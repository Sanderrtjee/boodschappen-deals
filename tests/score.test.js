'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const score = require('../boodschappen_deals/app/lib/score');

const dichtbij = (a, b, marge = 0.01) => Math.abs(a - b) <= marge;

test('labels', async (t) => {
  const gevallen = [
    // [label, verwachte factor (of null), verwacht aantal]
    ['1+1 gratis', 0.5, 2],
    ['2+1 gratis', 1 / 3, 3],
    ['1+1', 0.5, 2],
    ['2e gratis', 0.5, 2],
    ['2e halve prijs', 0.25, 2],
    ['50% korting op de 2e', 0.25, 2],
    ['3 halen 2 betalen', 1 / 3, 3],
    ['25% korting', 0.25, 1],
    ['-20%', 0.2, 1],
    ['2 voor 5,00', null, 2]
  ];
  for (const [label, factor, aantal] of gevallen) {
    await t.test(label, () => {
      const l = score.uitLabel(label);
      assert.ok(l, 'label niet herkend');
      if (factor === null) assert.equal(l.factor, null);
      else assert.ok(dichtbij(l.factor, factor), 'factor ' + l.factor);
      assert.equal(l.aantal, aantal);
    });
  }
  await t.test('1 voordeelpak is geen bundel', () => {
    const l = score.uitLabel('1 voordeelpak');
    assert.ok(!l || l.aantal === 1);
    assert.ok(!l || !(l.aantal > 1));
    const item = score.verrijk({ product_id: 1, naam: 'Koffie', label_tekst: '1 voordeelpak', prijs_nu: 5 });
    assert.equal(item.aantal_stuks, 1);
    assert.ok(!score.redenen(item).some((r) => r.includes('stuks nodig')));
  });
  await t.test('2e voor 1 euro', () => {
    // Schapprijs 3,00: twee voor 4,00 is 2,00 per stuk, 33% korting.
    const item = score.verrijk({ product_id: 1, naam: 'Pindakaas', label_tekst: '2e voor 1 euro', prijs_nu: 3 });
    assert.equal(item.aantal_stuks, 2);
    assert.ok(dichtbij(item.stuksprijs, 2), 'stuksprijs ' + item.stuksprijs);
    assert.equal(item.korting_pct, 33);
  });
});

test('eenheden', async (t) => {
  const gevallen = [
    ['500 g', 'gewicht', 500],
    ['2 x 200 g', 'gewicht', 400],
    ['6 x 33 cl', 'volume', 1980],
    ['1,5 liter', 'volume', 1500],
    ['per kilo', 'gewicht', 1000],
    ['per kg', 'gewicht', 1000],
    ['4 st', 'stuks', 4],
    ['6 stuks', 'stuks', 6]
  ];
  for (const [tekst, soort, basis] of gevallen) {
    await t.test(tekst, () => {
      const e = score.parseEenheid(tekst);
      assert.ok(e, 'niet herkend');
      assert.equal(e.soort, soort);
      assert.ok(dichtbij(e.basis, basis), 'basis ' + e.basis);
    });
  }
  await t.test('stuks geven geen kiloprijs', () => {
    const item = score.verrijk({ product_id: 1, naam: 'Avocado', eenheid: '4 st', prijs_nu: 2 });
    assert.equal(item.basisprijs, null);
  });
  await t.test('per kilo geeft de prijs zelf als kiloprijs', () => {
    const item = score.verrijk({ product_id: 1, naam: 'Mandarijnen', eenheid: 'per kilo', prijs_nu: 2.49 });
    assert.ok(item.basisprijs && dichtbij(item.basisprijs.prijs, 2.49));
  });
});

test('bundels van PLUS en ALDI: stuksprijs uit het label', async (t) => {
  await t.test('PLUS 3 voor 5.00 met de bundelprijs in prijs_nu', () => {
    const item = score.verrijk({
      product_id: 1, winkel: 'PLUS', naam: 'PLUS Kies & Mix Vers gesneden fruit',
      label_tekst: '3 voor 5.00 3 voor 5.00', deal_type: 'bundel',
      prijs_nu: 5, prijs_was: 7.47, prijs_per_stuk: 5
    });
    assert.ok(dichtbij(item.stuksprijs, 5 / 3), 'stuksprijs ' + item.stuksprijs);
    assert.ok(dichtbij(item.referentieprijs, 7.47 / 3), 'referentie ' + item.referentieprijs);
    assert.equal(item.korting_pct, 33);
  });
  await t.test('PLUS 2 voor 1.00 met de schapprijs in prijs_nu', () => {
    const item = score.verrijk({
      product_id: 1, winkel: 'PLUS', naam: 'PLUS Courgette groen',
      label_tekst: '2 voor 1.00 2 voor 1.00', deal_type: 'bundel',
      prijs_nu: 0.89, prijs_per_stuk: 0.89
    });
    assert.ok(dichtbij(item.stuksprijs, 0.5), 'stuksprijs ' + item.stuksprijs);
    assert.equal(item.korting_pct, 44);
  });
  await t.test('ALDI 2 VOOR zonder bedrag: prijs_nu is de bundelprijs', () => {
    const item = score.verrijk({
      product_id: 1, winkel: 'ALDI', naam: 'High protein skyr',
      label_tekst: '2 VOOR', deal_type: 'bundel', prijs_nu: 2.5, prijs_per_stuk: 2.5
    });
    assert.ok(dichtbij(item.stuksprijs, 1.25), 'stuksprijs ' + item.stuksprijs);
  });
  await t.test('Jumbo 2 voor 5,00 blijft 2,50', () => {
    const item = score.verrijk({
      product_id: 1, winkel: 'Jumbo', naam: 'Kipreepjes of flakes',
      label_tekst: '2 voor 5,00', deal_type: 'bundel', prijs_per_stuk: 2.5
    });
    assert.ok(dichtbij(item.stuksprijs, 2.5));
  });
});

test('bulk kijkt naar het gewicht, niet naar de prijs', () => {
  assert.ok(score.PROFIELEN.gezin.gewichten.bulk > 0, 'gezin heeft geen bulkgewicht');
  const som = Object.values(score.PROFIELEN.gezin.gewichten).reduce((a, b) => a + b, 0);
  assert.ok(dichtbij(som, 1), 'gewichten tellen op tot ' + som);

  const basis = { product_id: 1, naam: 'Rijst', prijs_nu: 3, prijs_was: 4 };
  const groot = score.verrijk({ ...basis, eenheid: '2 kg' });
  const klein = score.verrijk({ ...basis, eenheid: '200 g' });
  const opties = { profiel: 'gezin', huishouden: 4 };
  assert.ok(score.scoreVoor(groot, opties) > score.scoreVoor(klein, opties),
    'een groot pak moet bij gezin hoger scoren dan een klein pak voor dezelfde prijs');
});

test('alle profielen tellen op tot 1', () => {
  for (const [naam, p] of Object.entries(score.PROFIELEN)) {
    const som = Object.values(p.gewichten).reduce((a, b) => a + b, 0);
    assert.ok(dichtbij(som, 1), naam + ': ' + som);
  }
});
