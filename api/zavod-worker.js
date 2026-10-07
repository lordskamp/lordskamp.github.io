import { CATALOG_CABLES as CABLES, CATALOG_BASES as RECIPES, optionFor, baseFor, recipeIdFor } from '../Zavod/catalog-base.js';
import { COLORS } from '../Zavod/core.js';
import { modeFor } from '../Zavod/pv3-modes.js';

const NUMERIC = ['dorn', 'matrix', 'sikoraWire', 'sikoraOuter', 'extruder1', 'extruder2', 'maxSpeed', 'colorLead1', 'colorLead2'];
const COLOR_LEADS = ['colorLead1', 'colorLead2'];
const encoder = new TextEncoder();
const MAX_AGE = 12 * 60 * 60;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const fail = (status, message) => { throw new HttpError(status, message); };
const hexBytes = hex => Uint8Array.from(hex.match(/../g) ?? [], pair => parseInt(pair, 16));

/** Validate Telegram's signature before reading any identity or granting access. */
export async function verifyTelegram(initData, botToken, now = Math.floor(Date.now() / 1000)) {
  if (!botToken || typeof initData !== 'string' || initData.length > 12000) return null;
  const params = new URLSearchParams(initData);
  if ([...params.keys()].some((key, i, keys) => keys.indexOf(key) !== i)) return null;
  const hash = params.get('hash');
  if (!/^[a-f\d]{64}$/i.test(hash ?? '')) return null;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0 || now - authDate > MAX_AGE || authDate - now > 60) return null;
  params.delete('hash');
  const data = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  try {
    const seed = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const secret = await crypto.subtle.sign('HMAC', seed, encoder.encode(botToken));
    const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, hexBytes(hash), encoder.encode(data))) return null;
    const user = JSON.parse(params.get('user') ?? '{}');
    if (!Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot) return null;
    return user;
  } catch { return null; }
}

async function admin(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) fail(503, 'Вхід ще не налаштований.');
  const user = await verifyTelegram(request.headers.get('X-Telegram-Init-Data'), env.TELEGRAM_BOT_TOKEN);
  if (!user) fail(401, 'Відкрийте застосунок заново через Telegram.');
  const owner = await env.DB.prepare('SELECT value FROM settings WHERE name = ?').bind('owner_id').first();
  if (owner) {
    if (owner.value !== String(user.id)) fail(403, 'Записувати значення може лише власник.');
  } else {
    const expected = String(env.OWNER_USERNAME || '').replace(/^@/, '').toLowerCase();
    if (!expected || String(user.username || '').toLowerCase() !== expected) fail(403, 'Записувати значення може лише власник.');
    // Bootstrap once from a Telegram-signed username, then permanently use the numeric id.
    await env.DB.prepare('INSERT INTO settings(name, value) VALUES(?, ?) ON CONFLICT(name) DO NOTHING').bind('owner_id', String(user.id)).run();
    const pinned = await env.DB.prepare('SELECT value FROM settings WHERE name = ?').bind('owner_id').first();
    if (pinned?.value !== String(user.id)) fail(403, 'Доступ належить іншому акаунту.');
  }
  return user;
}

async function bodyJson(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, 'Потрібні дані JSON.');
  if (Number(request.headers.get('Content-Length') || 0) > 20000) fail(413, 'Запис завеликий.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Порожній запис.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 20000) { await reader.cancel(); fail(413, 'Запис завеликий.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Некоректний запис.');
    return data;
  } catch { fail(400, 'Некоректний запис.'); }
}

export function validateMeasurement(input, { historical = false } = {}) {
  const base = RECIPES.find(row => row.id === input.baseId);
  if (!base) fail(400, 'Оберіть марку та переріз із таблиці.');
  if (!/^[a-f\d-]{36}$/i.test(input.id ?? '')) fail(400, 'Некоректний номер запису.');
  if (input.color !== 'all' && !COLORS.some(color => color.id === input.color)) fail(400, 'Оберіть колір.');
  if (!['single', 'dual', 'unknown'].includes(input.mode)) fail(400, 'Оберіть режим екструдерів.');
  if (typeof input.note !== 'string' || input.note.length > 2000) fail(400, 'Примітка має містити до 2000 символів.');
  const result = { id: input.id, baseId: base.id, cableId: base.cableId, section: base.section, color: input.color, mode: input.mode, note: input.note.trim() };
  if (input.optionId !== undefined) {
    const option = CABLES.find(option => option.id === input.optionId);
    if (!option || baseFor(option.id, base.section)?.id !== base.id) fail(400, 'Замір належить іншій марці або карті.');
    result.optionId = optionFor(option.id).id;
  }
  const thread = optionFor(result.optionId ?? base.cableId)?.coreKind === 'thread';
  if (thread) {
    const diameter = input.finalDiameter;
    if (diameter !== undefined && diameter !== null && (typeof diameter !== 'number' || !Number.isFinite(diameter) || diameter <= 0 || diameter > 1000)) fail(400, 'Вкажіть додатний кінцевий діаметр джгута в міліметрах.');
    if (!historical && (diameter === undefined || diameter === null)) fail(400, 'Вкажіть кінцевий діаметр джгута.');
    if (diameter !== undefined && diameter !== null) result.finalDiameter = diameter;
    if (!historical && (input.mode !== 'single' || input.color !== 'all' || ![undefined, null, '', 0].includes(input.extruder2)
      || ![undefined, null, ''].includes(input.colorLead1) || ![undefined, null, ''].includes(input.colorLead2))) {
      fail(400, 'Джгути працюють лише екструдером №1, без кольору та зміни барвника.');
    }
  }
  if (input.mode === 'single' && input.color !== 'all' && modeFor(optionFor(result.optionId ?? base.cableId), input.color, 'single') === 'dual') {
    fail(400, 'Для цього кольору потрібні два екструдери.');
  }
  for (const field of NUMERIC) {
    const value = input[field];
    if (thread && !historical && field === 'extruder2' && value === 0) { result[field] = null; continue; }
    if (value === null || value === undefined || value === '') { result[field] = null; continue; }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!COLOR_LEADS.includes(field) && value === 0) || value > 100000) fail(400, 'Перевірте числа: значення мають бути додатними, випередження зміни кольору може бути нульовим.');
    if (COLOR_LEADS.includes(field) && !Number.isInteger(value)) fail(400, 'Випередження зміни кольору вкажіть у цілих метрах.');
    if (['dorn', 'matrix', 'sikoraWire', 'sikoraOuter'].includes(field) && value > 1000) fail(400, 'Перевірте діаметри: одиниця вимірювання — мм.');
    result[field] = value;
  }
  if (result.mode === 'single') { result.extruder2 = null; result.colorLead2 = null; }
  if (!result.note && !NUMERIC.some(key => result[key] !== null)) fail(400, 'Додайте хоча б одне значення або примітку.');
  return result;
}

function unpack(row) { return { ...JSON.parse(row.data), id: row.id, revision: row.revision, updatedAt: row.updated_at }; }

async function deleteMeasurement(id, env, user) {
  const stored = await env.DB.prepare('SELECT * FROM measurements WHERE id = ?').bind(id).first();
  if (!stored) fail(404, 'Замір не знайдено.');
  if (stored.deleted_at) return { ok: true, id, deleted: true, catalogChanged: false };
  const measurement = JSON.parse(stored.data);
  const original = RECIPES.find(row => row.id === measurement.baseId);
  const calibration = !stored.withdrawn_at;
  // Include the recipe slot even if another measurement is currently active:
  // a simultaneous deletion may revert this slot before our transaction runs.
  const affected = await env.DB.prepare("SELECT * FROM recipes WHERE base_id = ? AND json_extract(data, '$.mode') = ?").bind(measurement.baseId, measurement.mode).all();
  const now = new Date().toISOString();
  const statements = [env.DB.prepare('UPDATE measurements SET deleted_at = ?, deleted_by = ?, withdrawn_at = ? WHERE id = ? AND deleted_at IS NULL').bind(now, String(user.id), now, id)];
  for (const row of affected.results) {
    const current = JSON.parse(row.data);
    const fallback = { ...original, id: row.id, baseId: measurement.baseId, color: 'all', mode: current.mode, origin: 'handwritten', ...(current.optionId ? { optionId: current.optionId } : {}),
      ...(current.finalDiameter !== undefined ? { finalDiameter: current.finalDiameter } : {}) };
    // Resolve the previous calibration inside the transaction so a concurrent
    // deletion cannot bring an already deleted measurement back into use.
    const prior = `SELECT h.data FROM recipe_history h JOIN measurements m ON m.id = json_extract(h.data, '$.measurementId')
      WHERE h.recipe_id = recipes.id AND m.deleted_at IS NULL AND m.withdrawn_at IS NULL
        AND COALESCE(json_extract(h.data, '$.optionId'), '') = COALESCE(json_extract(recipes.data, '$.optionId'), '')
        AND json_extract(h.data, '$.mode') = json_extract(recipes.data, '$.mode')
        AND COALESCE(json_extract(h.data, '$.finalDiameter'), 0) = COALESCE(json_extract(recipes.data, '$.finalDiameter'), 0)
      ORDER BY h.recorded_at DESC, h.revision DESC, h.id DESC LIMIT 1`;
    statements.push(env.DB.prepare(`UPDATE recipes SET
      data = json_set(COALESCE((${prior}), ?), '$.id', recipes.id, '$.color', 'all'),
      retired_at = CASE WHEN EXISTS(${prior}) THEN NULL ELSE ? END,
      revision = revision + 1, updated_at = ?
      WHERE id = ? AND json_extract(data, '$.measurementId') = ? AND retired_at IS NULL`)
      .bind(JSON.stringify(fallback), now, now, row.id, id));
  }
  const results = await env.DB.batch(statements);
  return { ok: true, id, deleted: true, catalogChanged: Boolean(calibration) || results.slice(1).some(result => result.meta.changes > 0) };
}

export async function handleRequest(request, env) {
  const path = new URL(request.url).pathname.replace(/\/$/, '') || '/';
  if (request.method === 'GET' && path === '/catalog') {
    const [{ results }, { results: measured }] = await Promise.all([
      env.DB.prepare('SELECT * FROM recipes ORDER BY base_id, color').all(),
      env.DB.prepare('SELECT data, created_at FROM measurements WHERE deleted_at IS NULL AND withdrawn_at IS NULL ORDER BY created_at DESC, id DESC').all(),
    ]);
    const calibrations = measured.map(row => {
      const measurement = JSON.parse(row.data);
      const identity = Object.fromEntries(['id', 'baseId', 'cableId', 'section', 'optionId', 'color', 'mode', 'finalDiameter'].filter(key => measurement[key] !== undefined).map(key => [key, measurement[key]]));
      return { ...identity, ...Object.fromEntries(NUMERIC.map(key => [key, measurement[key] ?? null])), measurementId: measurement.id, origin: 'measurement', createdAt: row.created_at, updatedAt: row.created_at };
    });
    const measuredAt = new Map(calibrations.map(row => [row.measurementId, row.createdAt]));
    const recipes = results.filter(row => !row.retired_at).map(unpack).filter(row => row.origin !== 'measurement' || measuredAt.has(row.measurementId)).map(row => {
      if (row.origin !== 'measurement') return row;
      const publicRecipe = { ...row };
      delete publicRecipe.note;
      delete publicRecipe.notes;
      return { ...publicRecipe, notes: [], createdAt: measuredAt.get(row.measurementId), updatedAt: measuredAt.get(row.measurementId), appliedAt: row.updatedAt };
    });
    const updatedAt = [...results.map(row => row.updated_at), ...measured.map(row => row.created_at)].reduce((last, timestamp) => timestamp > last ? timestamp : last, '');
    return { cables: CABLES, recipes, calibrations, recipeRevisions: Object.fromEntries(results.map(row => [row.id, row.revision])), updatedAt, source: 'server' };
  }
  if (!path.startsWith('/admin/')) fail(404, 'Сторінку не знайдено.');
  const user = await admin(request, env);
  if (request.method === 'POST' && path === '/admin/auth') return { ok: true, username: user.username || env.OWNER_USERNAME };
  if (request.method === 'GET' && path === '/admin/measurements') {
    const cursor = new URL(request.url).searchParams.get('before');
    const [before, beforeId] = cursor ? cursor.split('|') : ['9999', ''];
    if (!before || (cursor && !beforeId)) fail(400, 'Некоректна сторінка журналу.');
    const { results } = await env.DB.prepare('SELECT * FROM measurements WHERE deleted_at IS NULL AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT 101').bind(before, before, beforeId).all();
    return { measurements: results.slice(0, 100).map(row => ({ ...JSON.parse(row.data), createdAt: row.created_at })), next: results.length > 100 ? results[99].created_at + '|' + results[99].id : null };
  }
  if (request.method === 'POST' && path === '/admin/measurements') {
    const measurement = validateMeasurement(await bodyJson(request));
    const now = new Date().toISOString();
    const result = await env.DB.prepare('INSERT INTO measurements(id, base_id, color, data, created_at, created_by) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(measurement.id, measurement.baseId, measurement.color, JSON.stringify(measurement), now, String(user.id)).run();
    if (!result.meta.changes) {
      const existing = await env.DB.prepare('SELECT data, created_at, deleted_at FROM measurements WHERE id = ?').bind(measurement.id).first();
      if (existing.deleted_at) fail(409, 'Цей запис видалено. Спочатку відновіть його.');
      if (JSON.stringify(validateMeasurement(JSON.parse(existing.data), { historical: true })) !== JSON.stringify(measurement)) fail(409, 'Запис із цим номером уже існує.');
      return { measurement: { ...measurement, createdAt: existing.created_at } };
    }
    return { measurement: { ...measurement, createdAt: now } };
  }
  const measurementAction = path.match(/^\/admin\/measurements\/([a-f\d-]{36})(\/restore)?$/i);
  if (measurementAction && request.method === 'DELETE' && !measurementAction[2]) return deleteMeasurement(measurementAction[1], env, user);
  if (measurementAction?.[2] && request.method === 'POST') {
    const stored = await env.DB.prepare('SELECT data, created_at FROM measurements WHERE id = ?').bind(measurementAction[1]).first();
    if (!stored) fail(404, 'Замір не знайдено.');
    await env.DB.prepare('UPDATE measurements SET deleted_at = NULL, deleted_by = NULL WHERE id = ?').bind(measurementAction[1]).run();
    return { ok: true, measurement: { ...JSON.parse(stored.data), createdAt: stored.created_at }, published: false };
  }
  if (request.method === 'PUT' && path.startsWith('/admin/recipes/')) {
    const payload = await bodyJson(request);
    const requestedId = decodeURIComponent(path.slice('/admin/recipes/'.length));
    if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) fail(400, 'Оновіть таблицю перед збереженням.');
    const stored = await env.DB.prepare('SELECT data, created_at FROM measurements WHERE id = ? AND deleted_at IS NULL').bind(String(payload.measurementId)).first();
    if (!stored) fail(404, 'Замір не знайдено.');
    const measurement = JSON.parse(stored.data);
    const id = recipeIdFor(measurement.baseId, measurement.color, measurement.optionId, measurement.mode, measurement.finalDiameter);
    // A diameter-specific thread slot has no unsized alias: sharing one would
    // let a later size redirect the history and revision of another size.
    const sizedThread = optionFor(measurement.optionId ?? measurement.cableId)?.coreKind === 'thread' && measurement.finalDiameter > 0;
    const legacyIds = sizedThread ? [] : [recipeIdFor(measurement.baseId, measurement.color), recipeIdFor(measurement.baseId, measurement.color, measurement.optionId)];
    if (requestedId !== id && !legacyIds.includes(requestedId)) fail(400, 'Замір належить іншому проводу або режиму.');
    if (measurement.mode === 'unknown') fail(400, 'Перед застосуванням оберіть кількість екструдерів.');
    const original = RECIPES.find(row => row.id === measurement.baseId);
    const data = { ...measurement, id, color: 'all', measurementId: measurement.id, createdAt: stored.created_at, source: original.source, origin: 'measurement', notes: measurement.note ? [measurement.note] : [], uncertain: [] };
    const previous = await env.DB.prepare('SELECT * FROM recipes WHERE id = ?').bind(id).first();
    if (previous && !previous.retired_at && JSON.parse(previous.data).measurementId === measurement.id) return { recipe: unpack(previous) };
    // Old clients publish under the handwritten id. Keep accepting their first
    // application while storing it under the option-specific id.
    const legacy = !previous && legacyIds.includes(requestedId) && id !== requestedId ? await env.DB.prepare('SELECT revision FROM recipes WHERE id = ?').bind(requestedId).first() : null;
    const expectedRevision = !previous && legacy?.revision === payload.expectedRevision ? 0 : payload.expectedRevision;
    if ((previous?.revision ?? 0) !== expectedRevision) fail(409, 'Цей рядок уже змінився. Замір збережений; оновіть таблицю перед застосуванням.');
    const now = new Date().toISOString();
    const updateRecipe = env.DB.prepare(`INSERT INTO recipes(id, base_id, color, data, revision, updated_at)
      SELECT ?, ?, ?, ?, 1, ? WHERE (? = 0 OR EXISTS(SELECT 1 FROM recipes WHERE id = ?))
        AND EXISTS(SELECT 1 FROM measurements WHERE id = ? AND deleted_at IS NULL)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, revision = recipes.revision + 1, updated_at = excluded.updated_at, retired_at = NULL WHERE recipes.revision = ?
      RETURNING *`).bind(id, measurement.baseId, 'all', JSON.stringify(data), now, expectedRevision, id, measurement.id, expectedRevision);
    const [applied] = await env.DB.batch([
      updateRecipe,
      env.DB.prepare("UPDATE measurements SET withdrawn_at = NULL WHERE id = ? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM recipes WHERE id = ? AND retired_at IS NULL AND json_extract(data, '$.measurementId') = ?)").bind(measurement.id, id, measurement.id),
      ...(requestedId !== id ? [env.DB.prepare("INSERT INTO recipe_aliases(id, recipe_id) SELECT ?, ? WHERE EXISTS(SELECT 1 FROM recipes WHERE id = ? AND retired_at IS NULL AND json_extract(data, '$.measurementId') = ?) ON CONFLICT(id) DO UPDATE SET recipe_id = excluded.recipe_id").bind(requestedId, id, id, measurement.id)] : []),
    ]);
    const updated = applied.results?.[0];
    if (!updated) fail(409, 'Цей рядок уже змінився. Замір збережений; оновіть таблицю перед застосуванням.');
    return { recipe: unpack(updated) };
  }
  if (request.method === 'GET' && path.startsWith('/admin/history/')) {
    const requestedId = decodeURIComponent(path.slice('/admin/history/'.length));
    const alias = await env.DB.prepare('SELECT recipe_id FROM recipe_aliases WHERE id = ?').bind(requestedId).first();
    const id = alias?.recipe_id ?? requestedId;
    const { results } = await env.DB.prepare("SELECT revision, data, recorded_at FROM recipe_history h WHERE recipe_id = ? AND NOT EXISTS(SELECT 1 FROM measurements m WHERE m.id = json_extract(h.data, '$.measurementId') AND (m.deleted_at IS NOT NULL OR m.withdrawn_at IS NOT NULL)) ORDER BY recorded_at DESC, revision DESC LIMIT 100").bind(id).all();
    return { history: results.map(row => ({ ...JSON.parse(row.data), revision: row.revision, updatedAt: row.recorded_at })) };
  }
  fail(404, 'Дію не знайдено.');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(item => item.trim());
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (origin && !allowed.includes(origin)) return new Response(JSON.stringify({ error: 'Цей сайт не має доступу.' }), { status: 403, headers });
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Telegram-Init-Data';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try { return new Response(JSON.stringify(await handleRequest(request, env)), { headers }); }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(JSON.stringify({ event: 'zavod_request_failed', path: new URL(request.url).pathname }));
      return new Response(JSON.stringify({ error: status === 500 ? 'Не вдалося зберегти. Спробуйте ще раз.' : error.message }), { status, headers });
    }
  }
};
