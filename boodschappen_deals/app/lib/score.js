'use strict';

const { classificeer } = require('./classify');

// ---------------------------------------------------------------------------
// Eenheden ontleden, zodat we een eerlijke kiloprijs kunnen tonen.
// De scrapers leveren dingen als "500 g", "2 x 200 g", "6 x 33 cl", "ca. 1 kg".
// ---------------------------------------------------------------------------

const eenheidFactoren = {
  kg: { soort: 'gewicht', naar_basis: 1000 },
  kilo: { soort: 'gewicht', naar_basis: 1000 },
  g: { soort: 'gewicht', naar_basis: 1 },
  gr: { soort: 'gewicht', naar_basis: 1 },
  gram: { soort: 'gewicht', naar_basis: 1 },
  l: { soort: 'volume', naar_basis: 1000 },
  liter: { soort: 'volume', naar_basis: 1000 },
  ltr: { soort: 'volume', naar_basis: 1000 },
  ml: { soort: 'volume', naar_basis: 1 },
  cl: { soort: 'volume', naar_basis: 10 },
  dl: { soort: 'volume', naar_basis: 100 }
};

function parseEenheid(eenheid) {
  if (!eenheid) return null;
  const t = String(eenheid).toLowerCase().replace(/,/g, '.');

  // "per kilo" en "per liter": de prijs geldt al per kilo of per liter.
  const per = t.match(/\bper\s*(kg|kilo|liter|ltr|l)\b/);
  if (per) return { soort: eenheidFactoren[per[1]].soort, basis: 1000 };

  // Meervoudige verpakkingen: "2 x 200 g", "6 x 33 cl"
  const multi = t.match(/(\d+(?:\.\d+)?)\s*[x*]\s*(\d+(?:\.\d+)?)\s*(kg|kilo|gram|gr|g|liter|ltr|l|ml|cl|dl)\b/);
  if (multi) {
    const f = eenheidFactoren[multi[3]];
    if (f) {
      return {
        soort: f.soort,
        basis: parseFloat(multi[1]) * parseFloat(multi[2]) * f.naar_basis
      };
    }
  }

  const enkel = t.match(/(\d+(?:\.\d+)?)\s*(kg|kilo|gram|gr|g|liter|ltr|l|ml|cl|dl)\b/);
  if (enkel) {
    const f = eenheidFactoren[enkel[2]];
    if (f) return { soort: f.soort, basis: parseFloat(enkel[1]) * f.naar_basis };
  }

  // "4 st" en "6 stuks". Daar hoort geen kiloprijs bij, maar het aantal is wel nuttig.
  const stuks = t.match(/(\d+)\s*(?:st|stk|stuk|stuks)\b/);
  if (stuks && parseInt(stuks[1], 10) > 0) return { soort: 'stuks', basis: parseInt(stuks[1], 10) };
  return null;
}

// Eerst de eenheid, dan de naam, en gewicht of volume gaat voor stuks.
function bepaalInhoud(rij) {
  const kandidaten = [parseEenheid(rij.eenheid), parseEenheid(rij.naam)].filter(Boolean);
  return kandidaten.find((k) => k.soort !== 'stuks') || null;
}

// Postgres levert een DATE-kolom als Date-object; de rest van de app wil
// overal een simpele yyyy-mm-dd string, ook in de JSON naar de browser.
function naarDatum(waarde) {
  if (!waarde) return null;
  if (waarde instanceof Date) {
    const y = waarde.getFullYear();
    const m = String(waarde.getMonth() + 1).padStart(2, '0');
    const d = String(waarde.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  const s = String(waarde);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

// ---------------------------------------------------------------------------
// Het actielabel uitlezen. Dit is nodig omdat de scraper een deel van de acties
// als deal_type 'overig' wegschrijft zonder kortingsfactor: "2e gratis" en
// "3e gratis" komen zo binnen, terwijl dat in werkelijkheid 50 en 33 procent
// korting is. Zonder deze stap ranken die acties als "geen korting".
//
// `toepassen` zegt of de factor nog van de prijs af moet. Bij "1+1 gratis" en
// "2e gratis" staat de gewone schapprijs in de kolommen, dus ja. Bij
// "30% korting" is prijs_nu al de afgeprijsde prijs, dus nee.
// ---------------------------------------------------------------------------

function uitLabel(labelTekst) {
  if (!labelTekst) return null;
  const t = String(labelTekst).toLowerCase().replace(/,/g, '.').replace(/\s+/g, ' ').trim();

  // "50% korting op de 2e": alleen het tweede stuk is afgeprijsd, dus over
  // twee stuks is dat 25 procent.
  let m = t.match(/(\d+)\s*%\s*korting\s+op\s+(?:de\s+|het\s+)?(\d+)\s*(?:e|de|ste)\b/);
  if (m) {
    const pct = parseInt(m[1], 10);
    const n = parseInt(m[2], 10);
    if (pct > 0 && pct <= 100 && n >= 2) return { factor: pct / 100 / n, aantal: n, toepassen: true };
  }

  // "3 halen 2 betalen"
  m = t.match(/(\d+)\s*halen\s*,?\s*(\d+)\s*betalen/);
  if (m) {
    const halen = parseInt(m[1], 10);
    const betalen = parseInt(m[2], 10);
    if (halen > betalen && betalen > 0) {
      return { factor: (halen - betalen) / halen, aantal: halen, toepassen: true };
    }
  }

  // "1+1 gratis", "2+1 gratis" en een kale "1+1"
  m = t.match(/(\d+)\s*\+\s*(\d+)(?!\s*%)/);
  if (m) {
    const koop = parseInt(m[1], 10);
    const gratis = parseInt(m[2], 10);
    if (koop > 0 && gratis > 0) {
      return { factor: gratis / (koop + gratis), aantal: koop + gratis, toepassen: true };
    }
  }

  // "2e gratis", "3e gratis", "2de gratis": je neemt n stuks en betaalt n-1.
  m = t.match(/(\d+)\s*(?:e|de|ste)\s+gratis/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 2) return { factor: 1 / n, aantal: n, toepassen: true };
  }

  // "2e halve prijs": twee stuks voor 1,5 keer de prijs is 25 procent korting.
  m = t.match(/(\d+)\s*(?:e|de|ste)\s+halve\s+prijs/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 2) return { factor: 0.5 / n, aantal: n, toepassen: true };
  }

  // "2e voor 1 euro": het laatste stuk kost een vast bedrag. De korting hangt
  // af van de schapprijs, dus die rekent bepaalPrijzen uit.
  m = t.match(/(\d+)\s*(?:e|de|ste)\s+voor\s+(?:€\s*)?(\d+(?:\.\d+)?)/);
  if (m) {
    const n = parseInt(m[1], 10);
    const bedrag = parseFloat(m[2]);
    if (n >= 2 && bedrag >= 0) return { factor: null, aantal: n, toepassen: false, laatsteVoor: bedrag };
  }

  // "2 voor 6.99" en een kale "2 VOOR" (ALDI). Alleen met een bedrag erachter
  // of aan het eind, zodat "1 voordeelpak" geen bundel van 1 wordt.
  m = t.match(/(\d+)\s*voor\s+(?:€\s*)?(\d+(?:\.\d+)?)/) || t.match(/(\d+)\s*voor$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const bedrag = m[2] !== undefined ? parseFloat(m[2]) : null;
    if (n >= 1) return { factor: null, aantal: n, toepassen: false, bundelprijs: bedrag > 0 ? bedrag : null };
  }

  // "30% korting" (AH) en "-25%" (Lidl): prijs is al verlaagd.
  m = t.match(/(\d+)\s*%/);
  if (m) {
    const pct = parseInt(m[1], 10);
    if (pct > 0 && pct < 100) return { factor: pct / 100, aantal: 1, toepassen: false };
  }

  return null;
}

// Hoeveel stuks moet je afnemen om de dealprijs te halen?
function bepaalAantalStuks(rij, label) {
  if (label && label.aantal) return label.aantal;
  if (rij.deal_type === 'tweede_half') return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Kortingspercentage bepalen, inclusief hoe hard we het bewijs vinden.
// ---------------------------------------------------------------------------

function bepaalKorting(rij, label, prijzen) {
  const factor = Number(rij.kortingsfactor);
  const was = Number(rij.prijs_was);
  const nu = Number(rij.prijs_nu);

  let pct = null;
  let bron = null;

  // Is er een factor toegepast én kennen we de prijs van vóór de actie, dan is
  // de eerlijkste korting het verschil tussen die twee. Anders zou een product
  // dat eerst is afgeprijsd en daarna 2e-gratis krijgt, te laag uitkomen.
  if (
    prijzen &&
    prijzen.toegepast &&
    prijzen.referentie > 0 &&
    prijzen.effectief > 0 &&
    prijzen.effectief < prijzen.referentie
  ) {
    pct = (1 - prijzen.effectief / prijzen.referentie) * 100;
    bron = 'effectieve prijs';
  } else if (Number.isFinite(factor) && factor > 0 && factor < 1) {
    pct = factor * 100;
    bron = 'kortingsfactor';
  } else if (Number.isFinite(was) && Number.isFinite(nu) && was > 0 && nu > 0 && nu < was) {
    pct = (1 - nu / was) * 100;
    bron = 'prijsverschil';
  } else if (label && label.factor > 0 && label.factor < 1) {
    // Laatste redmiddel: de korting staat alleen in de labeltekst.
    pct = label.factor * 100;
    bron = 'label';
  }

  if (pct === null) return { pct: null, pct_gewogen: null, bron: null, hard: true };

  pct = Math.min(pct, 90);

  // Lidl vergelijkt met "elders", dus dat is geen eigen eerdere prijs.
  // Die korting weegt maar deels mee in de ranking, maar we tonen hem wel.
  const hard = rij.deal_type !== 'elders';
  return {
    pct: Math.round(pct),
    pct_gewogen: hard ? pct : pct * 0.6,
    bron,
    hard
  };
}

// ---------------------------------------------------------------------------
// Prijzen op één noemer brengen. Dit is de lastigste stap, want de drie
// scrapers vullen dezelfde kolommen met verschillende betekenissen:
//
//   deal_type 'bundel' ("2 voor 6.99"): prijs_nu en prijs_was gaan over de hele
//     bundel, prijs_per_stuk is al de effectieve stuksprijs. De vergelijkprijs
//     moet dus ook door het aantal gedeeld worden, anders zet je € 3,50 naast
//     € 9,99 en klopt het doorgestreepte bedrag niet.
//   deal_type 'gratis_erbij' ("1+1") en 'tweede_half': prijs_per_stuk is dan
//     gelijk aan prijs_nu, namelijk de gewone schapprijs van één stuk. De
//     effectieve stuksprijs volgt uit de kortingsfactor (1+1 is 50 procent).
//   al het overige ('procent', 'vaste_prijs', 'elders', 'lidl_plus'): prijs_nu
//     is al de afgeprijsde stuksprijs, dus die factor niet nóg eens toepassen.
// ---------------------------------------------------------------------------

function bepaalPrijzen(rij, aantalStuks, perStuk, nu, label) {
  const geldig = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const was = geldig(Number(rij.prijs_was));
  const eenheidsprijs = geldig(perStuk) ?? geldig(nu);

  // "2e voor 1 euro": n-1 stuks tegen de schapprijs plus één vast bedrag.
  if (label && label.laatsteVoor !== undefined && eenheidsprijs && label.aantal >= 2) {
    const n = label.aantal;
    const effectief = ((n - 1) * eenheidsprijs + label.laatsteVoor) / n;
    if (effectief < eenheidsprijs) {
      return { effectief, referentie: was && was > eenheidsprijs ? was : eenheidsprijs, toegepast: true };
    }
  }

  // Bundels: de scrapers vullen de kolommen niet consequent. PLUS zet bij
  // "3 voor 5.00" soms de bundelprijs in prijs_nu en prijs_per_stuk en soms de
  // schapprijs van één stuk; ALDI zet bij een kale "2 VOOR" de bundelprijs
  // erin. Het bedrag in het label zelf is de enige betrouwbare bron.
  if (label && label.aantal >= 2 && (label.bundelprijs || rij.deal_type === 'bundel')) {
    const n = label.aantal;
    const nuGeldig = geldig(nu);
    let effectief;
    if (label.bundelprijs) {
      effectief = label.bundelprijs / n;
    } else if (nuGeldig && (!geldig(perStuk) || Math.abs(perStuk - nuGeldig) < 0.005)) {
      // Kale "2 VOOR" zonder bedrag: aangenomen dat prijs_nu de hele bundel is.
      effectief = nuGeldig / n;
    } else {
      effectief = eenheidsprijs;
    }

    let referentie = null;
    if (was && label.bundelprijs && was >= label.bundelprijs * 0.98) referentie = was / n;
    else if (was && !label.bundelprijs && rij.deal_type === 'bundel') referentie = was / n;
    else if (was && was > effectief) referentie = was;
    else if (nuGeldig && nuGeldig > effectief * 1.005 && (!label.bundelprijs || nuGeldig < label.bundelprijs)) {
      // prijs_nu is hier de gewone prijs van één stuk.
      referentie = nuGeldig;
    }
    return { effectief, referentie, toegepast: Boolean(referentie && referentie > effectief) };
  }

  if (rij.deal_type === 'bundel') {
    return {
      effectief: eenheidsprijs,
      referentie: was && aantalStuks > 1 ? was / aantalStuks : was
    };
  }

  // Een factor die nog toegepast moet worden komt uit de kortingsfactor-kolom,
  // of uit het label als die kolom leeg is (de 'overig'-rijen met "2e gratis").
  const kolomFactor = Number(rij.kortingsfactor);
  const heeftKolomFactor = Number.isFinite(kolomFactor) && kolomFactor > 0 && kolomFactor < 1;
  const moetToepassen =
    rij.deal_type === 'gratis_erbij' ||
    rij.deal_type === 'tweede_half' ||
    Boolean(label && label.toepassen);

  if (moetToepassen && eenheidsprijs) {
    const factor = heeftKolomFactor ? kolomFactor : (label ? label.factor : null);
    if (factor > 0 && factor < 1) {
      return {
        effectief: eenheidsprijs * (1 - factor),
        referentie: was && was > eenheidsprijs ? was : eenheidsprijs,
        toegepast: true
      };
    }
  }

  return { effectief: eenheidsprijs, referentie: was, toegepast: false };
}

// ---------------------------------------------------------------------------
// Verrijking: eenmalig per rij, wordt in de cache bewaard.
// ---------------------------------------------------------------------------

function verrijk(rij) {
  const kenmerken = classificeer(rij);
  const label = uitLabel(rij.label_tekst);

  const perStuk = Number(rij.prijs_per_stuk);
  const nu = Number(rij.prijs_nu);
  const aantalStuks = bepaalAantalStuks(rij, label);
  const prijzen = bepaalPrijzen(rij, aantalStuks, perStuk, nu, label);
  const stuksprijs = prijzen.effectief;
  const korting = bepaalKorting(rij, label, prijzen);

  // AH levert `eenheid` meestal als lege string en zet de maat in de naam
  // ("AH Sweet Palermo rode puntpaprika zak 500 gram"). Zonder deze terugval
  // heeft geen enkel AH-product een kiloprijs.
  const eenheidInfo = bepaalInhoud(rij);
  let basisprijs = null; // prijs per kg of per liter
  if (eenheidInfo && stuksprijs) {
    const perBasis = stuksprijs / eenheidInfo.basis; // per gram of per ml
    basisprijs = {
      soort: eenheidInfo.soort,
      prijs: perBasis * 1000,
      label: eenheidInfo.soort === 'gewicht' ? 'per kg' : 'per liter'
    };
  }

  return {
    // product_id is een bigserial, en pg geeft bigint terug als string om
    // precisieverlies te voorkomen. Hier wordt het één keer een getal, want
    // verder in de app wordt er strikt op vergeleken: met de gekozen id's van
    // een assistent-selectie, en in de browser met de boodschappenlijst.
    // Zonder deze omzetting is "2403" === 2403 onwaar en matcht er nooit iets.
    product_id: Number(rij.product_id),
    winkel: rij.winkel,
    naam: rij.naam,
    winkelcategorie: rij.categorie || null,
    categorie: kenmerken.hoofdcategorie,
    eenheid: rij.eenheid || null,
    afbeelding: rij.afbeelding || null,
    link: rij.link || null,
    label_tekst: rij.label_tekst || null,
    deal_type: rij.deal_type || null,
    uitzondering: rij.uitzondering || null,
    alleen_in_winkel: rij.alleen_in_winkel === true,
    geldig_van: naarDatum(rij.geldig_van),
    geldig_tot: naarDatum(rij.geldig_tot),
    geldigheid_tekst: rij.geldigheid_tekst || null,
    scrape_datum: naarDatum(rij.scrape_datum),
    prijs_nu: Number.isFinite(nu) && nu > 0 ? nu : null,
    prijs_was: Number.isFinite(Number(rij.prijs_was)) && Number(rij.prijs_was) > 0
      ? Number(rij.prijs_was)
      : null,
    stuksprijs,
    referentieprijs: prijzen.referentie && prijzen.referentie > stuksprijs
      ? prijzen.referentie
      : null,
    basisprijs,
    inhoud: eenheidInfo,
    aantal_stuks: aantalStuks,
    korting_pct: korting.pct,
    korting_hard: korting.hard,
    _korting_gewogen: korting.pct_gewogen,
    tags: kenmerken.tags,
    kenmerken,
    zoektekst: [rij.naam, rij.categorie, rij.eenheid, rij.winkel]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  };
}

// ---------------------------------------------------------------------------
// Profielen. De gewichten tellen per profiel op tot 1, zodat scores tussen
// profielen vergelijkbaar blijven op een schaal van 0 tot 100.
// ---------------------------------------------------------------------------

const PROFIELEN = {
  alles: {
    naam: 'Beste deals',
    omschrijving: 'Puur de scherpste kortingen, ongeacht wat het is.',
    icoon: 'sparkles',
    gewichten: { korting: 0.72, eiwit: 0.05, vers: 0.08, goedkoop: 0.15 },
    straf: { snoep: 0.85, alcohol: 0.9, nonfood: 0.95 }
  },
  eiwit: {
    naam: 'Eiwitrijk en sportief',
    omschrijving: 'Vlees, vis, zuivel en plantaardige eiwitten die nu scherp staan.',
    icoon: 'dumbbell',
    gewichten: { korting: 0.40, eiwit: 0.40, vers: 0.08, goedkoop: 0.12 },
    straf: { snoep: 0.4, alcohol: 0.35, nonfood: 0.5 }
  },
  gezond: {
    naam: 'Gezond en vers',
    omschrijving: 'Veel groente, fruit, vis en onbewerkte producten.',
    icoon: 'leaf',
    gewichten: { korting: 0.34, eiwit: 0.18, vers: 0.38, goedkoop: 0.10 },
    straf: { snoep: 0.25, alcohol: 0.25, nonfood: 0.5 }
  },
  budget: {
    naam: 'Zo goedkoop mogelijk',
    omschrijving: 'Laagste prijs per stuk en per kilo staat bovenaan.',
    icoon: 'wallet',
    gewichten: { korting: 0.45, goedkoop: 0.48, eiwit: 0.07 },
    straf: { snoep: 0.8, alcohol: 0.8, nonfood: 0.9 }
  },
  gezin: {
    naam: 'Gezin en voorraad',
    omschrijving: 'Grote pakken en meerstuks-acties waar je een week op vooruit kunt.',
    icoon: 'users',
    gewichten: { korting: 0.40, goedkoop: 0.18, eiwit: 0.14, gemak: 0.16, bulk: 0.12 },
    straf: { snoep: 0.7, alcohol: 0.6, nonfood: 0.9 }
  },
  gemak: {
    naam: 'Snel klaar',
    omschrijving: 'Maaltijden, verspakketten en dingen die zo de oven in kunnen.',
    icoon: 'clock',
    gewichten: { korting: 0.35, gemak: 0.40, eiwit: 0.15, goedkoop: 0.10 },
    straf: { snoep: 0.6, alcohol: 0.6, nonfood: 0.6 }
  },
  plantaardig: {
    naam: 'Plantaardig',
    omschrijving: 'Groente, fruit, bonen, noten en vleesvervangers.',
    icoon: 'sprout',
    gewichten: { korting: 0.34, plant: 0.34, vers: 0.22, goedkoop: 0.10 },
    straf: { snoep: 0.4, alcohol: 0.4, nonfood: 0.5 }
  },
  borrel: {
    naam: 'Borrel en snacks',
    omschrijving: 'Bier, wijn, chips en alles voor een avond op de bank.',
    icoon: 'glass',
    gewichten: { korting: 0.55, borrel: 0.32, goedkoop: 0.13 },
    straf: { snoep: 1, alcohol: 1, nonfood: 0.6 }
  }
};

const DIEETEN = {
  alles: { naam: 'Geen voorkeur' },
  vegetarisch: { naam: 'Vegetarisch' },
  veganistisch: { naam: 'Veganistisch' },
  pescotarisch: { naam: 'Pescotarisch (wel vis)' },
  geen_varkensvlees: { naam: 'Geen varkensvlees' },
  geen_alcohol: { naam: 'Geen alcohol' }
};

function dieetToegestaan(item, dieet) {
  const k = item.kenmerken;
  switch (dieet) {
    // dieet_onzeker: een samengesteld product zonder vegetarisch label. Daar
    // kan vlees in zitten, dus het valt buiten elk dieetfilter op vlees.
    case 'vegetarisch':
      return !k.bevat_vlees && !k.bevat_vis && !k.dieet_onzeker;
    case 'veganistisch':
      return !k.bevat_dierlijk && !k.dieet_onzeker && !k.vegan_onzeker;
    case 'pescotarisch':
      return !k.bevat_vlees && !k.dieet_onzeker;
    case 'geen_varkensvlees':
      return !k.bevat_varken && !k.dieet_onzeker;
    case 'geen_alcohol':
      return !k.is_alcohol;
    default:
      return true;
  }
}

// Kenmerkwaarden tussen 0 en 1.
function kenmerkWaarden(item, huishouden) {
  const k = item.kenmerken;
  const pct = item._korting_gewogen;

  // 50% korting geldt als een volle score. Daarboven telt het nog iets mee,
  // maar niet lineair, anders domineren losse 70%-restpartijen alles.
  let korting = 0;
  if (pct !== null) {
    korting = pct <= 50 ? pct / 50 : 1 + (pct - 50) / 200;
    korting = Math.min(korting, 1.15);
  }

  const stuksprijs = item.stuksprijs;
  let goedkoop = 0.35; // onbekende prijs krijgt een neutrale waarde
  if (stuksprijs !== null) {
    goedkoop = 1 - Math.min(stuksprijs, 9) / 9;
  }

  // Grote pakken zijn interessanter voor een gezin dan losse eenheden. Dat
  // gaat om de inhoud: 2 kilo of 3 liter telt als vol, 200 gram als weinig.
  let bulk = 0;
  if (item.inhoud && item.inhoud.soort === 'gewicht') bulk = Math.min(item.inhoud.basis / 2000, 1);
  if (item.inhoud && item.inhoud.soort === 'volume') bulk = Math.min(item.inhoud.basis / 3000, 1);
  if (item.aantal_stuks >= 2) bulk = Math.max(bulk, 0.6);

  return {
    korting,
    goedkoop,
    eiwit: k.eiwitrijk ? 1 : 0,
    vers: k.vers ? 1 : (k.is_gemak ? 0.25 : 0),
    gemak: k.is_gemak ? 1 : 0,
    plant: k.is_plantaardig ? 1 : (item.categorie === 'Groente en fruit' ? 0.85 : 0),
    borrel: k.is_alcohol || k.is_snoep ? 1 : 0,
    bulk
  };
}

function scoreVoor(item, opties) {
  const profiel = PROFIELEN[opties.profiel] || PROFIELEN.alles;
  const huishouden = opties.huishouden || 2;
  const w = profiel.gewichten;
  const f = kenmerkWaarden(item, huishouden);

  let score = 0;
  for (const [kenmerk, gewicht] of Object.entries(w)) {
    score += gewicht * (f[kenmerk] || 0);
  }
  // Profielen zonder eigen bulkgewicht krijgen bij een groot huishouden een
  // klein extraatje voor grote pakken.
  if (w.bulk === undefined && huishouden >= 3) score += 0.05 * f.bulk;

  // Straffen, multiplicatief zodat een profiel iets echt kan wegdrukken.
  const k = item.kenmerken;
  if (k.is_snoep) score *= profiel.straf.snoep;
  if (k.is_alcohol) score *= profiel.straf.alcohol;
  if (k.is_nonfood) score *= profiel.straf.nonfood;

  // Meerstuks-acties zijn minder handig als je alleen woont.
  if (huishouden === 1 && item.aantal_stuks >= 3) score *= 0.72;
  else if (huishouden === 1 && item.aantal_stuks === 2) score *= 0.9;

  // Zonder aantoonbare korting is het geen aanbieding maar een prijs.
  if (item.korting_pct === null) score *= 0.75;

  return Math.round(Math.max(0, Math.min(100, score * 100)) * 10) / 10;
}

// Korte, eerlijke onderbouwing voor de kaart in de UI.
function redenen(item) {
  const uit = [];
  if (item.korting_pct !== null) {
    uit.push(
      item.korting_hard
        ? item.korting_pct + '% korting'
        : item.korting_pct + '% goedkoper dan elders'
    );
  }
  if (item.kenmerken.eiwitrijk) uit.push('eiwitrijk');
  if (item.kenmerken.vers && !item.kenmerken.eiwitrijk) uit.push('vers');
  if (item.kenmerken.is_plantaardig) uit.push('plantaardig');
  if (item.kenmerken.is_gemak) uit.push('snel klaar');

  // Alleen bij eten waar een kiloprijs iets zegt, en met een grens die ook
  // echt gunstig is. Anders krijgt elke zak chips dit label erbij.
  const k = item.kenmerken;
  const zinvolleKiloprijs = !k.is_nonfood && !k.is_alcohol && !k.is_snoep;
  if (zinvolleKiloprijs && item.basisprijs && item.basisprijs.prijs > 0) {
    const grens = item.basisprijs.soort === 'gewicht' ? (k.eiwitrijk ? 10 : 4) : 2.5;
    if (item.basisprijs.prijs < grens) {
      uit.push(item.basisprijs.soort === 'gewicht' ? 'gunstige kiloprijs' : 'gunstige literprijs');
    }
  }
  if (item.aantal_stuks >= 2) uit.push(item.aantal_stuks + ' stuks nodig');
  return uit;
}

module.exports = {
  verrijk,
  uitLabel,
  naarDatum,
  scoreVoor,
  redenen,
  dieetToegestaan,
  parseEenheid,
  bepaalInhoud,
  PROFIELEN,
  DIEETEN
};
