import { number } from './core.js?v=28';
import { drumStatus } from './planner.js?v=28';

export const SHIFT_MINUTES = 12 * 60;
// Starting assumptions, not measured averages. All allowances are editable.
export const SHIFT_DEFAULTS = Object.freeze({ lunch: 60, alarms: 90, breaks: 30, startup: 30, drum: 5, tooling: 20, conductor: 10, color: 8 });
export const CORE_CAPACITIES = Object.freeze({ '2.5:4': 18000, '2.5:3': 18500, '6:3': 8000 });
export const coreClass = value => [1, 2, 3, 4, 5, 6].includes(number(value)) ? number(value) : null;
export const stockKey = item => `${number(item.section)}:${coreClass(item.coreClass) ?? '?'}`;
const thread = item => item.cableId === 'thread-bundle';
const metres = value => Number.isSafeInteger(number(value)) && number(value) > 0 ? number(value) : null;

export function shiftSettings(saved = {}) {
  return Object.fromEntries(Object.entries(SHIFT_DEFAULTS).map(([key, fallback]) => {
    const value = number(saved?.[key]);
    return [key, value !== null && Number.isFinite(value) && value >= 0 && value <= SHIFT_MINUTES ? value : fallback];
  }));
}

/** Pieces use whole metres, so a comma is always a separator, never a decimal. */
export function parseCorePieces(text) {
  const input = String(text ?? '').trim();
  if (!input) return { pieces: [], total: 0, errors: [] };
  const parts = input.split(/[,;\n]/u).map(part => part.trim());
  if (parts.some(part => !/^\d+$/u.test(part) || metres(part) === null) || parts.length > 500) {
    return { pieces: [], total: null, errors: ['Залишки — цілі метри через кому, наприклад 3200, 5400.'] };
  }
  const pieces = parts.map(Number), total = pieces.reduce((sum, length) => sum + length, 0);
  return Number.isSafeInteger(total) ? { pieces, total, errors: [] }
    : { pieces: [], total: null, errors: ['Завеликий сумарний метраж залишків.'] };
}

/** Pool inventory once per section/class, including several jobs and colours. */
export function conductorRequirements(drums, stock = {}) {
  const groups = new Map();
  for (const drum of drums ?? []) {
    if (thread(drum)) continue;
    const key = stockKey(drum);
    if (!groups.has(key)) groups.set(key, { key, section: number(drum.section), coreClass: coreClass(drum.coreClass), totalMetres: 0, remainingMetres: 0, drumCount: 0, errors: [] });
    const group = groups.get(key), length = metres(drum.length);
    group.drumCount++;
    if (length === null) group.errors.push('Перевір довжину барабанів.');
    else { group.totalMetres += length; if (drumStatus(drum) !== 'done') group.remainingMetres += length; }
  }
  return [...groups.values()].map(group => {
    const entry = stock?.[group.key] ?? {}, preset = CORE_CAPACITIES[group.key];
    const fullLengthKm = entry.fullLengthKm === undefined ? preset === undefined ? '' : String(preset / 1000) : String(entry.fullLengthKm);
    const km = number(fullLengthKm), fullMetres = km > 0 && Number.isSafeInteger(Math.round(km * 1000)) && Math.abs(km * 1000 - Math.round(km * 1000)) < 1e-7 ? Math.round(km * 1000) : null;
    const piecesText = String(entry.piecesText ?? ''), parsed = parseCorePieces(piecesText);
    const errors = [...new Set([...group.errors, ...parsed.errors])];
    if (fullLengthKm.trim() && fullMetres === null) errors.push('Довжина повного барабана — додатні кілометри з точністю до метра.');
    // Inventory belongs to the whole task. Checking off output drums must not
    // silently make the same input pieces available a second time.
    const shortage = parsed.total === null ? null : Math.max(0, group.totalMetres - parsed.total);
    const fullDrums = errors.length || shortage === null ? null : shortage === 0 ? 0 : fullMetres === null ? null : Math.ceil(shortage / fullMetres);
    const leftover = fullDrums === null ? null : Math.max(0, fullDrums * (fullMetres ?? 0) + parsed.total - group.totalMetres);
    return { ...group, fullLengthKm, fullMetres, piecesText, pieces: parsed.pieces, piecesMetres: parsed.total, shortage, fullDrums, leftover, errors };
  });
}

export function productionSpeed(info) {
  const reference = number(info?.reference?.workingSpeed);
  if (reference > 0) return { value: reference, source: 'reference' };
  const effective = number(info?.effective?.workingSpeed ?? info?.stages?.working);
  return effective > 0 ? { value: effective, source: info?.sources?.workingSpeed ?? 'forecast' } : { value: null, source: null };
}

/** Sequential forecast: never jump over a slow or unknown drum in the queue. */
export function estimateShift(drums, getSetup, savedSettings) {
  const settings = shiftSettings(savedSettings), pending = (drums ?? []).filter(drum => drumStatus(drum) !== 'done');
  const available = Math.max(0, SHIFT_MINUTES - settings.lunch - settings.alarms - settings.breaks);
  let elapsed = pending.length ? settings.startup : 0, running = 0, setup = elapsed;
  let possibleMetres = 0, completedDrums = 0, partial = null, previous = null, previousInfo = null;
  let blocked = false, fallbackSpeeds = 0;
  const rows = [];
  for (const drum of pending) {
    const info = getSetup(drum), speed = productionSpeed(info), length = metres(drum.length);
    if (length === null || speed.value === null) { blocked = true; break; }
    if (speed.source !== 'reference') fallbackSpeeds++;
    let overhead = settings.drum;
    if (previous) {
      if (previous.cableId !== drum.cableId || number(previous.section) !== number(drum.section) || coreClass(previous.coreClass) !== coreClass(drum.coreClass)) overhead += settings.conductor;
      if (JSON.stringify([previousInfo?.effective?.dorn, previousInfo?.effective?.matrix, previousInfo?.mode]) !== JSON.stringify([info?.effective?.dorn, info?.effective?.matrix, info?.mode])) overhead += settings.tooling;
      if (!thread(previous) && !thread(drum) && previous.color !== drum.color) overhead += settings.color;
    }
    const duration = length / speed.value, start = elapsed + overhead;
    const fit = Math.min(length, Math.floor(Math.max(0, available - start) * speed.value + 1e-7));
    if (!partial && completedDrums === rows.length) {
      possibleMetres += fit;
      if (fit === length) completedDrums++;
      else partial = { drumId: drum.id, metres: fit, length };
    }
    rows.push({ drumId: drum.id, speed: speed.value, source: speed.source, runningMinutes: duration, overhead, end: start + duration });
    elapsed = start + duration; running += duration; setup += overhead;
    previous = drum; previousInfo = info;
  }
  return { settings, available, blocked, fallbackSpeeds, pendingCount: pending.length, rows, runningMinutes: running, setupMinutes: setup,
    requiredMinutes: blocked ? null : elapsed, fits: !blocked && elapsed <= available, possibleMetres, completedDrums, partial,
    minimumShifts: !pending.length ? 0 : !blocked && available > settings.startup ? Math.ceil((elapsed - settings.startup) / (available - settings.startup)) : null };
}

/** Keep shaped and paired tools as reference text; never coerce them to a diameter. */
export function requiredTools(drums, getSetup) {
  const groups = new Map();
  for (const drum of drums ?? []) {
    const info = getSetup(drum), dorn = info?.effective?.dorn ?? null, matrix = info?.effective?.matrix ?? null;
    const key = JSON.stringify([drum.cableId, number(drum.section), coreClass(drum.coreClass), drum.finalDiameter ?? null, dorn, matrix]);
    if (!groups.has(key)) groups.set(key, { key, cableId: drum.cableId, section: number(drum.section), coreClass: coreClass(drum.coreClass), finalDiameter: drum.finalDiameter, dorn, matrix,
      dornSource: info?.sources?.dorn, matrixSource: info?.sources?.matrix, drumCount: 0 });
    groups.get(key).drumCount++;
  }
  return [...groups.values()];
}
