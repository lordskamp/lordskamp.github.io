import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import worker, { verifyTelegram } from '../api/zavod-worker.js';
import { baseline, findRecipe, csv } from '../Zavod/store.js';
import { CATALOG_OPTIONS, baseFor, measurementColor, recipeIdFor } from '../Zavod/catalog-base.js';
import { setupFor } from '../Zavod/setup-data.js';
import { refreshPendingMeasurements } from '../Zavod/measurement-input.js';

const TOKEN = 'test-bot-secret-only';
const owner = { id: 100, username: 'Lordskamp' };
const now = Math.floor(Date.now() / 1000);
function signed(user = owner, authDate = now) {
  const data = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user), query_id: 'test-query' });
  const check = [...data].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  data.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return data.toString();
}
function fixture({ beforeManagement, beforeModes } = {}) {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('../migrations/zavod/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    if (name === '0003_measurement_management.sql') beforeManagement?.(db);
    if (name === '0004_mode_calibrations.sql') beforeModes?.(db);
    db.exec(readFileSync(new URL('../migrations/zavod/' + name, import.meta.url), 'utf8'));
  }
  const DB = { prepare(sql) {
    const statement = db.prepare(sql); let values = [];
    return { bind(...args) { values = args; return this; }, async first() { return statement.get(...values) ?? null; }, async all() { return { results: statement.all(...values) }; }, execute() { const results = statement.all(...values); const changes = db.prepare('SELECT changes() AS changes').get().changes; return { results, meta: { changes } }; }, async run() { return this.execute(); } };
  }, async batch(statements) {
    db.exec('BEGIN');
    try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
  const env = { DB, TELEGRAM_BOT_TOKEN: TOKEN, OWNER_USERNAME: 'Lordskamp', ALLOWED_ORIGINS: 'https://lordskamp.github.io' };
  async function call(path, { method = 'GET', body, initData, origin = 'https://lordskamp.github.io' } = {}) {
    const headers = { Origin: origin };
    if (initData) headers['X-Telegram-Init-Data'] = initData;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await worker.fetch(new Request('https://test.invalid' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: response.status, headers: response.headers, data: response.status === 204 ? null : await response.json() };
  }
  return { db, env, call };
}
const measurement = (overrides = {}) => ({ id: randomUUID(), baseId: 'vvgng-p-1-5', color: 'blue', mode: 'dual', note: 'Перевірено', extruder1: 142, extruder2: 196, dorn: 1.4, matrix: 2.45, sikoraWire: 1.37, sikoraOuter: 2.6, maxSpeed: 800, ...overrides });
const authenticated = (body, method = 'POST') => ({ body, method, initData: signed() });
const measurementRecipeId = row => recipeIdFor(row.baseId, row.color, row.optionId, row.mode);

test('Telegram: authentic signature only; no forged, expired, future, duplicate, or bot data', async () => {
  assert.deepEqual(await verifyTelegram(signed(), TOKEN, now), owner);
  for (const data of [signed().replace('Lordskamp', 'intruder'), signed(owner, now - 43201), signed(owner, now + 61), signed() + '&auth_date=' + now, signed({ ...owner, is_bot: true }), signed({ id: -1, username: 'Lordskamp' }), '']) assert.equal(await verifyTelegram(data, TOKEN, now), null);
  assert.equal(await verifyTelegram(signed(), 'wrong-token', now), null);
});
test('Owner is pinned once by signed Telegram identity, never by frontend username', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  assert.equal((await call('/admin/auth', { method: 'POST' })).status, 401);
  assert.equal((await call('/admin/auth', { method: 'POST', initData: signed({ id: 200, username: 'Someone' }) })).status, 403);
  assert.equal((await call('/admin/auth', authenticated())).status, 200);
  assert.equal((await call('/admin/auth', { method: 'POST', initData: signed({ id: 200, username: 'Lordskamp' }) })).status, 403);
  assert.equal((await call('/admin/auth', { method: 'POST', initData: signed({ id: 100, username: 'Renamed' }) })).status, 200);
  assert.equal(db.prepare("SELECT value FROM settings WHERE name='owner_id'").get().value, '100');
});
test('Public catalogue includes 37 original rows and retains unknown numbers as null', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const response = await call('/catalog'); assert.equal(response.status, 200); assert.equal(response.data.recipes.length, 37);
  assert.equal(findRecipe(response.data, 'vvgng-p', 1.5, 'blue').maxSpeed, 800);
  assert.equal(findRecipe(response.data, 'pv3', 0.75, 'blue').extruder1, null);
  assert.equal(findRecipe(response.data, 'pv1', 1.5, 'blue').sikoraOuter, 2.85);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://lordskamp.github.io');
});
test('Writes require authentication and permitted origin; every saved numerical measurement is public practical data', async t => {
  const { call, db } = fixture(); t.after(() => db.close()); const draft = measurement();
  assert.equal((await call('/admin/measurements', { method: 'POST', body: draft })).status, 401);
  assert.equal((await call('/admin/measurements', { ...authenticated(draft), origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await call('/admin/measurements', authenticated(draft))).status, 200);
  const catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.calibrations.length, 1); assert.equal(catalogue.calibrations[0].extruder1, 142);
  assert.equal(catalogue.calibrations[0].note, undefined); assert.equal(catalogue.calibrations[0].createdBy, undefined);
  assert.equal(setupFor('vvgng-p', 1.5, catalogue, 'blue').effective.extruder1, 142);
  const journal = await call('/admin/measurements', { initData: signed() });
  assert.equal(journal.data.measurements.length, 1); assert.equal(journal.data.measurements[0].extruder1, 142);
});
test('Save retries are idempotent but cannot mutate an existing measurement', async t => {
  const { call, db } = fixture(); t.after(() => db.close()); const draft = measurement();
  const first = await call('/admin/measurements', authenticated(draft));
  const retry = await call('/admin/measurements', authenticated(draft));
  assert.deepEqual(first, retry);
  assert.equal((await call('/admin/measurements', authenticated({ ...draft, extruder1: 160 }))).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM measurements').get().n, 1);
});
test('Apply shared dual mode, optimistic conflicts, legacy history link, seed replay and cross-session persistence', async t => {
  const { call, db, env } = fixture(); t.after(() => db.close()); const draft = measurement();
  await call('/admin/measurements', authenticated(draft));
  const path = '/admin/recipes/' + draft.baseId + '~blue';
  const publish = authenticated({ measurementId: draft.id, expectedRevision: 0 }, 'PUT');
  assert.equal((await call(path, publish)).data.recipe.revision, 1);
  assert.equal((await call(path, publish)).data.recipe.revision, 1);
  const data = (await call('/catalog')).data;
  assert.equal(data.recipes.find(row => row.id === measurementRecipeId(draft)).extruder1, 142);
  for (const color of ['blue', 'brown', 'black', 'yellow-green']) assert.equal(setupFor('vvgng-p', 1.5, data, color).effective.extruder1, 142);
  const second = measurement({ extruder1: 144 }); await call('/admin/measurements', authenticated(second));
  assert.equal((await call(path, authenticated({ measurementId: second.id, expectedRevision: 0 }, 'PUT'))).status, 409);
  assert.equal((await call(path, authenticated({ measurementId: second.id, expectedRevision: 1 }, 'PUT'))).data.recipe.revision, 2);
  const history = await call('/admin/history/' + draft.baseId + '~blue', { initData: signed() });
  assert.equal(history.data.history[0].extruder1, 142);
  db.exec(readFileSync(new URL('../migrations/zavod/0002_seed.sql', import.meta.url), 'utf8'));
  const fresh = await worker.fetch(new Request('https://test.invalid/catalog'), { ...env });
  assert.equal((await fresh.json()).recipes.find(row => row.id === measurementRecipeId(draft)).extruder1, 144);
});
test('retry of an old failed snapshot revalidates omitted fields before a fresh explicit save', async t => {
  const option = CATALOG_OPTIONS.find(row => row.brand === 'H07V-K');
  const base = baseFor(option.id, 4);
  const entered = measurement({ baseId: base.id, optionId: option.id, section: 4, color: 'all', mode: 'dual', extruder1: 56, extruder2: 82, colorLead1: 300, colorLead2: 2000 });
  const legacy = { ...entered }; delete legacy.colorLead1;
  const { call, db } = fixture({ beforeManagement(legacyDb) {
    legacyDb.prepare('INSERT INTO measurements(id, base_id, color, data, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(legacy.id, legacy.baseId, legacy.color, JSON.stringify(legacy), '2026-10-01T10:00:00.000Z', '100');
  } }); t.after(() => db.close());
  const pending = { entries: [{ mode: 'dual', id: legacy.id, expectedRevision: 0, recorded: true, published: false }] };
  const retry = await call('/admin/measurements', authenticated({ ...entered, id: pending.entries[0].id }));
  assert.equal(retry.status, 409);
  assert.match(retry.data.error, /цим номером уже існує/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM measurements').get().n, 1);
  assert.equal(JSON.parse(db.prepare('SELECT data FROM measurements WHERE id = ?').get(legacy.id).data).colorLead1, undefined);
  pending.entries[0].conflict = true;
  assert.equal(refreshPendingMeasurements(pending, { revisionFor: () => 0, createId: randomUUID }), 1);
  const renewed = pending.entries[0]; assert.notEqual(renewed.id, legacy.id);
  assert.equal(renewed.recorded, false);
  assert.equal((await call('/admin/measurements', authenticated({ ...entered, id: renewed.id }))).status, 200);
  const publish = authenticated({ measurementId: renewed.id, expectedRevision: renewed.expectedRevision }, 'PUT');
  const result = await call('/admin/recipes/' + encodeURIComponent(measurementRecipeId(entered)), publish);
  assert.equal(result.status, 200);
  assert.deepEqual([result.data.recipe.extruder1, result.data.recipe.extruder2, result.data.recipe.colorLead1, result.data.recipe.colorLead2], [56, 82, 300, 2000]);
  assert.equal((await call('/admin/measurements', authenticated({ ...entered, id: renewed.id }))).status, 200);
  assert.equal((await call('/admin/recipes/' + encodeURIComponent(measurementRecipeId(entered)), publish)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM measurements').get().n, 2);
});

test('Partial measurements keep absent values null; unknown mode cannot be applied', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const draft = measurement({ mode: 'unknown', extruder1: null });
  const stored = await call('/admin/measurements', authenticated(draft)); assert.equal(stored.data.measurement.extruder1, null);
  assert.equal((await call('/admin/recipes/' + draft.baseId + '~blue', authenticated({ measurementId: draft.id, expectedRevision: 0 }, 'PUT'))).status, 400);
  for (const overrides of [{ matrix: -1 }, { extruder1: '140' }, { sikoraWire: 1500 }, { color: 'missing' }, { baseId: 'missing' }, { note: 'a'.repeat(2001) }]) assert.equal((await call('/admin/measurements', authenticated(measurement(overrides)))).status, 400);
  const single = await call('/admin/measurements', authenticated(measurement({ mode: 'single', extruder2: 160 })));
  assert.equal(single.data.measurement.extruder2, null);
});

test('a cable present only in the printed catalogue can receive its first owner measurement', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const option = CATALOG_OPTIONS.find(row => row.brand === 'ПВ5');
  const base = baseFor(option.id, .5);
  const draft = measurement({ baseId: base.id, optionId: option.id, color: 'all', mode: 'single', extruder1: 60, extruder2: null, maxSpeed: 300 });
  const saved = await call('/admin/measurements', authenticated(draft));
  assert.equal(saved.status, 200);
  assert.equal(saved.data.measurement.optionId, option.id);
  const result = await call('/admin/recipes/' + base.id, authenticated({ measurementId: draft.id, expectedRevision: 0 }, 'PUT'));
  assert.equal(result.status, 200);
  assert.equal(result.data.recipe.cableId, option.id);
  assert.equal(result.data.recipe.origin, 'measurement');
  assert.equal(result.data.recipe.source, 'IMG_3850.JPG');
  const catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.recipes.find(row => row.id === measurementRecipeId(draft)).extruder1, 60);
  assert(catalogue.cables.some(row => row.id === option.id));
  assert.equal((await call('/admin/measurements', authenticated(measurement({ baseId: option.id + '-invalid' })))).status, 400);
  assert.equal((await call('/admin/measurements', authenticated(measurement({ optionId: option.id })))).status, 400);
});
test('PV3 single and yellow-green measurements persist independently and retain unused original anchors', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const option = CATALOG_OPTIONS.find(row => row.practicalCableId === 'pv3'), base = baseFor(option.id, .75);
  const single = measurement({baseId:base.id,optionId:option.id,color:measurementColor(option.id,'single'),mode:'single',extruder1:70,extruder2:null,maxSpeed:340});
  assert.equal((await call('/admin/measurements',authenticated(single))).status,200);
  assert.equal((await call('/admin/recipes/'+base.id,authenticated({measurementId:single.id,expectedRevision:1},'PUT'))).status,200);
  let catalog = (await call('/catalog')).data;
  const originalDual = setupFor(option.id,.75,catalog,'yellow-green');
  assert.deepEqual([originalDual.effective.extruder1,originalDual.effective.extruder2,originalDual.effective.workingSpeed],[65,85,350]);
  const dual = measurement({baseId:base.id,optionId:option.id,color:measurementColor(option.id,'dual'),mode:'dual',extruder1:66,extruder2:86,maxSpeed:345});
  assert.equal((await call('/admin/measurements',authenticated(dual))).status,200);
  assert.equal((await call('/admin/recipes/'+measurementRecipeId(dual),authenticated({measurementId:dual.id,expectedRevision:0},'PUT'))).status,200);
  catalog = (await call('/catalog')).data;
  for (const color of ['brown','white','black']) {
    const result = setupFor(option.id,.75,catalog,color);
    assert.deepEqual([result.effective.extruder1,result.effective.extruder2,result.effective.workingSpeed],[70,null,340]);
  }
  const striped = setupFor(option.id,.75,catalog,'yellow-green');
  assert.deepEqual([striped.effective.extruder1,striped.effective.extruder2,striped.effective.workingSpeed],[66,86,345]);
  assert.deepEqual(setupFor(option.id,.75,catalog,'blue').effective, striped.effective);
  assert.equal(catalog.recipes.find(row => row.id === measurementRecipeId(single)).extruder1,70);
  assert.equal(catalog.recipes.find(row => row.id === measurementRecipeId(dual)).extruder1,66);
  assert.equal(catalog.recipes.find(row => row.id === base.id).origin,'handwritten');
  assert.equal((await call('/admin/measurements',{initData:signed()})).data.measurements.length,2);
});

test('H and ПВ colour validation follows the same modes as the public setup', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  for (const optionId of ['h07v-k--h07v-k', 'pv3--pv3', 'pv5--pv5', 'pvs-380--pvs']) {
    const option = CATALOG_OPTIONS.find(row => row.id === optionId), base = baseFor(optionId, option.sections[0]);
    const draft = { baseId: base.id, optionId, mode: 'single', extruder1: 75, extruder2: null };
    for (const color of ['blue', 'yellow-green']) assert.equal((await call('/admin/measurements', authenticated(measurement({ ...draft, color })))).status, 400);
    for (const color of ['black', 'brown', 'red']) assert.equal((await call('/admin/measurements', authenticated(measurement({ ...draft, color })))).status, 200);
    for (const color of ['all', 'blue', 'yellow-green']) assert.equal((await call('/admin/measurements', authenticated(measurement({ ...draft, color, mode: 'dual', extruder1: 53.7, extruder2: 72.2 })))).status, 200);
  }
});

test('Journal pagination never skips records with identical timestamps', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const insert = db.prepare('INSERT INTO measurements(id, base_id, color, data, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 102; i++) { const row = measurement(); insert.run(row.id, row.baseId, row.color, JSON.stringify(row), '2026-09-29T00:00:00.000Z', '100'); }
  const first = await call('/admin/measurements', { initData: signed() });
  const next = await call('/admin/measurements?before=' + encodeURIComponent(first.data.next), { initData: signed() });
  assert.equal(first.data.measurements.length, 100); assert.equal(next.data.measurements.length, 2);
  assert.equal(new Set([...first.data.measurements, ...next.data.measurements].map(row => row.id)).size, 102);
});
test('Both extruders keep independent colour leads, including zero, and single mode clears unused extruder fields', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const draft = measurement({ colorLead1: 0, colorLead2: 1250 });
  assert.equal((await call('/admin/measurements', authenticated(draft))).status, 200);
  const applied = await call('/admin/recipes/' + recipeIdFor(draft.baseId, draft.color), authenticated({ measurementId: draft.id, expectedRevision: 0 }, 'PUT'));
  assert.equal(applied.data.recipe.colorLead1, 0);
  assert.equal(applied.data.recipe.colorLead2, 1250);
  for (const overrides of [{ colorLead1: -1 }, { colorLead2: -1 }, { colorLead1: 10.5 }, { colorLead2: 12.5 }, { extruder1: 0 }, { color: 'black', mode: 'single' }, { color: 'yellow-green', mode: 'single' }]) {
    assert.equal((await call('/admin/measurements', authenticated(measurement(overrides)))).status, 400);
  }
  const single = await call('/admin/measurements', authenticated(measurement({ mode: 'single', colorLead1: 300, colorLead2: 2000 })));
  assert.equal(single.data.measurement.colorLead1, 300);
  assert.equal(single.data.measurement.colorLead2, null);
  assert.equal(single.data.measurement.extruder2, null);
});

test('Measurement deletion is authenticated, reversible and idempotent; deleted drafts cannot be applied or silently restored', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const draft = measurement(); await call('/admin/measurements', authenticated(draft));
  const path = '/admin/measurements/' + draft.id;
  assert.equal((await call(path, { method: 'DELETE' })).status, 401);
  assert.equal((await call(path, { method: 'DELETE', initData: signed({ id: 200, username: 'Someone' }) })).status, 403);
  assert.equal((await call(path, { method: 'DELETE', initData: signed(), origin: 'https://evil.invalid' })).status, 403);
  const deleted = await call(path, { method: 'DELETE', initData: signed() });
  assert.equal(deleted.status, 200); assert.equal(deleted.data.catalogChanged, true);
  assert.equal((await call(path, { method: 'DELETE', initData: signed() })).status, 200);
  assert.equal((await call('/admin/measurements', { initData: signed() })).data.measurements.length, 0);
  assert.equal((await call('/admin/measurements', authenticated(draft))).status, 409);
  assert.equal((await call('/admin/recipes/' + draft.baseId + '~blue', authenticated({ measurementId: draft.id, expectedRevision: 0 }, 'PUT'))).status, 404);
  const restored = await call(path + '/restore', { method: 'POST', initData: signed() });
  assert.equal(restored.status, 200); assert.equal(restored.data.published, false);
  assert.equal((await call('/admin/measurements', { initData: signed() })).data.measurements.length, 1);
  assert.equal((await call('/admin/measurements', authenticated(draft))).status, 200);
  assert.equal((await call('/catalog')).headers.get('Access-Control-Allow-Methods').includes('DELETE'), true);
});

test('Deleting the applied measurement reverts the previous mode value, then retires an empty mode override without losing revision checks', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const first = measurement({ extruder1: 145 }), second = measurement({ extruder1: 150 });
  const recipeId = measurementRecipeId(first), path = '/admin/recipes/' + recipeId;
  for (const [draft, revision] of [[first, 0], [second, 1]]) {
    await call('/admin/measurements', authenticated(draft));
    assert.equal((await call(path, authenticated({ measurementId: draft.id, expectedRevision: revision }, 'PUT'))).status, 200);
  }
  assert.equal((await call('/admin/measurements/' + second.id, { method: 'DELETE', initData: signed() })).data.catalogChanged, true);
  let catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.recipes.find(row => row.id === recipeId).extruder1, 145);
  assert.equal(catalogue.recipeRevisions[recipeId], 3);
  assert((await call('/admin/history/' + recipeId, { initData: signed() })).data.history.every(row => row.measurementId !== second.id));
  const deleted = await call('/admin/measurements/' + first.id, { method: 'DELETE', initData: signed() });
  assert.equal(deleted.data.catalogChanged, true);
  catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.recipes.some(row => row.id === recipeId), false);
  assert.equal(catalogue.recipeRevisions[recipeId], 4);
  assert.equal(findRecipe(catalogue, 'vvgng-p', 1.5, 'blue').extruder1, 140);
  assert.equal((await call('/admin/history/' + recipeId, { initData: signed() })).data.history.length, 0);
  await call('/admin/measurements/' + second.id + '/restore', { method: 'POST', initData: signed() });
  assert.equal((await call('/catalog')).data.recipes.some(row => row.id === recipeId), false);
  assert.equal((await call('/catalog')).data.calibrations.some(row => row.measurementId === second.id), false);
  assert.equal((await call(path, authenticated({ measurementId: second.id, expectedRevision: 0 }, 'PUT'))).status, 409);
  const applied = await call(path, authenticated({ measurementId: second.id, expectedRevision: 4 }, 'PUT'));
  assert.equal(applied.status, 200); assert.equal(applied.data.recipe.revision, 5);
  assert.equal(applied.data.recipe.extruder1, 150);
  assert.equal((await call('/catalog')).data.calibrations.find(row => row.measurementId === second.id).extruder1, 150);
});

test('Restoring a removed historical measurement keeps it out of forecasts and rollback until explicit reapplication', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const first = measurement({ extruder1: 145 }), second = measurement({ extruder1: 150 }), recipeId = measurementRecipeId(first);
  for (const [row, revision] of [[first, 0], [second, 1]]) {
    await call('/admin/measurements', authenticated(row));
    await call('/admin/recipes/' + recipeId, authenticated({ measurementId: row.id, expectedRevision: revision }, 'PUT'));
  }
  await call('/admin/measurements/' + first.id, { method: 'DELETE', initData: signed() });
  await call('/admin/measurements/' + first.id + '/restore', { method: 'POST', initData: signed() });
  assert.equal((await call('/catalog')).data.calibrations.some(row => row.measurementId === first.id), false);
  await call('/admin/measurements/' + second.id, { method: 'DELETE', initData: signed() });
  const catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.recipes.some(row => row.id === recipeId), false);
  assert.equal(catalogue.calibrations.length, 0);
  assert.equal((await call('/admin/measurements', { initData: signed() })).data.measurements.length, 1);
});

test('Every saved calibration is public and newer partial measurements preserve earlier known fields', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const first = measurement({ extruder1: 140 }), partial = measurement({ extruder1: 145, maxSpeed: null, matrix: null }), draft = measurement({ extruder1: 155, maxSpeed: null, matrix: null });
  const recipeId = measurementRecipeId(first), path = '/admin/recipes/' + recipeId;
  for (const [row, revision] of [[first, 0], [partial, 1]]) {
    await call('/admin/measurements', authenticated(row));
    await call(path, authenticated({ measurementId: row.id, expectedRevision: revision }, 'PUT'));
  }
  await call('/admin/measurements', authenticated(draft));
  let catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.calibrations.length, 3);
  assert.equal(catalogue.calibrations.find(row => row.measurementId === first.id).maxSpeed, 800);
  assert.equal(catalogue.calibrations.find(row => row.measurementId === partial.id).maxSpeed, null);
  assert.equal(catalogue.calibrations.some(row => row.measurementId === draft.id), true);
  assert(catalogue.calibrations.every(row => row.note === undefined && row.origin === 'measurement'));
  assert.equal(setupFor('vvgng-p', 1.5, catalogue, 'blue').effective.extruder1, 155);
  assert.equal(setupFor('vvgng-p', 1.5, catalogue, 'blue').effective.workingSpeed, 800);
  await call('/admin/measurements/' + first.id, { method: 'DELETE', initData: signed() });
  catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.calibrations.length, 2); assert.equal(catalogue.calibrations.some(row => row.measurementId === first.id), false);
  assert.equal(catalogue.recipes.find(row => row.id === recipeId).extruder1, 145);
});

test('Concurrent deletion of previous and current calibrations cannot restore a deleted value', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const first = measurement({ extruder1: 145 }), second = measurement({ extruder1: 150 });
  const recipeId = measurementRecipeId(first);
  for (const [row, revision] of [[first, 0], [second, 1]]) {
    await call('/admin/measurements', authenticated(row));
    await call('/admin/recipes/' + recipeId, authenticated({ measurementId: row.id, expectedRevision: revision }, 'PUT'));
  }
  const deleted = await Promise.all([second, first].map(row => call('/admin/measurements/' + row.id, { method: 'DELETE', initData: signed() })));
  assert(deleted.every(result => result.status === 200));
  const catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.recipes.some(row => row.id === recipeId), false);
  assert.equal(catalogue.calibrations.length, 0);
  assert.equal((await call('/admin/measurements', { initData: signed() })).data.measurements.length, 0);
});

test('Deleting a shared calibration retires its mode slot while preserving original practical values', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const draft = measurement({ color: 'all' });
  await call('/admin/measurements', authenticated(draft));
  await call('/admin/recipes/' + draft.baseId, authenticated({ measurementId: draft.id, expectedRevision: 1 }, 'PUT'));
  await call('/admin/measurements/' + draft.id, { method: 'DELETE', initData: signed() });
  const restored = (await call('/catalog')).data.recipes.find(row => row.id === draft.baseId);
  assert.equal(restored.origin, 'handwritten'); assert.equal(restored.extruder1, 140); assert.equal(restored.revision, 1);
  assert.equal((await call('/catalog')).data.recipes.some(row => row.id === measurementRecipeId(draft)), false);
  assert.equal((await call('/catalog')).data.recipeRevisions[measurementRecipeId(draft)], 2);
});

test('Different marketing options sharing one handwritten base keep independent calibrations', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const options = CATALOG_OPTIONS.filter(row => row.practicalCableId === 'pv1').slice(0, 2);
  assert.equal(options.length, 2);
  const base = baseFor(options[0].id, 1.5);
  assert.equal(baseFor(options[1].id, 1.5).id, base.id);
  for (const [index, option] of options.entries()) {
    const draft = measurement({ baseId: base.id, optionId: option.id, color: 'all', mode: 'single', extruder1: 80 + index, extruder2: null });
    await call('/admin/measurements', authenticated(draft));
    const result = await call('/admin/recipes/' + encodeURIComponent(measurementRecipeId(draft)), authenticated({ measurementId: draft.id, expectedRevision: 0 }, 'PUT'));
    assert.equal(result.status, 200); assert.equal(result.data.recipe.optionId, option.id);
  }
  const recipes = (await call('/catalog')).data.recipes;
  for (const [index, option] of options.entries()) assert.equal(recipes.find(row => row.id === recipeIdFor(base.id, 'all', option.id, 'single')).extruder1, 80 + index);
  assert.equal(recipes.find(row => row.id === base.id).origin, 'handwritten');
});

test('Management migration preserves existing option-specific measurement, revision and history', async t => {
  const option = CATALOG_OPTIONS.find(row => row.practicalCableId === 'pv1'), base = baseFor(option.id, 1.5);
  const draft = measurement({ baseId: base.id, optionId: option.id, color: 'all', mode: 'single' });
  const legacyData = { ...draft, id: base.id, measurementId: draft.id, origin: 'measurement', source: base.source };
  const { call, db } = fixture({ beforeManagement(legacyDb) {
    legacyDb.prepare('INSERT INTO measurements(id, base_id, color, data, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(draft.id, base.id, 'all', JSON.stringify(draft), '2026-10-01T00:00:00.000Z', '100');
    legacyDb.prepare('UPDATE recipes SET data = ?, revision = revision + 1 WHERE id = ?').run(JSON.stringify(legacyData), base.id);
  } }); t.after(() => db.close());
  const canonicalId = recipeIdFor(base.id, 'all', option.id, 'single'), catalogue = (await call('/catalog')).data;
  const migrated = catalogue.recipes.find(row => row.id === canonicalId);
  assert.equal(migrated.optionId, option.id); assert.equal(migrated.measurementId, draft.id); assert.equal(migrated.revision, 2);
  const history = (await call('/admin/history/' + encodeURIComponent(canonicalId), { initData: signed() })).data.history;
  assert.equal(history[0].origin, 'handwritten'); assert.equal(history[0].id, canonicalId);
  await call('/admin/measurements/' + draft.id, { method: 'DELETE', initData: signed() });
  assert.equal((await call('/catalog')).data.recipes.some(row => row.id === canonicalId), false);
  assert.equal((await call('/catalog')).data.recipeRevisions[canonicalId], 3);
});

test('Deleting a migrated calibration never restores a sibling marketing option from old shared history', async t => {
  const options = CATALOG_OPTIONS.filter(row => row.practicalCableId === 'pv1').slice(0, 2), base = baseFor(options[0].id, 1.5);
  const drafts = options.map((option, index) => measurement({ baseId: base.id, optionId: option.id, color: 'all', mode: 'single', extruder1: 80 + index }));
  const { call, db } = fixture({ beforeManagement(legacyDb) {
    for (const row of drafts) {
      legacyDb.prepare('INSERT INTO measurements(id, base_id, color, data, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, base.id, 'all', JSON.stringify(row), '2026-10-01T00:00:00.000Z', '100');
      const data = { ...row, id: base.id, measurementId: row.id, origin: 'measurement', source: base.source };
      legacyDb.prepare('UPDATE recipes SET data = ?, revision = revision + 1 WHERE id = ?').run(JSON.stringify(data), base.id);
    }
  } }); t.after(() => db.close());
  await call('/admin/measurements/' + drafts[1].id, { method: 'DELETE', initData: signed() });
  const catalogue = (await call('/catalog')).data;
  const recovered = catalogue.recipes.find(row => row.id === recipeIdFor(base.id, 'all', options[0].id, 'single'));
  assert.equal(recovered.measurementId, drafts[0].id); assert.equal(recovered.extruder1, 80);
  assert.equal(catalogue.recipes.some(row => row.id === recipeIdFor(base.id, 'all', options[1].id, 'single')), false);
  assert.equal(catalogue.calibrations.length, 1); assert.equal(catalogue.calibrations[0].optionId, options[0].id);
});

test('Blue and yellow-green share a dual calibration, while single mode stays independent and deletion restores the previous dual value', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const option = CATALOG_OPTIONS.find(row => row.practicalCableId === 'pv3'), base = baseFor(option.id, .75);
  const single = measurement({ baseId: base.id, optionId: option.id, color: 'all', mode: 'single', extruder1: 70, extruder2: null, maxSpeed: 340 });
  const striped = measurement({ baseId: base.id, optionId: option.id, color: 'yellow-green', mode: 'dual', extruder1: 66, extruder2: 86, maxSpeed: 345 });
  const black = measurement({ baseId: base.id, optionId: option.id, color: 'black', mode: 'dual', extruder1: 68, extruder2: 90, maxSpeed: 330 });
  for (const [row, expectedRevision] of [[single, 0], [striped, 0], [black, 1]]) {
    await call('/admin/measurements', authenticated(row));
    const applied = await call('/admin/recipes/' + encodeURIComponent(measurementRecipeId(row)), authenticated({ measurementId: row.id, expectedRevision }, 'PUT'));
    assert.equal(applied.status, 200); assert.equal(applied.data.recipe.color, 'all');
  }
  const dualId = measurementRecipeId(black), singleId = measurementRecipeId(single);
  assert.equal(dualId, measurementRecipeId(striped)); assert.notEqual(dualId, singleId);
  let catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.recipes.find(row => row.id === singleId).extruder1, 70);
  for (const color of ['blue', 'yellow-green']) assert.deepEqual([setupFor(option.id, .75, catalogue, color).effective.extruder1, setupFor(option.id, .75, catalogue, color).effective.extruder2], [68, 90]);
  assert.equal(setupFor(option.id, .75, catalogue, 'black').effective.extruder1, 70);
  const journal = (await call('/admin/measurements', { initData: signed() })).data.measurements;
  assert.equal(journal.find(row => row.id === striped.id).color, 'yellow-green'); assert.equal(journal.find(row => row.id === black.id).color, 'black');
  await call('/admin/measurements/' + black.id, { method: 'DELETE', initData: signed() });
  catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.recipes.find(row => row.id === dualId).measurementId, striped.id);
  for (const color of ['blue', 'yellow-green']) assert.equal(setupFor(option.id, .75, catalogue, color).effective.extruder1, 66);
  assert.equal(catalogue.recipes.find(row => row.id === singleId).extruder1, 70);
});

test('Mode migration merges older colour slots by latest date, retains shared history and preserves journal colours', async t => {
  const option = CATALOG_OPTIONS.find(row => row.practicalCableId === 'pv3'), base = baseFor(option.id, .75);
  const single = measurement({ baseId: base.id, optionId: option.id, color: 'all', mode: 'single', extruder1: 70, extruder2: null, maxSpeed: 340 });
  const striped = measurement({ baseId: base.id, optionId: option.id, color: 'yellow-green', mode: 'dual', extruder1: 66, extruder2: 86, maxSpeed: 345 });
  const black = measurement({ baseId: base.id, optionId: option.id, color: 'black', mode: 'dual', extruder1: 68, extruder2: 90, maxSpeed: 330 });
  const { call, db } = fixture({ beforeModes(legacyDb) {
    for (const [index, row] of [single, striped, black].entries()) {
      const timestamp = `2026-10-01T0${index + 1}:00:00.000Z`, legacyId = recipeIdFor(base.id, row.color, option.id);
      legacyDb.prepare('INSERT INTO measurements(id, base_id, color, data, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, base.id, row.color, JSON.stringify(row), timestamp, '100');
      const data = { ...row, id: legacyId, measurementId: row.id, source: base.source, origin: 'measurement' };
      legacyDb.prepare('INSERT INTO recipes(id, base_id, color, data, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(legacyId, base.id, row.color, JSON.stringify(data), index === 1 ? 4 : 2, timestamp);
    }
  } }); t.after(() => db.close());
  const dualId = measurementRecipeId(black), singleId = measurementRecipeId(single);
  let catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.recipes.filter(row => row.optionId === option.id && row.baseId === base.id && row.origin === 'measurement').length, 2);
  assert.equal(catalogue.recipes.find(row => row.id === dualId).measurementId, black.id);
  assert.equal(catalogue.recipes.find(row => row.id === singleId).measurementId, single.id);
  assert.equal(catalogue.calibrations.length, 3);
  const oldHistory = await call('/admin/history/' + encodeURIComponent(recipeIdFor(base.id, 'yellow-green', option.id)), { initData: signed() });
  assert.equal(oldHistory.data.history[0].measurementId, striped.id);
  await call('/admin/measurements/' + black.id, { method: 'DELETE', initData: signed() });
  catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.recipes.find(row => row.id === dualId).measurementId, striped.id);
  assert.equal(catalogue.recipes.find(row => row.id === dualId).extruder1, 66);
  assert.equal(catalogue.recipes.find(row => row.id === singleId).extruder1, 70);
  assert.equal((await call('/admin/measurements', { initData: signed() })).data.measurements.find(row => row.id === striped.id).color, 'yellow-green');
});

test('Public measurements omit admin text and identity; later reapplication cannot make an older measurement newer', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const older = measurement({ extruder1: 140, note: 'PRIVATE_ADMIN_NOTE_OLD' }), newer = measurement({ extruder1: 155, note: 'PRIVATE_ADMIN_NOTE_NEW' });
  for (const [row, timestamp] of [[older, '2026-09-01T00:00:00.000Z'], [newer, '2026-09-02T00:00:00.000Z']]) {
    await call('/admin/measurements', authenticated(row));
    db.prepare('UPDATE measurements SET created_at = ? WHERE id = ?').run(timestamp, row.id);
  }
  const applied = await call('/admin/recipes/' + measurementRecipeId(older), authenticated({ measurementId: older.id, expectedRevision: 0 }, 'PUT'));
  assert.equal(applied.status, 200);
  const response = await call('/catalog'), catalogue = response.data, current = catalogue.recipes.find(row => row.id === measurementRecipeId(older));
  assert.equal(response.status, 200);
  assert.equal(current.updatedAt, '2026-09-01T00:00:00.000Z'); assert.equal(current.createdAt, current.updatedAt);
  assert.notEqual(current.appliedAt, current.updatedAt);
  assert.equal(current.note, undefined); assert.deepEqual(current.notes, []);
  assert.equal(JSON.stringify(catalogue).includes('PRIVATE_ADMIN_NOTE'), false);
  for (const row of catalogue.calibrations) {
    assert.equal(row.updatedAt, row.createdAt);
    for (const field of ['note', 'notes', 'createdBy', 'created_by', 'auth', 'initData']) assert.equal(row[field], undefined);
  }
  assert.equal(setupFor('vvgng-p', 1.5, catalogue, 'blue').effective.extruder1, 155);
});

test('Previously journal-only records and unknown-mode measurements are included in public numeric metadata', async t => {
  const legacy = measurement({ mode: 'unknown', extruder1: null, extruder2: null, note: 'PRIVATE_LEGACY_NOTE' });
  const { call, db } = fixture({ beforeManagement(legacyDb) {
    legacyDb.prepare('INSERT INTO measurements(id, base_id, color, data, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(legacy.id, legacy.baseId, legacy.color, JSON.stringify(legacy), '2026-09-01T00:00:00.000Z', '100');
  } }); t.after(() => db.close());
  const catalogue = (await call('/catalog')).data;
  assert.equal(catalogue.calibrations.length, 1); assert.equal(catalogue.calibrations[0].measurementId, legacy.id);
  assert.equal(catalogue.calibrations[0].mode, 'unknown'); assert.equal(catalogue.calibrations[0].matrix, 2.45);
  assert.equal(JSON.stringify(catalogue).includes('PRIVATE_LEGACY_NOTE'), false);
  assert.equal(catalogue.recipes.some(row => row.measurementId === legacy.id), false);
});

test('CSV preserves Unicode and quotes, and neutralizes spreadsheet formulas', () => {
  const catalog = baseline(); catalog.recipes[0].notes = ['=HYPERLINK("bad")'];
  const output = csv(catalog); assert.ok(output.startsWith('\uFEFF')); assert.ok(output.includes("\"'=HYPERLINK(\"\"bad\"\")\"")); assert.ok(output.includes('SIKORA'));
});
