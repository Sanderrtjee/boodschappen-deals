'use strict';

// Tabeltests voor de classificatie. Het belangrijkste doel: het dieetfilter mag
// nooit vlees of vis doorlaten. Iets te veel wegfilteren mag wel.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { classificeer } = require('../boodschappen_deals/app/lib/classify');
const score = require('../boodschappen_deals/app/lib/score');

const k = (naam, categorie = null, eenheid = null) => classificeer({ naam, categorie, eenheid });
const magVoor = (dieet, naam, categorie = null) =>
  score.dieetToegestaan(score.verrijk({ product_id: 1, naam, categorie }), dieet);

// Vlees dat het filter liet passeren (audit 20-11-2026 en live onder dieet=vegetarisch).
const VLEES = [
  ['Beenham'],
  ['Achterham'],
  ['Gegrilde beenham', 'NU of nooit'],
  ['Kogelbiefstuk'],
  ['AH Excellent hertenbiefstuk', 'Vlees'],
  ['Gelderse worst'],
  ['Leverpastei'],
  ['Pulled pork'],
  ['Salami snack'],
  ['Kipsate snacks'],
  ['AH Stoofvleesblokjes', 'Vlees'],
  ['AH Schouderkarbonade 2 stuks', 'Vlees'],
  ['Zwagerman Yorkham', 'Food'],
  ['Kipschnitzels'],
  ['Curryworsten', 'Vlees, vis en vega'],
  ['AH Scharrelkipkluifjes', 'Vlees'],
  ['AH Gerookte slagersachterham van de versafdeling', 'Vleeswaren'],
  ['Peper- of Elzasser cervelaat', 'Kaas en vleeswaren'],
  ['Alle AH Cervelaat', 'Vleeswaren'],
  ['Alle BiFi', 'Borrel, chips, snacks'],
  ['AH Brabantse worstenbroodjes of hotdog', 'Maaltijden, salades'],
  ['Uit de keuken van PLUS Spaghetti meatball', 'Verse maaltijden, gemak, salades'],
  ['Alle Mora oven & airfryer snacks 2-8 stuks', 'Diepvries'],
  ['AH Vleeswaren van de versafdeling', 'Vleeswaren'],
  ['AH Ovenspecialiteiten', 'Vlees'],
  ['Spekknabbels', 'Weekacties'],
  ['Alle Unox Knaks', 'Vlees'],
  ['Knaks', 'NU of nooit'],
  ['Chicken wings', 'Weekacties'],
  ['Herten-medaillon', 'Vlees, vis en vega'],
  ['Duitse goulash', 'Weekacties'],
  ['- Zigeunergehaktschnitzel', 'Food'],
  ['- Rundertartaartje', 'Food'],
  ['Riblappen'],
  ['Hamlappen', 'Vlees, vis en vega'],
  ['AH Paté kleinverpakking', 'Vleeswaren'],
  ['AH Excellent kroketjes', 'Diepvries'],
  ['Verspakket Griekse gehaktschotel, tomatensoep, lasagne of lemon chicken'],
  ['Peper, vegan of boschampignonspaté', 'Weekacties'],
  ['Dr. Oetker Casa di Mama salami', 'Food'],
  ['Kip schnitzel, kip krokant schnitzel, kip saté schnitzel, kip cordon bleu'],
  ['Hamburgers'],
  ['Gebraden gehakt', 'Kaas en vleeswaren']
];

const VIS = [
  ['Gerookte paling'],
  ['Alle AH Gerookte zalm', 'Vis'],
  ['Iglo vissticks', 'Food'],
  ['- Kabeljauwburgers', 'Food'],
  ['Jumbo surimisticks'],
  ['Hollandse Nieuwe haring', 'Vlees, vis en vega'],
  ['Jumbo gemarineerde pangasiusfilet'],
  ['Tonijn in pikante saus', 'Weekacties'],
  ['AH Excellent hele vis', 'Vis']
];

// Vegetarische producten die wel door het filter moeten.
const VEGETARISCH = [
  ['Hamburgerbroodjes'],
  ['Fijne champignons'],
  ['Champagne'],
  ['Vleestomaten'],
  ['Goudse kaasplakken 48+', 'Weekacties'],
  ['Brie', 'A-merken'],
  ['Jumbo tofu of tempeh naturel'],
  ['Ijsbergsla'],
  ['Vegetarische schnitzel'],
  ['Hummus naturel', 'Borrelhapjes'],
  ['Uit de keuken van PLUS Pizza Funghi', 'Verse maaltijden, gemak, salades'],
  ['Crème fraîche'],
  ['Weekendtas']
];

test('vlees wordt herkend en valt buiten vegetarisch', async (t) => {
  for (const [naam, cat] of VLEES) {
    await t.test(naam, () => {
      assert.equal(magVoor('vegetarisch', naam, cat), false, naam + ' mag niet vegetarisch zijn');
      assert.equal(magVoor('veganistisch', naam, cat), false);
      assert.equal(magVoor('pescotarisch', naam, cat), false);
    });
  }
});

test('vis valt buiten vegetarisch maar mag bij pescotarisch', async (t) => {
  for (const [naam, cat] of VIS) {
    await t.test(naam, () => {
      assert.equal(magVoor('vegetarisch', naam, cat), false, naam + ' mag niet vegetarisch zijn');
      assert.equal(magVoor('pescotarisch', naam, cat), true, naam + ' is vis, geen vlees');
    });
  }
});

test('vegetarische producten blijven zichtbaar', async (t) => {
  for (const [naam, cat] of VEGETARISCH) {
    await t.test(naam, () => {
      assert.equal(magVoor('vegetarisch', naam, cat), true, naam + ' is vegetarisch');
    });
  }
});

test('varkensvlees, ook als de soort onbekend is', async (t) => {
  const varken = ['Beenham', 'Pulled pork', 'Spekknabbels', 'Gelderse worst', 'Zwagerman Yorkham',
    'AH Vleeswaren van de versafdeling', 'Speklappen'];
  for (const naam of varken) {
    await t.test(naam, () => assert.equal(magVoor('geen_varkensvlees', naam), false));
  }
  for (const naam of ['Hamburgerbroodjes', 'Hamamelis', 'Champignons', 'AH Excellent hertenbiefstuk',
    'Jumbo kipdijfiletblokjes', 'AH Mager rundergehakt 300 gram']) {
    await t.test('wel: ' + naam, () => assert.equal(magVoor('geen_varkensvlees', naam), true));
  }
});

test('veganistisch weert zuivel en ei, ook in snoep', async (t) => {
  for (const naam of ['Alle Milka chocolade 87-100 gram', 'Brie', 'Scharreleieren 10 stuks',
    'Choco met slagroom', 'AH Roomboterappelflappen']) {
    await t.test(naam, () => assert.equal(magVoor('veganistisch', naam), false));
  }
  await t.test('tofu mag', () => assert.equal(magVoor('veganistisch', 'Jumbo tofu of tempeh naturel'), true));
});

test('geen valse categorieën', async (t) => {
  const gevallen = [
    ['IJsbergsla', (c) => !c.is_snoep && c.tags.includes('groente_fruit')],
    ['Portobello', (c) => !c.is_alcohol],
    ['Ginger ale', (c) => !c.is_alcohol],
    ['Wijnazijn', (c) => !c.is_alcohol],
    ['Visolie capsules', (c) => c.hoofdcategorie !== 'Vis'],
    ['Hamamelis', (c) => !c.bevat_vlees && !c.bevat_varken],
    ['Hamburgerbroodjes', (c) => !c.bevat_vlees && !c.bevat_varken],
    ['Crème fraîche', (c) => c.bevat_zuivel],
    ['Rosé', (c) => c.is_alcohol],
    ['Salami snack', (c) => c.bevat_vlees && c.hoofdcategorie === 'Vlees'],
    ['Paprikachips', (c) => c.is_snoep && !c.tags.includes('groente_fruit')]
  ];
  for (const [naam, check] of gevallen) {
    await t.test(naam, () => assert.ok(check(k(naam)), naam + ': ' + JSON.stringify(k(naam))));
  }
});

// Regressie over de echte productnamen van 20-11-2026: elke naam waarin
// onmiskenbaar vlees of vis staat, moet buiten vegetarisch vallen.
test('live dataset: geen bekend vlees onder vegetarisch', () => {
  const rijen = require(path.join(__dirname, 'fixtures', 'live-2026-11-20.json'));
  const onmiskenbaar = /(gehakt|worst|biefstuk|schnitzel|cervelaat|salami|spek|ham\b|hamlap|beenham|yorkham|rookworst|kip|zalm|tonijn|haring|vissticks|pangasius|riblap|karbonade|stoofvlees|goulash|chicken|knaks|paté|tartaar|kroket|medaillon|vleeswaren|bifi)/i;
  const fout = rijen
    .filter((r) => onmiskenbaar.test(r.naam))
    .filter((r) => score.dieetToegestaan(score.verrijk({ product_id: 1, ...r }), 'vegetarisch'))
    .map((r) => r.winkel + ': ' + r.naam);
  assert.deepEqual(fout, []);
});

test('merknamen en speelgoed', () => {
  assert.notEqual(k('Alle Duyvis 175-275 gram', 'Borrel, chips, snacks').hoofdcategorie, 'Vis');
  assert.equal(k('Alle Duyvis 175-275 gram').bevat_vis, false);
  assert.equal(k('Doorables knuffel', 'Sintassortiment ').is_snoep, false);
  assert.equal(k("Pim's of scholiertje").bevat_vis, false);
});
