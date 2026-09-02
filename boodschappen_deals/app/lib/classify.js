'use strict';

// Woordenboek om producten te classificeren op basis van naam, eenheid en categorie.
// Bewust conservatief: liever een product niet taggen dan verkeerd taggen, want
// een onterecht "vegetarisch" label is schadelijker dan een gemist label.

const woordgroepen = {
  vlees: [
    'kip', 'kipfilet', 'kipdij', 'kiphaas', 'kipgehakt', 'drumstick', 'kippenbout',
    'kalkoen', 'rund', 'rundvlees', 'biefstuk', 'entrecote', 'ribeye', 'rib-eye', 'sucade',
    'gehakt', 'hamburger', 'varken', 'varkens', 'speklap', 'spek', 'bacon',
    'ham', 'schnitzel', 'shoarma', 'gyros', 'saucijs', 'braadworst', 'rookworst', 'worstje',
    'knakworst', 'salami', 'chorizo', 'carpaccio', 'tartaar', 'lamsvlees', 'lams', 'kotelet',
    'procureur', 'ossenhaas', 'kalfs', 'spareribs', 'slavink', 'frikandel', 'kroket', 'gehaktbal',
    'cordon bleu', 'kipnuggets', 'satestokjes', 'kipsate', 'filetlapjes',
    'boterhamworst', 'pastrami', 'rosbief', 'fricandeau', 'leverworst'
  ],
  varken: [
    'varken', 'varkens', 'speklap', 'spek', 'bacon', 'ham', 'saucijs', 'salami', 'chorizo',
    'procureur', 'kotelet', 'schnitzel', 'frikandel', 'leverworst', 'boterhamworst', 'pastrami'
  ],
  vis: [
    'zalm', 'tonijn', 'kabeljauw', 'garnaal', 'garnalen', 'vis', 'visstick', 'haring', 'makreel',
    'forel', 'pangasius', 'tilapia', 'mossel', 'sardine', 'ansjovis', 'scampi', 'koolvis',
    'lekkerbek', 'kibbeling', 'schol', 'pollak', 'surimi', 'krab', 'oester',
    'zalmfilet', 'victoriabaars', 'heek', 'wijting'
  ],
  zuivel: [
    'kwark', 'skyr', 'yoghurt', 'melk', 'karnemelk', 'kaas', 'kaasblokjes',
    'eieren', 'kefir', 'huttenkase', 'cottage cheese', 'mozzarella', 'feta',
    'brie', 'roomkaas', 'room', 'creme fraiche', 'kwarktoetje', 'vla', 'pudding',
    'boter', 'margarine', 'gouda', 'oude kaas', 'jong belegen', 'geitenkaas', 'halloumi',
    'parmezaan', 'mascarpone', 'ricotta', 'zuivelspread'
  ],
  plantaardig_eiwit: [
    'tofu', 'tempeh', 'seitan', 'linzen', 'kikkererwt', 'kidneybon', 'bruine bonen', 'witte bonen',
    'zwarte bonen', 'hummus', 'noten', 'pinda', 'amandel', 'cashew', 'walnoot', 'hazelnoot',
    'vegetarische', 'vegetarisch', 'vegan', 'plantaardig', 'sojabon', 'edamame',
    'quinoa', 'falafel', 'erwten', 'pindakaas', 'notenmix', 'sojadrink', 'sojayoghurt',
    'vleesvervanger', 'valess', 'vivera', 'garden gourmet', 'beyond meat'
  ],
  groente_fruit: [
    'appel', 'banaan', 'peer', 'druiven', 'aardbei', 'blauwe bes', 'framboos', 'mandarijn',
    'sinaasappel', 'citroen', 'limoen', 'kiwi', 'mango', 'ananas', 'meloen', 'perzik', 'nectarine',
    'pruim', 'avocado', 'tomaat', 'komkommer', 'paprika', 'courgette', 'aubergine', 'broccoli',
    'bloemkool', 'spinazie', 'sperziebon', 'haricot', 'wortel', 'winterpeen', 'knoflook',
    'aardappel', 'krieltjes', 'ijsbergsalade', 'rucola', 'andijvie', 'prei', 'champignon',
    'paddenstoel', 'asperge', 'venkel', 'boerenkool', 'spruit', 'rode kool', 'witlof', 'radijs',
    'bleekselderij', 'pompoen', 'zoete aardappel', 'erwt', 'groente', 'fruit',
    'salademix', 'snoeptomaat', 'cherrytomaat', 'kropsla', 'bosui', 'gember', 'granaatappel',
    'clementine', 'bosbes', 'olijven', 'handperen', 'handsinaasappel'
  ],
  brood_graan: [
    'brood', 'bolletjes', 'stokbrood', 'crackers', 'beschuit', 'ontbijtkoek', 'muesli',
    'cruesli', 'havermout', 'cornflakes', 'granola', 'rijst', 'pasta', 'spaghetti', 'penne',
    'macaroni', 'noedels', 'couscous', 'bulgur', 'tortilla', 'wrap', 'pita', 'krentenbol',
    'croissant', 'knackebrod', 'volkoren', 'meergranen'
  ],
  gemak: [
    'maaltijd', 'verspakket', 'maaltijdpakket', 'pizza', 'wokgerecht', 'wokmix', 'roerbakmix',
    'pastasaus', 'soep', 'kant-en-klaar', 'salade', 'bowl', 'curry', 'lasagne', 'friet', 'patat',
    'nasi', 'bami', 'ovenschotel', 'quiche', 'stamppot', 'wraps', 'burrito', 'sushi', 'noodles',
    'gnocchi', 'kruidenmix', 'saus', 'ovenschaal'
  ],
  snoep_snacks: [
    'chips', 'snoep', 'chocolade', 'chocola', 'koek', 'koekjes', 'snack',
    'wine gum', 'lolly', 'ijs', 'ijsjes', 'taart', 'gebak', 'stroopwafel', 'bonbon', 'pepernoot',
    'kruidnoot', 'marsepein', 'candy', 'zuurtjes', 'winegums', 'toffee', 'bounty',
    'snickers', 'kitkat', 'oreo', 'pringles', 'doritos', 'borrelnoot', 'popcorn',
    'gevulde koek', 'appelflap', 'donut', 'muffin', 'brownie', 'wafel', 'dropje'
  ],
  dranken: [
    'frisdrank', 'cola', 'fanta', 'sprite', 'ice tea', 'ijsthee', 'sinas', 'limonade', 'siroop',
    'bruiswater', 'sap', 'appelsap', 'smoothie', 'energydrink',
    'red bull', 'monster energy', 'koffie', 'thee', 'cappuccino', 'espresso', 'chocomel',
    'fristi', 'aa drink', 'sportdrank', 'mineraalwater'
  ],
  alcohol: [
    'bier', 'pils', 'speciaalbier', 'wijn', 'rode wijn', 'witte wijn', 'rose', 'whisky',
    'whiskey', 'rum', 'gin', 'vodka', 'wodka', 'aperitief', 'prosecco', 'cava', 'champagne',
    'likeur', 'jenever', 'bacardi', 'jagermeister', 'malibu', 'aperol',
    'martini', 'port', 'sherry', 'radler', 'cider', 'heineken', 'grolsch', 'hertog jan',
    'amstel', 'corona', 'desperados', 'brouwerij'
  ],
  nonfood: [
    'shampoo', 'wasmiddel', 'luier', 'tandpasta', 'tandenborstel', 'deodorant', 'wc-papier',
    'toiletpapier', 'keukenrol', 'afwasmiddel', 'allesreiniger', 'schoonmaak', 'wasverzachter',
    'vaatwastablet', 'scheermes', 'scheergel', 'bodylotion', 'make-up',
    'mascara', 'lippenstift', 'nagellak', 'parfum', 'eau de toilette', 'zonnebrand', 'aftersun',
    'maandverband', 'tampon', 'inlegkruisje', 'condoom', 'vitamine', 'supplement', 'paracetamol',
    'pleister', 'hoestdrank', 'neusspray', 'zakdoekjes', 'vuilniszak', 'aluminiumfolie',
    'batterij', 'gloeilamp', 'speelgoed', 'tijdschrift',
    'handdoek', 'beddengoed', 'pannenset', 'servies', 'bestek', 'boeket',
    'hondenvoer', 'kattenvoer', 'kattenbakvulling', 'hondenbrokken',
    'diervoeding', 'dierensnack', 'sokken', 'ondergoed', 'handzeep', 'douchegel',
    'haarverf', 'lenzenvloeistof', 'kauwgom', 'tandenstoker', 'luiers'
  ]
};

// Categorienamen uit de scrapers die vrijwel altijd non-food zijn.
const nonfoodCategorieen = new Set([
  'etos acties', 'gall & gall acties', 'gall & gall klantenkaart', 'drogisterij', 'huishouden',
  'baby en kind', 'huisdier', 'koken, tafelen, vrije tijd', 'bloemen en planten',
  'wonen en vrije tijd', 'nonfood', 'non-food'
]);

const alcoholCategorieen = new Set([
  'bier, wijn, aperitieven', 'gall & gall acties', 'gall & gall klantenkaart', 'wijn', 'bier'
]);

// De winkelcategorie is vaak het enige signaal. "Lay's Oven Baked paprika"
// bevat geen enkel snackwoord, maar staat wel onder "Borrel, chips, snacks".
const categorieHints = [
  [['koek, snoep, chocolade', 'borrel, chips, snacks', 'snoep en snacks', 'zoet en snacks',
    'chips en snacks', 'koek en snoep'], 'snoep_snacks'],
  [['frisdrank, sappen, water', 'dranken', 'sappen en water', 'koffie en thee'], 'dranken'],
  [['aardappel, groente, fruit', 'groente en fruit', 'groente', 'fruit'], 'groente_fruit'],
  [['maaltijden en salades', 'maaltijden', 'verspakketten'], 'gemak'],
  [['brood en gebak', 'bakkerij', 'brood, bakkerij'], 'brood_graan']
];

// Zet een woordgroep om naar een regex met een woordgrens aan de voorkant.
function bouwPatroon(woorden) {
  const delen = woorden.map((w) =>
    w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  );
  return new RegExp('(^|[^a-z0-9])(' + delen.join('|') + ')', 'i');
}

const patronen = {};
for (const [naam, woorden] of Object.entries(woordgroepen)) {
  patronen[naam] = bouwPatroon(woorden);
}

// Grofmazige indeling naar de hoofdcategorie die we in de UI als filter tonen.
// De volgorde is de prioriteit: vis vóór vlees, want "visburger" is vis.
const hoofdcategorieOrde = [
  ['Non-food', 'nonfood'],
  ['Alcohol', 'alcohol'],
  ['Vis', 'vis'],
  ['Vlees', 'vlees'],
  ['Zuivel en eieren', 'zuivel'],
  ['Plantaardig', 'plantaardig_eiwit'],
  ['Groente en fruit', 'groente_fruit'],
  ['Maaltijden en gemak', 'gemak'],
  ['Brood en granen', 'brood_graan'],
  ['Snoep en snacks', 'snoep_snacks'],
  ['Dranken', 'dranken']
];

function classificeer(rij) {
  const naam = String(rij.naam || '');
  const eenheid = String(rij.eenheid || '');
  const categorie = String(rij.categorie || '');
  const tekst = (naam + ' ' + eenheid).toLowerCase();
  const catLaag = categorie.trim().toLowerCase();

  const tags = new Set();
  for (const [groep, patroon] of Object.entries(patronen)) {
    if (patroon.test(tekst)) tags.add(groep);
  }

  // Losse eieren staan zelden als "eieren" in de naam, dus apart matchen.
  if (/(^|[^a-z])(eieren|eitjes|scharrelei|vrije-uitloopei|kippenei)/i.test(tekst)) {
    tags.add('zuivel');
  }

  // Categoriehints van de winkel zelf wegen zwaarder dan losse woorden.
  if (nonfoodCategorieen.has(catLaag)) tags.add('nonfood');
  if (alcoholCategorieen.has(catLaag)) tags.add('alcohol');
  for (const [namen, tag] of categorieHints) {
    if (namen.includes(catLaag)) tags.add(tag);
  }
  if (catLaag.includes('vlees') || catLaag.includes('vis') || catLaag.includes('zuivel')) {
    tags.delete('nonfood');
  }

  // Non-food sluit voedingslabels uit, anders wordt "kaas" in een kaasschaaf
  // of "rund" in hondenbrokken alsnog als eiwitrijk product geteld.
  if (tags.has('nonfood')) {
    for (const t of ['vlees', 'vis', 'zuivel', 'plantaardig_eiwit', 'groente_fruit', 'gemak']) {
      tags.delete(t);
    }
  }
  if (tags.has('alcohol')) {
    for (const t of ['vlees', 'vis', 'zuivel', 'plantaardig_eiwit', 'gemak']) tags.delete(t);
  }

  // Smaakaanduidingen zijn de grootste bron van valse labels: paprikachips is
  // geen groente, aardbeienijs geen fruit en een chocolademelk geen zuivelmaaltijd.
  if (tags.has('snoep_snacks')) {
    for (const t of ['groente_fruit', 'vlees', 'vis', 'gemak', 'plantaardig_eiwit', 'zuivel']) {
      tags.delete(t);
    }
  }
  if (tags.has('dranken') && !tags.has('zuivel')) {
    for (const t of ['groente_fruit', 'vlees', 'vis']) tags.delete(t);
  }

  const eiwitrijk =
    tags.has('vlees') || tags.has('vis') || tags.has('zuivel') || tags.has('plantaardig_eiwit');
  const dierlijk = tags.has('vlees') || tags.has('vis') || tags.has('zuivel');
  const vers = tags.has('groente_fruit') || tags.has('vis') || tags.has('vlees');

  let hoofdcategorie = 'Overig';
  for (const [label, tag] of hoofdcategorieOrde) {
    if (tags.has(tag)) {
      hoofdcategorie = label;
      break;
    }
  }

  return {
    tags: [...tags],
    hoofdcategorie,
    eiwitrijk,
    vers,
    bevat_vlees: tags.has('vlees'),
    bevat_vis: tags.has('vis'),
    bevat_zuivel: tags.has('zuivel'),
    bevat_dierlijk: dierlijk,
    bevat_varken: patronen.varken.test(tekst) && !tags.has('nonfood'),
    is_alcohol: tags.has('alcohol'),
    is_nonfood: tags.has('nonfood'),
    is_snoep: tags.has('snoep_snacks'),
    is_gemak: tags.has('gemak'),
    is_plantaardig: tags.has('plantaardig_eiwit') && !dierlijk
  };
}

module.exports = { classificeer, hoofdcategorieOrde };
