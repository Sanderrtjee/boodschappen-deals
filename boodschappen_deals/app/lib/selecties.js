'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

// Selecties die door de assistent in n8n zijn samengesteld. Per profiel één
// bestand. We bewaren alleen de keuze en de onderbouwing, niet de prijzen:
// die komen bij het tonen uit de database, zodat er nooit een verouderd bedrag
// op de site staat naast een actueel bedrag.
//
// De product_id's zijn de sleutel. Staat een gekozen product niet meer in de
// actuele aanbiedingen, dan valt hij weg en zegt de site hoeveel er over zijn.

const SLEUTEL_PATROON = /^[a-z0-9][a-z0-9-]{0,39}$/;

class Selecties {
  constructor(dataDir, log) {
    this.map = path.join(dataDir, 'selecties');
    this.log = log || (() => {});
    try {
      fs.mkdirSync(this.map, { recursive: true });
    } catch (e) {
      this.log('waarschuwing', 'Kon de map voor selecties niet maken: ' + e.message);
    }
  }

  geldigeSleutel(sleutel) {
    return typeof sleutel === 'string' && SLEUTEL_PATROON.test(sleutel);
  }

  bestand(sleutel) {
    return path.join(this.map, sleutel + '.json');
  }

  async bewaar(invoer) {
    if (!this.geldigeSleutel(invoer.sleutel)) {
      throw new Error('Ongeldige sleutel. Gebruik kleine letters, cijfers en streepjes.');
    }

    const deals = [];
    for (const d of Array.isArray(invoer.deals) ? invoer.deals : []) {
      const id = Number(d.product_id);
      if (!Number.isInteger(id) || id <= 0) continue;
      if (deals.some((x) => x.product_id === id)) continue;
      deals.push({
        product_id: id,
        reden: typeof d.reden === 'string' ? d.reden.slice(0, 400) : null
      });
    }

    const inhoud = {
      sleutel: invoer.sleutel,
      naam: String(invoer.naam || invoer.sleutel).slice(0, 80),
      omschrijving: invoer.omschrijving ? String(invoer.omschrijving).slice(0, 200) : null,
      icoon: typeof invoer.icoon === 'string' ? invoer.icoon.slice(0, 20) : 'sparkles',
      gegenereerd_op: invoer.gegenereerd_op || new Date().toISOString(),
      // Met `orde` bepaal je zelf welke selectie vooraan staat, lager is eerder.
      orde: Number.isFinite(Number(invoer.orde)) ? Number(invoer.orde) : 50,
      deals,
      recepten: Array.isArray(invoer.recepten) ? invoer.recepten.slice(0, 12) : []
    };

    await fsp.writeFile(this.bestand(invoer.sleutel), JSON.stringify(inhoud, null, 2), 'utf8');
    return inhoud;
  }

  async verwijder(sleutel) {
    if (!this.geldigeSleutel(sleutel)) return false;
    try {
      await fsp.unlink(this.bestand(sleutel));
      return true;
    } catch (e) {
      return false;
    }
  }

  async alle() {
    let bestanden;
    try {
      bestanden = await fsp.readdir(this.map);
    } catch (e) {
      return [];
    }

    const uit = [];
    for (const naam of bestanden) {
      if (!naam.endsWith('.json')) continue;
      try {
        const ruw = await fsp.readFile(path.join(this.map, naam), 'utf8');
        const data = JSON.parse(ruw);
        if (this.geldigeSleutel(data.sleutel)) uit.push(data);
      } catch (e) {
        this.log('waarschuwing', 'Kon selectie ' + naam + ' niet lezen: ' + e.message);
      }
    }
    return uit.sort(
      (a, b) => (a.orde ?? 50) - (b.orde ?? 50) || a.naam.localeCompare(b.naam, 'nl')
    );
  }

  async een(sleutel) {
    if (!this.geldigeSleutel(sleutel)) return null;
    try {
      const ruw = await fsp.readFile(this.bestand(sleutel), 'utf8');
      const data = JSON.parse(ruw);
      return this.geldigeSleutel(data.sleutel) ? data : null;
    } catch (e) {
      return null;
    }
  }
}

module.exports = { Selecties };
