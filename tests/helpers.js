'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const SERVER = path.join(__dirname, '..', 'boodschappen_deals', 'app', 'server.js');

function vrijePoort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

// Start de server uit deze checkout met een eigen datamap en poort.
async function startServer(env = {}) {
  const poort = await vrijePoort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-test-'));
  const kind = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH,
      PORT: String(poort),
      DATA_DIR: dataDir,
      OPTIONS_PATH: path.join(dataDir, 'bestaat-niet.json'),
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  kind.stdout.on('data', (d) => (log += d));
  kind.stderr.on('data', (d) => (log += d));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server start niet: ' + log)), 8000);
    const kijk = () => {
      if (log.includes('Dataset geladen')) {
        clearTimeout(t);
        resolve();
      } else setTimeout(kijk, 25);
    };
    kijk();
  });
  const basis = 'http://127.0.0.1:' + poort;
  return {
    basis,
    dataDir,
    log: () => log,
    vraag: (pad, opties = {}) => fetch(basis + pad, opties),
    stop: () => {
      kind.kill('SIGTERM');
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

module.exports = { startServer };
