'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Eerst naar een tijdelijk bestand in dezelfde map schrijven en daarna
// hernoemen. Een rename binnen één bestandssysteem is atomisch: een lezer ziet
// het oude of het nieuwe bestand, nooit een half geschreven bestand. Valt de
// add-on midden in het schrijven om, dan blijft het oude bestand heel.
async function schrijfAtomisch(doel, inhoud) {
  const tijdelijk = path.join(
    path.dirname(doel),
    '.' + path.basename(doel) + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp'
  );
  try {
    await fsp.writeFile(tijdelijk, inhoud, 'utf8');
    await fsp.rename(tijdelijk, doel);
  } catch (e) {
    await fsp.rm(tijdelijk, { force: true }).catch(() => {});
    throw e;
  }
}

module.exports = { schrijfAtomisch };
