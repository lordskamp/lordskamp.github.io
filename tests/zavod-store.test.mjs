import assert from 'node:assert/strict';
import test from 'node:test';
import { baseline, cachedCatalog, loadCatalog, withOfflineCalibrations } from '../Zavod/store.js';
import { PUBLIC_CALIBRATIONS, CALIBRATION_SNAPSHOT } from '../Zavod/calibration-snapshot.js';
import { setupFor } from '../Zavod/setup-data.js';

const CACHE = 'zavod-shared-table-v1';
const h07 = 'h07v-k--h07v-k';
function globals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = globalThis[key];
    globalThis[key] = value;
    t.after(() => { if (previous === undefined) delete globalThis[key]; else globalThis[key] = previous; });
  }
}
function storage(initial) {
  const values = new Map(initial ? [[CACHE, JSON.stringify(initial)]] : []);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('a fresh offline installation carries real public numeric calibration and reproduces the live H07 curve', t => {
  globals(t, { localStorage: storage() });
  const catalog = cachedCatalog();
  assert.equal(catalog.source, 'snapshot');
  assert.equal(catalog.calibrations.length, 3);
  assert.equal(CALIBRATION_SNAPSHOT.retrievedOn, '2026-10-02');
  assert.equal(CALIBRATION_SNAPSHOT.source, 'https://zavod-data.lordskamp.workers.dev/catalog');
  const interior = setupFor(h07, 4, catalog, 'blue');
  const actual = setupFor(h07, 6, catalog, 'blue');
  assert.deepEqual([interior.effective.extruder1, interior.effective.extruder2, interior.effective.workingSpeed], [56, 82, 137]);
  assert.deepEqual([actual.effective.extruder1, actual.effective.extruder2, actual.effective.workingSpeed], [59, 95, 120]);
  assert.equal(actual.sources.extruder1, 'practical');
  for (const row of PUBLIC_CALIBRATIONS) for (const key of ['note', 'notes', 'uncertain', 'telegramId', 'operatorId', 'account', 'user']) assert(!Object.hasOwn(row, key), key);
  catalog.calibrations[0].extruder1 = 999;
  assert.equal(baseline().calibrations[0].extruder1, 37.5, 'callers cannot mutate bundled training data');
});

test('legacy offline cache supplements missing calibration while exact newer records and retractions win', t => {
  const original = baseline(); delete original.calibrations;
  const actual = { ...PUBLIC_CALIBRATIONS[0], extruder1: 42, updatedAt: '2026-10-03T00:00:00Z' };
  const withdrawn = { ...PUBLIC_CALIBRATIONS[1], withdrawnAt: '2026-10-03T00:00:00Z' };
  original.recipes.push(actual, withdrawn);
  globals(t, { localStorage: storage(original) });
  const cached = cachedCatalog();
  assert.equal(cached.source, 'cache');
  assert.deepEqual(cached.calibrations.map(row => row.section), [6]);
  assert.equal(setupFor(h07, 1.5, cached, 'blue').effective.extruder1, 42);
  assert.equal(setupFor(h07, 2.5, cached, 'blue').practical.extruder1, null);
});

test('full online catalog is authoritative and missing/deleted snapshot records stay absent after an offline reload', async t => {
  const original = baseline();
  const server = { cables: original.cables, recipes: original.recipes, calibrations: [], source: 'server' };
  const localStorage = storage();
  globals(t, { localStorage, fetch: async () => new Response(JSON.stringify(server), { status: 200 }) });
  const online = await loadCatalog();
  assert.equal(online.calibrationAuthority, 'server');
  assert.deepEqual(online.calibrations, []);
  assert.equal(withOfflineCalibrations(online), online);
  const offline = cachedCatalog();
  assert.equal(offline.source, 'cache');
  assert.deepEqual(offline.calibrations, []);
  assert.equal(setupFor(h07, 6, offline, 'blue').practical.extruder1, null);
});

test('older caches explicitly sourced from the server also preserve its omissions', t => {
  const original = baseline();
  const oldServer = { cables: original.cables, recipes: original.recipes, source: 'server' };
  globals(t, { localStorage: storage(oldServer) });
  assert.equal(cachedCatalog().calibrations, undefined);
});

test('new live partial fields replace snapshot records without stale bundled fields reappearing', async t => {
  const original = baseline();
  const row = { ...PUBLIC_CALIBRATIONS[2], extruder1: 63, extruder2: null, maxSpeed: 125 };
  const server = { cables: original.cables, recipes: [...original.recipes, row], source: 'server' };
  globals(t, { localStorage: storage(), fetch: async () => new Response(JSON.stringify(server), { status: 200 }) });
  const online = await loadCatalog();
  assert.equal(online.calibrations, undefined);
  assert.equal(setupFor(h07, 6, online, 'blue').practical.extruder1, 63);
  assert.equal(setupFor(h07, 6, online, 'blue').practical.extruder2, null);
  assert.equal(cachedCatalog().calibrations, undefined);
});
