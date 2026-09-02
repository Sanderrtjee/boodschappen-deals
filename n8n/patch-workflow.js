'use strict';

// Past de n8n-workflow aan zodat hij de website voedt.
// Elke wijziging wordt geteld; als een vervanging niet aanslaat, faalt het
// script. Stille mislukkingen zijn hier het gevaar.

const fs = require('fs');

const bron = process.argv[2];
const doel = process.argv[3];
const wf = JSON.parse(fs.readFileSync(bron, 'utf8'));

const gedaan = [];
const fouten = [];

function knoop(naam) {
  const n = wf.nodes.find((x) => x.name === naam);
  if (!n) fouten.push('Node niet gevonden: ' + naam);
  return n;
}

function vervang(naam, veld, zoek, nieuw, beschrijving) {
  const n = knoop(naam);
  if (!n) return;
  const huidig = n.parameters[veld];
  if (typeof huidig !== 'string' || !huidig.includes(zoek)) {
    fouten.push('Tekst niet gevonden in ' + naam + '.' + veld + ': ' + beschrijving);
    return;
  }
  n.parameters[veld] = huidig.split(zoek).join(nieuw);
  gedaan.push(beschrijving);
}

const nieuweId = (() => {
  let t = 0;
  return () => 'aaaa0000-0000-4000-8000-' + String(++t).padStart(12, '0');
})();

// ---------------------------------------------------------------------------
// 1. Trigger van wekelijks naar dagelijks
// ---------------------------------------------------------------------------

const trigger = knoop('Schedule Trigger1');
if (trigger) {
  trigger.parameters.rule = {
    interval: [{ field: 'days', triggerAtHour: 6, triggerAtMinute: 30 }]
  };
  gedaan.push('Trigger staat op dagelijks 06:30 in plaats van maandag 08:03');
}

// ---------------------------------------------------------------------------
// 2. Limit-nodes eruit, rechtstreeks naar Merge1
// ---------------------------------------------------------------------------

const voorAantal = wf.nodes.length;
wf.nodes = wf.nodes.filter((n) => n.name !== 'Limit' && n.name !== 'Limit1');
if (wf.nodes.length !== voorAantal - 2) fouten.push('Limit-nodes niet allebei verwijderd');
delete wf.connections.Limit;
delete wf.connections.Limit1;
wf.connections['formatteer AH'] = { main: [[{ node: 'Merge1', type: 'main', index: 0 }]] };
wf.connections['Formatteer Lidl'] = { main: [[{ node: 'Merge1', type: 'main', index: 2 }]] };
gedaan.push('Limit (89) en Limit1 (150) verwijderd; AH en Lidl gaan nu volledig naar Merge1');

// ---------------------------------------------------------------------------
// 3. products-insert: eenheid ook bijwerken
// ---------------------------------------------------------------------------

vervang(
  'Execute a SQL query',
  'query',
  '                categorie = COALESCE(EXCLUDED.categorie, products.categorie),\n                afbeelding = COALESCE(EXCLUDED.afbeelding, products.afbeelding)',
  '                categorie = COALESCE(EXCLUDED.categorie, products.categorie),\n' +
    '                eenheid = COALESCE(NULLIF(EXCLUDED.eenheid, \'\'), products.eenheid),\n' +
    '                afbeelding = COALESCE(EXCLUDED.afbeelding, products.afbeelding)',
  'products-insert werkt nu ook eenheid bij (stond niet in de DO UPDATE, dus een lege eenheid bleef voor altijd leeg)'
);

// ---------------------------------------------------------------------------
// 4. AH-parser: "2e gratis" en "3e gratis" herkennen
// ---------------------------------------------------------------------------

const ahZoek =
  '  // "2e halve prijs"\n' +
  '  if (t.includes("2e halve prijs")) {\n' +
  '    return { deal_type: "tweede_half", prijs: null, kortingsfactor: 0.25 };\n' +
  '  }\n';

const ahNieuw =
  ahZoek +
  '\n' +
  '  // "2e gratis", "3e gratis": je neemt n stuks en betaalt n-1.\n' +
  '  m = t.match(/^(\\d+)\\s*(?:e|de)\\s*gratis$/);\n' +
  '  if (m) {\n' +
  '    const n = parseInt(m[1]);\n' +
  '    if (n >= 2) return { deal_type: "gratis_erbij", prijs: null, kortingsfactor: 1 / n };\n' +
  '  }\n';

vervang('formatteer AH', 'jsCode', ahZoek, ahNieuw,
  'AH-parser herkent nu "2e gratis" en "3e gratis" (kwamen binnen als overig zonder korting)');

// ---------------------------------------------------------------------------
// 5. Gemini-invoerquery: per winkel de laatste scrape, plus prijs_per_stuk
// ---------------------------------------------------------------------------

const laatstePerWinkel =
  'JOIN (SELECT p2.winkel, MAX(o2.scrape_datum) AS datum\n' +
  '      FROM offers o2\n' +
  '      JOIN products p2 ON p2.product_id = o2.product_id\n' +
  '      GROUP BY p2.winkel) l\n' +
  '  ON l.winkel = p.winkel AND l.datum = o.scrape_datum';

const eiwitQuery =
  'SELECT p.product_id, p.winkel, p.categorie, p.naam, p.eenheid, p.afbeelding,\n' +
  '       o.prijs_nu, o.prijs_was, o.prijs_per_stuk, o.deal_type, o.label_tekst,\n' +
  '       o.kortingsfactor, o.link\n' +
  'FROM products p\n' +
  'JOIN offers o ON o.product_id = p.product_id\n' +
  laatstePerWinkel + '\n' +
  'WHERE (\n' +
  "        p.winkel <> 'AH'\n" +
  '     OR p.categorie NOT IN (\n' +
  "          'Etos acties','Gall & Gall acties','Gall & Gall klantenkaart',\n" +
  "          'Drogisterij','Huishouden','Baby en kind','Huisdier',\n" +
  "          'Bier, wijn, aperitieven','Frisdrank, sappen, water',\n" +
  "          'Koek, snoep, chocolade','Borrel, chips, snacks',\n" +
  "          'Koken, tafelen, vrije tijd'\n" +
  '        )\n' +
  '  )\n' +
  'ORDER BY p.winkel, p.categorie, p.naam;';

const eiwitDb = knoop('Aanbiedingen deze week');
if (eiwitDb) {
  eiwitDb.parameters.query = eiwitQuery;
  gedaan.push(
    'Gemini-invoerquery pakt nu per winkel de laatste scrape (was de globale max, ' +
      'waardoor een winkel die vandaag faalde helemaal uit de prompt viel) en levert prijs_per_stuk mee'
  );
}

vervang('Bouw prompt', 'jsCode',
  '  prijs_nu: r.prijs_nu,\n  prijs_was: r.prijs_was,\n  korting_pct: korting(r)',
  '  prijs_nu: r.prijs_nu,\n  prijs_was: r.prijs_was,\n  prijs_per_stuk: r.prijs_per_stuk,\n  korting_pct: korting(r)',
  'Prompt bevat nu prijs_per_stuk, zodat Gemini ook Jumbo-producten kan beoordelen (die hebben geen prijs_nu)'
);

// ---------------------------------------------------------------------------
// 6. Nieuwe nodes
// ---------------------------------------------------------------------------

const geminiCred = knoop('Message a model').credentials;
const pgCred = knoop('Aanbiedingen deze week').credentials;

function codeNode(naam, positie, code) {
  return {
    parameters: { jsCode: code },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: positie,
    id: nieuweId(),
    name: naam
  };
}

function httpNaarSite(naam, positie, pad) {
  return {
    parameters: {
      method: 'POST',
      url: 'http://VUL-JE-HA-IP-IN:8499' + pad,
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json) }}',
      options: {}
    },
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.4,
    position: positie,
    id: nieuweId(),
    name: naam,
    onError: 'continueRegularOutput'
  };
}

// -- 6a. IF-node zodat de weekbrief alleen op maandag weggaat ---------------

wf.nodes.push({
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
      conditions: [
        {
          id: nieuweId(),
          leftValue: '={{ $now.weekday }}',
          rightValue: 1,
          operator: { type: 'number', operation: 'equals' }
        }
      ],
      combinator: 'and'
    },
    options: {}
  },
  type: 'n8n-nodes-base.if',
  typeVersion: 2.3,
  position: [2704, -672],
  id: nieuweId(),
  name: 'Alleen op maandag'
});

knoop('Bouw html').position = [2928, -672];
knoop('Send an Email').position = [3152, -672];

// -- 6b. Selectie eiwit ------------------------------------------------------

const selectieEiwit = `// Zet het antwoord van de assistent om naar wat de website verwacht:
// alleen de gekozen product_id en de reden. Geen prijzen, die haalt de site
// zelf uit de database zodat er nooit een verouderd bedrag op staat.
const deals = ($json.topdeals ?? [])
  .filter(d => d.product_id)
  .map(d => ({ product_id: Number(d.product_id), reden: d.reden ?? null }));

// Geen deals betekent dat er iets mis is gegaan. Dan sturen we niets, want een
// lege selectie zou de goede selectie van vorige keer overschrijven.
if (deals.length === 0) return [];

const recepten = ($json.recepten ?? []).map(r => ({
  titel: r.titel,
  beschrijving: r.beschrijving,
  ingredienten: (r.ingredienten ?? []).map(i => ({
    naam: i.naam, winkel: i.winkel, prijs_nu: i.prijs_nu, link: i.link
  })),
  extra_ingredienten: r.extra_ingredienten ?? []
}));

return [{
  json: {
    sleutel: 'assistent-eiwit',
    naam: 'Eiwitrijk, gezond en gevarieerd',
    omschrijving: 'Wekelijkse keuze op eiwit, gezondheid en scherpe prijs.',
    icoon: 'dumbbell',
    orde: 1,
    gegenereerd_op: $json.gegenereerd_op,
    deals,
    recepten
  }
}];`;

wf.nodes.push(codeNode('Bouw selectie eiwit', [2768, -240], selectieEiwit));
wf.nodes.push(httpNaarSite('Stuur selectie naar site', [2992, -240], '/api/import/selectie'));

// -- 6c. Borreltak -----------------------------------------------------------

const borrelQuery =
  'SELECT p.product_id, p.winkel, p.categorie, p.naam, p.eenheid,\n' +
  '       o.prijs_nu, o.prijs_was, o.prijs_per_stuk, o.deal_type, o.label_tekst,\n' +
  '       o.kortingsfactor, o.link\n' +
  'FROM products p\n' +
  'JOIN offers o ON o.product_id = p.product_id\n' +
  laatstePerWinkel + '\n' +
  'WHERE (\n' +
  '        p.categorie IN (\n' +
  "          'Bier, wijn, aperitieven','Borrel, chips, snacks',\n" +
  "          'Koek, snoep, chocolade','Frisdrank, sappen, water',\n" +
  "          'Gall & Gall acties','Gall & Gall klantenkaart'\n" +
  '        )\n' +
  '        -- Lidl geeft categorie Food en Jumbo geeft niets, dus daar moeten we\n' +
  '        -- op de naam vissen.\n' +
  "     OR p.naam ~* '(bier|pils|speciaalbier|wijn|prosecco|cava|champagne|radler|cider|borrel|chips|nootjes|olijven|tapas|dipsaus|kaasplank|toast|zoutjes|popcorn|salami|chorizo)'\n" +
  '      )\n' +
  '  -- Anders komen er wijnglazen en bierpullen in de borrelprompt. De IS NULL\n' +
  '  -- is nodig omdat Jumbo geen categorie levert en NOT IN dan NULL oplevert.\n' +
  '  AND (\n' +
  '        p.categorie IS NULL\n' +
  '     OR p.categorie NOT IN (\n' +
  "          'Koken, tafelen, vrije tijd','Huishouden','Drogisterij',\n" +
  "          'Etos acties','Baby en kind','Huisdier'\n" +
  '        )\n' +
  '      )\n' +
  'ORDER BY p.winkel, p.naam;';

wf.nodes.push({
  parameters: { operation: 'executeQuery', query: borrelQuery, options: {} },
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: [1744, -96],
  id: nieuweId(),
  name: 'Borrelaanbiedingen',
  credentials: pgCred
});

const borrelPrompt = `const rows = $input.all().map(i => i.json);

function korting(r) {
  if (typeof r.kortingsfactor === 'number' && r.kortingsfactor > 0) {
    return Math.round(r.kortingsfactor * 100);
  }
  const was = Number(r.prijs_was), nu = Number(r.prijs_nu);
  if (was > 0 && nu > 0 && nu < was) return Math.round((1 - nu / was) * 100);
  return null;
}

const aanbiedingen = rows.map((r, idx) => ({
  id: idx,
  winkel: r.winkel,
  naam: r.naam,
  eenheid: r.eenheid || null,
  deal: r.label_tekst || null,
  deal_type: r.deal_type || null,
  prijs_nu: r.prijs_nu,
  prijs_was: r.prijs_was,
  prijs_per_stuk: r.prijs_per_stuk,
  korting_pct: korting(r)
}));

const instructie = [
  "Je bent een boodschappenassistent die supermarktaanbiedingen selecteert voor een gezellig weekend: borrel, vrijdagavond, visite.",
  "Je krijgt een lijst aanbiedingen, elk met een id.",
  "Kies de beste deals voor een borrel: speciaalbier en pils, wijn en bubbels, hartige snacks, noten, olijven, kaas en tapas, en iets zoets voor erbij.",
  "Let extra op producten die normaal duur zijn maar nu flink afgeprijsd (hoge korting_pct of groot verschil tussen prijs_was en prijs_nu).",
  "Let op 'elders' betekent dat prijs_was een prijs bij een andere winkel is en geen eerdere Lidl-prijs. Weeg dat eerlijk mee.",
  "Kies ongeveer 8 tot 12 deals, gevarieerd over de winkels en over de soorten, dus niet alleen bier.",
  "Bedenk daarnaast 2 borrelhapjes die je met deze aanbiedingen kunt maken. Elk hapje mag een paar goedkope basisingredienten aannemen die niet in de lijst staan; zet die in extra_ingredienten.",
  "Verwijs naar producten met hun id. Verzin geen prijzen of producten die niet in de lijst staan.",
  "Antwoord uitsluitend met geldige JSON, zonder codeblok of tekst eromheen, exact in dit formaat:",
  '{"topdeals":[{"id":0,"reden":"..."}],"recepten":[{"titel":"...","beschrijving":"...","ingredienten":[{"id":0}],"extra_ingredienten":["..."]}]}'
].join("\\n");

const prompt = instructie + "\\n\\nAANBIEDINGEN:\\n" + JSON.stringify(aanbiedingen);

return [{ json: { prompt, records: rows } }];`;

wf.nodes.push(codeNode('Bouw borrelprompt', [1968, -96], borrelPrompt));

wf.nodes.push({
  parameters: {
    modelId: {
      __rl: true,
      value: 'models/gemini-3.6-flash',
      mode: 'list',
      cachedResultName: 'models/gemini-3.6-flash'
    },
    messages: { values: [{ content: '={{ $json.prompt }}' }] },
    builtInTools: {},
    options: {}
  },
  type: '@n8n/n8n-nodes-langchain.googleGemini',
  typeVersion: 1.2,
  position: [2192, -96],
  id: nieuweId(),
  name: 'Message a model borrel',
  credentials: geminiCred
});

const selectieWeekend = `// Antwoord van Gemini uitpakken, id's terugkoppelen naar product_id en er de
// selectie voor de website van maken.
const j = $json;
let raw =
  j?.content?.parts?.[0]?.text ??
  j?.content?.parts?.map(p => p.text).join('') ??
  j?.text ?? j?.content ?? j?.response ?? '';

let tekst = typeof raw === 'string' ? raw : JSON.stringify(raw);
tekst = tekst.replace(/\`\`\`json/gi, '').replace(/\`\`\`/g, '').trim();
const start = tekst.indexOf('{');
const eind = tekst.lastIndexOf('}');
if (start !== -1 && eind !== -1) tekst = tekst.slice(start, eind + 1);

let data;
try {
  data = JSON.parse(tekst);
} catch (e) {
  // Niets doorsturen: dan blijft de vorige selectie op de site staan.
  console.log('Kon borrelantwoord niet parsen: ' + e.message);
  return [];
}

const records = $('Bouw borrelprompt').first().json.records;
const bijId = (id) => records[id] ?? null;

const deals = (data.topdeals ?? [])
  .map(d => {
    const r = bijId(d.id);
    return r && r.product_id ? { product_id: Number(r.product_id), reden: d.reden ?? null } : null;
  })
  .filter(Boolean);

if (deals.length === 0) return [];

const recepten = (data.recepten ?? []).map(r => ({
  titel: r.titel,
  beschrijving: r.beschrijving,
  ingredienten: (r.ingredienten ?? [])
    .map(i => bijId(i.id))
    .filter(Boolean)
    .map(i => ({ naam: i.naam, winkel: i.winkel, prijs_nu: i.prijs_nu, link: i.link })),
  extra_ingredienten: r.extra_ingredienten ?? []
}));

return [{
  json: {
    sleutel: 'assistent-weekend',
    naam: 'Borrel en weekend',
    omschrijving: 'Bier, wijn en hapjes voor het weekend.',
    icoon: 'glass',
    orde: 2,
    gegenereerd_op: new Date().toISOString(),
    deals,
    recepten
  }
}];`;

wf.nodes.push(codeNode('Bouw selectie weekend', [2544, -96], selectieWeekend));
wf.nodes.push(
  httpNaarSite('Stuur weekendselectie naar site', [2768, -96], '/api/import/selectie')
);

// -- 6d. Sticky notes met wat je nog moet invullen --------------------------

function sticky(naam, positie, breedte, hoogte, kleur, inhoud) {
  wf.nodes.push({
    parameters: { content: inhoud, height: hoogte, width: breedte, color: kleur },
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: positie,
    id: nieuweId(),
    name: naam
  });
}

sticky('Uitleg site', [2704, 40], 520, 260, 4,
  '## Zelf nog invullen\n' +
  'De twee nodes **Stuur selectie naar site** en **Stuur weekendselectie naar site**:\n\n' +
  '1. Vervang `VUL-JE-HA-IP-IN` in de URL door het LAN-IP van je Home Assistant, ' +
  'bijvoorbeeld `http://192.168.1.10:8499/api/import/selectie`. Gebruik geen ' +
  '`homeassistant.local`, want mDNS werkt niet vanuit een container.\n' +
  '2. Kies bij **Credential for Header Auth** een nieuwe credential met ' +
  'Name `Authorization` en Value `Bearer <het import_token uit de add-on>`.\n\n' +
  'Testen: zet de URL tijdelijk op `/api/health` met method GET.'
);

sticky('Uitleg weekbrief', [2704, -840], 420, 150, 3,
  '## Weekbrief nu alleen op maandag\n' +
  'De flow draait dagelijks zodat de site verse data heeft, maar de e-mail gaat ' +
  'alleen door als `$now.weekday` gelijk is aan 1 (maandag).'
);

// ---------------------------------------------------------------------------
// 7. Verbindingen voor de nieuwe nodes
// ---------------------------------------------------------------------------

wf.connections['Code in JavaScript1'] = {
  main: [
    [
      { node: 'Alleen op maandag', type: 'main', index: 0 },
      { node: 'Bouw HA payload', type: 'main', index: 0 },
      { node: 'Bouw selectie eiwit', type: 'main', index: 0 }
    ]
  ]
};
wf.connections['Alleen op maandag'] = {
  main: [[{ node: 'Bouw html', type: 'main', index: 0 }], []]
};
wf.connections['Bouw selectie eiwit'] = {
  main: [[{ node: 'Stuur selectie naar site', type: 'main', index: 0 }]]
};

wf.connections['Code in JavaScript3'].main[0].push({
  node: 'Borrelaanbiedingen',
  type: 'main',
  index: 0
});
wf.connections['Borrelaanbiedingen'] = {
  main: [[{ node: 'Bouw borrelprompt', type: 'main', index: 0 }]]
};
wf.connections['Bouw borrelprompt'] = {
  main: [[{ node: 'Message a model borrel', type: 'main', index: 0 }]]
};
wf.connections['Message a model borrel'] = {
  main: [[{ node: 'Bouw selectie weekend', type: 'main', index: 0 }]]
};
wf.connections['Bouw selectie weekend'] = {
  main: [[{ node: 'Stuur weekendselectie naar site', type: 'main', index: 0 }]]
};

gedaan.push('Nieuwe takken: selectie eiwit naar de site, en een complete borreltak (query, prompt, Gemini, selectie)');
gedaan.push('IF-node "Alleen op maandag" voor de weekbrief, zodat die niet dagelijks verstuurd wordt');

// ---------------------------------------------------------------------------
// 8. Nieuwe naam en identiteit, zodat je bestaande workflow blijft staan
// ---------------------------------------------------------------------------

wf.name = 'Aanbiedingen boodschappen website (met site-koppeling)';
delete wf.id;
delete wf.versionId;

// ---------------------------------------------------------------------------
// 9. Controle: bestaan alle verbindingsdoelen, en hangt er niets los?
// ---------------------------------------------------------------------------

const namen = new Set(wf.nodes.map((n) => n.name));
for (const [van, data] of Object.entries(wf.connections)) {
  if (!namen.has(van)) fouten.push('Verbinding vertrekt van onbekende node: ' + van);
  for (const uitgang of data.main || []) {
    for (const verb of uitgang || []) {
      if (!namen.has(verb.node)) {
        fouten.push('Verbinding van ' + van + ' wijst naar onbekende node: ' + verb.node);
      }
    }
  }
}

const heeftInvoer = new Set();
for (const data of Object.values(wf.connections)) {
  for (const uitgang of data.main || []) {
    for (const verb of uitgang || []) heeftInvoer.add(verb.node);
  }
}
const losseNodes = wf.nodes
  .filter((n) => n.type !== 'n8n-nodes-base.stickyNote')
  .filter((n) => n.type !== 'n8n-nodes-base.scheduleTrigger')
  .filter((n) => !heeftInvoer.has(n.name))
  .map((n) => n.name);

fs.writeFileSync(doel, JSON.stringify(wf, null, 2), 'utf8');

console.log('WIJZIGINGEN');
gedaan.forEach((g, i) => console.log('  ' + (i + 1) + '. ' + g));
console.log('\nNODES: ' + wf.nodes.length + ' (was ' + voorAantal + ')');
console.log('Nodes zonder inkomende verbinding: ' + (losseNodes.length ? losseNodes.join(', ') : 'geen'));
if (fouten.length) {
  console.log('\nFOUTEN:');
  fouten.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('\nAlle wijzigingen zijn aangeslagen, geen kapotte verbindingen.');
