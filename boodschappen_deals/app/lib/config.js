'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// De add-on leest zijn instellingen uit /data/options.json. Dat is hetzelfde
// bestand dat bashio uitleest, dus we hebben geen shellwrapper en geen
// Home Assistant basisimage nodig; het image kan daardoor gewoon op een
// officieel Node-image staan.
//
// Draai je de container los met docker compose, dan bestaat dat bestand niet
// en komt alles uit omgevingsvariabelen.

const OPTIES_PAD = process.env.OPTIONS_PATH || '/data/options.json';

function leesOpties(pad) {
  try {
    const ruw = fs.readFileSync(pad, 'utf8');
    const data = JSON.parse(ruw);
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    return null;
  }
}

function alsGetal(waarde, standaard) {
  const n = parseInt(waarde, 10);
  return Number.isFinite(n) ? n : standaard;
}

function alsBoolean(waarde) {
  return waarde === true || waarde === 'true' || waarde === '1';
}

function bouwConfig() {
  const opties = leesOpties(OPTIES_PAD) || {};
  const bron = Object.keys(opties).length ? 'add-on-configuratie' : 'omgevingsvariabelen';

  // Een lege string in de add-on-configuratie betekent "niet ingevuld".
  const optie = (naam) => {
    const w = opties[naam];
    if (w === undefined || w === null) return undefined;
    if (typeof w === 'string' && w.trim() === '') return undefined;
    return w;
  };

  return {
    bron,
    poort: alsGetal(process.env.PORT, 8499),
    siteTitel: optie('site_titel') || process.env.SITE_TITEL || 'Boodschappen Deals',
    cacheMinuten: Math.max(
      1,
      alsGetal(optie('cache_minuten') ?? process.env.CACHE_MINUTEN, 15)
    ),
    // Trimmen, want een onzichtbare spatie of regeleinde achter het token in de
    // add-on-configuratie geeft een 401 die niet te zien is.
    importToken: String(optie('import_token') || process.env.IMPORT_TOKEN || '').trim(),
    demoAf: process.env.DEMO_MODE === '1',
    // In de add-on is /data de vaste opslagmap. Draai je hem lokaal op Windows
    // of macOS, dan willen we geen map in de root van de schijf aanmaken.
    dataDir:
      process.env.DATA_DIR ||
      (process.platform === 'linux' ? '/data' : path.join(os.tmpdir(), 'boodschappen-deals')),
    db: {
      host: String(optie('db_host') || process.env.DB_HOST || ''),
      port: alsGetal(optie('db_port') ?? process.env.DB_PORT, 5432),
      database: String(optie('db_name') || process.env.DB_NAME || 'boodschappen'),
      user: String(optie('db_user') || process.env.DB_USER || 'boodschappen'),
      password: String(optie('db_password') || process.env.DB_PASSWORD || ''),
      ssl: opties.db_ssl !== undefined ? alsBoolean(opties.db_ssl) : alsBoolean(process.env.DB_SSL)
    }
  };
}

module.exports = { bouwConfig, OPTIES_PAD };
