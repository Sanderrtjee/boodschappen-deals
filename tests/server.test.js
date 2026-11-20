'use strict';

// Starten de echte server (demomodus, of met een database die niet bestaat)
// en controleren de hardening van werkpakket 3.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startServer } = require('./helpers');

const TOKEN = 'test-token-' + 'x'.repeat(29); // 40 tekens

test('server in demomodus', async (t) => {
  const s = await startServer({ IMPORT_TOKEN: TOKEN });
  t.after(() => s.stop());

  await t.test('health, meta en deals werken', async () => {
    const h = await (await s.vraag('/api/health')).json();
    assert.equal(h.status, 'ok');
    assert.equal(h.demo, true);
    assert.equal(h.verbinding, undefined, 'zonder token geen verbindingsgegevens');
    const m = await s.vraag('/api/meta');
    assert.equal(m.status, 200);
    const d = await (await s.vraag('/api/deals?dieet=vegetarisch&limit=500')).json();
    assert.ok(d.items.length > 0);
  });

  await t.test('beveiligingsheaders', async () => {
    const r = await s.vraag('/');
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('strict-transport-security'), null, 'geen HSTS over gewone http');
    const html = await r.text();
    assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/);
    assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'geen inline scripts');
    assert.doesNotMatch(html, /\sstyle="/, 'geen inline stijlen');

    const viaCf = await s.vraag('/', { headers: { 'x-forwarded-proto': 'https', 'cf-connecting-ip': '203.0.113.9' } });
    assert.match(viaCf.headers.get('strict-transport-security') || '', /max-age=\d+/);
  });

  await t.test('lettertypes komen van de eigen server', async () => {
    const css = await s.vraag('/fonts/fonts.css');
    assert.equal(css.status, 200);
    const f = await s.vraag('/fonts/manrope-latin.woff2');
    assert.equal(f.status, 200);
    assert.equal(f.headers.get('content-type'), 'font/woff2');
  });

  await t.test('HEAD werkt', async () => {
    const r = await s.vraag('/', { method: 'HEAD' });
    assert.equal(r.status, 200);
    const api = await s.vraag('/api/health', { method: 'HEAD' });
    assert.equal(api.status, 200);
  });

  await t.test('ingress-prefix alleen van het ingress-adres', async () => {
    const r = await s.vraag('/api/hassio_ingress/abc123/api/meta');
    assert.equal(r.status, 404);
  });

  await t.test('401 noemt de lengte van het token niet', async () => {
    const r = await s.vraag('/api/verversen', { method: 'POST', headers: { authorization: 'Bearer fout' } });
    assert.equal(r.status, 401);
    const body = await r.text();
    assert.ok(!body.includes(String(TOKEN.length)), body);
    assert.doesNotMatch(body, /tekens/);
    assert.doesNotMatch(s.log(), new RegExp(TOKEN.length + ' tekens'));
  });

  await t.test('na 5 fouten een 429, maar een geldig token gaat altijd voor', async () => {
    // Er is al één fout geteld in de vorige test.
    for (let i = 0; i < 4; i++) {
      const r = await s.vraag('/api/import/selectie', { method: 'POST', headers: { authorization: 'Bearer fout' }, body: '{}' });
      assert.equal(r.status, 401);
    }
    const geblokt = await s.vraag('/api/verversen', { method: 'POST', headers: { authorization: 'Bearer fout' } });
    assert.equal(geblokt.status, 429);
    assert.ok(Number(geblokt.headers.get('retry-after')) > 0);
    const geldig = await s.vraag('/api/verversen', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN } });
    assert.equal(geldig.status, 200);
  });

  await t.test('import via Cloudflare staat dicht, ook met een geldig token', async () => {
    const r = await s.vraag('/api/verversen', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + TOKEN, 'cf-connecting-ip': '203.0.113.9' }
    });
    assert.equal(r.status, 404);
    const h = await (await s.vraag('/api/health', {
      headers: { authorization: 'Bearer ' + TOKEN, 'cf-ray': 'abc' }
    })).json();
    assert.equal(h.verbinding, undefined, 'geen details via het publieke domein');
  });

  await t.test('recepten worden atomisch weggeschreven', async () => {
    const r = await s.vraag('/api/import/recepten', {
      method: 'POST',
      headers: { 'x-import-token': TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ recepten: [{ naam: 'Test' }] })
    });
    assert.equal(r.status, 200);
    const terug = await (await s.vraag('/api/recepten')).json();
    assert.equal(terug.recepten[0].naam, 'Test');
    const rest = fs.readdirSync(s.dataDir).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(rest, []);
  });
});

test('ingress-prefix werkt vanaf het ingress-adres', async (t) => {
  const s = await startServer({ INGRESS_IP: '127.0.0.1' });
  t.after(() => s.stop());
  const r = await s.vraag('/api/hassio_ingress/abc123/api/meta');
  assert.equal(r.status, 200);
  const root = await s.vraag('/api/hassio_ingress/abc123/');
  assert.equal(root.status, 200);
  assert.equal(root.headers.get('strict-transport-security'), null, 'geen HSTS via ingress');
});

test('databasefout lekt geen interne details', async (t) => {
  const s = await startServer({ DB_HOST: '127.0.0.1', DB_PORT: '1', DB_PASSWORD: 'x', IMPORT_TOKEN: TOKEN });
  t.after(() => s.stop());
  const h = await (await s.vraag('/api/health')).json();
  assert.equal(h.database, 'fout');
  assert.doesNotMatch(JSON.stringify(h), /ECONNREFUSED|127\.0\.0\.1|:1\b/);
  const m = await (await s.vraag('/api/meta')).json();
  assert.doesNotMatch(JSON.stringify(m.fout || ''), /ECONNREFUSED|127\.0\.0\.1/);
  // Met token (via het LAN) wel het detail, voor wie het moet oplossen.
  const metToken = await (await s.vraag('/api/health', { headers: { authorization: 'Bearer ' + TOKEN } })).json();
  assert.match(metToken.fout_detail || '', /ECONNREFUSED|connect/);
});
