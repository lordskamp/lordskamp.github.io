import { CATALOG_CABLES as CABLES, CATALOG_BASES as RECIPES, optionFor, baseFor } from '../Zavod/catalog-base.js';
import { COLORS } from '../Zavod/core.js';

const NUMERIC = ['dorn', 'matrix', 'sikoraWire', 'sikoraOuter', 'extruder1', 'extruder2', 'maxSpeed', 'colorLead2'];
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

export function validateMeasurement(input) {
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
  for (const field of NUMERIC) {
    const value = input[field];
    if (value === null || value === undefined || value === '') { result[field] = null; continue; }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100000) fail(400, 'Значення мають бути додатними числами.');
    if (['dorn', 'matrix', 'sikoraWire', 'sikoraOuter'].includes(field) && value > 1000) fail(400, 'Перевірте діаметри: одиниця вимірювання — мм.');
    result[field] = value;
  }
  if (result.mode === 'single') result.extruder2 = null;
  if (!result.note && !NUMERIC.some(key => result[key] !== null)) fail(400, 'Додайте хоча б одне значення або примітку.');
  return result;
}

function unpack(row) { return { ...JSON.parse(row.data), id: row.id, revision: row.revision, updatedAt: row.updated_at }; }

export async function handleRequest(request, env) {
  const path = new URL(request.url).pathname.replace(/\/$/, '') || '/';
  if (request.method === 'GET' && path === '/catalog') {
    const { results } = await env.DB.prepare('SELECT * FROM recipes ORDER BY base_id, color').all();
    return { cables: CABLES, recipes: results.map(unpack), updatedAt: results.reduce((last, row) => row.updated_at > last ? row.updated_at : last, ''), source: 'server' };
  }
  if (!path.startsWith('/admin/')) fail(404, 'Сторінку не знайдено.');
  const user = await admin(request, env);
  if (request.method === 'POST' && path === '/admin/auth') return { ok: true, username: user.username || env.OWNER_USERNAME };
  if (request.method === 'GET' && path === '/admin/measurements') {
    const cursor = new URL(request.url).searchParams.get('before');
    const [before, beforeId] = cursor ? cursor.split('|') : ['9999', ''];
    if (!before || (cursor && !beforeId)) fail(400, 'Некоректна сторінка журналу.');
    const { results } = await env.DB.prepare('SELECT * FROM measurements WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT 101').bind(before, before, beforeId).all();
    return { measurements: results.slice(0, 100).map(row => ({ ...JSON.parse(row.data), createdAt: row.created_at })), next: results.length > 100 ? results[99].created_at + '|' + results[99].id : null };
  }
  if (request.method === 'POST' && path === '/admin/measurements') {
    const measurement = validateMeasurement(await bodyJson(request));
    const now = new Date().toISOString();
    const result = await env.DB.prepare('INSERT INTO measurements(id, base_id, color, data, created_at, created_by) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(measurement.id, measurement.baseId, measurement.color, JSON.stringify(measurement), now, String(user.id)).run();
    if (!result.meta.changes) {
      const existing = await env.DB.prepare('SELECT data, created_at FROM measurements WHERE id = ?').bind(measurement.id).first();
      if (existing.data !== JSON.stringify(measurement)) fail(409, 'Запис із цим номером уже існує.');
      return { measurement: { ...measurement, createdAt: existing.created_at } };
    }
    return { measurement: { ...measurement, createdAt: now } };
  }
  if (request.method === 'PUT' && path.startsWith('/admin/recipes/')) {
    const payload = await bodyJson(request);
    const id = decodeURIComponent(path.slice('/admin/recipes/'.length));
    if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) fail(400, 'Оновіть таблицю перед збереженням.');
    const stored = await env.DB.prepare('SELECT data, created_at FROM measurements WHERE id = ?').bind(String(payload.measurementId)).first();
    if (!stored) fail(404, 'Замір не знайдено.');
    const measurement = JSON.parse(stored.data);
    const expectedId = measurement.color === 'all' ? measurement.baseId : `${measurement.baseId}~${measurement.color}`;
    if (id !== expectedId) fail(400, 'Замір належить іншому проводу або кольору.');
    if (measurement.mode === 'unknown') fail(400, 'Перед застосуванням оберіть кількість екструдерів.');
    const original = RECIPES.find(row => row.id === measurement.baseId);
    const data = { ...measurement, id, measurementId: measurement.id, source: original.source, origin: 'measurement', notes: measurement.note ? [measurement.note] : [], uncertain: [] };
    const previous = await env.DB.prepare('SELECT * FROM recipes WHERE id = ?').bind(id).first();
    if (previous && JSON.parse(previous.data).measurementId === measurement.id) return { recipe: unpack(previous) };
    if ((previous?.revision ?? 0) !== payload.expectedRevision) fail(409, 'Цей рядок уже змінився. Замір збережений; оновіть таблицю перед застосуванням.');
    const now = new Date().toISOString();
    const updated = await env.DB.prepare(`INSERT INTO recipes(id, base_id, color, data, revision, updated_at)
      SELECT ?, ?, ?, ?, 1, ? WHERE ? = 0 OR EXISTS(SELECT 1 FROM recipes WHERE id = ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, revision = recipes.revision + 1, updated_at = excluded.updated_at WHERE recipes.revision = ?
      RETURNING *`).bind(id, measurement.baseId, measurement.color, JSON.stringify(data), now, payload.expectedRevision, id, payload.expectedRevision).first();
    if (!updated) fail(409, 'Цей рядок уже змінився. Замір збережений; оновіть таблицю перед застосуванням.');
    return { recipe: unpack(updated) };
  }
  if (request.method === 'GET' && path.startsWith('/admin/history/')) {
    const id = decodeURIComponent(path.slice('/admin/history/'.length));
    const { results } = await env.DB.prepare('SELECT revision, data, recorded_at FROM recipe_history WHERE recipe_id = ? ORDER BY revision DESC LIMIT 100').bind(id).all();
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
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS';
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
