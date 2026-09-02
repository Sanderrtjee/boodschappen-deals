'use strict';

// Voorbeelddata zodat de site ook werkt zonder databaseverbinding.
// Handig om het uiterlijk te bekijken en om te zien of de container draait.
// De site zet dan zelf een waarschuwingsbalk boven de pagina.

const vandaag = () => new Date().toISOString().slice(0, 10);
const overDagen = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// De kolommen betekenen per deal_type iets anders, precies zoals de n8n-parsers
// ze vullen. Bij 'bundel' gaan prijs_nu en prijs_was over de hele bundel; bij
// 'gratis_erbij' en 'tweede_half' is prijs_per_stuk gelijk aan de schapprijs en
// zit de korting in de kortingsfactor.
const rijen = [
  ['AH', 'Verse zalmfilet naturel', 'Vis', '250 g', 'bundel', 6.99, 9.99, null, 3.495, '2 voor 6.99'],
  ['AH', 'AH Kipfilet naturel', 'Vlees', '600 g', 'procent', 5.24, 6.99, 0.25, 5.24, '25% korting'],
  ['AH', 'AH Magere kwark', 'Zuivel', '500 g', 'gratis_erbij', 1.19, null, 0.5, 1.19, '1+1 gratis'],
  ['AH', 'AH Biologische scharreleieren', 'Zuivel', '10 stuks', 'tweede_half', 3.49, null, 0.25, 3.49, '2e halve prijs'],
  ['AH', 'Hollandse spitskool', 'Groente', 'per stuk', 'vaste_prijs', 0.99, 1.49, null, 0.99, 'voor 0.99'],
  ['AH', 'AH Rundergehakt', 'Vlees', '500 g', 'procent', 4.49, 6.49, 0.3, 4.49, '30% korting'],
  ['AH', 'Zoete aardappelen', 'Groente', '1 kg', 'vaste_prijs', 1.79, 2.49, null, 1.79, 'voor 1.79'],
  ['AH', 'AH Verspakket Thaise curry', 'Maaltijden', '380 g', 'gratis_erbij', 3.29, null, 0.5, 3.29, '1+1 gratis'],
  ['AH', 'Griekse yoghurt 10% vet', 'Zuivel', '1 kg', 'procent', 2.79, 3.99, 0.3, 2.79, '30% korting'],
  ['AH', 'AH Kipgehakt', 'Vlees', '400 g', 'bundel', 7.0, null, null, 3.5, '2 voor 7.00'],
  ['AH', 'Lay’s Oven Baked paprika', 'Borrel, chips, snacks', '150 g', 'gratis_erbij', 2.19, null, 0.5, 2.19, '1+1 gratis'],
  ['AH', 'Heineken pilsener', 'Bier, wijn, aperitieven', '6 x 33 cl', 'procent', 4.99, 6.99, 0.29, 4.99, '29% korting'],
  ['AH', 'Andrélon shampoo', 'Drogisterij', '300 ml', 'gratis_erbij', 4.49, null, 0.5, 4.49, '1+1 gratis'],
  ['AH', 'AH Roomboter croissants', 'Brood', '4 stuks', 'vaste_prijs', 1.99, 2.79, null, 1.99, 'voor 1.99'],

  // Vormen die letterlijk zo in de database staan. AH laat `eenheid` vaak leeg
  // en zet de maat in de naam, en zet "2e gratis" en "€1 korting" weg als
  // deal_type 'overig' zonder kortingsfactor.
  ['AH', 'AH Sweet Palermo rode puntpaprika zak 500 gram', 'Groente, aardappelen', '', 'procent', 2.23, 3.19, 0.3, 2.23, '30% korting'],
  ['AH', 'AH Bloemkool', 'Groente, aardappelen', '', 'vaste_prijs', 1.49, 1.89, null, 1.49, 'voor 1.49'],
  ['AH', 'AH Kipfilet gemarineerd 500 gram', 'Vlees, kip, vis, vega', '', 'overig', 3.85, 3.85, null, 3.85, '2e gratis'],
  ['AH', 'AH Verse pasta tagliatelle 250 gram', 'Pasta, rijst', '', 'overig', null, null, null, null, '2e gratis'],
  ['AH', 'AH Biologische halfvolle melk 1 liter', 'Zuivel', '', 'overig', 1.79, null, null, 1.79, '€1 korting'],
  ['Jumbo', 'Rucola, veldsla of melanges', null, null, 'bundel', null, null, null, 1.0, '2 voor 2,00'],
  ['Lidl', 'Pinot Grigio Rosé', 'Food', '0,75 l', 'lidl_plus', 2.99, 3.99, null, 2.99, '-25%'],

  ['Jumbo', 'Jumbo Kipfilethaasjes', null, null, 'bundel', null, null, null, 4.0, '2 voor 8.00'],
  ['Jumbo', 'Jumbo Verse hele zalm', null, null, 'procent', null, null, 0.35, null, '35% korting'],
  ['Jumbo', 'Jumbo Skyr aardbei', null, null, 'gratis_erbij', null, null, 0.5, null, '1+1 gratis'],
  ['Jumbo', 'Hollandse tomaten op tak', null, null, 'vaste_prijs', null, null, null, 1.49, 'voor 1.49'],
  ['Jumbo', 'Jumbo Beenham', null, null, 'procent', null, null, 0.4, null, '40% korting'],
  ['Jumbo', 'Alpro sojadrink ongezoet', null, null, 'bundel', null, null, null, 1.25, '3 voor 3.75'],
  ['Jumbo', 'Jumbo Pizza margherita', null, null, 'gratis_erbij', null, null, 0.5, null, '1+1 gratis'],
  ['Jumbo', 'Grolsch premium pilsner', null, null, 'bundel', null, null, null, 0.79, '4 voor 3.16'],
  ['Jumbo', 'Jumbo Kruimige aardappelen', null, null, 'vaste_prijs', null, null, null, 2.29, 'voor 2.29'],
  ['Jumbo', 'Jumbo Hummus naturel', null, null, 'tweede_half', null, null, 0.25, null, '2e halve prijs'],

  ['Lidl', 'Verse kipfilet', 'Food', '1 kg', 'procent', 6.49, 8.99, 0.28, 6.49, '28% korting'],
  ['Lidl', 'Ierse rib-eye', 'Food', '300 g', 'elders', 5.99, 8.49, null, 5.99, 'Elders €8.49'],
  ['Lidl', 'Griekse feta', 'Food', '200 g', 'vaste_prijs', 1.79, null, null, 1.79, null],
  ['Lidl', 'Milbona magere kwark', 'Food', '500 g', 'lidl_plus', 0.99, 1.39, 0.29, 0.99, 'Lidl Plus prijs'],
  ['Lidl', 'Verse blauwe bessen', 'Food', '250 g', 'procent', 1.99, 2.99, 0.33, 1.99, '33% korting'],
  ['Lidl', 'Noorse zalmfilet', 'Food', '2 x 125 g', 'procent', 4.49, 6.29, 0.29, 4.49, '29% korting'],
  ['Lidl', 'Broccoli', 'Food', '500 g', 'vaste_prijs', 0.89, null, null, 0.89, null],
  ['Lidl', 'Amandelen ongezouten', 'Food', '200 g', 'elders', 2.29, 3.49, null, 2.29, 'Elders €3.49'],
  ['Lidl', 'Verse tagliatelle', 'Food', '250 g', 'vaste_prijs', 1.35, null, null, 1.35, null],
  ['Lidl', 'Kikkererwten in pot', 'Food', '400 g', 'vaste_prijs', 0.75, null, null, 0.75, null],
  ['Lidl', 'Volkoren desembrood', 'Food', '500 g', 'procent', 1.29, 1.79, 0.28, 1.29, '28% korting'],
  ['Lidl', 'Chocolade hazelnootpasta', 'Food', '400 g', 'elders', 1.99, 3.29, null, 1.99, 'Elders €3.29']
];

function demoRijen() {
  return rijen.map((r, i) => {
    const [winkel, naam, categorie, eenheid, deal_type, prijs_nu, prijs_was, kortingsfactor, prijs_per_stuk, label] = r;
    return {
      product_id: 900000 + i,
      winkel,
      externe_id: 'demo-' + i,
      naam,
      categorie,
      eenheid,
      afbeelding: null,
      scrape_datum: vandaag(),
      geldig_van: vandaag(),
      geldig_tot: overDagen(5),
      geldigheid_tekst: 'Geldig t/m zondag',
      label_tekst: label,
      deal_type,
      prijs_per_stuk,
      prijs_nu,
      prijs_was,
      kortingsfactor,
      alleen_in_winkel: i % 9 === 0,
      uitzondering: null,
      link: null
    };
  });
}

module.exports = { demoRijen };
