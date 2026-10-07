import { positive, firstSpeed, secondSpeed } from './core.js?v=25';

export const THREAD_DORN = .95;
export const THREAD_MATRIX_OFFSET = .2;
export const THREAD_DEFAULT_SPEED = 600;
export const THREAD_OPERATOR_ANCHORS = Object.freeze([
  [1.5, 50, 700], [1.7, 63.6, 700], [2.1, 84.8, 600],
].map(([finalDiameter, extruder1, maxSpeed]) => Object.freeze({
  id: `thread-operator-${String(finalDiameter).replace('.', '-')}`, optionId: 'thread-bundle', cableId: 'thread-bundle',
  section: 1, finalDiameter, extruder1, extruder2: null, maxSpeed, mode: 'single', origin: 'measurement',
  operatorAnchor: true, source: null, updatedAt: '2026-10-07T00:00:00Z',
})));

const keys = ['extruder1', 'extruder2', 'workingSpeed', 'dorn', 'matrix', 'sikoraWire', 'sikoraOuter', 'colorLead1', 'colorLead2'];
const emptyValues = () => Object.fromEntries(keys.map(key => [key, null]));
const round = (value, precision = 10) => Math.round((value + Number.EPSILON) * precision) / precision;
const active = record => record.origin === 'measurement' && record.mode === 'single' && !record.deletedAt && !record.withdrawnAt && !record.retired
  && (record.optionId ? record.optionId === 'thread-bundle' : record.cableId === 'thread-bundle');
const latestFirst = (a, b) => Number(Boolean(a.operatorAnchor)) - Number(Boolean(b.operatorAnchor))
  || String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? ''))
  || Number(b.revision ?? 0) - Number(a.revision ?? 0);

export function threadDiameter(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(value.trim())) return null;
  const diameter = positive(value);
  return diameter !== null && diameter <= 1000 ? diameter : null;
}

export function threadRecords(catalog = {}) {
  return [...THREAD_OPERATOR_ANCHORS, ...(catalog.recipes ?? []), ...(catalog.calibrations ?? [])]
    .filter(record => active(record) && threadDiameter(record.finalDiameter) !== null).sort(latestFirst);
}

export function threadDiameters(catalog) {
  return [...new Set(threadRecords(catalog).map(record => threadDiameter(record.finalDiameter)))].sort((a, b) => a - b);
}

function pairedAnchors(records) {
  const byDiameter = new Map();
  for (const record of records) {
    const diameter = threadDiameter(record.finalDiameter);
    if (diameter === null) continue;
    if (!byDiameter.has(diameter)) byDiameter.set(diameter, []);
    byDiameter.get(diameter).push(record);
  }
  // A partial correction updates that diameter's current setting without
  // discarding its earlier valid speed or RPM. Never combine different sizes.
  return [...byDiameter].flatMap(([diameter, rows]) => {
    const rpmRecord = rows.find(record => positive(record.extruder1) !== null);
    const speedRecord = rows.find(record => positive(record.maxSpeed) !== null);
    if (!rpmRecord || !speedRecord) return [];
    const rpm = positive(rpmRecord.extruder1), speed = positive(speedRecord.maxSpeed);
    return [{ diameter, x: diameter ** 2, q: rpm / speed, rpm, speed, record: rpmRecord,
      rpmMeasurementId: rpmRecord.measurementId ?? rpmRecord.id, speedMeasurementId: speedRecord.measurementId ?? speedRecord.id }];
  }).sort((a, b) => a.diameter - b.diameter);
}

// Isotonic blocks affect estimates only. Contradictory practical settings stay
// exactly as entered, while the estimated load curve remains nondecreasing.
function monotoneCurve(anchors) {
  const blocks = [];
  anchors.forEach((anchor, index) => {
    blocks.push({ from: index, to: index, total: anchor.q, count: 1 });
    while (blocks.length > 1 && blocks.at(-2).total / blocks.at(-2).count > blocks.at(-1).total / blocks.at(-1).count) {
      const last = blocks.pop(), previous = blocks.pop();
      blocks.push({ from: previous.from, to: last.to, total: previous.total + last.total, count: previous.count + last.count });
    }
  });
  return anchors.map((anchor, index) => {
    const block = blocks.find(block => index >= block.from && index <= block.to);
    return { ...anchor, q: block.total / block.count };
  });
}

function estimateLoad(anchors, diameter) {
  if (!anchors.length || diameter === null) return null;
  const curve = monotoneCurve(anchors), x = diameter ** 2;
  const exact = curve.find(anchor => anchor.diameter === diameter);
  if (exact) return { q: exact.q, used: [exact], method: 'thread-normalized-measurement' };
  const low = [...curve].reverse().find(anchor => anchor.x <= x), high = curve.find(anchor => anchor.x >= x);
  if (low && high) return { q: low.q + (high.q - low.q) * (x - low.x) / (high.x - low.x),
    used: [low, high], method: 'thread-area-interpolation' };
  const edge = low ?? high;
  const neighbour = low ? curve.at(-2) : curve[1];
  // Beyond the observed range, limit the endpoint slope to a positive area
  // response. Three examples do not establish a universal extrusion law.
  const observedSlope = neighbour ? (edge.q - neighbour.q) / (edge.x - neighbour.x) : edge.q / edge.x;
  const slope = Math.max(0, Math.min(edge.q / edge.x, observedSlope));
  return { q: Math.max(Number.EPSILON, edge.q + slope * (x - edge.x)), used: neighbour ? [edge, neighbour] : [edge],
    method: 'thread-area-extrapolation' };
}

export function threadSettings(finalDiameter, catalog = {}) {
  const diameter = threadDiameter(finalDiameter), records = threadRecords(catalog), anchors = pairedAnchors(records);
  const exactRecords = diameter === null ? [] : records.filter(record => threadDiameter(record.finalDiameter) === diameter);
  const rpmRecord = exactRecords.find(record => positive(record.extruder1) !== null);
  const speedRecord = exactRecords.find(record => positive(record.maxSpeed) !== null);
  const workingSpeed = speedRecord ? positive(speedRecord.maxSpeed) : THREAD_DEFAULT_SPEED;
  const estimated = estimateLoad(anchors, diameter);
  const extruder1 = rpmRecord ? positive(rpmRecord.extruder1) : estimated ? round(estimated.q * workingSpeed) : null;
  return {
    mode: 'single', noDye: true, finalDiameter: diameter, dorn: THREAD_DORN,
    matrix: diameter === null ? null : round(diameter + THREAD_MATRIX_OFFSET, 1000),
    extruder1, extruder2: null, workingSpeed, sikoraWire: null, sikoraOuter: null, colorLead1: null, colorLead2: null,
    rpmWorkingSpeed: extruder1 === null || rpmRecord && !speedRecord ? null : workingSpeed,
    sources: { extruder1: rpmRecord ? 'practical' : extruder1 === null ? null : 'forecast', extruder2: null,
      workingSpeed: speedRecord ? 'practical' : 'rule', dorn: 'rule', matrix: diameter === null ? null : 'rule',
      sikoraWire: null, sikoraOuter: null, colorLead1: null, colorLead2: null },
    fieldMethods: { extruder1: rpmRecord ? 'measured-value' : estimated?.method ?? null, workingSpeed: speedRecord ? 'measured-value' : 'operator-default',
      dorn: 'operator-fixed-dorn', matrix: diameter === null ? null : 'operator-matrix-offset' },
    fieldConfidence: { extruder1: rpmRecord ? 'high' : 'low', workingSpeed: speedRecord ? 'high' : 'low', dorn: 'high', matrix: 'high' },
    confidence: rpmRecord && speedRecord ? 'high' : 'low',
    reason: diameter === null ? 'Вкажи фінальний діаметр із завдання.' : rpmRecord && !speedRecord
      ? 'Практичні оберти записано без швидкості; робоча швидкість поки за початковим налаштуванням.' : rpmRecord ? null
      : 'Орієнтовно: оберти розраховано за практичними замірами джгутів. Уточни їх на лінії.',
    anchors: anchors.map(anchor => ({ finalDiameter: anchor.diameter, extruder1: anchor.rpm, workingSpeed: anchor.speed,
      source: anchor.record.source, measurementId: anchor.rpmMeasurementId, speedMeasurementId: anchor.speedMeasurementId,
      operatorAnchor: Boolean(anchor.record.operatorAnchor) })),
    usedAnchors: estimated?.used.map(anchor => anchor.diameter) ?? [],
    knownMaxSpeed: Math.max(THREAD_DEFAULT_SPEED, ...anchors.map(anchor => anchor.speed)),
    rpmRecord, speedRecord,
  };
}

export function threadSetup({ option, card, row, base, stored, catalog, color, finalDiameter }) {
  const settings = threadSettings(finalDiameter, catalog);
  const effective = Object.fromEntries(keys.map(key => [key, settings[key]]));
  const practical = emptyValues(), reference = emptyValues(), forecast = emptyValues();
  for (const key of keys) {
    if (settings.sources[key] === 'practical') practical[key] = settings[key];
    if (settings.sources[key] === 'forecast') forecast[key] = settings[key];
  }
  Object.assign(forecast, { mode: 'single', noDye: true, finalDiameter: settings.finalDiameter, method: settings.fieldMethods.extruder1,
    rpmMethod: settings.fieldMethods.extruder1, fieldMethods: settings.fieldMethods, fieldConfidence: settings.fieldConfidence,
    confidence: settings.confidence, reason: settings.reason, anchors: settings.anchors, borrowedFrom: [], fieldAnchors: {},
    rpmWorkingSpeed: settings.rpmWorkingSpeed, rpmSpeedBasis: { extruder1: settings.rpmWorkingSpeed }, knownMaxSpeed: settings.knownMaxSpeed });
  return {
    option, card, row, base, mode: 'single', normalMode: 'single', noDye: true, color,
    finalDiameter: settings.finalDiameter, knownMaxSpeed: settings.knownMaxSpeed,
    rpmWorkingSpeed: settings.rpmWorkingSpeed, rpmSpeedBasis: { extruder1: settings.rpmWorkingSpeed },
    stored: { ...base, ...stored, baseId: base.id, optionId: option.id, mode: 'single', color: 'all', finalDiameter: settings.finalDiameter,
      origin: settings.rpmRecord || settings.speedRecord ? 'measurement' : stored?.origin ?? 'handwritten',
      extruder1: practical.extruder1, extruder2: null, maxSpeed: practical.workingSpeed ?? THREAD_DEFAULT_SPEED,
      dorn: THREAD_DORN, matrix: effective.matrix, sikoraWire: null, sikoraOuter: null, colorLead1: null, colorLead2: null, noDye: true },
    practical, practicalSources: [], reference, forecast, effective, sources: settings.sources, rpmConflict: null,
    stages: { first: firstSpeed(settings.workingSpeed), second: secondSpeed(settings.workingSpeed), working: settings.workingSpeed, source: settings.sources.workingSpeed },
  };
}
