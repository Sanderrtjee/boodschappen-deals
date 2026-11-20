'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { maakDataset } = require('../boodschappen_deals/app/lib/dataset');

test('een throw tijdens het laden blokkeert de cache niet', async () => {
  let keer = 0;
  const ds = maakDataset({
    db: {},
    demoModus: () => true,
    demoRijen: () => {
      keer += 1;
      if (keer === 1) throw new Error('kapot');
      return [{ naam: 'A' }];
    },
    verrijk: (r) => r,
    cacheMinuten: 15,
    log: () => {}
  });
  await assert.rejects(ds.haal(true), /kapot/);
  assert.equal(ds.cache.bezig, null);
  const tweede = await ds.haal(true);
  assert.equal(tweede.items.length, 1);
});

test('één kapotte rij slaat alleen die rij over', async () => {
  const ds = maakDataset({
    db: {},
    demoModus: () => true,
    demoRijen: () => [{ naam: 'A' }, { naam: 'kapot' }, { naam: 'B' }],
    verrijk: (r) => {
      if (r.naam === 'kapot') throw new Error('x');
      return r;
    },
    cacheMinuten: 15,
    log: () => {}
  });
  const c = await ds.haal(true);
  assert.deepEqual(c.items.map((i) => i.naam), ['A', 'B']);
});
