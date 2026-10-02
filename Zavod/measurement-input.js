import { number } from './core.js?v=21';

const NUMERIC_FIELDS = ['extruder1', 'extruder2', 'sikoraWire', 'sikoraOuter', 'dorn', 'matrix', 'maxSpeed', 'colorLead1', 'colorLead2'];
const LABELS = { extruder1: 'Оберти №1', extruder2: 'Оберти №2', sikoraWire: 'Діаметр жили', sikoraOuter: 'Діаметр з ізоляцією', dorn: 'Дорн', matrix: 'Матриця', maxSpeed: 'Робоча швидкість', colorLead1: 'Зміна кольору №1', colorLead2: 'Зміна кольору №2' };
const fail = message => { throw new Error(message); };

export function parseExtruderInput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { kind: 'empty', value: null };
  const chunks = text.split('/').map(value => value.trim());
  if (chunks.length > 2 || chunks.some(value => !/^\d+(?:[.,]\d+)?$/.test(value))) fail('Введи число або пару №1/№2, наприклад 53,7/72,2.');
  const values = chunks.map(number);
  if (values.some(value => value === null || value > 100000)) fail('Перевір оберти: значення має бути від 0 до 100 000.');
  if (chunks.length === 2) {
    if (values.some(value => value === 0)) fail('Для роботи двох екструдерів обидва числа в парі мають бути більшими за 0. Для вимкненого №2 введи 0 окремо.');
    return { kind: 'pair', values };
  }
  return { kind: values[0] === 0 ? 'off' : 'number', value: values[0] };
}

/** RPM fields determine the working mode; legacy draft metadata cannot override them. */
export function inferMeasurementMode(raw) {
  const parse = value => { try { return parseExtruderInput(value); } catch { return { kind: 'invalid' }; } };
  const first = parse(raw.extruder1), second = parse(raw.extruder2);
  if (second.kind === 'pair' || (first.kind === 'pair' && second.kind === 'empty')) return 'dual';
  if (second.kind === 'number') return 'dual';
  if (second.kind === 'off' || (second.kind === 'empty' && first.kind === 'number')) return 'single';
  return 'unknown';
}

/** Preserve retry IDs across draft versions whose JSON differs only in property or record order. */
export function measurementSignature(raw) {
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : null;
  if (!rows?.length || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) return null;
  return JSON.stringify(rows.map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

/** An explicit conflict refresh creates a new intent, while connection retries keep their IDs. */
export function refreshPendingMeasurements(pending, { revisionFor, createId }) {
  let renewed = 0;
  for (const entry of pending?.entries || []) {
    if (entry.published) continue;
    entry.expectedRevision = revisionFor(entry.mode);
    if (entry.conflict) {
      entry.id = createId(); entry.recorded = false; entry.conflict = false;
      renewed++;
    }
  }
  return renewed;
}

/** Expand shorthand into independent numeric API records, without copying speed or tools to an unmeasured mode. */
export function measurementRecords(raw) {
  const parsed = {};
  for (const key of ['extruder1', 'extruder2']) {
    try { parsed[key] = parseExtruderInput(raw[key]); } catch (error) { fail(`${LABELS[key]}: ${error.message}`); }
  }
  const paired = ['extruder1', 'extruder2'].filter(key => parsed[key].kind === 'pair');
  if (paired.length > 1) fail('Вкажи пару №1/№2 лише в одному полі обертів.');
  const values = { ...raw };
  for (const key of NUMERIC_FIELDS.filter(key => !key.startsWith('extruder'))) {
    const text = String(raw[key] ?? '').trim(), value = number(raw[key]), lead = key.startsWith('colorLead');
    if (text && (value === null || value < 0 || (!lead && value === 0) || value > 100000)) fail(`${LABELS[key]}: введи ${lead ? 'невід’ємне' : 'додатне'} число або залиш поле порожнім.`);
    if (lead && value !== null && !Number.isInteger(value)) fail(`${LABELS[key]}: введи цілі метри.`);
    if (['sikoraWire', 'sikoraOuter', 'dorn', 'matrix'].includes(key) && value > 1000) fail(`${LABELS[key]}: перевір діаметр у міліметрах.`);
    values[key] = value;
  }
  const rpmOnly = mode => ({ baseId: raw.baseId, optionId: raw.optionId, section: raw.section, color: raw.color, note: '', mode, ...Object.fromEntries(NUMERIC_FIELDS.map(key => [key, null])) });
  let records;
  if (paired.length) {
    const key = paired[0], [extruder1, extruder2] = parsed[key].values;
    if (key === 'extruder1' && parsed.extruder2.kind !== 'empty') fail('Пара в полі №1 вже містить оберти обох екструдерів. Залиш поле №2 порожнім або перенеси пару в нього.');
    const dual = { ...values, mode: 'dual', extruder1, extruder2 };
    records = [dual];
    if (key === 'extruder2' && parsed.extruder1.kind === 'number') records.push({ ...rpmOnly('single'), extruder1: parsed.extruder1.value, extruder2: null, colorLead2: null });
  } else {
    if (parsed.extruder1.kind === 'off') fail(parsed.extruder2.kind === 'off' || parsed.extruder2.kind === 'empty'
      ? 'Обидва екструдери вимкнені. Для робочого заміру вкажи оберти №1.'
      : 'Режим тільки з екструдером №2 ще не підтримується. Значення залишилися у формі.');
    const mode = inferMeasurementMode(raw);
    if (!['single', 'dual'].includes(mode)) fail('Вкажи оберти шнека. Для вимкненого екструдера №2 введи 0.');
    records = [{ ...values, mode, extruder1: parsed.extruder1.value, extruder2: mode === 'single' ? null : parsed.extruder2.value, ...(mode === 'single' ? { colorLead2: null } : {}) }];
  }
  // The primary record is inferred from RPM, so old draft modes never change save order.
  return records;
}
