'use strict';

// Werkt zowel op een eigen domein als achter Home Assistant ingress, waar de
// app onder /api/hassio_ingress/<token>/ hangt. Daarom alles relatief.
const BASIS = location.pathname.replace(/\/[^/]*$/, '/');
const api = (pad) => BASIS + 'api/' + pad;

const WINKELKLEUREN = {
  AH: 'var(--ah)',
  'Albert Heijn': 'var(--ah)',
  Jumbo: 'var(--jumbo)',
  Lidl: 'var(--lidl)',
  // De data gebruikt hoofdletters; de oude spelling blijft voor de zekerheid.
  PLUS: 'var(--plus)',
  Plus: 'var(--plus)',
  ALDI: 'var(--aldi)',
  Aldi: 'var(--aldi)'
};

const STANDAARD = {
  profiel: 'alles',
  winkels: [],
  dieet: [],
  categorieen: [],
  huishouden: 2,
  max_prijs: 0,
  min_korting: 0,
  alleen_korting: false,
  nonfood: false,
  winkelbezoek: 'alles',
  q: '',
  sort: 'score'
};

const PAGINA = 48;

let staat = { ...STANDAARD };
let metaData = null;
let laatsteSelectie = null;
let getoond = 0;
let laatsteTotaal = 0;
let lijst = [];
let ophaalTeller = 0;

const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Opslag en URL
// ---------------------------------------------------------------------------

function veiligLees(sleutel) {
  try {
    const ruw = localStorage.getItem(sleutel);
    return ruw ? JSON.parse(ruw) : null;
  } catch (e) {
    return null;
  }
}

function veiligSchrijf(sleutel, waarde) {
  try {
    localStorage.setItem(sleutel, JSON.stringify(waarde));
  } catch (e) {
    /* privémodus of volle opslag: dan bewaren we simpelweg niets */
  }
}

function staatUitUrl() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return null;
  const uit = { ...STANDAARD };
  const csv = (k) => (p.get(k) ? p.get(k).split(',').filter(Boolean) : []);
  if (p.get('profiel')) uit.profiel = p.get('profiel');
  if (p.get('winkels')) uit.winkels = csv('winkels');
  if (p.get('dieet')) uit.dieet = csv('dieet');
  if (p.get('categorieen')) uit.categorieen = csv('categorieen');
  if (p.get('huishouden')) uit.huishouden = parseInt(p.get('huishouden'), 10) || 2;
  if (p.get('max_prijs')) uit.max_prijs = parseFloat(p.get('max_prijs')) || 0;
  if (p.get('min_korting')) uit.min_korting = parseInt(p.get('min_korting'), 10) || 0;
  if (p.get('sort')) uit.sort = p.get('sort');
  if (p.get('q')) uit.q = p.get('q');
  uit.alleen_korting = p.get('alleen_korting') === '1';
  uit.nonfood = p.get('nonfood') === '1';
  if (p.get('winkelbezoek')) uit.winkelbezoek = p.get('winkelbezoek');
  return uit;
}

function naarParams(voorDelen) {
  const p = new URLSearchParams();
  p.set('profiel', staat.profiel);
  if (staat.winkels.length) p.set('winkels', staat.winkels.join(','));
  if (staat.dieet.length) p.set('dieet', staat.dieet.join(','));
  if (staat.categorieen.length) p.set('categorieen', staat.categorieen.join(','));
  p.set('huishouden', String(staat.huishouden));
  if (staat.max_prijs > 0) p.set('max_prijs', String(staat.max_prijs));
  if (staat.min_korting > 0) p.set('min_korting', String(staat.min_korting));
  if (staat.alleen_korting) p.set('alleen_korting', '1');
  if (staat.nonfood) p.set('nonfood', '1');
  if (staat.winkelbezoek !== 'alles') p.set('winkelbezoek', staat.winkelbezoek);
  if (staat.q) p.set('q', staat.q);
  if (staat.sort !== 'score') p.set('sort', staat.sort);
  if (!voorDelen) {
    p.set('limit', String(PAGINA));
    p.set('offset', String(getoond));
  }
  return p;
}

function urlBijwerken() {
  const p = naarParams(true);
  history.replaceState(null, '', location.pathname + '?' + p.toString());
}

// ---------------------------------------------------------------------------
// Weergavehulpjes
// ---------------------------------------------------------------------------

const euroOpmaak = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2
});

const euro = (v) => (typeof v === 'number' && isFinite(v) ? euroOpmaak.format(v) : null);

function datumNl(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' });
}

function ontsnap(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Recepten komen van een taalmodel via n8n. Alleen http(s)-links doorlaten.
function veiligeUrl(waarde) {
  return /^https?:\/\//i.test(String(waarde || '')) ? String(waarde) : null;
}

let toastTimer = null;
function toast(tekst) {
  const t = el('toast');
  t.textContent = tekst;
  t.classList.remove('verborgen');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('verborgen'), 2600);
}

// ---------------------------------------------------------------------------
// Filters opbouwen uit /api/meta
// ---------------------------------------------------------------------------

function bouwProfielen() {
  const houder = el('profielen');
  houder.innerHTML = '';
  for (const p of metaData.profielen) {
    const b = document.createElement('button');
    b.className = 'profiel';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(p.sleutel === staat.profiel));
    b.dataset.sleutel = p.sleutel;
    if (p.bron === 'assistent') b.classList.add('profiel-assistent');

    // Bij een assistent-selectie is het aantal producten relevante informatie:
    // een selectie van vorige week kan grotendeels verlopen zijn.
    let extra = ontsnap(p.omschrijving);
    if (p.bron === 'assistent') {
      const deel =
        p.nog_actueel === p.aantal
          ? p.aantal + ' deals'
          : p.nog_actueel + ' van ' + p.aantal + ' nog actueel';
      extra = '<em class="profiel-merk">Assistent</em> ' + deel;
    }

    b.innerHTML =
      '<span class="profiel-icoon"><svg><use href="#i-' + ontsnap(p.icoon || 'sparkles') + '"></use></svg></span>' +
      '<span class="profiel-tekst"><strong>' + ontsnap(p.naam) + '</strong>' +
      '<span>' + extra + '</span></span>';
    b.addEventListener('click', () => kiesProfiel(p.sleutel));
    houder.appendChild(b);
  }
  profielTabindex();

  // Het gekozen profiel kan achteraan de rij staan, bijvoorbeeld uit een
  // gedeelde link. Schuif het dan in beeld, zonder animatie bij het laden.
  const gekozen = houder.querySelector('[aria-checked="true"]');
  if (gekozen) {
    const r = houder.getBoundingClientRect();
    const k = gekozen.getBoundingClientRect();
    if (k.left < r.left || k.right > r.right) {
      houder.scrollTo({ left: houder.scrollLeft + k.left - r.left - 20, behavior: 'instant' });
    }
  }
  profielRandBijwerken();
}

// Een bewuste keuze van de bezoeker. Alleen dan laten we de selectie van de
// assistent bij een volgend bezoek los.
function kiesProfiel(sleutel) {
  staat.profiel = sleutel;
  veiligSchrijf('bd_profiel_gekozen', true);
  for (const k of el('profielen').querySelectorAll('.profiel')) {
    k.setAttribute('aria-checked', String(k.dataset.sleutel === sleutel));
  }
  profielTabindex();
  opnieuw();
}

// Een radiogroep is één tabstop: alleen de gekozen knop zit in de tabvolgorde,
// met de pijltjestoetsen ga je binnen de groep.
function profielTabindex() {
  const knoppen = [...el('profielen').querySelectorAll('.profiel')];
  const gekozen = knoppen.find((k) => k.getAttribute('aria-checked') === 'true') || knoppen[0];
  for (const k of knoppen) k.tabIndex = k === gekozen ? 0 : -1;
}

function radioPijlen(houder, selector, kies) {
  houder.addEventListener('keydown', (e) => {
    const stap = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!stap) return;
    const knoppen = [...houder.querySelectorAll(selector)];
    const i = knoppen.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const volgende = knoppen[(i + stap + knoppen.length) % knoppen.length];
    volgende.focus();
    kies(volgende);
  });
}

// Welke kant van de profielrij nog kaarten verbergt: bepaalt de zachte rand
// en welke pijlknoppen zichtbaar zijn.
function profielRandBijwerken() {
  const houder = el('profielen');
  const links = houder.scrollLeft > 2;
  const rechts = houder.scrollLeft + houder.clientWidth < houder.scrollWidth - 2;
  houder.classList.toggle('kan-links', links);
  houder.classList.toggle('kan-rechts', rechts);
  el('profielenLinks').hidden = !links;
  el('profielenRechts').hidden = !rechts;
}

function profielRijBedraden() {
  const houder = el('profielen');
  const stap = (richting) => {
    const zacht = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    houder.scrollBy({ left: richting * houder.clientWidth * 0.8, behavior: zacht ? 'smooth' : 'instant' });
  };
  el('profielenLinks').addEventListener('click', () => stap(-1));
  el('profielenRechts').addEventListener('click', () => stap(1));
  houder.addEventListener('scroll', profielRandBijwerken, { passive: true });
  new ResizeObserver(profielRandBijwerken).observe(houder);
}

// De knoppen worden één keer gebouwd en daarna alleen bijgewerkt. Opnieuw
// bouwen zou precies de knop vervangen die net is aangeklikt, en dan raakt
// een toetsenbordgebruiker zijn plek kwijt.
function bouwWinkels() {
  const houder = el('winkels');
  houder.innerHTML = '';
  for (const w of metaData.winkels) {
    const b = document.createElement('button');
    b.className = 'pil';
    b.type = 'button';
    b.dataset.winkel = w.naam;
    b.style.setProperty('--kleur', WINKELKLEUREN[w.naam] || 'var(--tekst-stil)');
    b.innerHTML = ontsnap(w.naam) + ' <small>' + w.aantal + '</small>';
    b.addEventListener('click', () => {
      // Leeg betekent "alles". De eerste klik zet dan juist alleen deze winkel uit.
      let huidig = staat.winkels.length ? [...staat.winkels] : metaData.winkels.map((x) => x.naam);
      huidig = huidig.includes(w.naam) ? huidig.filter((n) => n !== w.naam) : [...huidig, w.naam];
      if (huidig.length === 0) huidig = metaData.winkels.map((x) => x.naam);
      staat.winkels = huidig.length === metaData.winkels.length ? [] : huidig;
      winkelsBijwerken();
      opnieuw();
    });
    houder.appendChild(b);
  }
  winkelsBijwerken();
}

function winkelsBijwerken() {
  for (const b of el('winkels').querySelectorAll('.pil')) {
    const aan = staat.winkels.length === 0 || staat.winkels.includes(b.dataset.winkel);
    b.setAttribute('aria-pressed', String(aan));
  }
}

function bouwDieten() {
  const houder = el('dieten');
  houder.innerHTML = '';
  for (const d of metaData.dieten) {
    const l = document.createElement('label');
    l.className = 'vinkje';
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = staat.dieet.includes(d.sleutel);
    i.addEventListener('change', () => {
      staat.dieet = i.checked
        ? [...staat.dieet, d.sleutel]
        : staat.dieet.filter((s) => s !== d.sleutel);
      opnieuw();
    });
    const s = document.createElement('span');
    s.textContent = d.naam;
    l.append(i, s);
    houder.appendChild(l);
  }
}

function bouwCategorieen() {
  const houder = el('categorieen');
  houder.innerHTML = '';
  for (const c of metaData.categorieen) {
    const l = document.createElement('label');
    l.className = 'vinkje';
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = staat.categorieen.includes(c.naam);
    i.addEventListener('change', () => {
      staat.categorieen = i.checked
        ? [...staat.categorieen, c.naam]
        : staat.categorieen.filter((s) => s !== c.naam);
      opnieuw();
    });
    const s = document.createElement('span');
    s.textContent = c.naam;
    const e = document.createElement('em');
    e.textContent = c.aantal;
    l.append(i, s, e);
    houder.appendChild(l);
  }
}

function schuivenBijwerken() {
  const mp = el('maxPrijs');
  mp.max = String(Math.max(10, metaData ? metaData.max_prijs : 25));
  mp.value = String(staat.max_prijs);
  el('maxPrijsUit').textContent = staat.max_prijs > 0 ? 'tot ' + euro(staat.max_prijs) : 'geen maximum';
  el('minKorting').value = String(staat.min_korting);
  el('minKortingUit').textContent = staat.min_korting > 0 ? 'vanaf ' + staat.min_korting + '%' : 'alles';
}

function segmentBijwerken() {
  const zet = (b, aan) => {
    b.classList.toggle('actief', aan);
    b.setAttribute('aria-checked', String(aan));
    b.tabIndex = aan ? 0 : -1;
  };
  for (const b of el('huishouden').querySelectorAll('button')) {
    zet(b, Number(b.dataset.waarde) === staat.huishouden);
  }
  for (const b of el('winkelbezoek').querySelectorAll('button')) {
    zet(b, b.dataset.waarde === staat.winkelbezoek);
  }
}

function filterAantalBijwerken() {
  let n = 0;
  if (staat.winkels.length) n++;
  if (staat.dieet.length) n += staat.dieet.length;
  if (staat.categorieen.length) n++;
  if (staat.max_prijs > 0) n++;
  if (staat.min_korting > 0) n++;
  if (staat.alleen_korting) n++;
  if (staat.nonfood) n++;
  if (staat.winkelbezoek !== 'alles') n++;
  el('filterAantal').textContent = String(n);
}

// ---------------------------------------------------------------------------
// Kaarten
// ---------------------------------------------------------------------------

function prijsBlok(d) {
  const delen = [];
  const nu = euro(d.stuksprijs !== null ? d.stuksprijs : d.prijs_nu);
  if (nu) {
    delen.push('<span class="prijs-nu">' + nu + '</span>');
    // De server heeft de vergelijkprijs al op dezelfde noemer gezet als de
    // stuksprijs, dus die kan hier zonder rekenwerk doorgestreept mee.
    if (d.referentieprijs) {
      delen.push('<span class="prijs-was">' + euro(d.referentieprijs) + '</span>');
    }
  } else if (d.label) {
    delen.push('<span class="prijs-label">' + ontsnap(d.label) + '</span>');
  } else {
    delen.push('<span class="prijs-nu">Prijs onbekend</span>');
  }
  if (d.korting_pct !== null) {
    delen.push(
      '<span class="prijs-korting' + (d.korting_hard ? '' : ' zacht') + '">' +
      '-' + d.korting_pct + '%</span>'
    );
  }
  if (d.basisprijs && d.basisprijs.prijs > 0) {
    delen.push(
      '<span class="prijs-basis">' + euro(d.basisprijs.prijs) + ' ' + d.basisprijs.label + '</span>'
    );
  }
  return delen.join(' ');
}

function scoreband(d) {
  if (d.score >= 72) return '<span class="scoreband top">Topdeal</span>';
  if (d.score >= 52) return '<span class="scoreband">Goede deal</span>';
  return '';
}

function kaartHtml(d) {
  const inLijst = lijst.some((x) => x.id === d.id);
  const letter = ontsnap((d.naam || '?').charAt(0).toUpperCase());
  // data-fallback zodat de foutafhandeling (zie letBeeldFouten) de letter kan
  // tonen zonder terug te hoeven grijpen naar de deal-data: de afbeelding-URL
  // komt uit externe winkel-CDN's die soms een plaatje laten mislukken.
  const beeld = d.afbeelding
    ? '<img src="' + ontsnap(d.afbeelding) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="' + letter + '">'
    : '<span>' + letter + '</span>';

  const naam = d.link
    ? '<a href="' + ontsnap(d.link) + '" target="_blank" rel="noopener noreferrer">' + ontsnap(d.naam) + '</a>'
    : ontsnap(d.naam);

  const redenen = d.redenen
    .map((r, i) => '<span class="reden' + (i === 0 ? ' reden-sterk' : '') + '">' + ontsnap(r) + '</span>')
    .join('');

  // De onderbouwing van de assistent, alleen aanwezig binnen een selectie.
  const toelichting = d.toelichting
    ? '<p class="kaart-toelichting">' + ontsnap(d.toelichting) + '</p>'
    : '';

  const geldig = d.geldigheid_tekst
    ? ontsnap(d.geldigheid_tekst)
    : d.geldig_tot ? 't/m ' + datumNl(d.geldig_tot) : '';

  return (
    '<article class="kaart' + (inLijst ? ' in-lijst' : '') + '" data-id="' + d.id + '">' +
    scoreband(d) +
    '<div class="kaart-top">' +
    '<div class="kaart-beeld">' + beeld + '</div>' +
    '<div class="kaart-hoofd">' +
    '<div class="kaart-winkelrij">' +
    // Geen style-attribuut: de CSP staat geen inline stijlen toe. De kleur
    // komt uit styles.css op basis van data-winkel.
    '<span class="winkelbadge" data-winkel="' + ontsnap(d.winkel) + '">' +
    ontsnap(d.winkel) + '</span>' +
    (d.label ? '<span class="dealbadge">' + ontsnap(d.label) + '</span>' : '') +
    '</div>' +
    '<div class="kaart-naam">' + naam + '</div>' +
    (d.eenheid ? '<div class="kaart-eenheid">' + ontsnap(d.eenheid) + '</div>' : '') +
    '</div></div>' +
    '<div class="kaart-prijs">' + prijsBlok(d) + '</div>' +
    (redenen ? '<div class="kaart-redenen">' + redenen + '</div>' : '') +
    toelichting +
    '<div class="kaart-voet">' +
    '<span class="meta">' + [geldig, d.alleen_in_winkel ? 'alleen in de winkel' : ''].filter(Boolean).join(' · ') + '</span>' +
    (d.link ? '<a class="knop knop-plat" href="' + ontsnap(d.link) + '" target="_blank" rel="noopener noreferrer" title="Bekijk bij ' + ontsnap(d.winkel) + '"><svg><use href="#i-extern"></use></svg></a>' : '') +
    '<button type="button" class="knop ' + (inLijst ? 'knop-primair' : 'knop-rand') + ' toevoeg" data-id="' + d.id + '" aria-pressed="' + inLijst + '" aria-label="' + ontsnap(d.naam) + ' op mijn lijst">' +
    '<svg><use href="#i-' + (inLijst ? 'check' : 'plus') + '"></use></svg>' +
    (inLijst ? 'Op lijst' : 'Lijst') +
    '</button>' +
    '</div></article>'
  );
}

const dealsPerId = new Map();

function kaartenPlaatsen(items, aanvullen) {
  const houder = el('kaarten');
  if (!aanvullen) {
    houder.innerHTML = '';
    dealsPerId.clear();
  }
  // Bij aanvullen nooit een kaart die er al staat nog eens toevoegen.
  const nieuw = aanvullen ? items.filter((d) => !dealsPerId.has(d.id)) : items;
  for (const d of nieuw) dealsPerId.set(d.id, d);
  houder.insertAdjacentHTML('beforeend', nieuw.map(kaartHtml).join(''));
}

// Alleen de lijststand van een kaart bijwerken, in plaats van de hele kaart
// te vervangen. Zo blijft de focus op de knop waar je net op drukte.
function kaartLijstStand(id) {
  const kaart = document.querySelector('.kaart[data-id="' + id + '"]');
  if (!kaart) return;
  const inLijst = lijst.some((x) => x.id === id);
  kaart.classList.toggle('in-lijst', inLijst);
  const knop = kaart.querySelector('.toevoeg');
  if (!knop) return;
  knop.classList.toggle('knop-primair', inLijst);
  knop.classList.toggle('knop-rand', !inLijst);
  knop.setAttribute('aria-pressed', String(inLijst));
  knop.innerHTML = '<svg><use href="#i-' + (inLijst ? 'check' : 'plus') + '"></use></svg>' + (inLijst ? 'Op lijst' : 'Lijst');
}

// ---------------------------------------------------------------------------
// Ophalen
// ---------------------------------------------------------------------------

// Er zijn twee redenen om niets te tonen: je filters zijn te streng, of er is
// helemaal geen data. Dat tweede is geen filterprobleem, dus zeg dat ook zo.
function legeStaatTekst() {
  const geenData = !metaData || metaData.totaal === 0;

  // Een selectie van vorige week verwijst naar producten die niet meer in de
  // actuele scrape staan. Dat is geen filterprobleem en ook geen storing.
  if (!geenData && laatsteSelectie && laatsteSelectie.nog_actueel === 0) {
    el('leegTitel').textContent = 'Deze selectie is verlopen';
    el('leegUitleg').textContent =
      'De producten die de assistent koos staan niet meer in de actuele aanbiedingen. ' +
      'Zodra de flow opnieuw gelopen heeft, staat er een nieuwe selectie. Kies ondertussen ' +
      'een van de vaste profielen hierboven.';
    el('leegReset').classList.add('verborgen');
    return;
  }

  if (geenData) {
    el('leegTitel').textContent = 'Nog geen aanbiedingen';
    el('leegUitleg').textContent = metaData && metaData.fout
      ? 'De site kan de aanbiedingen op dit moment niet ophalen. Dat lost zich meestal binnen een paar minuten op, probeer het dan opnieuw.'
      : 'Er staan nog geen aanbiedingen in de database. Zodra de scrape gelopen heeft, verschijnen ze hier.';
    el('leegReset').classList.add('verborgen');
  } else {
    el('leegTitel').textContent = 'Niets gevonden';
    // Een oude zoekterm is de meest verraderlijke oorzaak, dus die noemen we.
    el('leegUitleg').textContent = staat.q
      ? 'Er staat nog een zoekterm aan: "' + staat.q + '". Samen met je andere filters levert dat niets op.'
      : 'Deze combinatie van filters levert geen aanbiedingen op. Laat de filters los om alles binnen dit profiel te zien.';
    el('leegReset').classList.remove('verborgen');
  }
}

let ophaalTimer = null;

function opnieuw(vertraagd) {
  getoond = 0;
  urlBijwerken();
  filterAantalBijwerken();
  // De zoekterm bewaren we niet: een vergeten "chocola" van vorige week gaf
  // anders 0 aanbiedingen zonder dat duidelijk was waarom.
  veiligSchrijf('bd_filters', { ...staat, q: '' });
  clearTimeout(ophaalTimer);
  ophaalTimer = setTimeout(() => haalDeals(false), vertraagd ? 260 : 0);
}

async function haalDeals(aanvullen) {
  const mijnRonde = ++ophaalTeller;
  const p = naarParams(false);
  let data;
  try {
    const res = await fetch(api('deals?' + p.toString()));
    if (!res.ok) throw new Error('Server antwoordde met ' + res.status);
    data = await res.json();
  } catch (e) {
    if (mijnRonde !== ophaalTeller) return;
    el('samenvatting').innerHTML = '<span>Kon de aanbiedingen niet ophalen: ' + ontsnap(e.message) + '</span>';
    return;
  }
  if (mijnRonde !== ophaalTeller) return;

  laatsteTotaal = data.totaal;
  getoond += data.items.length;
  kaartenPlaatsen(data.items, aanvullen);

  // Eerst de selectie bijwerken, dan pas de lege staat: die leest hem.
  laatsteSelectie = data.selectie || null;
  el('leeg').classList.toggle('verborgen', data.totaal > 0);
  if (data.totaal === 0) legeStaatTekst();
  el('meerKnop').classList.toggle('verborgen', getoond >= data.totaal);
  el('meerKnop').textContent = 'Nog ' + (data.totaal - getoond) + ' aanbiedingen laden';

  const s = data.samenvatting;
  const delen = [];

  if (data.selectie) {
    const datum = data.selectie.gegenereerd_op
      ? new Date(data.selectie.gegenereerd_op).toLocaleDateString('nl-NL', {
          day: 'numeric',
          month: 'long'
        })
      : 'onbekend';
    delen.push(
      '<span class="samenvatting-merk"><svg><use href="#i-sparkles"></use></svg> ' +
        'Selectie van de assistent, ' + datum + '</span>'
    );
    if (data.selectie.nog_actueel < data.selectie.gevraagd) {
      delen.push(
        '<span><strong>' + data.selectie.nog_actueel + '</strong> van ' +
          data.selectie.gevraagd + ' gekozen deals zijn nog actueel</span>'
      );
    }
  }

  delen.push('<span><strong>' + data.totaal + '</strong> aanbiedingen die passen</span>');
  if (s.gemiddelde_korting !== null) {
    delen.push('<span>gemiddeld <strong>' + s.gemiddelde_korting + '%</strong> korting</span>');
  }
  if (s.beste_korting !== null) {
    delen.push('<span>hoogste korting <strong>' + s.beste_korting + '%</strong></span>');
  }
  if (s.eiwitrijk) delen.push('<span><strong>' + s.eiwitrijk + '</strong> eiwitrijk</span>');
  el('samenvatting').innerHTML = delen.join('');
}

async function haalMeta() {
  const res = await fetch(api('meta'));
  if (!res.ok) throw new Error('Server antwoordde met ' + res.status);
  metaData = await res.json();

  document.title = metaData.site_titel + ' — supermarktaanbiedingen op maat';
  el('siteTitel').textContent = metaData.site_titel;

  const datum = metaData.laatste_update ? datumNl(metaData.laatste_update) : 'onbekend';
  el('kopMeta').textContent = metaData.totaal + ' aanbiedingen · bijgewerkt ' + datum;
  el('voetMeta').textContent =
    'Laatste scrape: ' + datum + ' · ' +
    metaData.winkels.map((w) => w.naam + ' ' + w.aantal).join(' · ');

  const m = el('melding');
  const verouderd = (metaData.winkels || []).filter((w) => w.verouderd);
  if (metaData.demo) {
    m.classList.remove('verborgen');
    m.innerHTML =
      '<strong>Demodata.</strong> Er is geen databaseverbinding ingesteld, dus de site ' +
      'toont voorbeeldaanbiedingen zodat je het uiterlijk kunt bekijken.';
  } else if (metaData.fout) {
    m.classList.remove('verborgen');
    m.innerHTML = '<strong>Even geen actuele aanbiedingen.</strong> ' + ontsnap(metaData.fout);
  } else if (verouderd.length) {
    // Oude data die als actueel wordt gepresenteerd is erger dan geen data.
    m.classList.remove('verborgen');
    const omschrijving = verouderd
      .map((w) => ontsnap(w.naam) + ' (' + w.dagen_oud + ' dagen)')
      .join(', ');
    m.innerHTML =
      '<strong>Let op, deze aanbiedingen zijn niet vers.</strong> De laatste update van ' +
      omschrijving + ' is te oud, dus een deel is waarschijnlijk verlopen. Controleer het schap.';
  } else {
    m.classList.add('verborgen');
  }

  bouwProfielen();
  bouwWinkels();
  bouwDieten();
  bouwCategorieen();
  schuivenBijwerken();
  segmentBijwerken();
  filterAantalBijwerken();
}

async function haalRecepten() {
  try {
    const res = await fetch(api('recepten'));
    const data = await res.json();
    if (!data.recepten || !data.recepten.length) return;

    el('tabRecepten').classList.remove('verborgen');
    el('recepten').innerHTML = data.recepten
      .map((r) => {
        const uit = (r.ingredienten || [])
          .map((i) => {
            const prijs = euro(Number(i.prijs_nu));
            const extra = [i.winkel, prijs].filter(Boolean).join(', ');
            const link = veiligeUrl(i.link);
            const naam = link
              ? '<a href="' + ontsnap(link) + '" target="_blank" rel="noopener noreferrer">' + ontsnap(i.naam) + '</a>'
              : ontsnap(i.naam);
            return '<li>' + naam + (extra ? ' <em>(' + ontsnap(extra) + ')</em>' : '') + '</li>';
          })
          .join('');
        const extra = (r.extra_ingredienten || []).map((e) => '<li>' + ontsnap(e) + '</li>').join('');
        // Komt het recept uit een assistent-selectie, dan noemen we die erbij.
        const bron = r.bron
          ? '<span class="recept-bron"><svg><use href="#i-sparkles"></use></svg>' +
            ontsnap(r.bron) + '</span>'
          : '';
        return (
          '<article class="recept">' + bron + '<h3>' + ontsnap(r.titel) + '</h3>' +
          '<p>' + ontsnap(r.beschrijving) + '</p>' +
          (uit ? '<h4>Uit de aanbieding</h4><ul>' + uit + '</ul>' : '') +
          (extra ? '<h4>Nog nodig</h4><ul>' + extra + '</ul>' : '') +
          '</article>'
        );
      })
      .join('');
  } catch (e) {
    /* recepten zijn optioneel */
  }
}

// ---------------------------------------------------------------------------
// Boodschappenlijst
// ---------------------------------------------------------------------------

function lijstBewaren() {
  veiligSchrijf('bd_lijst', lijst);
  el('lijstAantal').textContent = String(lijst.length);
  lijstTekenen();
}

function lijstWissel(id) {
  const bestaand = lijst.findIndex((x) => x.id === id);
  if (bestaand >= 0) {
    lijst.splice(bestaand, 1);
  } else {
    const d = dealsPerId.get(id);
    if (!d) return;
    lijst.push({
      id: d.id,
      naam: d.naam,
      winkel: d.winkel,
      eenheid: d.eenheid,
      prijs: d.stuksprijs !== null ? d.stuksprijs : d.prijs_nu,
      label: d.label,
      link: d.link
    });
  }
  lijstBewaren();
  kaartLijstStand(id);
}

function lijstTekenen() {
  const houder = el('ladeInhoud');
  if (!lijst.length) {
    houder.innerHTML =
      '<div class="lade-leeg">Je lijst is nog leeg. Klik bij een aanbieding op <strong>Lijst</strong> om hem hier te zetten.</div>';
    el('ladeTotaal').textContent = euro(0);
    return;
  }

  const perWinkel = new Map();
  for (const r of lijst) {
    if (!perWinkel.has(r.winkel)) perWinkel.set(r.winkel, []);
    perWinkel.get(r.winkel).push(r);
  }

  let totaal = 0;
  let html = '';
  for (const [winkel, regels] of perWinkel) {
    html += '<div class="lade-groep"><h4>' + ontsnap(winkel) + '</h4>';
    for (const r of regels) {
      if (typeof r.prijs === 'number') totaal += r.prijs;
      html +=
        '<div class="lade-regel">' +
        '<span class="naam">' + ontsnap(r.naam) +
        (r.eenheid || r.label ? '<small>' + ontsnap([r.eenheid, r.label].filter(Boolean).join(' · ')) + '</small>' : '') +
        '</span>' +
        '<span class="bedrag">' + (euro(r.prijs) || '—') + '</span>' +
        '<button data-verwijder="' + r.id + '" aria-label="Verwijderen"><svg><use href="#i-sluit"></use></svg></button>' +
        '</div>';
    }
    html += '</div>';
  }
  houder.innerHTML = html;
  el('ladeTotaal').textContent = euro(totaal);
}

function lijstAlsTekst() {
  const perWinkel = new Map();
  for (const r of lijst) {
    if (!perWinkel.has(r.winkel)) perWinkel.set(r.winkel, []);
    perWinkel.get(r.winkel).push(r);
  }
  const regels = ['Boodschappenlijst'];
  for (const [winkel, items] of perWinkel) {
    regels.push('', winkel + ':');
    for (const r of items) {
      const prijs = euro(r.prijs);
      regels.push('- ' + r.naam + (r.eenheid ? ' (' + r.eenheid + ')' : '') + (prijs ? ' — ' + prijs : ''));
    }
  }
  return regels.join('\n');
}

async function naarKlembord(tekst, melding) {
  try {
    await navigator.clipboard.writeText(tekst);
    toast(melding);
  } catch (e) {
    // Bijvoorbeeld zonder https of zonder toestemming: dan maar selecteerbaar tonen.
    const veld = document.createElement('textarea');
    veld.value = tekst;
    veld.style.position = 'fixed';
    veld.style.opacity = '0';
    document.body.appendChild(veld);
    veld.select();
    try {
      document.execCommand('copy');
      toast(melding);
    } catch (e2) {
      toast('Kopiëren lukt niet in deze browser');
    }
    veld.remove();
  }
}

// ---------------------------------------------------------------------------
// Bedrading
// ---------------------------------------------------------------------------

// Bij openen gaat de focus naar de sluitknop, bij sluiten terug naar de knop
// waarmee het paneel geopend werd.
function lade(open) {
  const wasOpen = !el('lade').classList.contains('verborgen');
  el('lade').classList.toggle('verborgen', !open);
  el('overlay').classList.toggle('verborgen', !open);
  el('lijstKnop').setAttribute('aria-expanded', String(open));
  if (open && !wasOpen) el('ladeSluit').focus();
  if (!open && wasOpen) el('lijstKnop').focus();
}

function zijbalk(open) {
  const wasOpen = el('zijbalk').classList.contains('open');
  el('zijbalk').classList.toggle('open', open);
  el('filterKnop').setAttribute('aria-expanded', String(open));
  if (window.matchMedia('(max-width: 900px)').matches) {
    el('overlay').classList.toggle('verborgen', !open);
    if (open && !wasOpen) el('zijbalkSluit').focus();
    if (!open && wasOpen) el('filterKnop').focus();
  }
}

// Tab binnen de open lade houden.
function houdFocusInLade(e) {
  if (e.key !== 'Tab' || el('lade').classList.contains('verborgen')) return;
  const focusbaar = [...el('lade').querySelectorAll('button, a[href]')].filter((x) => !x.disabled);
  if (!focusbaar.length) return;
  const eerste = focusbaar[0];
  const laatste = focusbaar[focusbaar.length - 1];
  if (e.shiftKey && document.activeElement === eerste) {
    e.preventDefault();
    laatste.focus();
  } else if (!e.shiftKey && document.activeElement === laatste) {
    e.preventDefault();
    eerste.focus();
  }
}

function themaZetten(thema) {
  document.documentElement.dataset.thema = thema;
  veiligSchrijf('bd_thema', thema);
}

// 'error' op een <img> borrelt niet omhoog, dus dit moet met capture=true op
// een voorouder staan. Bij een mislukte load (bijv. een winkel-CDN die de
// afbeelding niet meer heeft) tonen we dezelfde letter-placeholder als bij een
// deal zonder afbeelding, in plaats van een kapot plaatje.
function letBeeldFouten() {
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.closest('.kaart-beeld')) return;
      const span = document.createElement('span');
      span.textContent = img.dataset.fallback || '?';
      img.replaceWith(span);
    },
    true
  );
}

function bedraad() {
  letBeeldFouten();
  profielRijBedraden();

  el('kaarten').addEventListener('click', (e) => {
    const knop = e.target.closest('.toevoeg');
    if (knop) lijstWissel(Number(knop.dataset.id));
  });

  el('ladeInhoud').addEventListener('click', (e) => {
    const knop = e.target.closest('[data-verwijder]');
    if (!knop) return;
    const id = Number(knop.dataset.verwijder);
    lijst = lijst.filter((x) => x.id !== id);
    lijstBewaren();
    kaartLijstStand(id);
    // De knop is weg; zet de focus op iets logisch in plaats van op <body>.
    const volgende = el('ladeInhoud').querySelector('[data-verwijder]') || el('ladeSluit');
    volgende.focus();
  });

  el('lijstKnop').addEventListener('click', () => lade(true));
  el('ladeSluit').addEventListener('click', () => lade(false));
  el('overlay').addEventListener('click', () => {
    lade(false);
    zijbalk(false);
  });
  el('filterKnop').addEventListener('click', () => zijbalk(true));
  el('zijbalkSluit').addEventListener('click', () => zijbalk(false));

  el('ladeKopieer').addEventListener('click', () => {
    if (!lijst.length) return toast('Je lijst is nog leeg');
    naarKlembord(lijstAlsTekst(), 'Lijst gekopieerd');
  });
  el('ladeLeeg').addEventListener('click', () => {
    const waren = lijst.map((x) => x.id);
    lijst = [];
    lijstBewaren();
    waren.forEach(kaartLijstStand);
  });

  el('deelKnop').addEventListener('click', () => {
    const url = location.origin + location.pathname + '?' + naarParams(true).toString();
    naarKlembord(url, 'Link met jouw filters gekopieerd');
  });

  el('themaKnop').addEventListener('click', () => {
    const nu = document.documentElement.dataset.thema;
    const donkerNu =
      nu === 'donker' ||
      (nu === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    themaZetten(donkerNu ? 'licht' : 'donker');
  });

  const zoek = el('zoek');
  zoek.addEventListener('input', () => {
    staat.q = zoek.value.trim();
    el('zoekWis').classList.toggle('verborgen', !staat.q);
    opnieuw(true);
  });
  el('zoekWis').addEventListener('click', () => {
    zoek.value = '';
    staat.q = '';
    el('zoekWis').classList.add('verborgen');
    opnieuw();
  });

  el('sorteer').addEventListener('change', (e) => {
    staat.sort = e.target.value;
    opnieuw();
  });

  const kiesHuishouden = (b) => {
    staat.huishouden = Number(b.dataset.waarde);
    segmentBijwerken();
    opnieuw();
  };
  const kiesWinkelbezoek = (b) => {
    staat.winkelbezoek = b.dataset.waarde;
    segmentBijwerken();
    opnieuw();
  };
  el('huishouden').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) kiesHuishouden(b);
  });
  el('winkelbezoek').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) kiesWinkelbezoek(b);
  });
  radioPijlen(el('huishouden'), 'button', kiesHuishouden);
  radioPijlen(el('winkelbezoek'), 'button', kiesWinkelbezoek);
  radioPijlen(el('profielen'), '.profiel', (b) => kiesProfiel(b.dataset.sleutel));

  el('maxPrijs').addEventListener('input', (e) => {
    staat.max_prijs = parseFloat(e.target.value) || 0;
    schuivenBijwerken();
    opnieuw(true);
  });
  el('minKorting').addEventListener('input', (e) => {
    staat.min_korting = parseInt(e.target.value, 10) || 0;
    schuivenBijwerken();
    opnieuw(true);
  });

  el('alleenKorting').addEventListener('change', (e) => {
    staat.alleen_korting = e.target.checked;
    opnieuw();
  });
  el('toonNonfood').addEventListener('change', (e) => {
    staat.nonfood = e.target.checked;
    opnieuw();
  });

  // Een dubbele klik mag niet twee keer dezelfde pagina ophalen.
  let meerBezig = false;
  el('meerKnop').addEventListener('click', async () => {
    if (meerBezig) return;
    meerBezig = true;
    el('meerKnop').disabled = true;
    try {
      await haalDeals(true);
    } finally {
      meerBezig = false;
      el('meerKnop').disabled = false;
    }
  });

  const herstel = () => {
    staat = { ...STANDAARD };
    // Alles terug naar af, dus ook de selectie van de assistent weer als start.
    veiligSchrijf('bd_profiel_gekozen', false);
    el('zoek').value = '';
    el('zoekWis').classList.add('verborgen');
    el('sorteer').value = staat.sort;
    el('alleenKorting').checked = false;
    el('toonNonfood').checked = false;
    bouwProfielen();
    bouwWinkels();
    bouwDieten();
    bouwCategorieen();
    schuivenBijwerken();
    segmentBijwerken();
    opnieuw();
  };
  el('resetKnop').addEventListener('click', herstel);

  // Filters loslaten houdt het profiel, het dieet en de huishoudgrootte vast:
  // die zeggen iets over de bezoeker, de rest over deze ene zoektocht.
  el('leegReset').addEventListener('click', () => {
    staat = {
      ...STANDAARD,
      profiel: staat.profiel,
      dieet: staat.dieet,
      huishouden: staat.huishouden,
      sort: staat.sort
    };
    el('zoek').value = '';
    el('zoekWis').classList.add('verborgen');
    el('alleenKorting').checked = false;
    el('toonNonfood').checked = false;
    winkelsBijwerken();
    bouwCategorieen();
    schuivenBijwerken();
    segmentBijwerken();
    opnieuw();
  });

  el('tabAanbiedingen').addEventListener('click', () => tab('aanbiedingen'));
  el('tabRecepten').addEventListener('click', () => tab('recepten'));

  document.addEventListener('keydown', (e) => {
    houdFocusInLade(e);
    if (e.key === 'Escape') {
      lade(false);
      zijbalk(false);
    }
    if (e.key === '/' && e.target === document.body) {
      e.preventDefault();
      el('zoek').focus();
    }
  });
}

function tab(welke) {
  const aan = welke === 'aanbiedingen';
  el('weergaveAanbiedingen').classList.toggle('verborgen', !aan);
  el('weergaveRecepten').classList.toggle('verborgen', aan);
  el('tabAanbiedingen').setAttribute('aria-pressed', String(aan));
  el('tabRecepten').setAttribute('aria-pressed', String(!aan));
}

async function start() {
  themaZetten(veiligLees('bd_thema') || 'auto');
  lijst = veiligLees('bd_lijst') || [];
  el('lijstAantal').textContent = String(lijst.length);

  const uitUrl = staatUitUrl();
  const opgeslagen = veiligLees('bd_filters');
  staat = uitUrl || opgeslagen || { ...STANDAARD };
  staat = { ...STANDAARD, ...staat };

  // Heeft de bezoeker zelf nog niets gekozen, dan is de selectie van de
  // assistent het startpunt. Dat is de curatie waar het om begonnen is; de
  // regelprofielen zijn de terugval als er nog geen selectie ingestuurd is.
  // Let op: de opgeslagen filters bevatten altijd een profiel, ook als de
  // bezoeker er nooit een koos. Daarom een eigen vlag voor een bewuste keuze.
  const profielIsGekozen = Boolean(
    (uitUrl && new URLSearchParams(location.search).get('profiel')) ||
      veiligLees('bd_profiel_gekozen') === true
  );
  if (!uitUrl) staat.q = '';

  el('zoek').value = staat.q;
  el('zoekWis').classList.toggle('verborgen', !staat.q);
  el('sorteer').value = staat.sort;
  el('alleenKorting').checked = staat.alleen_korting;
  el('toonNonfood').checked = staat.nonfood;

  bedraad();
  lijstTekenen();

  try {
    await haalMeta();
    if (!profielIsGekozen) {
      const eerste = (metaData.profielen || []).find(
        (p) => p.bron === 'assistent' && p.nog_actueel > 0
      );
      if (eerste) {
        staat.profiel = eerste.sleutel;
        bouwProfielen();
      }
    }
  } catch (e) {
    el('kopMeta').textContent = 'Kon de gegevens niet laden';
    el('samenvatting').innerHTML =
      '<span>De server antwoordde niet. Staat de add-on aan? (' + ontsnap(e.message) + ')</span>';
    return;
  }

  await haalDeals(false);
  haalRecepten();
}

start();
