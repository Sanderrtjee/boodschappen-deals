'use strict';

// Alle aanbiedingen van de meest recente scrape, per winkel.
// Per winkel afzonderlijk de laatste datum pakken, zodat een winkel die
// vandaag faalde niet de hele site leegtrekt: dan zie je gewoon de vorige run.
const QUERY_AANBIEDINGEN = `
WITH laatste AS (
  SELECT p.winkel, MAX(o.scrape_datum) AS datum
  FROM offers o
  JOIN products p ON p.product_id = o.product_id
  GROUP BY p.winkel
)
SELECT p.product_id,
       p.winkel,
       p.externe_id,
       p.naam,
       p.categorie,
       p.eenheid,
       p.afbeelding,
       o.scrape_datum,
       o.geldig_van,
       o.geldig_tot,
       o.geldigheid_tekst,
       o.label_tekst,
       o.deal_type,
       o.prijs_per_stuk,
       o.prijs_nu,
       o.prijs_was,
       o.kortingsfactor,
       o.alleen_in_winkel,
       o.uitzondering,
       o.link
FROM offers o
JOIN products p ON p.product_id = o.product_id
JOIN laatste l ON l.winkel = p.winkel AND l.datum = o.scrape_datum
WHERE (o.geldig_tot IS NULL OR o.geldig_tot >= CURRENT_DATE - INTERVAL '1 day')
  AND p.naam IS NOT NULL
`;

const QUERY_RUNS = `
SELECT p.winkel, o.scrape_datum, COUNT(*)::int AS aantal
FROM offers o
JOIN products p ON p.product_id = o.product_id
WHERE o.scrape_datum >= CURRENT_DATE - INTERVAL '21 days'
GROUP BY p.winkel, o.scrape_datum
ORDER BY o.scrape_datum DESC, p.winkel
`;

class Database {
  constructor(config, log) {
    this.config = config;
    this.log = log || (() => {});
    this.pool = null;
    this.beschikbaar = Boolean(config.host);
  }

  async pak() {
    if (!this.beschikbaar) return null;
    if (this.pool) return this.pool;

    let pg;
    try {
      pg = require('pg');
    } catch (e) {
      this.log('waarschuwing', 'De pg-module ontbreekt, database wordt overgeslagen.');
      this.beschikbaar = false;
      return null;
    }

    this.pool = new pg.Pool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      application_name: 'boodschappen-deals'
    });

    this.pool.on('error', (err) => {
      this.log('fout', 'Onverwachte databasefout: ' + err.message);
    });

    return this.pool;
  }

  async aanbiedingen() {
    const pool = await this.pak();
    if (!pool) return null;
    const res = await pool.query(QUERY_AANBIEDINGEN);
    return res.rows;
  }

  async runs() {
    const pool = await this.pak();
    if (!pool) return [];
    try {
      const res = await pool.query(QUERY_RUNS);
      return res.rows;
    } catch (e) {
      this.log('waarschuwing', 'Kon scrapehistorie niet ophalen: ' + e.message);
      return [];
    }
  }

  async sluit() {
    if (this.pool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }
}

module.exports = { Database };
