import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import worker, { verifyTelegram } from '../api/zavod-worker.js';
import { baseline, findRecipe, csv } from '../Zavod/store.js';

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
function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['0001_catalog.sql', '0002_seed.sql']) db.exec(readFileSync(new URL('../migrations/zavod/' + name, import.meta.url), 'utf8'));
  const DB = { prepare(sql) {
    const statement = db.prepare(sql); let values = [];
    return { bind(...args) { values = args; return this; }, async first() { return statement.get(...values) ?? null; }, async all() { return { results: statement.all(...values) }; }, async run() { const result = statement.run(...values); return { meta: { changes: result.changes } }; } };
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
test('Writes require authentication and permitted origin; draft never changes the calculator', async t => {
  const { call, db } = fixture(); t.after(() => db.close()); const draft = measurement();
  assert.equal((await call('/admin/measurements', { method: 'POST', body: draft })).status, 401);
  assert.equal((await call('/admin/measurements', { ...authenticated(draft), origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await call('/admin/measurements', authenticated(draft))).status, 200);
  assert.equal(findRecipe((await call('/catalog')).data, 'vvgng-p', 1.5, 'blue').extruder1, 140);
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
test('Apply, colour isolation, optimistic conflicts, history, seed replay and cross-session persistence', async t => {
  const { call, db, env } = fixture(); t.after(() => db.close()); const draft = measurement();
  await call('/admin/measurements', authenticated(draft));
  const path = '/admin/recipes/' + draft.baseId + '~blue';
  const publish = authenticated({ measurementId: draft.id, expectedRevision: 0 }, 'PUT');
  assert.equal((await call(path, publish)).data.recipe.revision, 1);
  assert.equal((await call(path, publish)).data.recipe.revision, 1);
  const data = (await call('/catalog')).data;
  assert.equal(findRecipe(data, 'vvgng-p', 1.5, 'blue').extruder1, 142);
  assert.equal(findRecipe(data, 'vvgng-p', 1.5, 'brown').extruder1, 140);
  const second = measurement({ extruder1: 144 }); await call('/admin/measurements', authenticated(second));
  assert.equal((await call(path, authenticated({ measurementId: second.id, expectedRevision: 0 }, 'PUT'))).status, 409);
  assert.equal((await call(path, authenticated({ measurementId: second.id, expectedRevision: 1 }, 'PUT'))).data.recipe.revision, 2);
  const history = await call('/admin/history/' + draft.baseId + '~blue', { initData: signed() });
  assert.equal(history.data.history[0].extruder1, 142);
  db.exec(readFileSync(new URL('../migrations/zavod/0002_seed.sql', import.meta.url), 'utf8'));
  const fresh = await worker.fetch(new Request('https://test.invalid/catalog'), { ...env });
  assert.equal(findRecipe(await fresh.json(), 'vvgng-p', 1.5, 'blue').extruder1, 144);
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
test('Journal pagination never skips records with identical timestamps', async t => {
  const { call, db } = fixture(); t.after(() => db.close());
  const insert = db.prepare('INSERT INTO measurements VALUES (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 102; i++) { const row = measurement(); insert.run(row.id, row.baseId, row.color, JSON.stringify(row), '2026-09-29T00:00:00.000Z', '100'); }
  const first = await call('/admin/measurements', { initData: signed() });
  const next = await call('/admin/measurements?before=' + encodeURIComponent(first.data.next), { initData: signed() });
  assert.equal(first.data.measurements.length, 100); assert.equal(next.data.measurements.length, 2);
  assert.equal(new Set([...first.data.measurements, ...next.data.measurements].map(row => row.id)).size, 102);
});
test('CSV preserves Unicode and quotes, and neutralizes spreadsheet formulas', () => {
  const catalog = baseline(); catalog.recipes[0].notes = ['=HYPERLINK("bad")'];
  const output = csv(catalog); assert.ok(output.startsWith('\uFEFF')); assert.ok(output.includes("\"'=HYPERLINK(\"\"bad\"\")\"")); assert.ok(output.includes('Сікора'));
});
