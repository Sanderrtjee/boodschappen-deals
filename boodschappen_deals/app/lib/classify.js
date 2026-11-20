'use strict';

// Producten classificeren op naam, eenheid en winkelcategorie.
//
// Twee dingen staan hier bewust los van elkaar:
//
//   1. De categorie voor de UI ("Vlees", "Snoep en snacks", ...). Die mag
//      grofmazig zijn en wordt opgeschoond: paprikachips is geen groente.
//   2. De dieetsignalen (vlees, vis, varken, dierlijk). Die worden nooit door
//      een andere categorie gewist. Een "Salami snack" is snoep én vlees.
//
// Bij het dieet kiezen we altijd de veilige kant: liever een vegetarisch
// product te veel weg dan één stuk vlees onder "vegetarisch". Wat we niet
// zeker weten (een kant-en-klare maaltijd zonder vegetarisch label) telt als
// onzeker en valt buiten de dieetfilters.

// ---------------------------------------------------------------------------
// Tekst voorbereiden
// ---------------------------------------------------------------------------

// Kleine letters en zonder accenten: "Crème fraîche" wordt "creme fraiche",
// "Rosé" wordt "rose" en "Paté" wordt "pate".
function normaliseer(tekst) {
  return String(tekst || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function tokens(tekst) {
  return normaliseer(tekst).split(/[^a-z0-9]+/).filter(Boolean);
}

// Meervoud en verkleinwoorden, zodat "worst" ook "worsten" en "worstje" is.
const ACHTERVOEGSELS = ['', 's', 'n', 'en', 'e', 'je', 'jes', 'tje', 'tjes', 'etje', 'etjes', 'pje', 'pjes'];

function eindigtOp(token, stam) {
  for (const a of ACHTERVOEGSELS) {
    if (token.endsWith(stam + a)) return true;
  }
  // Verdubbelde medeklinker: "lap" wordt "lappen", "bal" wordt "ballen".
  const laatste = stam[stam.length - 1];
  return !'aeiou'.includes(laatste) && (token.endsWith(stam + laatste + 'en') || token.endsWith(stam + laatste + 'etje') || token.endsWith(stam + laatste + 'etjes'));
}

// Een woord in een lijst kan een voorvoegsel hebben dat zegt hoe het mag
// matchen. Nederlands plakt woorden aan elkaar en het hoofdwoord staat
// achteraan, dus de standaard is: het token begint of eindigt met het woord.
//
//   'woord'   standaard: begin of eind van een token ("kipfilet", "soepkip")
//   '=woord'  alleen het hele token, met meervoud ("port", niet "portobello")
//   '$woord'  alleen achteraan ("ijs" in "roomijs", niet in "ijsbergsla")
//   '^woord'  alleen vooraan
//   '~woord'  overal in het token ("stoofvleesblokjes")
//   'twee woorden'  als losse, opeenvolgende tokens
function maakMatcher(spec) {
  if (spec.includes(' ')) {
    const zin = ' ' + tokens(spec).join(' ') + ' ';
    return { type: 'zin', test: (t) => t.zin.includes(zin) };
  }
  const soort = '=$^~'.includes(spec[0]) ? spec[0] : '';
  const w = normaliseer(soort ? spec.slice(1) : spec);
  let tokenTest;
  if (soort === '=') tokenTest = (tk) => ACHTERVOEGSELS.some((a) => tk === w + a);
  else if (soort === '$') tokenTest = (tk) => eindigtOp(tk, w);
  else if (soort === '^') tokenTest = (tk) => tk.startsWith(w);
  else if (soort === '~') tokenTest = (tk) => tk.includes(w);
  else tokenTest = (tk) => tk.startsWith(w) || eindigtOp(tk, w);
  return { type: 'token', tokenTest, test: (t) => t.tokens.some(tokenTest) };
}

function maakGroep(woorden, uitzonderingen = []) {
  const matchers = woorden.map(maakMatcher);
  const nee = new Set(uitzonderingen.map(normaliseer));
  return {
    // Tokens in de uitzonderingenlijst tellen voor deze groep niet mee.
    test(t) {
      const schoon = nee.size ? filterTekst(t, nee) : t;
      return matchers.some((m) => m.test(schoon));
    },
    // Welke tokens matchen er? Nodig om het voorvoegsel te bekijken.
    tokenTreffers(t) {
      const uit = [];
      t.tokens.forEach((tk, i) => {
        if (nee.has(tk)) return;
        for (const m of matchers) {
          if (m.type === 'token' && m.tokenTest(tk)) {
            uit.push(i);
            break;
          }
        }
      });
      return uit;
    }
  };
}

function filterTekst(t, nee) {
  const over = t.tokens.filter((tk) => !nee.has(tk));
  return { tokens: over, zin: ' ' + over.join(' ') + ' ' };
}

function bereid(tekst) {
  const tk = tokens(tekst);
  return { tokens: tk, zin: ' ' + tk.join(' ') + ' ' };
}

// ---------------------------------------------------------------------------
// Dieetsignalen
// ---------------------------------------------------------------------------

// Woorden die altijd vlees betekenen.
const VLEES = maakGroep([
  'kip', 'kippen', 'kalkoen', '^rund', 'runder', 'kalfs', 'kalf', '^lams', 'lamsvlees', '^herten',
  '=hert', 'eend', 'konijn', '~varken', '~vlees', '~gehakt', '$biefstuk', 'biefstuk', '$ham',
  'hamlap', 'beenham', 'spek', 'bacon', 'salami', 'chorizo', 'cervelaat', 'pastrami', 'rosbief',
  'fricandeau', 'carpaccio', '$tartaar', 'rollade', 'goulash', 'hachee', 'gyros', 'shoarma',
  'kebab', 'doner', '$sate', '=sates', 'satestokje', '^worst', '$worst', '^knak', 'frikandel',
  'bitterbal', 'gehaktbal', 'slavink', 'saucijs', 'americain', 'procureur', 'ossenhaas',
  'varkenshaas', 'kiphaas', 'biefhaas', 'entrecote', 'ribeye', 'sucade', 'spareribs', '=ribs',
  'drumstick', 'kluif', '$bout', '$vleugel', '$karbonade', '$kotelet', '$riblap', '$speklap',
  '$runderlap', '$filetlap', 'lever', '$pate', '$pastei', 'pepperoni', 'prosciutto', 'serrano',
  'parmaham', 'mortadella', 'pancetta', 'lardon', 'bresaola', 'merguez', '~wurst', 'hotdog',
  '=chicken', '=beef', '=pork', '=meat', '=meatball', '=turkey', '=wings', 'cordon bleu',
  'pulled pork', 'hot dog', 'filet americain', 'half om half',
  // Merken die (vrijwel) alleen vlees verkopen.
  '=bifi', '=mora', '=kwekkeboom', 'van dobben', '=unox'
], [
  // Geen vlees, maar ze lijken er wel op.
  'vleestomaat', 'vleestomaten', 'vleesvervanger', 'vleesvervangers', 'vleesloos', 'vleesvrij',
  'spekkoek', 'speculaas', 'spekulaas', 'leverancier', 'hamamelis', 'eendjes', 'lamsoor',
  'graham', 'kippenvoer', 'kipper'
]);

// Hoofdwoorden die vlees zijn, behalve als er vis of iets vegetarisch voor
// staat: "kabeljauwburger" is vis, "groenteburger" is vegetarisch.
const KOPPEN = maakGroep(['$burger', '$schnitzel', '$kroket', '$nugget', '$medaillon', '$balletje']);

const VIS = maakGroep([
  'zalm', 'tonijn', 'kabeljauw', 'garnaal', 'garnalen', '^vis', '$vis', 'haring', 'makreel',
  'forel', 'paling', 'pangasius', 'tilapia', 'mossel', 'sardine', 'sardien', 'ansjovis', 'scampi',
  'lekkerbek', 'kibbeling', '=schol', 'pollak', 'surimi', '$krab', 'oester', '$baars', '=heek',
  'wijting', 'calamar', 'octopus', 'kreeft', 'langoustine', '$tong', 'kaviaar', 'sushi',
  'zeevruchten', 'bokking', '=sprot', 'dorade', 'zeeduivel', 'rolmops', '=fish', '=tuna',
  '=salmon', '=shrimp', '=prawn'
], ['visite', 'scholiertje', 'duyvis']);

// Een vegetarisch label in de naam weegt zwaarder dan "schnitzel" of "kip".
const VEGETARISCH_LABEL = maakGroep([
  'vegetarisch', 'vegetarische', '=vegan', '=veganistisch', '=veggie', '=vega', 'plantaardig',
  'plantaardige', 'vleesvervanger', 'vleesloos', 'zonder vlees', '=vivera', 'garden gourmet',
  'beyond meat', 'vegetarische slager', 'vegetarian butcher', '=valess', 'like meat'
]);

// Staat er een van deze voor een hoofdwoord, dan is dat hoofdwoord geen vlees.
const VEGA_VOORVOEGSELS = [
  'groente', 'bonen', 'boon', 'kaas', 'vega', 'veggie', 'falafel', 'linzen', 'tofu', 'tempeh',
  'soja', 'quinoa', 'spinazie', 'champignon', 'paddenstoel', 'aardappel', 'kikkererwt',
  'plantaardig', 'vegetarisch', 'vegan', 'broccoli', 'bloemkool', 'wortel', 'rijst'
];

// Diersoorten die geen varken zijn. Staat er alleen zo'n soort in de naam,
// dan is het vlees geen varkensvlees.
const NIET_VARKEN = maakGroep([
  'kip', 'kippen', 'kalkoen', '^rund', 'runder', 'kalf', 'kalfs', '^lams', '^herten', '=hert',
  'eend', 'konijn', '=chicken', '=beef', '=turkey', '=wings', 'biefstuk', 'ossenhaas', 'entrecote',
  'ribeye', 'sucade', 'tartaar', 'rosbief', 'carpaccio', 'riblap', 'runderlap', 'biefhaas',
  'kiphaas', 'drumstick', 'kluif', 'vleugel', 'goulash'
], ['kippenvoer', 'kipper']);

// Woorden die altijd varkensvlees zijn, wat er verder ook in de naam staat.
const VARKEN = maakGroep([
  '~varken', 'spek', 'bacon', '$ham', 'hamlap', 'beenham', 'salami', 'chorizo', 'cervelaat',
  'saucijs', 'procureur', '$karbonade', '$kotelet', 'frikandel', 'leverworst', 'boterhamworst',
  'rookworst', '^knak', '=pork', 'pancetta', 'prosciutto', 'serrano', 'parmaham', 'pepperoni',
  'mortadella', 'lardon', 'cordon bleu', 'pulled pork', 'half om half', '$speklap', '$pate',
  '$pastei'
], ['spekkoek', 'speculaas', 'spekulaas', 'hamamelis', 'graham']);

// Samengestelde producten waarvan we de inhoud niet kennen. Zonder vegetarisch
// label weten we niet of er vlees in zit, dus die tellen als onzeker.
const SAMENGESTELD = maakGroep([
  'maaltijd', 'maaltijden', 'pizza', 'pinsa', 'verspakket', 'shared dining', '$soep', '$schotel',
  'lasagne', '$stamppot', '=nasi', '=bami', 'quiche', 'burrito', '=ristorante', 'casa di mama',
  '=johma', 'tapas', 'snackpakket', '=soup', 'spaghetteria', 'risotteria'
]);

const VEGA_AANWIJZING = maakGroep([
  'funghi', 'margherita', 'formaggi', 'groente', '$tomaat', 'tomaten', 'champignon', 'pompoen',
  'spinazie', 'linzen', 'paddenstoel', 'vegetarisch', 'vegetarische', '=vegan', '=veggie',
  '=vega', 'plantaardig', 'kaas', 'kazen'
]);

// Dierlijk maar geen vlees of vis: voor het veganistische filter.
const DIERLIJK_OVERIG = maakGroep([
  'kaas', 'kwark', 'skyr', 'yoghurt', 'melk', 'karnemelk', '=ei', 'eieren', 'eitje', '$ei',
  'kefir', 'mozzarella', 'feta', 'brie', 'burrata', '^room', '=room', 'slagroom', 'creme fraiche',
  '=vla', 'pudding', 'boter', 'roomboter', 'gouda', 'halloumi', 'parmezaan', 'mascarpone',
  'ricotta', 'zuivel', 'honing', 'mayonaise', 'gelatine', '=milk', 'cream', 'whey', 'protein',
  'proteine', 'drinkyoghurt'
], ['pindakaas', 'pindaboter', 'kokosmelk', 'amandelmelk', 'havermelk', 'sojamelk', 'rijstmelk',
  'notenboter', 'cacaoboter']);

// Producten die vaak melk, ei of gelatine bevatten zonder dat het in de naam staat.
const VEGAN_ONZEKER = maakGroep([
  'chocola', 'chocolade', '=choco', 'koek', 'koekje', 'gebak', 'taart', 'cake', 'donut', 'wafel',
  'croissant', 'brioche', '$ijs', '=ijs', 'bonbon', 'toffee', 'snoep', '=drop', 'winegum',
  'wine gum', 'marsepein', 'stroopwafel', 'muffin', 'brownie', 'banket', 'vlaai', 'stol',
  'pannenkoek', 'poffertje', 'tompouce', 'saus', 'pesto', 'chips'
], ['snoepgroente', 'snoeptomaat', 'snoeptomaatjes', 'snoepworteltjes']);

const VEGAN_LABEL = maakGroep(['=vegan', '=veganistisch', 'plantaardig', 'plantaardige', '=alpro', '=oatly']);

// ---------------------------------------------------------------------------
// Categorieën voor de UI
// ---------------------------------------------------------------------------

const woordgroepen = {
  zuivel: [
    'kwark', 'skyr', 'yoghurt', 'melk', 'karnemelk', 'kaas', 'eieren', 'kefir', 'huttenkase',
    'cottage cheese', 'mozzarella', 'feta', 'brie', 'burrata', 'roomkaas', '^room', '=room',
    'slagroom', 'creme fraiche', '=vla', 'pudding', 'boter', 'margarine', 'gouda', 'oude kaas',
    'jong belegen', 'geitenkaas', 'halloumi', 'parmezaan', 'mascarpone', 'ricotta', 'zuivel'
  ],
  plantaardig_eiwit: [
    'tofu', 'tempeh', 'seitan', 'linzen', 'kikkererwt', 'kidneybon', 'bruine bonen', 'witte bonen',
    'zwarte bonen', 'hummus', '$noten', 'pinda', 'amandel', 'cashew', 'walnoot', 'hazelnoot',
    'vegetarische', 'vegetarisch', '=vegan', 'plantaardig', 'sojabon', 'edamame', 'quinoa',
    'falafel', 'erwten', 'pindakaas', 'notenmix', 'sojadrink', 'sojayoghurt', 'vleesvervanger',
    'valess', 'vivera', 'garden gourmet', 'beyond meat'
  ],
  groente_fruit: [
    'appel', 'banaan', 'peer', 'peren', 'druiven', 'aardbei', 'blauwe bes', '$bessen', 'framboos',
    'frambozen', 'mandarijn', 'sinaasappel', 'citroen', 'limoen', 'kiwi', 'mango', 'ananas',
    'meloen', 'perzik', 'nectarine', 'pruim', 'avocado', 'tomaat', 'tomaten', 'komkommer',
    'paprika', 'courgette', 'aubergine', 'broccoli', 'bloemkool', 'spinazie', 'sperziebon',
    'haricot', 'wortel', 'winterpeen', '$peen', 'knoflook', 'aardappel', 'krieltjes',
    'ijsbergsalade', '$sla', 'slaatje', 'rucola', 'andijvie', 'prei', 'champignon', 'paddenstoel',
    'asperge', 'venkel', 'boerenkool', 'spruit', 'rode kool', '$kool', 'witlof', 'radijs',
    'bleekselderij', 'pompoen', 'zoete aardappel', 'erwt', 'groente', 'fruit', 'salademix',
    'snoeptomaat', 'cherrytomaat', 'kropsla', 'bosui', '$uien', 'gember', 'granaatappel',
    'clementine', 'bosbes', 'olijven', 'handperen', 'handsinaasappel', 'kaki', 'bieten'
  ],
  brood_graan: [
    'brood', 'bolletjes', '$bollen', 'stokbrood', 'crackers', 'beschuit', 'ontbijtkoek', 'muesli',
    'cruesli', 'havermout', 'cornflakes', 'granola', 'rijst', 'pasta', 'spaghetti', 'penne',
    'macaroni', 'noedels', 'couscous', 'bulgur', 'tortilla', 'wrap', 'pita', 'krentenbol',
    'croissant', 'knackebrod', 'volkoren', 'meergranen', 'broodjes'
  ],
  gemak: [
    'maaltijd', 'verspakket', 'maaltijdpakket', 'pizza', 'wokgerecht', 'wokmix', 'roerbakmix',
    'pastasaus', '$soep', 'kant-en-klaar', 'salade', 'bowl', 'curry', 'lasagne', 'friet', 'patat',
    '=nasi', '=bami', '$schotel', 'quiche', '$stamppot', 'burrito', 'sushi', 'noodles', 'gnocchi',
    'kruidenmix', '=saus', '$saus', 'ovenschaal', 'pinsa'
  ],
  snoep_snacks: [
    '$chips', '=chips', 'snoep', 'chocolade', 'chocola', '=choco', 'koek', 'koekjes', '$snack',
    '=snack', 'wine gum', 'lolly', '$ijs', '=ijs', '$taart', 'gebak', 'stroopwafel', 'bonbon',
    'pepernoot', 'kruidnoot', 'kruidnoten', 'marsepein', 'candy', 'zuurtjes', 'winegum', 'toffee',
    'bounty', 'snickers', 'kitkat', 'oreo', 'pringles', 'doritos', 'borrelnoot', 'popcorn',
    'gevulde koek', '$appelflap', 'donut', 'muffin', 'brownie', 'wafel', '=drop', '$dropje',
    'chocoladeletter', 'speculaas'
  ],
  dranken: [
    'frisdrank', '=cola', 'fanta', 'sprite', 'ice tea', 'ijsthee', '=sinas', 'limonade', 'siroop',
    'siropen', 'bruiswater', '=sap', '$sap', 'smoothie', 'energydrink', 'red bull',
    'monster energy', 'koffie', '=thee', '$thee', 'cappuccino', 'espresso', 'chocomel', 'fristi',
    'aa drink', 'sportdrank', 'mineraalwater', 'shots'
  ],
  alcohol: [
    '=bier', '$bier', '=pils', 'speciaalbier', '=wijn', '$wijn', 'rode wijn', 'witte wijn', '=rose',
    'whisky', 'whiskey', '=rum', '=gin', 'vodka', 'wodka', 'aperitief', 'aperitieven', 'prosecco',
    '=cava', 'champagne', 'likeur', 'jenever', 'bacardi', 'jagermeister', 'malibu', 'aperol',
    '=martini', '=port', '=sherry', '=radler', '=cider', 'heineken', 'grolsch', 'hertog jan',
    '=amstel', '=corona', 'desperados', '=brouwerij', '=merlot', 'chardonnay', 'sauvignon'
  ],
  nonfood: [
    'shampoo', 'wasmiddel', 'luier', 'tandpasta', 'tandenborstel', 'deodorant', 'wc-papier',
    'toiletpapier', 'keukenrol', 'keukenpapier', 'afwasmiddel', 'allesreiniger', 'schoonmaak',
    'wasverzachter', 'vaatwastablet', 'scheermes', 'scheergel', 'bodylotion', 'make-up', 'mascara',
    'lippenstift', 'nagellak', 'parfum', 'eau de toilette', 'zonnebrand', 'aftersun',
    'maandverband', 'tampon', 'inlegkruisje', 'condoom', 'vitamine', 'supplement', 'paracetamol',
    'pleister', 'hoestdrank', 'neusspray', 'zakdoekjes', 'vuilniszak', 'aluminiumfolie',
    'batterij', 'gloeilamp', 'speelgoed', 'tijdschrift', 'handdoek', 'beddengoed', 'pannenset',
    'servies', 'bestek', 'boeket', 'hondenvoer', 'kattenvoer', 'kattenbakvulling', 'kattenbrokjes',
    'hondenbrokken', 'diervoeding', 'dierensnack', 'sokken', 'ondergoed', 'handzeep', 'douchegel',
    'haarverf', 'lenzenvloeistof', 'kauwgom', 'tandenstoker', 'luiers', 'visolie', 'visoliecapsules',
    'wasgel', 'reiniger', 'toiletblok', 'lucifers', 'kaars', 'kookpan', '=jumbone'
  ]
};

const uitzonderingenPerGroep = {
  snoep_snacks: ['snoepgroente', 'snoeptomaat', 'snoeptomaatjes', 'snoepworteltjes', 'snackworteltjes'],
  dranken: ['koffiebroodje', 'koffiebroodjes'],
  zuivel: ['pindakaas', 'pindaboter', 'kokosmelk', 'amandelmelk', 'havermelk', 'sojamelk', 'notenboter'],
  nonfood: ['koffiecapsules']
};

const groepen = {};
for (const [naam, woorden] of Object.entries(woordgroepen)) {
  groepen[naam] = maakGroep(woorden, uitzonderingenPerGroep[naam] || []);
}

// Categorienamen uit de scrapers die vrijwel altijd non-food zijn.
const nonfoodCategorieen = new Set([
  'etos acties', 'gall & gall acties', 'gall & gall klantenkaart', 'drogisterij', 'huishouden',
  'baby en kind', 'huisdier', 'koken, tafelen, vrije tijd', 'bloemen en planten',
  'wonen en vrije tijd', 'nonfood', 'non-food', 'wonen', 'lotto kleding', 'kerstaccessoires'
]);

const alcoholCategorieen = new Set([
  'bier, wijn, aperitieven', 'gall & gall acties', 'gall & gall klantenkaart', 'wijn', 'bier',
  'bier, mixdranken, aperitieven en likeuren'
]);

// De winkelcategorie is vaak het enige signaal. "Lay's Oven Baked paprika"
// bevat geen enkel snackwoord, maar staat wel onder "Borrel, chips, snacks".
const categorieHints = [
  [['koek, snoep, chocolade', 'borrel, chips, snacks', 'snoep en snacks', 'zoet en snacks',
    'chips en snacks', 'koek en snoep', 'chips, noten en zoutjes'], 'snoep_snacks'],
  [['frisdrank, sappen, water', 'dranken', 'sappen en water', 'koffie en thee', 'koffie, thee'], 'dranken'],
  [['aardappel, groente, fruit', 'groente en fruit', 'groente', 'fruit', 'fruit, verse sappen',
    'groente, aardappelen', 'aardappels, groente en fruit', 'aardappelen, groenten en fruit',
    'aardappelen, groente, fruit'], 'groente_fruit'],
  [['maaltijden en salades', 'maaltijden', 'verspakketten', 'maaltijden, salades',
    'verse maaltijden, gemak, salades'], 'gemak'],
  [['brood en gebak', 'bakkerij', 'brood, bakkerij', 'brood, bakkerij en bakken'], 'brood_graan'],
  [['kaas', 'zuivel, eieren'], 'zuivel']
];

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

// ---------------------------------------------------------------------------
// Signalen uit de winkelcategorie
// ---------------------------------------------------------------------------

function categorieSignaal(categorie) {
  const tk = tokens(categorie);
  const vlees = tk.some((w) => ['vlees', 'vleeswaren', 'kip', 'gevogelte', 'slager', 'slagerij'].includes(w));
  const vis = tk.some((w) => ['vis', 'zeevruchten'].includes(w));
  // "Vlees, vis en vega" en "Kaas en vleeswaren" zijn gemengd.
  const gemengd = tk.some((w) => ['vega', 'vegetarisch', 'kaas', 'zuivel', 'plantaardig'].includes(w)) ||
    (vlees && vis);
  return { vlees, vis, gemengd };
}

// ---------------------------------------------------------------------------
// De classificatie zelf
// ---------------------------------------------------------------------------

function dieetSignalen(naamTekst, categorie, tags) {
  const t = bereid(naamTekst);
  // Een naam met "of", "en" of een komma bevat meerdere varianten. Daar zegt
  // een vegetarisch label niets over de andere varianten: "Peper, vegan of
  // boschampignonspaté" bevat ook gewone paté.
  const komma = /[,/]/.test(String(naamTekst));
  const varianten = komma || / (of|en|and) /.test(t.zin);

  let vlees = VLEES.test(t);
  let vis = VIS.test(t);

  // Hoofdwoorden als "burger" en "schnitzel": kijk wat ervoor staat.
  for (const i of KOPPEN.tokenTreffers(t)) {
    const tk = t.tokens[i];
    const vorige = i > 0 ? t.tokens[i - 1] : '';
    const ervoor = tk + ' ' + vorige;
    const isVis = VIS.test(bereid(tk.replace(/(burger|schnitzel|kroket|nugget|medaillon|balletje)\w*$/, ''))) ||
      VIS.test(bereid(vorige));
    if (isVis) {
      vis = true;
    } else if (!VEGA_VOORVOEGSELS.some((v) => ervoor.includes(v))) {
      vlees = true;
    }
  }

  // "Spekjes" is in de snoepafdeling een schuimsnoepje, elders blokjes spek.
  const snoepCategorie = tags.has('snoep_snacks');
  if (snoepCategorie && t.tokens.includes('spekjes') && !t.tokens.some((w) => w !== 'spekjes' && VLEES.test(bereid(w)))) {
    vlees = false;
  }

  // De winkelcategorie als extra signaal.
  const cat = categorieSignaal(categorie);
  if (!cat.gemengd) {
    if (cat.vlees) vlees = true;
    if (cat.vis) vis = true;
  } else if ((cat.vlees || cat.vis) && !vlees && !vis) {
    // Gemengde categorie en de naam zegt niets: alleen als het duidelijk
    // zuivel, plantaardig of groente is, nemen we aan dat het geen vlees is.
    const duidelijkVega = tags.has('zuivel') || tags.has('plantaardig_eiwit') ||
      tags.has('groente_fruit') || VEGETARISCH_LABEL.test(t);
    if (!duidelijkVega) vlees = true;
  }

  // Een vegetarisch label wint, behalve bij een naam met meerdere varianten.
  const vegaLabel = VEGETARISCH_LABEL.test(t);
  if (vegaLabel && !varianten) {
    vlees = false;
    vis = false;
  }

  // Varkensvlees: een varkenswoord, of vlees waarvan we de soort niet weten.
  let varken = false;
  if (vlees) {
    const zekerVarken = VARKEN.test(t);
    const andereSoort = NIET_VARKEN.test(t);
    varken = zekerVarken || !andereSoort || varianten;
    if (!zekerVarken && andereSoort && !varianten) varken = false;
  }

  // Samengesteld zonder vegetarisch label of vega-aanwijzing: onzeker.
  const onzeker = !vlees && !vis && SAMENGESTELD.test(t) && !(VEGA_AANWIJZING.test(t) && !varianten && !VLEES.test(t));

  const veganLabel = VEGAN_LABEL.test(t) && !varianten;
  const dierlijkOverig = DIERLIJK_OVERIG.test(t) && !veganLabel;
  const veganOnzeker = !veganLabel && (VEGAN_ONZEKER.test(t) || snoepCategorie || tags.has('zuivel'));

  return { vlees, vis, varken, onzeker, dierlijkOverig, veganOnzeker };
}

function classificeer(rij) {
  const naam = String(rij.naam || '');
  const eenheid = String(rij.eenheid || '');
  const categorie = String(rij.categorie || '');
  const t = bereid(naam + ' ' + eenheid);
  const catLaag = categorie.trim().toLowerCase();

  const tags = new Set();
  for (const [groep, g] of Object.entries(groepen)) {
    if (g.test(t)) tags.add(groep);
  }

  // Losse eieren staan zelden als "eieren" in de naam, dus apart matchen.
  if (maakMatcher('$eieren').test(t) || ['eitjes', 'scharrelei', 'kippenei'].some((w) => t.tokens.includes(w))) {
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

  // De dieetsignalen worden hier, vóór het opschonen, vastgelegd.
  const dieet = dieetSignalen(naam, categorie, tags);
  if (dieet.vlees) tags.add('vlees');
  if (dieet.vis) tags.add('vis');

  // Non-food sluit voedingslabels uit, anders wordt "kaas" in een kaasschaaf
  // of "rund" in hondenbrokken alsnog als eiwitrijk product geteld.
  if (tags.has('nonfood')) {
    for (const x of ['vlees', 'vis', 'zuivel', 'plantaardig_eiwit', 'groente_fruit', 'gemak', 'snoep_snacks', 'dranken']) {
      tags.delete(x);
    }
  }
  if (tags.has('alcohol')) {
    for (const x of ['vlees', 'vis', 'zuivel', 'plantaardig_eiwit', 'gemak', 'groente_fruit']) tags.delete(x);
  }

  // Smaakaanduidingen zijn de grootste bron van valse labels: paprikachips is
  // geen groente, aardbeienijs geen fruit en een chocolademelk geen zuivelmaaltijd.
  // Vlees en vis blijven staan: een "Salami snack" is wel degelijk vlees.
  if (tags.has('snoep_snacks')) {
    for (const x of ['groente_fruit', 'gemak', 'plantaardig_eiwit', 'zuivel']) tags.delete(x);
  }
  if (tags.has('dranken') && !tags.has('zuivel')) {
    tags.delete('groente_fruit');
  }

  const eiwitrijk =
    tags.has('vlees') || tags.has('vis') || tags.has('zuivel') || tags.has('plantaardig_eiwit');
  const vers = tags.has('groente_fruit') || tags.has('vis') || tags.has('vlees');

  let hoofdcategorie = 'Overig';
  for (const [label, tag] of hoofdcategorieOrde) {
    if (tags.has(tag)) {
      hoofdcategorie = label;
      break;
    }
  }

  const dierlijk = dieet.vlees || dieet.vis || dieet.dierlijkOverig || tags.has('zuivel');

  return {
    tags: [...tags],
    hoofdcategorie,
    eiwitrijk,
    vers,
    // De dieetvelden komen uit de signalen, niet uit de opgeschoonde tags.
    bevat_vlees: dieet.vlees,
    bevat_vis: dieet.vis,
    bevat_zuivel: tags.has('zuivel') || dieet.dierlijkOverig,
    bevat_dierlijk: dierlijk,
    bevat_varken: dieet.varken,
    dieet_onzeker: dieet.onzeker,
    vegan_onzeker: dieet.veganOnzeker,
    is_alcohol: tags.has('alcohol'),
    is_nonfood: tags.has('nonfood'),
    is_snoep: tags.has('snoep_snacks'),
    is_gemak: tags.has('gemak'),
    is_plantaardig: tags.has('plantaardig_eiwit') && !dierlijk
  };
}

module.exports = { classificeer, hoofdcategorieOrde, normaliseer, tokens };
