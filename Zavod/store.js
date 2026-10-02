import { CABLES, RECIPES } from './data.js';
import { colorName } from './core.js?v=21';
import { API_URL } from './config.js?v=3';
import { PUBLIC_CALIBRATIONS, CALIBRATION_SNAPSHOT } from './calibration-snapshot.js?v=21';
const CACHE = 'zavod-shared-table-v1';
export const FIELDS = [['extruder1', 'Оберти №1, об/хв'], ['extruder2', 'Оберти №2, об/хв'], ['sikoraWire', 'SIKORA: діаметр жили, мм'], ['sikoraOuter', 'SIKORA: з ізоляцією, мм'], ['dorn', 'Дорн, мм'], ['matrix', 'Матриця, мм'], ['maxSpeed', 'Робоча швидкість, м/хв'], ['colorLead1', 'Зміна кольору №1 за, м'], ['colorLead2', 'Зміна кольору №2 за, м']];
export function baseline() {
  return { cables: CABLES, recipes: RECIPES.map(row => ({ ...row, baseId: row.id, color: 'all', origin: 'handwritten', revision: 1, updatedAt: '2026-09-29T00:00:00.000Z' })),
    calibrations: PUBLIC_CALIBRATIONS.map(row => ({ ...row })), calibrationSnapshot: CALIBRATION_SNAPSHOT, source: 'snapshot' };
}
// Once a full server catalogue has been received, its omissions/retractions are
// authoritative, including offline use of that cache. Never add bundled rows
// back to an authoritative server result or silently resurrect a removed row.
export function withOfflineCalibrations(catalog) {
  if (catalog.calibrationAuthority === 'server' || catalog.source === 'server' || typeof catalog.lastSyncedAt === 'string') return catalog;
  const existing = [...(catalog.recipes ?? []), ...(catalog.calibrations ?? [])];
  const identity = row => `${row.optionId ?? row.cableId}|${row.section}|${row.mode}`;
  const present = new Set(existing.filter(row => row.origin === 'measurement' || row.deletedAt || row.withdrawnAt || row.retired).map(identity));
  return { ...catalog, calibrations: [...(catalog.calibrations ?? []), ...PUBLIC_CALIBRATIONS.filter(row => !present.has(identity(row))).map(row => ({ ...row }))],
    calibrationSnapshot: CALIBRATION_SNAPSHOT };
}
export function cachedCatalog() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE));
    if (Array.isArray(cached?.recipes) && cached.recipes.length && Array.isArray(cached?.cables)) return { ...withOfflineCalibrations(cached), source: 'cache' };
  } catch { /* Original data is always available. */ }
  return baseline();
}
export async function loadCatalog() {
  const result = await api('/catalog');
  if (!Array.isArray(result.recipes) || !result.recipes.length) throw new Error('Таблиця ще не заповнена.');
  const authoritative = { ...result, calibrationAuthority: 'server', lastSyncedAt: new Date().toISOString() };
  try { localStorage.setItem(CACHE, JSON.stringify(authoritative)); } catch { /* Online use still works. */ }
  return authoritative;
}
export function findRecipe(catalog, cableId, section, color) {
  const rows = catalog.recipes.filter(row => row.cableId === cableId && row.section === Number(section));
  return rows.find(row => row.color === color) ?? rows.find(row => row.color === 'all') ?? null;
}
export async function api(path, { method = 'GET', body, admin = false } = {}) {
  if (!API_URL) throw new Error('Спільне збереження ще підключається.');
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (admin) {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) throw new Error('Відкрийте адмін-панель через Telegram.');
    headers['X-Telegram-Init-Data'] = initData;
  }
  let response;
  try { response = await fetch(API_URL + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000), cache: 'no-store' }); }
  catch { throw new Error('Немає зв’язку. Запис залишився у формі — спробуйте ще раз.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('Сервер не відповів. Спробуйте ще раз.'); }
  if (!response.ok) {
    const error = new Error(result.error || 'Не вдалося виконати дію.');
    error.status = response.status;
    throw error;
  }
  return result;
}
export function csv(catalog) {
  const quote = value => {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const headers = ['Марка', 'Переріз, мм²', 'Колір', 'Режим', ...FIELDS.map(([, label]) => label), 'Джерело', 'Примітки', 'Дата', 'Версія'];
  const rows = catalog.recipes.map(row => [catalog.cables.find(cable => cable.id === (row.optionId ?? row.cableId))?.label ?? CABLES.find(cable => cable.id === row.cableId)?.label, row.section, row.color === 'all' ? 'Усі кольори' : colorName(row.color), { single: 'Тільки №1', dual: '№1 і №2', unknown: 'Не уточнено' }[row.mode], ...FIELDS.map(([key]) => row[key]), row.source, [...(row.notes || []), ...(row.uncertain || [])].join(' | '), row.updatedAt, row.revision]);
  return '\uFEFF' + [headers, ...rows].map(row => row.map(quote).join(';')).join('\r\n');
}
