'use strict';

// De dataset verandert maar een paar keer per dag, dus we houden de verrijkte
// rijen in het geheugen en scoren per verzoek.
//
// `fout` gaat naar buiten (meta en health) en is daarom altijd een generieke
// zin. De ruwe databasefout kan interne hostnamen en poorten bevatten; die
// staat alleen in het log en in `foutDetail`, dat health alleen met een
// geldig token toont.

// Na een fout willen we het snel opnieuw proberen. Een database die even weg is
// omdat hij herstart, moet niet een kwartier lang een lege site opleveren.
const HERKANSING_MS = 60000;

function maakDataset({ db, demoModus, demoRijen, verrijk, cacheMinuten, log }) {
  const cache = {
    items: null,
    geldigTot: 0,
    demo: false,
    fout: null,
    foutDetail: null,
    runs: [],
    bezig: null
  };

  async function laad() {
    let rijen = null;
    let fout = null;
    let foutDetail = null;

    if (!demoModus()) {
      try {
        rijen = await db.aanbiedingen();
        cache.runs = await db.runs();
        if (rijen.length === 0) {
          fout = 'De database is bereikbaar maar bevat geen actuele aanbiedingen. Heeft de n8n-flow al gelopen?';
        }
      } catch (e) {
        fout = 'De database is op dit moment niet bereikbaar.';
        foutDetail = e.message;
        log('fout', 'De database is niet bereikbaar: ' + e.message);
        rijen = [];
      }
    } else {
      rijen = demoRijen();
    }

    // Eén kapotte rij mag niet de hele dataset blokkeren.
    const items = [];
    let overgeslagen = 0;
    for (const rij of rijen) {
      try {
        const item = verrijk(rij);
        if (item.naam) items.push(item);
      } catch (e) {
        overgeslagen += 1;
        if (overgeslagen <= 3) log('waarschuwing', 'Rij overgeslagen bij verrijken: ' + e.message);
      }
    }

    cache.demo = demoModus();
    cache.items = items;
    cache.fout = fout;
    cache.foutDetail = foutDetail;
    cache.geldigTot = Date.now() + (fout ? HERKANSING_MS : cacheMinuten * 60000);
    log(
      fout ? 'waarschuwing' : 'info',
      'Dataset geladen: ' + items.length + ' aanbiedingen' + (cache.demo ? ' (demodata)' : '') +
        (overgeslagen ? ', ' + overgeslagen + ' rijen overgeslagen' : '')
    );
    return cache;
  }

  async function haal(forceer) {
    if (!forceer && cache.items && Date.now() < cache.geldigTot) return cache;
    if (cache.bezig) return cache.bezig;

    // finally: ook als laden faalt, mag de volgende aanvraag het opnieuw
    // proberen. Zonder dat bleef `bezig` voorgoed op een mislukte belofte staan.
    cache.bezig = (async () => {
      try {
        return await laad();
      } finally {
        cache.bezig = null;
      }
    })();
    return cache.bezig;
  }

  return { haal, cache };
}

module.exports = { maakDataset, HERKANSING_MS };
