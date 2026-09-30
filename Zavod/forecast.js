import { RECIPES } from './data.js';

// Only these cards are linked to the original practical tables. Other cards need
// their own measurements; matching a brand name does not match its specification.
const FAMILIES = {
  'pvs-380': { mode: 'dual', cables: ['pvs-shvvp'], sources: ['IMG_3843.JPG'] },
  'vvg-066': { mode: 'dual', cables: ['vvg', 'vvgng-p'], sources: ['DRAW_3.JPG'] },
  'vvg-p-066': { mode: 'dual', cables: ['vvgng-p'], sources: ['DRAW_3.JPG'] },
  pv1: { mode: 'single', cables: ['pv1'], sources: ['DRAW_1.JPG'] },
  pv3: { mode: 'single', cables: ['pv3'], sources: ['DRAW_5.JPG'] },
  'h07v-u': { mode: 'single', cables: ['pv1'], sources: ['DRAW_1.JPG'] },
  'ysly-shared': { mode: 'dual', cables: ['ysly', 'h05vv-f'], sources: ['DRAW_4.JPG'] },
};

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const whole = value => Math.round(value + Number.EPSILON * Math.max(1, Math.abs(value)) * 16);
const empty = (mode, reason) => ({ extruder1: null, extruder2: null, workingSpeed: null, mode, method: null, reason, anchors: [], speed1: 20, speed2: null });
const sameCard = (record, card) => record.referenceCardId === card.id || record.cardId === card.id || record.cableId === card.id;
const area = (inner, outer) => positive(inner) && positive(outer) && outer > inner ? Math.PI / 4 * (outer ** 2 - inner ** 2) : null;
const referenceArea = row => area(row.wireNom, row.outerNom);
const practicalArea = (record, row) => area(record.sikoraWire, record.sikoraOuter) ?? referenceArea(row);

function linked(record, card, family, options) {
  if (sameCard(record, card)) return true;
  if (!family || !family.cables.includes(record.cableId)) return false;
  if (card.id === 'ysly-shared') {
    if (options.cableId && record.cableId !== options.cableId) return false;
    if (record.source === 'DRAW_6.JPG') return options.cableId === 'h05vv-f' && record.cableId === 'h05vv-f';
  }
  return family.sources.includes(record.source);
}

function rank(record) {
  return [record.origin === 'measurement' ? 1 : 0, String(record.updatedAt ?? ''), Number(record.revision ?? 0)];
}

function newer(a, b) {
  const first = rank(a), second = rank(b);
  for (let i = 0; i < first.length; i++) {
    if (first[i] !== second[i]) return first[i] > second[i];
  }
  return false;
}

function anchorsFor(card, records, family, mode, options) {
  const sections = new Map();
  for (const record of records) {
    if (!linked(record, card, family, options) || record.mode !== mode) continue;
    // The colour/conditions of the two-extruder PV3 notes were not established.
    if (card.id === 'pv3' && mode === 'dual' && record.origin !== 'measurement') continue;
    if (!positive(record.extruder1) || !positive(record.maxSpeed) || (mode === 'dual' && !positive(record.extruder2))) continue;
    const row = card.rows.find(candidate => candidate.section === record.section);
    if (!row || !positive(row.maxSpeed)) continue;
    const previous = sections.get(record.section);
    // Reused DRAW_3/DRAW_4 rows count once. Multiple values of the same section
    // are not independent calibration sections; prefer the current measurement.
    if (!previous || newer(record, previous.record)) sections.set(record.section, { record, row });
  }
  return [...sections.values()].sort((a, b) => a.record.section - b.record.section);
}

function bracket(anchors, section) {
  if (section < anchors[0].record.section) return { low: anchors[0], high: anchors[0], weight: 0, method: 'extrapolation' };
  if (section > anchors.at(-1).record.section) return { low: anchors.at(-1), high: anchors.at(-1), weight: 0, method: 'extrapolation' };
  const high = anchors.find(anchor => anchor.record.section >= section);
  const low = [...anchors].reverse().find(anchor => anchor.record.section <= section);
  const span = high.record.section - low.record.section;
  return { low, high, weight: span ? (section - low.record.section) / span : 0, method: 'interpolation' };
}

const blend = (a, b, weight) => a + (b - a) * weight;

function rpmAt(cardRow, workingSpeed, anchors, section, key, referenceKey) {
  const reference = positive(cardRow[referenceKey]);
  const usable = anchors.filter(({ record, row }) => reference
    ? positive(row[referenceKey])
    : positive(practicalArea(record, row)));
  if (usable.length < 2 || (!reference && !positive(referenceArea(cardRow)))) return null;
  const { low, high, weight } = bracket(usable, section);
  const coefficient = ({ record, row }) => reference
    ? record[key] / (row[referenceKey] * record.maxSpeed / row.maxSpeed)
    : record[key] / (record.maxSpeed * practicalArea(record, row));
  const factor = blend(coefficient(low), coefficient(high), weight);
  return whole(reference
    ? cardRow[referenceKey] * workingSpeed / cardRow.maxSpeed * factor
    : referenceArea(cardRow) * workingSpeed * factor);
}

/**
 * Automatic estimates, never a machine limit or a verified working recipe.
 * Speed uses the practical/reference speed ratio of the same card and mode.
 * RPM uses the speed-normalised practical/reference RPM ratio where available;
 * otherwise it uses RPM per insulation volume at the recorded working speed.
 * Between sections the coefficient is interpolated. Outside them its nearest
 * endpoint is held constant instead of extending an unbounded linear slope.
 * At least two independent sections are required, even for extrapolation.
 */
export function forecastFor(card, row, practicalRecords = RECIPES, options = {}) {
  if (!card || !row || !positive(row.section)) return empty('unknown', 'Немає довідкового рядка.');
  const family = FAMILIES[card.id];
  const ownModes = [...new Set(practicalRecords.filter(record => sameCard(record, card)).map(record => record.mode).filter(mode => mode === 'single' || mode === 'dual'))];
  const mode = options.mode ?? family?.mode ?? (ownModes.length === 1 ? ownModes[0] : positive(row.rpm2) ? 'dual' : 'unknown');
  if (mode !== 'single' && mode !== 'dual') return empty(mode, 'Потрібно уточнити кількість екструдерів.');
  if (!positive(row.maxSpeed)) return empty(mode, 'Немає однозначної довідкової швидкості.');
  const anchors = anchorsFor(card, practicalRecords, family, mode, options);
  if (anchors.length < 2) return empty(mode, 'Для прогнозу потрібні практичні заміри двох перерізів цієї карти.');
  const selected = bracket(anchors, row.section);
  const ratio = ({ record, row: reference }) => record.maxSpeed / reference.maxSpeed;
  const workingSpeed = whole(row.maxSpeed * blend(ratio(selected.low), ratio(selected.high), selected.weight));
  const extruder1 = rpmAt(row, workingSpeed, anchors, row.section, 'extruder1', 'rpm1');
  const extruder2 = mode === 'dual' ? rpmAt(row, workingSpeed, anchors, row.section, 'extruder2', 'rpm2') : null;
  return {
    extruder1, extruder2, workingSpeed, mode,
    method: selected.method,
    rpmMethod: positive(row.rpm1) ? 'reference-ratio' : 'insulation-volume',
    reason: extruder1 === null || (mode === 'dual' && extruder2 === null) ? 'Швидкість розрахована; для обертів бракує геометрії або довідкових обертів.' : null,
    anchors: anchors.map(({ record }) => ({ section: record.section, source: record.source, extruder1: record.extruder1, extruder2: record.extruder2, workingSpeed: record.maxSpeed })),
    speed1: 20, speed2: Math.round(workingSpeed / 2),
  };
}

export function speedStages(workingSpeed) {
  return { speed1: 20, speed2: positive(workingSpeed) ? Math.round(workingSpeed / 2) : null, workingSpeed: positive(workingSpeed) ? workingSpeed : null };
}
