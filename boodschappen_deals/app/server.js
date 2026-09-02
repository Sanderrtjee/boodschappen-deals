'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { URL } = require('node:url');

const { bouwConfig } = require('./lib/config');
const { Database } = require('./lib/db');
const { demoRijen } = require('./lib/demo');
const { Selecties } = require('./lib/selecties');
const score = require('./lib/score');

// ---------------------------------------------------------------------------
// Configuratie
// ---------------------------------------------------------------------------

const config = bouwConfig();

function log(niveau, bericht) {
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log('[' + t + '] ' + niveau + ': ' + bericht);
}

// Als /data niet bestaat (los draaien buiten Home Assistant) val terug op temp.
let dataDir = config.dataDir;
try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.W_OK);
} catch (e) {
  dataDir = path.join(os.tmpdir(), 'boodschappen-deals');
  fs.mkdirSync(dataDir, { recursive: true });
  log('waarschuwing', 'Kon ' + config.dataDir + ' niet gebruiken, ik schrijf naar ' + dataDir);
}
const receptenBestand = path.join(dataDir, 'recepten.json');

const db = new Database(config.db, log);
const selecties = new Selecties(dataDir, log);

// ---------------------------------------------------------------------------
// Cache: de dataset verandert maar een paar keer per dag, dus we houden de
// verrijkte rijen in het geheugen en scoren per verzoek. Dat is ruim snel
// genoeg voor een paar honderd aanbiedingen.
// ---------------------------------------------------------------------------

const cache = {
  items: null,
  geldigTot: 0,
  demo: false,
  fout: null,
  runs: [],
  bezig: null
};

// Na een fout willen we het snel opnieuw proberen. Een database die even weg is
// omdat hij herstart, moet niet een kwartier lang een lege site opleveren.
const HERKANSING_MS = 60000;

async function haalDataset(forceer) {
  if (!forceer && cache.items && Date.now() < cache.geldigTot) return cache;
  if (cache.bezig) return cache.bezig;

  cache.bezig = (async () => {
    let rijen = null;
    let fout = null;

    // Demodata alleen als er helemaal geen database is ingesteld. Is er wel een
    // database maar hapert die, dan tonen we niets in plaats van verzonnen
    // aanbiedingen: op een publieke site is nepdata erger dan een lege pagina.
    const demoModus = config.demoAf || !db.beschikbaar;

    if (!demoModus) {
      try {
        rijen = await db.aanbiedingen();
        cache.runs = await db.runs();
        if (rijen.length === 0) {
          fout = 'De database is bereikbaar maar bevat geen actuele aanbiedingen. Heeft de n8n-flow al gelopen?';
        }
      } catch (e) {
        fout = 'De database is niet bereikbaar: ' + e.message;
        log('fout', fout);
        rijen = [];
      }
    } else {
      rijen = demoRijen();
    }

    cache.demo = demoModus;
    cache.items = rijen.map(score.verrijk).filter((i) => i.naam);
    cache.fout = fout;
    cache.geldigTot = Date.now() + (fout ? HERKANSING_MS : config.cacheMinuten * 60000);
    log(
      fout ? 'waarschuwing' : 'info',
      'Dataset geladen: ' + cache.items.length + ' aanbiedingen' + (demoModus ? ' (demodata)' : '')
    );
    cache.bezig = null;
    return cache;
  })();

  return cache.bezig;
}

// ---------------------------------------------------------------------------
// Filteren, scoren en sorteren
// ---------------------------------------------------------------------------

function lijst(param) {
  if (!param) return [];
  return String(param)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function selecteer(items, q, selectie) {
  const winkels = lijst(q.get('winkels'));
  const categorieen = lijst(q.get('categorieen'));
  const dieten = lijst(q.get('dieet'));
  const zoek = (q.get('q') || '').trim().toLowerCase();
  const maxPrijs = parseFloat(q.get('max_prijs') || '');
  const minKorting = parseFloat(q.get('min_korting') || '');
  const toonNonfood = q.get('nonfood') === '1';
  const winkelBezoek = q.get('winkelbezoek') || 'alles'; // alles | online | winkel
  const alleenMetKorting = q.get('alleen_korting') === '1';
  const profiel = q.get('profiel') || 'alles';
  const huishouden = Math.min(5, Math.max(1, parseInt(q.get('huishouden') || '2', 10)));

  const opties = { profiel, huishouden };

  // Bij een assistent-selectie bepaalt die de deelnemers en de volgorde. De
  // gewone filters blijven daarbovenop werken, zodat iemand die geen Lidl in de
  // buurt heeft ook binnen zo'n selectie kan filteren.
  const gekozenIds = selectie
    ? new Map(selectie.deals.map((d, i) => [d.product_id, { reden: d.reden, positie: i }]))
    : null;

  const uit = [];
  for (const item of items) {
    if (gekozenIds && !gekozenIds.has(item.product_id)) continue;
    if (winkels.length && !winkels.includes(item.winkel)) continue;
    if (!toonNonfood && item.kenmerken.is_nonfood) continue;
    if (categorieen.length && !categorieen.includes(item.categorie)) continue;
    if (dieten.length && !dieten.every((d) => score.dieetToegestaan(item, d))) continue;
    if (Number.isFinite(maxPrijs) && maxPrijs > 0) {
      if (item.stuksprijs === null || item.stuksprijs > maxPrijs) continue;
    }
    if (Number.isFinite(minKorting) && minKorting > 0) {
      if (item.korting_pct === null || item.korting_pct < minKorting) continue;
    }
    if (alleenMetKorting && item.korting_pct === null) continue;
    if (winkelBezoek === 'online' && item.alleen_in_winkel) continue;
    if (winkelBezoek === 'winkel' && !item.alleen_in_winkel) continue;
    if (zoek && !item.zoektekst.includes(zoek)) continue;

    const gekozen = gekozenIds ? gekozenIds.get(item.product_id) : null;
    uit.push({
      item,
      score: score.scoreVoor(item, opties),
      reden: gekozen ? gekozen.reden : null,
      positie: gekozen ? gekozen.positie : null
    });
  }
  return uit;
}

const sorteerders = {
  // De volgorde van de assistent zelf, met de eigen score als terugval.
  selectie: (a, b) => (a.positie ?? 999) - (b.positie ?? 999) || b.score - a.score,
  score: (a, b) => b.score - a.score,
  korting: (a, b) => (b.item.korting_pct ?? -1) - (a.item.korting_pct ?? -1),
  prijs: (a, b) => (a.item.stuksprijs ?? 1e9) - (b.item.stuksprijs ?? 1e9),
  kiloprijs: (a, b) => {
    const pa = a.item.basisprijs ? a.item.basisprijs.prijs : 1e9;
    const pb = b.item.basisprijs ? b.item.basisprijs.prijs : 1e9;
    return pa - pb;
  },
  naam: (a, b) => a.item.naam.localeCompare(b.item.naam, 'nl'),
  winkel: (a, b) => a.item.winkel.localeCompare(b.item.winkel, 'nl') || b.score - a.score
};

// De links en afbeeldingen komen uit gescrapete HTML. We laten alleen http(s)
// door, zodat een rare waarde in de database geen javascript:-link kan worden.
function veiligeUrl(waarde) {
  return /^https?:\/\//i.test(String(waarde || '')) ? waarde : null;
}

function naarBuiten(rij) {
  const i = rij.item;
  return {
    id: i.product_id,
    winkel: i.winkel,
    naam: i.naam,
    categorie: i.categorie,
    winkelcategorie: i.winkelcategorie,
    eenheid: i.eenheid,
    afbeelding: veiligeUrl(i.afbeelding),
    link: veiligeUrl(i.link),
    label: i.label_tekst,
    deal_type: i.deal_type,
    uitzondering: i.uitzondering,
    alleen_in_winkel: i.alleen_in_winkel,
    geldig_tot: i.geldig_tot,
    geldigheid_tekst: i.geldigheid_tekst,
    prijs_nu: i.prijs_nu,
    prijs_was: i.prijs_was,
    stuksprijs: i.stuksprijs,
    referentieprijs: i.referentieprijs,
    basisprijs: i.basisprijs,
    aantal_stuks: i.aantal_stuks,
    korting_pct: i.korting_pct,
    korting_hard: i.korting_hard,
    tags: i.tags,
    eiwitrijk: i.kenmerken.eiwitrijk,
    vers: i.kenmerken.vers,
    plantaardig: i.kenmerken.is_plantaardig,
    score: rij.score,
    redenen: score.redenen(i),
    toelichting: rij.reden || null
  };
}

// ---------------------------------------------------------------------------
// HTTP-helpers
// ---------------------------------------------------------------------------

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const publicDir = path.join(__dirname, 'public');

// Versie uit package.json, plus de starttijd. Die hangen we als queryparameter
// achter styles.css en app.js, zodat een browser na een update van de add-on
// gegarandeerd de nieuwe bestanden ophaalt in plaats van zijn eigen cache.
const versie = (() => {
  try {
    return require('./package.json').version + '-' + Math.floor(Date.now() / 1000);
  } catch (e) {
    return String(Date.now());
  }
})();

function stuurJson(res, statuscode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statuscode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function stuurBestand(res, bestandsnaam) {
  const veilig = path.normalize(bestandsnaam).replace(/^(\.\.[/\\])+/, '');
  const volledig = path.join(publicDir, veilig);
  if (!volledig.startsWith(publicDir)) {
    res.writeHead(403).end('Verboden');
    return;
  }
  try {
    let data = await fsp.readFile(volledig);
    const ext = path.extname(volledig).toLowerCase();
    if (ext === '.html') data = Buffer.from(data.toString('utf8').split('__VERSIE__').join(versie));
    // HTML, CSS en JS niet laten cachen: anders zien bezoekers na een update
    // van de add-on nog een uur de oude versie. Het gaat om enkele tientallen
    // kilobytes, dus dat kost niets. Plaatjes en fonts mogen wel blijven staan.
    const versGehouden = ext === '.html' || ext === '.css' || ext === '.js';
    res.writeHead(200, {
      'content-type': mimeTypes[ext] || 'application/octet-stream',
      'cache-control': versGehouden ? 'no-cache' : 'public, max-age=86400'
    });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Niet gevonden');
  }
}

function leesBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let totaal = 0;
    const delen = [];
    req.on('data', (c) => {
      totaal += c.length;
      if (totaal > maxBytes) {
        reject(new Error('Verzoek te groot'));
        req.destroy();
        return;
      }
      delen.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(delen).toString('utf8')));
    req.on('error', reject);
  });
}

function tokenGeldig(req) {
  if (!config.importToken) return false;
  const kop = req.headers.authorization || '';
  const bearer = kop.startsWith('Bearer ') ? kop.slice(7).trim() : '';
  const los = String(req.headers['x-import-token'] || '').trim();
  return bearer === config.importToken || los === config.importToken;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function meta() {
  const data = await haalDataset(false);
  const bewaardeSelecties = await selecties.alle();
  const beschikbareIds = new Set(data.items.map((i) => i.product_id));
  const winkels = new Map();
  const categorieen = new Map();
  let maxPrijs = 0;

  for (const item of data.items) {
    const w = winkels.get(item.winkel) || { naam: item.winkel, aantal: 0, datum: null };
    w.aantal += 1;
    if (!w.datum || String(item.scrape_datum) > String(w.datum)) w.datum = item.scrape_datum;
    winkels.set(item.winkel, w);

    if (!item.kenmerken.is_nonfood) {
      categorieen.set(item.categorie, (categorieen.get(item.categorie) || 0) + 1);
    }
    if (item.stuksprijs && item.stuksprijs > maxPrijs) maxPrijs = item.stuksprijs;
  }

  const laatste = [...winkels.values()]
    .map((w) => w.datum)
    .filter(Boolean)
    .sort()
    .pop();

  // Een scrape die is blijven hangen is gevaarlijker dan geen scrape: de site
  // toont dan vorige week alsof het deze week is. Reken daarom per winkel uit
  // hoe oud de data is, zodat de pagina daar eerlijk over kan zijn.
  const vandaag = new Date();
  vandaag.setHours(0, 0, 0, 0);
  const winkelLijst = [...winkels.values()].map((w) => {
    let dagenOud = null;
    if (w.datum) {
      const d = new Date(String(w.datum) + 'T00:00:00');
      if (!isNaN(d)) dagenOud = Math.round((vandaag - d) / 86400000);
    }
    return { ...w, dagen_oud: dagenOud, verouderd: dagenOud !== null && dagenOud > 8 };
  });

  return {
    site_titel: config.siteTitel,
    demo: data.demo,
    fout: data.fout,
    laatste_update: laatste ? String(laatste).slice(0, 10) : null,
    totaal: data.items.length,
    winkels: winkelLijst.sort((a, b) => a.naam.localeCompare(b.naam, 'nl')),
    categorieen: [...categorieen.entries()]
      .map(([naam, aantal]) => ({ naam, aantal }))
      .sort((a, b) => b.aantal - a.aantal),
    max_prijs: Math.ceil(maxPrijs),
    // De door de assistent samengestelde selecties staan vooraan: dat is de
    // curatie die de gebruiker wil zien. Daarna de eigen, altijd werkende
    // profielen als terugval.
    profielen: [
      ...bewaardeSelecties.map((s) => ({
        sleutel: s.sleutel,
        naam: s.naam,
        omschrijving: s.omschrijving || 'Samengesteld door de assistent.',
        icoon: s.icoon || 'sparkles',
        bron: 'assistent',
        gegenereerd_op: s.gegenereerd_op,
        aantal: s.deals.length,
        nog_actueel: s.deals.filter((d) => beschikbareIds.has(d.product_id)).length
      })),
      ...Object.entries(score.PROFIELEN).map(([sleutel, p]) => ({
        sleutel,
        naam: p.naam,
        omschrijving: p.omschrijving,
        icoon: p.icoon,
        bron: 'regels'
      }))
    ],
    dieten: Object.entries(score.DIEETEN)
      .filter(([s]) => s !== 'alles')
      .map(([sleutel, d]) => ({ sleutel, naam: d.naam })),
    runs: data.runs
  };
}

async function deals(q) {
  const data = await haalDataset(false);

  // Is het gekozen profiel een assistent-selectie? Dan is dat de bron.
  const profielSleutel = q.get('profiel') || 'alles';
  const selectie = score.PROFIELEN[profielSleutel]
    ? null
    : await selecties.een(profielSleutel);

  const gekozen = selecteer(data.items, q, selectie);

  // Zonder expliciete sorteerkeuze volgt een selectie de volgorde van de
  // assistent; kiest de bezoeker zelf iets, dan wint dat.
  const sorteer =
    sorteerders[q.get('sort')] || (selectie ? sorteerders.selectie : sorteerders.score);
  gekozen.sort(sorteer);

  const limiet = Math.min(500, Math.max(1, parseInt(q.get('limit') || '60', 10)));
  const start = Math.max(0, parseInt(q.get('offset') || '0', 10));
  const pagina = gekozen.slice(start, start + limiet);

  // Wat een korte samenvatting bovenaan de pagina kan tonen.
  const metKorting = gekozen.filter((r) => r.item.korting_pct !== null);
  const gemiddeldeKorting = metKorting.length
    ? Math.round(metKorting.reduce((s, r) => s + r.item.korting_pct, 0) / metKorting.length)
    : null;

  return {
    totaal: gekozen.length,
    offset: start,
    limit: limiet,
    demo: data.demo,
    selectie: selectie
      ? {
          sleutel: selectie.sleutel,
          naam: selectie.naam,
          gegenereerd_op: selectie.gegenereerd_op,
          gevraagd: selectie.deals.length,
          // Hoeveel van de gekozen producten staan nog in de actuele scrape?
          nog_actueel: selectie.deals.filter((d) =>
            data.items.some((i) => i.product_id === d.product_id)
          ).length
        }
      : null,
    laatste_update: data.items.length
      ? String(data.items.map((i) => i.scrape_datum).filter(Boolean).sort().pop() || '').slice(0, 10)
      : null,
    samenvatting: {
      gemiddelde_korting: gemiddeldeKorting,
      beste_korting: metKorting.length
        ? Math.max(...metKorting.map((r) => r.item.korting_pct))
        : null,
      eiwitrijk: gekozen.filter((r) => r.item.kenmerken.eiwitrijk).length
    },
    items: pagina.map(naarBuiten)
  };
}

// Recepten kunnen uit twee hoeken komen: het losse recepten-endpoint, en de
// selecties die de assistent instuurt. Ze worden hier samengevoegd met een
// label erbij, zodat de site kan laten zien waar een recept vandaan komt.
async function leesRecepten() {
  const uit = [];
  let laatste = null;

  try {
    const data = JSON.parse(await fsp.readFile(receptenBestand, 'utf8'));
    for (const r of data.recepten || []) uit.push({ ...r, bron: null });
    laatste = data.gegenereerd_op || null;
  } catch (e) {
    /* geen los receptenbestand, dat mag */
  }

  for (const s of await selecties.alle()) {
    for (const r of s.recepten || []) uit.push({ ...r, bron: s.naam });
    if (!laatste || (s.gegenereerd_op && s.gegenereerd_op > laatste)) {
      laatste = s.gegenereerd_op;
    }
  }

  return { recepten: uit, gegenereerd_op: laatste };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    res.writeHead(400).end('Ongeldig verzoek');
    return;
  }

  // Home Assistant ingress zet de app achter /api/hassio_ingress/<token>/.
  // We knippen dat prefix eraf zodat de routes hieronder gelijk blijven.
  let pad = url.pathname.replace(/\/{2,}/g, '/');
  const ingress = pad.match(/^\/api\/hassio_ingress\/[^/]+(\/.*)?$/);
  if (ingress) pad = ingress[1] || '/';
  if (pad.length > 1 && pad.endsWith('/')) pad = pad.slice(0, -1);

  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');

  try {
    if (req.method === 'GET' && (pad === '/' || pad === '/index.html')) {
      return stuurBestand(res, 'index.html');
    }

    if (req.method === 'GET' && pad === '/api/health') {
      const data = await haalDataset(false);
      const antwoord = {
        status: 'ok',
        demo: data.demo,
        aanbiedingen: data.items.length,
        database: db.beschikbaar ? (data.fout ? 'fout' : 'verbonden') : 'niet ingesteld',
        fout: data.fout || null
      };

      // Waar de add-on precies verbinding mee probeert te maken is het eerste
      // wat je wilt weten als het niet werkt. Maar het zijn interne
      // hostnamen, dus dat vertellen we alleen aan wie het token heeft.
      if (tokenGeldig(req)) {
        antwoord.verbinding = {
          host: config.db.host || null,
          poort: config.db.port,
          database: config.db.database,
          gebruiker: config.db.user,
          ssl: config.db.ssl
        };
        antwoord.winkels = {};
        for (const item of data.items) {
          antwoord.winkels[item.winkel] = (antwoord.winkels[item.winkel] || 0) + 1;
        }
        antwoord.selecties = (await selecties.alle()).map((s) => ({
          sleutel: s.sleutel,
          deals: s.deals.length,
          gegenereerd_op: s.gegenereerd_op
        }));
      }

      return stuurJson(res, 200, antwoord);
    }

    if (req.method === 'GET' && pad === '/api/meta') {
      return stuurJson(res, 200, await meta());
    }

    if (req.method === 'GET' && pad === '/api/deals') {
      return stuurJson(res, 200, await deals(url.searchParams));
    }

    if (req.method === 'GET' && pad === '/api/recepten') {
      return stuurJson(res, 200, await leesRecepten());
    }

    if (req.method === 'POST' && pad === '/api/import/recepten') {
      if (!tokenGeldig(req)) return stuurJson(res, 401, { fout: 'Ongeldig of ontbrekend token' });
      const ruw = await leesBody(req, 1024 * 512);
      let data;
      try {
        data = JSON.parse(ruw);
      } catch (e) {
        return stuurJson(res, 400, { fout: 'Body is geen geldige JSON' });
      }
      const recepten = Array.isArray(data.recepten) ? data.recepten : [];
      const inhoud = {
        recepten,
        gegenereerd_op: data.gegenereerd_op || new Date().toISOString()
      };
      await fsp.writeFile(receptenBestand, JSON.stringify(inhoud, null, 2), 'utf8');
      log('info', 'Recepten ontvangen: ' + recepten.length);
      return stuurJson(res, 200, { status: 'ok', opgeslagen: recepten.length });
    }

    if (req.method === 'POST' && pad === '/api/import/selectie') {
      if (!tokenGeldig(req)) return stuurJson(res, 401, { fout: 'Ongeldig of ontbrekend token' });
      const ruw = await leesBody(req, 1024 * 512);
      let data;
      try {
        data = JSON.parse(ruw);
      } catch (e) {
        return stuurJson(res, 400, { fout: 'Body is geen geldige JSON' });
      }
      try {
        const bewaard = await selecties.bewaar(data);
        log('info', 'Selectie "' + bewaard.sleutel + '" ontvangen: ' + bewaard.deals.length + ' deals');
        return stuurJson(res, 200, {
          status: 'ok',
          sleutel: bewaard.sleutel,
          deals: bewaard.deals.length,
          recepten: bewaard.recepten.length
        });
      } catch (e) {
        return stuurJson(res, 400, { fout: e.message });
      }
    }

    if (req.method === 'DELETE' && pad.startsWith('/api/import/selectie/')) {
      if (!tokenGeldig(req)) return stuurJson(res, 401, { fout: 'Ongeldig of ontbrekend token' });
      const sleutel = decodeURIComponent(pad.slice('/api/import/selectie/'.length));
      const weg = await selecties.verwijder(sleutel);
      return stuurJson(res, weg ? 200 : 404, weg ? { status: 'ok' } : { fout: 'Niet gevonden' });
    }

    if (req.method === 'POST' && pad === '/api/verversen') {
      if (!tokenGeldig(req)) return stuurJson(res, 401, { fout: 'Ongeldig of ontbrekend token' });
      const data = await haalDataset(true);
      return stuurJson(res, 200, { status: 'ok', aanbiedingen: data.items.length, demo: data.demo });
    }

    if (req.method === 'GET') {
      return stuurBestand(res, pad.slice(1));
    }

    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Methode niet toegestaan');
  } catch (e) {
    log('fout', 'Onverwachte fout op ' + pad + ': ' + e.stack);
    if (!res.headersSent) stuurJson(res, 500, { fout: 'Interne serverfout' });
  }
});

server.listen(config.poort, '0.0.0.0', () => {
  log('info', config.siteTitel + ' luistert op poort ' + config.poort);
  log('info', 'Instellingen gelezen uit ' + config.bron);
  // Zonder token geeft /api/import/* altijd 401. Dat is opzet, maar het is een
  // 401 die niets over de oorzaak zegt, dus zeg het hier wel.
  log(
    config.importToken ? 'info' : 'waarschuwing',
    config.importToken
      ? 'Import-endpoints staan aan, token is ingesteld (' + config.importToken.length + ' tekens)'
      : 'Geen import_token ingesteld: /api/import/selectie en /api/verversen geven 401'
  );
  log('info', db.beschikbaar
    ? 'Database: ' + config.db.user + '@' + config.db.host + ':' + config.db.port + '/' + config.db.database
    : 'Geen database ingesteld, de site draait op demodata.');
  haalDataset(true).catch((e) => log('fout', e.message));
});

for (const signaal of ['SIGTERM', 'SIGINT']) {
  process.on(signaal, async () => {
    log('info', 'Afsluiten na ' + signaal);
    server.close();
    await db.sluit();
    process.exit(0);
  });
}
