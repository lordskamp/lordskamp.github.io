import { RECIPES } from './data.js';
import { DEFAULT_RULES, firstSpeed, secondSpeed } from './core.js?v=27';
import { CATALOG_OPTIONS } from './catalog-options.js?v=27';
import { ALL_CARDS, SOURCE_ANNOTATIONS } from './reference-data.js?v=27';
import { operatingRecords } from './pv3-modes.js?v=27';
import { estimateColorLead2 } from './color-lead.js?v=27';

const HANDWRITTEN = {
  'pvs-380': ['pvs-shvvp'], 'vvg-066': ['vvg'], 'vvg-p-066': ['vvgng-p'],
  pv1: ['pv1'], pv3: ['pv3'], 'h07v-u': ['pv1'], 'ysly-shared': ['ysly', 'h05vv-f'],
};
const SHARED_OPTIONS = [['pv1--pv1', 'h07v-u--h07v-u']];
const FIELDS = ['extruder1', 'extruder2', 'workingSpeed', 'dorn', 'matrix', 'sikoraWire', 'sikoraOuter', 'colorLead1', 'colorLead2'];
const GEOMETRY = ['sikoraWire', 'sikoraOuter', 'dorn', 'matrix'];
const NOMINAL = { sikoraWire: 'wireNom', sikoraOuter: 'outerNom', dorn: 'dorn', matrix: 'matrix' };
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const valid = (key, value) => typeof value === 'number' && Number.isFinite(value) && (key.startsWith('colorLead') ? value >= 0 : value > 0);
const valueFor = (record, key) => record[key === 'workingSpeed' ? 'maxSpeed' : key];
const optionById = id => CATALOG_OPTIONS.find(option => option.id === id);
const cardById = id => ALL_CARDS.find(card => card.id === id);
const defaultOption = card => CATALOG_OPTIONS.find(option => option.cardId === card.id && option.practicalCableId === HANDWRITTEN[card.id]?.[0])
  ?? CATALOG_OPTIONS.find(option => option.cardId === card.id && option.brand.toLowerCase() === card.id)
  ?? CATALOG_OPTIONS.find(option => option.cardId === card.id);
const sameCard = (record, card) => record.referenceCardId === card.id || record.cardId === card.id || record.cableId === card.id;
const flat = card => card?.id === 'speaker';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const median = values => {
  const sorted = values.filter(value => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
};
const round = (value, key) => {
  const precision = ['extruder1', 'extruder2'].includes(key) ? 10 : ['workingSpeed', 'colorLead1', 'colorLead2'].includes(key) ? 1 : 100;
  return Math.round((value + Number.EPSILON) * precision) / precision;
};
const area = (wire, outer) => positive(wire) && positive(outer) && outer > wire ? Math.PI * (outer ** 2 - wire ** 2) / 4 : null;
const timestamp = record => String(record.createdAt ?? record.updatedAt ?? '');

function newer(a, b) {
  return Number(a.origin === 'measurement') > Number(b.origin === 'measurement')
    || a.origin === b.origin && (timestamp(a) > timestamp(b)
      || timestamp(a) === timestamp(b) && Number(a.revision ?? 0) > Number(b.revision ?? 0));
}

// The most recent nonempty value wins independently for each section and field.
// Colour is deliberately absent: calibration is specific to the extruder mode.
function fieldAnchors(records, key) {
  const sections = new Map();
  for (const record of records) {
    if (!positive(record.section) || !valid(key, valueFor(record, key))) continue;
    const previous = sections.get(record.section);
    if (!previous || newer(record, previous)) sections.set(record.section, record);
  }
  return [...sections.values()].sort((a, b) => a.section - b.section);
}

function interpolate(anchors, section, key) {
  const exact = anchors.find(record => record.section === section);
  if (exact) return { value: valueFor(exact, key), used: [exact], method: 'measured-value', confidence: 'high' };
  if (anchors.length < 2 || section < anchors[0].section || section > anchors.at(-1).section) return null;
  const low = [...anchors].reverse().find(record => record.section <= section);
  const high = anchors.find(record => record.section >= section);
  const weight = (section - low.section) / (high.section - low.section);
  return { value: valueFor(low, key) + (valueFor(high, key) - valueFor(low, key)) * weight,
    used: [low, high], method: 'interpolation', confidence: 'medium' };
}

function recordOption(record) {
  return optionById(record.optionId ?? record.cableId)
    ?? CATALOG_OPTIONS.find(option => option.practicalCableId === record.cableId)
    ?? CATALOG_OPTIONS.find(option => option.cardId === (record.referenceCardId ?? record.cardId ?? record.cableId));
}

function recordCard(record) { return cardById(recordOption(record)?.cardId); }

function similarity(target, source) {
  if (!source) return 0;
  if ((target.coreKind ?? 'metal') !== (source.coreKind ?? 'metal')) return 0;
  if (flat(source)) return flat(target) ? 1.5 : 0;
  if (target.id === source.id) return 1.5;
  // The class/shape are documented in the manufacturer cards. ПВ3 has class
  // 3/4, not the class-5 identity of H07V-K; it is a weaker fallback only.
  const a = target.conductorClass ?? (target.id === 'pv3' ? 3.5 : null);
  const b = source.conductorClass ?? (source.id === 'pv3' ? 3.5 : null);
  if (a === b && a !== null) return 1;
  if ([1, 2].includes(a) && [1, 2].includes(b)) return .65;
  if (a >= 3 && b >= 3) return .35;
  return .15;
}

function speakerRecords() {
  return SOURCE_ANNOTATIONS.filter(annotation => annotation[1] === 'Speaker cable' && annotation[3].startsWith('Шнек'))
    .map(annotation => {
      const [extruder1, extruder2] = String(annotation[4]).split('/').map(Number);
      return { id: `speaker-handwritten-${annotation[2]}`, cableId: 'speaker', section: annotation[2], mode: 'dual',
        source: annotation[0], extruder1, extruder2 };
    });
}

function groupsFor(records, target, own) {
  const groups = new Map();
  for (const record of records.filter(record => !own(record))) {
    const sourceCard = recordCard(record), weight = similarity(target, sourceCard);
    if (!weight) continue;
    // DRAW_4 is transcribed under both YSLY and H05VV-F. It is one family curve,
    // not two independent votes. The same applies to the copied VVG recipe.
    const family = record.origin === 'measurement' ? record.optionId ?? record.cableId
      : sourceCard.id === 'vvg-p-066' ? 'vvg-066' : sourceCard.id;
    const id = `${family}:${record.mode}`;
    if (!groups.has(id)) groups.set(id, { records: [], card: sourceCard, weight, brand: recordOption(record)?.brand ?? sourceCard.label });
    groups.get(id).records.push(record);
  }
  return [...groups.values()];
}

function closestGroups(groups, key) {
  const usable = groups.filter(group => fieldAnchors(group.records, key).length);
  const best = Math.max(0, ...usable.map(group => group.weight));
  const compatible = usable.filter(group => group.weight >= best * .8);
  // Recent admin measurements calibrate the current line better than a mixture
  // of older handwritten settings. Prefer them among equally compatible
  // families; a physically closer family still wins over a distant donor.
  const measured = compatible.filter(group => group.records.some(record => record.origin === 'measurement' && valid(key, valueFor(record, key))));
  return measured.length ? measured : compatible;
}

function measuredCurve(records, key) {
  const families = new Map();
  for (const record of records) {
    if (record.origin !== 'measurement' || !positive(record.section) || !valid(key, valueFor(record, key))) continue;
    const id = record.optionId ?? record.cableId;
    if (!families.has(id)) families.set(id, new Set());
    families.get(id).add(record.section);
  }
  return [...families.values()].some(sections => sections.size >= 2);
}

function mergedSection(records, section) {
  const result = {};
  for (const key of FIELDS) result[key] = valueFor(fieldAnchors(records, key).find(record => record.section === section) ?? {}, key);
  return result;
}

function measuredGeometry(records, record) {
  const merged = mergedSection(records, record.section), sourceRow = recordCard(record)?.rows.find(row => row.section === record.section);
  const matrix = positive(merged.matrix) ? merged.matrix : sourceRow?.matrix;
  const inferredOuter = positive(matrix) ? matrix + allowanceEstimate().value : sourceRow?.outerNom;
  return { wire: positive(merged.sikoraWire) ? merged.sikoraWire : sourceRow?.wireNom,
    outer: positive(merged.sikoraOuter) ? merged.sikoraOuter : inferredOuter };
}

function regression(points) {
  const usable = points.filter(([x, y]) => positive(x) && positive(y)).map(([x, y]) => [Math.log(x), Math.log(y)]);
  if (usable.length < 2) return null;
  const xMean = usable.reduce((sum, [x]) => sum + x, 0) / usable.length;
  const yMean = usable.reduce((sum, [, y]) => sum + y, 0) / usable.length;
  const variance = usable.reduce((sum, [x]) => sum + (x - xMean) ** 2, 0);
  return variance > 1e-9 ? usable.reduce((sum, [x, y]) => sum + (x - xMean) * (y - yMean), 0) / variance : null;
}

function nearest(anchors, section) {
  return [...anchors].sort((a, b) => Math.abs(Math.log(a.section / section)) - Math.abs(Math.log(b.section / section)))[0];
}

function geometryEstimate(key, ownAnchors, related, ownRecords, card, row, estimated) {
  const direct = interpolate(ownAnchors, row.section, key);
  if (direct?.method === 'measured-value') return direct;
  if (direct) {
    if (direct.used.every(record => valueFor(record, key) === valueFor(direct.used[0], key))) return direct;
    const nominal = NOMINAL[key];
    const residuals = direct.used.map(record => {
      const sourceRow = card.rows.find(candidate => candidate.section === record.section);
      return positive(sourceRow?.[nominal]) ? { ...record, [key]: valueFor(record, key) - sourceRow[nominal] } : null;
    });
    if (positive(row[nominal]) && residuals.every(Boolean)) {
      // Diameter and tooling follow the cable construction, not a straight
      // line in conductor area. Interpolate measured deviations from the
      // nominal construction curve instead of flattening its real geometry.
      const [low, high] = residuals, weight = (row.section - low.section) / (high.section - low.section);
      const value = row[nominal] + low[key] + (high[key] - low[key]) * weight;
      if (positive(value)) return { ...direct, value, method: 'nominal-residual-interpolation' };
    }
    return direct;
  }
  if (flat(card) && key !== 'sikoraWire') return null; // Paired tools are text, never circular diameters.
  const donorGroups = ownAnchors.length ? [{ records: ownRecords }] : closestGroups(related, key);
  const anchors = ownAnchors.length ? ownAnchors : donorGroups.flatMap(group => fieldAnchors(group.records, key));
  const offsets = anchors.map(record => {
    const sourceRow = (ownAnchors.length ? card : recordCard(record))?.rows.find(candidate => candidate.section === record.section);
    return positive(sourceRow?.[NOMINAL[key]]) ? valueFor(record, key) - sourceRow[NOMINAL[key]] : null;
  }).filter(value => value !== null);
  let value = positive(row[NOMINAL[key]]) ? row[NOMINAL[key]] + (median(offsets) ?? 0) : null;
  if (!positive(value) && key === 'sikoraWire') {
    const ratios = anchors.map(record => valueFor(record, key) / Math.sqrt(record.section));
    value = median(ratios) * Math.sqrt(row.section);
  }
  if (!positive(value)) {
    const samplesFor = records => [...new Set(records.map(record => record.section))].map(section => mergedSection(records, section));
    const ownSamples = samplesFor(ownRecords);
    const relatedSamples = closestGroups(related, key).flatMap(group => samplesFor(group.records));
    const usable = sample => key === 'sikoraOuter' ? positive(sample.sikoraWire) && sample.sikoraOuter > sample.sikoraWire
      : key === 'dorn' ? positive(sample.dorn) && positive(sample.sikoraWire) : positive(sample.matrix) && positive(sample.sikoraOuter);
    const samples = ownSamples.some(usable) ? ownSamples : relatedSamples;
    if (key === 'sikoraOuter') {
      const thickness = positive(row.thicknessNom) ? row.thicknessNom : median(samples.filter(usable)
        .map(sample => (sample.sikoraOuter - sample.sikoraWire) / 2));
      if (positive(thickness)) value = estimated.sikoraWire + 2 * thickness;
    } else if (key === 'dorn') {
      const clearance = median(samples.filter(usable).map(sample => sample.dorn - sample.sikoraWire));
      if (clearance !== null) value = estimated.sikoraWire + clearance;
    } else if (key === 'matrix') {
      const clearance = median(samples.filter(usable).map(sample => sample.matrix - sample.sikoraOuter));
      if (clearance !== null) value = estimated.sikoraOuter + clearance;
    }
  }
  return positive(value) ? { value, used: anchors, groups: ownAnchors.length ? [] : donorGroups,
    method: ownAnchors.length ? 'geometry-calibrated' : offsets.length ? 'related-geometry' : 'nominal-geometry', confidence: 'low' } : null;
}

// Only actual numeric tooling/diameter pairs establish the die allowance.
// Printed cable diameters are nominal construction dimensions, not SIKORA
// targets, and must never contribute an outer-minus-matrix training sample.

function allowanceEstimate() {
  return { value: 0.15, used: [], method: 'matrix-operator-allowance', confidence: 'low' };
}

function speedSlope(records) {
  return regression(fieldAnchors(records, 'workingSpeed').map(record => {
    const geometry = measuredGeometry(records, record);
    return [area(geometry.wire, geometry.outer), record.maxSpeed];
  }));
}

function speedEstimate(ownAnchors, ownRecords, related, row, targetArea) {
  const direct = interpolate(ownAnchors, row.section, 'workingSpeed');
  if (direct) return direct;
  const donorGroups = closestGroups(related, 'workingSpeed');
  let slope = speedSlope(ownRecords);
  // A pair at the same printing limit says nothing about throughput at a larger
  // section. Borrow the load response, keeping the operator's own speed level.
  if (slope === null || slope > -.05) slope = median(donorGroups.map(group => speedSlope(group.records)).filter(value => value !== null && value < 0));
  if (slope === null) slope = 0;
  slope = clamp(slope, -1.25, 0);
  const anchors = ownAnchors.length ? ownAnchors : donorGroups.flatMap(group => fieldAnchors(group.records, 'workingSpeed'));
  const projected = anchors.map(record => {
    const geometry = measuredGeometry(ownAnchors.length ? ownRecords : donorGroups.find(group => group.records.includes(record)).records, record);
    const baseArea = area(geometry.wire, geometry.outer);
    const ratio = positive(targetArea) && positive(baseArea) ? targetArea / baseArea : row.section / record.section;
    return record.maxSpeed * clamp(ratio ** slope, .15, 3);
  });
  const anchor = nearest(ownAnchors, row.section);
  const value = anchor ? projected[anchors.indexOf(anchor)] : median(projected);
  return positive(value) ? { value, used: anchors, groups: donorGroups,
    method: ownAnchors.length ? 'load-extrapolation' : 'related-load', confidence: 'low' } : null;
}

function empiricalTrend(anchors, section, key) {
  if (!anchors.length) return null;
  const anchor = nearest(anchors, section);
  if (anchors.length === 1) return valueFor(anchor, key);
  const pair = section < anchors[0].section ? anchors.slice(0, 2) : anchors.slice(-2);
  const slope = (valueFor(pair[1], key) - valueFor(pair[0], key)) / (pair[1].section - pair[0].section);
  const projected = valueFor(anchor, key) + slope * (section - anchor.section);
  // The secondary dye extruder is an empirical machine setting. A bounded
  // measured trend is preferable to imposing the main extruder's flow law.
  return clamp(projected, valueFor(anchor, key) / 2, valueFor(anchor, key) * 2);
}

function normalizedRpmInterpolation(anchors, records, section, key, targetSpeed, targetArea) {
  const direct = interpolate(anchors, section, key);
  if (!direct || direct.method === 'measured-value' || !positive(targetSpeed)) return direct;
  const normalized = direct.used.map(record => {
    const speed = mergedSection(records, record.section).workingSpeed;
    return positive(speed) ? { ...record, [key]: valueFor(record, key) / speed } : null;
  });
  if (normalized.some(record => !record)) return direct;
  // RPM at 300 m/min and at 120 m/min are not comparable loads. Interpolate
  // the measured RPM per metre first, then use one common target line speed.
  const loads = normalized.map(record => {
    const geometry = measuredGeometry(records, record);
    return area(geometry.wire, geometry.outer);
  });
  const useArea = positive(targetArea) && loads.every(positive) && loads[1] > loads[0];
  const areaWeight = useArea ? (targetArea - loads[0]) / (loads[1] - loads[0]) : null;
  const weight = useArea ? clamp(areaWeight, 0, 1) : (section - normalized[0].section) / (normalized[1].section - normalized[0].section);
  const value = normalized[0][key] + (normalized[1][key] - normalized[0][key]) * weight;
  return { ...direct, value: value * targetSpeed,
    method: 'speed-normalized-interpolation', speedBasisKnown: true,
    confidence: 'low' };
}

function balanceAnchors(records) {
  return fieldAnchors(records, 'extruder2').flatMap(record => {
    const first = mergedSection(records, record.section).extruder1;
    return positive(first) ? [{ ...record, balance: record.extruder2 / first }] : [];
  });
}

function pairedRpmEstimate(ownRecords, related, section, targetFirst, speedBasisKnown) {
  if (!positive(targetFirst)) return null;
  const own = balanceAnchors(ownRecords);
  const donors = closestGroups(related.filter(group => balanceAnchors(group.records).length), 'extruder2');
  const groups = own.length ? [{ records: ownRecords }] : donors;
  const estimates = groups.map(group => {
    const anchors = balanceAnchors(group.records), direct = interpolate(anchors, section, 'balance');
    // Outside the observed range we know the paired machine balance, but not
    // its future slope. A robust observed ratio avoids inventing a new speed
    // basis for a raw secondary-extruder RPM-versus-section extrapolation.
    return { value: direct?.value ?? median(anchors.map(record => record.balance)), used: direct?.used ?? anchors,
      interior: direct?.method === 'interpolation' };
  });
  const ratio = median(estimates.map(estimate => estimate.value));
  return positive(ratio) ? { value: targetFirst * ratio, used: estimates.flatMap(estimate => estimate.used),
    groups: own.length ? [] : donors, speedBasisKnown,
    method: own.length && estimates.every(estimate => estimate.interior) ? 'paired-balance-interpolation' : 'paired-balance',
    confidence: 'low' } : null;
}

// Compare two existing secondary-extruder predictors only on same-mode
// paired measurements. Each validation point is hidden from its predictor.
function pairedBeatsNearest(records) {
  const pairs = balanceAnchors(records).filter(record => positive(mergedSection(records, record.section).workingSpeed));
  if (pairs.length < 2) return false;
  let pairedError = 0, nearestError = 0;
  for (const sample of pairs) {
    const rest = pairs.filter(other => other.section !== sample.section);
    if (!rest.length) return false;
    const closest = nearest(rest, sample.section);
    const ratio = median(rest.map(record => record.balance));
    const actual = sample.extruder2;
    const speed = mergedSection(records, sample.section).workingSpeed;
    const otherSpeed = mergedSection(records, closest.section).workingSpeed;
    const first = mergedSection(records, sample.section).extruder1;
    pairedError += Math.abs(first * ratio - actual) / actual;
    nearestError += Math.abs(closest.extruder2 * speed / otherSpeed - actual) / actual;
  }
  // Require a clear improvement; two measurements cannot establish high confidence.
  return pairedError < nearestError * 0.8;
}

function nearestSecondaryLoad(ownRecords, related, section, targetSpeed) {
  if (!positive(targetSpeed)) return null;
  const ownRpm = fieldAnchors(ownRecords, 'extruder2');
  const own = ownRpm.filter(record => positive(mergedSection(ownRecords, record.section).workingSpeed));
  if (ownRpm.length && !own.length) return null;
  const donors = closestGroups(related.filter(group => fieldAnchors(group.records, 'extruder2')
    .some(record => positive(mergedSection(group.records, record.section).workingSpeed))), 'extruder2');
  const groups = own.length ? [{ records: ownRecords }] : donors;
  const estimates = groups.map(group => {
    const anchor = nearest(fieldAnchors(group.records, 'extruder2')
      .filter(record => positive(mergedSection(group.records, record.section).workingSpeed)), section);
    return { value: anchor.extruder2 / mergedSection(group.records, anchor.section).workingSpeed * targetSpeed, used: [anchor] };
  });
  const value = median(estimates.map(estimate => estimate.value));
  return positive(value) ? { value, used: estimates.flatMap(estimate => estimate.used), groups: own.length ? [] : donors,
    speedBasisKnown: true, method: 'nearest-secondary-load', confidence: 'low' } : null;
}

function rpmEstimate(key, ownAnchors, ownRecords, related, row, targetArea, targetSpeed, targetFirst, firstSpeedBasisKnown, firstMeasured) {
  const direct = interpolate(ownAnchors, row.section, key);
  if (direct?.method === 'measured-value') return direct;
  const pairs = key === 'extruder2' ? balanceAnchors(ownRecords) : [];
  const fixedBalance = pairs.length > 1 && pairs.every(record => Math.abs(record.balance - pairs[0].balance) < 1e-9);
  if (key === 'extruder2' && direct && !firstMeasured && !fixedBalance) {
    // Within a recorded secondary-extruder curve its own measured load is
    // stronger evidence than a ratio to a separately estimated first RPM.
    return normalizedRpmInterpolation(ownAnchors, ownRecords, row.section, key, targetSpeed, null);
  }
  if (key === 'extruder2') {
    // Thin-core dosing below the observed range has no established downward
    // response. Keep the nearest measured secondary RPM per metre rather than
    // extending a foreign balance or flow curve into unsupported small loads.
    if (ownAnchors.length && row.section < ownAnchors[0].section || !ownAnchors.length && !closestGroups(related, key)
      .some(group => balanceAnchors(group.records).some(record => record.section <= row.section))) {
      const nearestLoad = nearestSecondaryLoad(ownRecords, related, row.section, targetSpeed);
      if (firstSpeedBasisKnown && nearestLoad && pairedBeatsNearest(ownRecords)) {
        const paired = pairedRpmEstimate(ownRecords, [], row.section, targetFirst, firstSpeedBasisKnown);
        if (paired) return { value: (paired.value + nearestLoad.value) / 2, used: [...paired.used, ...nearestLoad.used],
          groups: [], speedBasisKnown: true, method: 'validated-secondary-blend', confidence: 'low' };
      }
      if (nearestLoad) return nearestLoad;
    }
    if (!ownAnchors.length || pairs.length) {
      const covered = ownAnchors.length ? related : related.filter(group => balanceAnchors(group.records).some(record => record.section <= row.section));
      const paired = pairedRpmEstimate(ownRecords, covered, row.section, targetFirst, firstSpeedBasisKnown);
      if (paired) return paired;
    }
  }
  if (direct) return normalizedRpmInterpolation(ownAnchors, ownRecords, row.section, key, targetSpeed, targetArea);
  const donorGroups = closestGroups(related, key);
  if (ownAnchors.length && key === 'extruder2') return { value: empiricalTrend(ownAnchors, row.section, key), used: ownAnchors,
    speedBasisKnown: false,
    method: 'empirical-extrapolation', confidence: 'low' };
  const groups = ownAnchors.length ? [{ records: ownRecords, own: true }] : donorGroups;
  const estimates = [], used = [], speedBases = [];
  for (const group of groups) {
    const anchors = fieldAnchors(group.records, key);
    if (flat(group.card)) {
      estimates.push(interpolate(anchors, row.section, key)?.value ?? empiricalTrend(anchors, row.section, key));
      used.push(...anchors); speedBases.push(false); continue;
    }
    const samples = anchors.map(record => {
      const geometry = measuredGeometry(group.records, record), sample = mergedSection(group.records, record.section);
      return { record, area: area(geometry.wire, geometry.outer), speed: sample.workingSpeed, rpm: valueFor(record, key) };
    }).filter(sample => positive(sample.area) && positive(sample.speed));
    if (positive(targetArea) && positive(targetSpeed) && samples.length) {
      if (key === 'extruder1') {
        estimates.push(median(samples.map(sample => sample.rpm / (sample.area * sample.speed))) * targetArea * targetSpeed);
      } else {
        const exponent = clamp(regression(samples.map(sample => [sample.area, sample.rpm / sample.speed])) ?? 0, 0, 1.5);
        estimates.push(median(samples.map(sample => sample.rpm / (sample.speed * sample.area ** exponent))) * targetSpeed * targetArea ** exponent);
      }
      used.push(...samples.map(sample => sample.record));
      speedBases.push(true);
    } else if (anchors.length) {
      estimates.push(empiricalTrend(anchors, row.section, key)); used.push(...anchors); speedBases.push(false);
    }
  }
  const value = median(estimates);
  const speedBasisKnown = speedBases.length > 0 && speedBases.every(Boolean);
  return positive(value) ? { value, used, groups: ownAnchors.length ? [] : donorGroups,
    speedBasisKnown, method: key === 'extruder1' && speedBasisKnown ? 'annular-flow' : ownAnchors.length ? 'empirical-extrapolation' : 'related-empirical', confidence: 'low' } : null;
}

function empty(mode, reason) {
  return { ...Object.fromEntries(FIELDS.map(key => [key, null])), mode, method: null, rpmMethod: null, reason,
    confidence: 'low', fieldMethods: {}, fieldConfidence: {}, anchors: [], fieldAnchors: {}, borrowedFrom: [], speed1: null, speed2: null };
}

// A thread recipe has no cross-section feature or compatible metallic donor.
// Only the operator's own, mode-matched values may establish its settings.
function threadForecast(records, row, mode) {
  const result = empty(mode, 'Додайте практичний замір для джгутів.');
  const used = new Map();
  for (const key of FIELDS) {
    const geometry = GEOMETRY.includes(key);
    if (key === 'extruder2' && mode === 'single') continue;
    const candidates = records.filter(record => record.origin === 'measurement'
      && (record.mode === mode && (geometry || ['single', 'dual'].includes(mode)) || geometry && record.mode === 'unknown'));
    const record = fieldAnchors(candidates, key).find(record => record.section === row.section);
    if (!record) continue;
    result[key] = valueFor(record, key);
    result.fieldMethods[key] = 'measured-value'; result.fieldConfidence[key] = 'high';
    result.fieldAnchors[key] = [{ section: record.section, value: valueFor(record, key), source: record.source,
      optionId: record.optionId ?? null, measurementId: record.measurementId ?? record.id }];
    used.set(record.measurementId ?? record.id, record);
  }
  if (used.size) {
    result.method = 'interpolation'; result.rpmMethod = 'measured-values';
    result.confidence = 'high'; result.reason = null;
    result.anchors = [...used.values()].map(record => ({ section: record.section, source: record.source,
      optionId: record.optionId ?? null, extruder1: record.extruder1, extruder2: record.extruder2, workingSpeed: record.maxSpeed }));
  }
  result.speed1 = firstSpeed(result.workingSpeed); result.speed2 = secondSpeed(result.workingSpeed);
  return result;
}

/**
 * Actual numeric measurements are the only operating training data. Interior
 * values interpolate per field; outside the measured range, main RPM follows
 * measured annular flow and speed follows a compatible family's load curve.
 * Nominal geometry is a feature calibrated by actual measured offsets, never
 * a source of printed RPM/speed. Every borrowed/extrapolated value is labelled.
 */
export function forecastFor(card, row, practicalRecords = RECIPES, options = {}) {
  if (!card || !row || !positive(row.section)) return empty('unknown', 'Немає вибраного перерізу.');
  const option = optionById(options.optionId) ?? defaultOption(card), optionId = option?.id;
  const legacy = options.cableId ?? option?.practicalCableId;
  const records = operatingRecords([...(options.baselineRecords ?? RECIPES), ...speakerRecords(), ...practicalRecords])
    .filter(record => !record.deletedAt && !record.withdrawnAt && !record.retired);
  const exact = record => record.optionId ? record.optionId === optionId : record.cableId === optionId
    || !option && sameCard(record, card)
    || card.id === 'speaker' && option?.brand === 'Speaker cable' && record.cableId === 'speaker';
  const handwritten = record => record.origin !== 'measurement' && !record.optionId && (legacy ? record.cableId === legacy
    : !option && HANDWRITTEN[card.id]?.includes(record.cableId)) && !(option?.brand === '(H)05VV-F' && record.source === 'DRAW_6.JPG');
  const legacyOwn = record => record.origin === 'measurement' && !record.optionId && legacy && record.cableId === legacy;
  const own = record => exact(record) || handwritten(record) || legacyOwn(record);
  const ownRecords = records.filter(own);
  const latest = [...ownRecords].filter(record => ['single', 'dual'].includes(record.mode)).sort((a, b) => newer(a, b) ? -1 : newer(b, a) ? 1 : 0)[0];
  let mode = ['single', 'dual'].includes(options.mode) ? options.mode : latest?.mode ?? option?.mode ?? 'unknown';
  if (card.coreKind === 'thread') return threadForecast(ownRecords, row, mode);
  let inferredMode = false;
  if (!['single', 'dual'].includes(mode)) {
    const nearestFamily = groupsFor(records, card, own).filter(group => ['single', 'dual'].includes(group.records[0]?.mode))
      .sort((a, b) => b.weight - a.weight || b.records.length - a.records.length)[0];
    mode = nearestFamily?.records[0]?.mode ?? 'dual'; inferredMode = true;
  }
  const matchingOwn = ownRecords.filter(record => record.mode === mode);
  const related = groupsFor(records.filter(record => record.mode === mode), card, own);
  // A directly confirmed equivalent family retains its interior measured curve.
  const linkedIds = SHARED_OPTIONS.find(group => group.includes(optionId)) ?? [];
  const linked = records.filter(record => record.mode === mode && record.optionId !== optionId && linkedIds.includes(record.optionId));
  const result = empty(mode, null), allUsed = new Map();
  result.inferredMode = inferredMode;
  result.rpmSpeedBasis = {};
  const anchorsFor = key => {
    const exactMeasurements = fieldAnchors(matchingOwn.filter(record => record.origin === 'measurement'), key);
    if (exactMeasurements.length >= 2) return exactMeasurements;
    const confirmedMeasurements = fieldAnchors([...matchingOwn, ...linked].filter(record => record.origin === 'measurement'), key);
    if (confirmedMeasurements.length >= 2) return confirmedMeasurements;
    // The explicitly confirmed ПВ1 / H07V-U identity may use newer admin data
    // over an older handwritten value, while own-brand admin anchors win ties.
    return fieldAnchors([...matchingOwn, ...linked], key);
  };
  const setEstimate = (key, estimate) => {
    if (!estimate || !valid(key, estimate.value)) return;
    result[key] = estimate.method === 'measured-value' ? estimate.value : round(estimate.value, key);
    result.fieldMethods[key] = estimate.method; result.fieldConfidence[key] = estimate.confidence;
    if (['extruder1', 'extruder2'].includes(key)) {
      const speedRecords = [...matchingOwn, ...linked];
      const knownDirectSpeed = (estimate.used ?? []).every(record => positive(mergedSection(speedRecords, record.section).workingSpeed));
      result.rpmSpeedBasis[key] = estimate.speedBasisKnown === false ? null : estimate.speedBasisKnown === true ? result.workingSpeed
        : knownDirectSpeed ? interpolate(anchorsFor('workingSpeed'), row.section, 'workingSpeed')?.value ?? null : null;
    }
    result.fieldAnchors[key] = (estimate.used ?? []).map(record => ({ section: record.section, value: valueFor(record, key), source: record.source,
      optionId: record.optionId ?? null, measurementId: record.measurementId ?? (record.origin === 'measurement' ? record.id : null) }));
    for (const record of [...(estimate.used ?? []), ...anchorsFor(key)]) {
      allUsed.set(`${record.optionId ?? record.cableId}:${record.section}:${record.mode}`, record);
      if (!own(record)) {
        const brand = recordOption(record)?.brand;
        if (brand && !result.borrowedFrom.includes(brand)) result.borrowedFrom.push(brand);
      }
    }
    for (const group of estimate.groups ?? []) if (!result.borrowedFrom.includes(group.brand)) result.borrowedFrom.push(group.brand);
  };
  for (const key of GEOMETRY) setEstimate(key, geometryEstimate(key, anchorsFor(key), related, matchingOwn, card, row, result));
  const selectedMatrix = positive(options.matrix) ? options.matrix : result.matrix;
  const exactOuter = fieldAnchors([...matchingOwn, ...linked], 'sikoraOuter').find(record => record.section === row.section);
  if (exactOuter) {
    // Admin anchors at other sections can replace the fitting curve, but not
    // an actual outer-diameter setting already recorded for this section.
    setEstimate('sikoraOuter', { value: exactOuter.sikoraOuter, used: [exactOuter], method: 'measured-value', confidence: 'high' });
  } else if (!flat(card) && positive(selectedMatrix)) {
    const allowance = allowanceEstimate();
    setEstimate('sikoraOuter', { ...allowance, value: selectedMatrix + Math.max(.01, allowance.value) });
    result.sikoraOuterMatrix = selectedMatrix;
  }
  // Flat twin dimensions remain strings in the reference view. Their individual
  // round-core diameter can support only a coarse, explicitly borrowed load.
  const targetArea = area(result.sikoraWire, result.sikoraOuter) ?? (flat(card) && positive(result.sikoraWire)
    ? 2 * area(result.sikoraWire, result.sikoraWire + 2 * row.thicknessNom) : null);
  setEstimate('workingSpeed', speedEstimate(anchorsFor('workingSpeed'), matchingOwn, related, row, targetArea));
  result.calibratedSpeedCurve = measuredCurve([...matchingOwn, ...linked], 'workingSpeed')
    || !anchorsFor('workingSpeed').length && closestGroups(related, 'workingSpeed').some(group => measuredCurve(group.records, 'workingSpeed'));
  for (const key of ['extruder1', 'extruder2']) {
    if (key === 'extruder2' && mode === 'single') continue;
    setEstimate(key, rpmEstimate(key, anchorsFor(key), matchingOwn, related, row, targetArea, result.workingSpeed,
      result.extruder1, positive(result.rpmSpeedBasis.extruder1), result.fieldMethods.extruder1 === 'measured-value'));
  }
  for (const key of ['colorLead1', 'colorLead2']) {
    if (key === 'colorLead2' && mode === 'single') continue;
    const anchors = anchorsFor(key), direct = interpolate(anchors, row.section, key), anchor = nearest(anchors, row.section);
    if (key === 'colorLead2') {
      const operator = estimateColorLead2({ conductorClass: card.conductorClass, section: row.section, mode, coreKind: card.coreKind,
        practicalLead: direct?.method === 'measured-value' ? direct.value : null });
      result.colorLead2Model = operator;
      if (operator.value !== null) {
        setEstimate(key, { value: operator.value, method: operator.method, confidence: operator.confidence,
          used: direct?.method === 'measured-value' ? direct.used : [] });
        continue;
      }
    }
    setEstimate(key, direct ?? (anchor ? { value: valueFor(anchor, key), used: [anchor], method: 'measured-lead', confidence: 'low' }
      : { value: key === 'colorLead1' ? DEFAULT_RULES.lead1 : DEFAULT_RULES.lead2, used: [], method: 'default-lead', confidence: 'low' }));
  }
  result.modelWorkingSpeed = result.workingSpeed;
  if (positive(options.workingSpeed) && positive(result.workingSpeed)) {
    // RPM without a known matching measured speed must not be rescaled, whether
    // it interpolates or follows a sparse empirical extrapolation.
    for (const key of ['extruder1', 'extruder2']) {
      const speedBasis = result.rpmSpeedBasis[key];
      // An actual setting remains the operator's recorded setting. A selected
      // speed can adjust an estimate, but cannot relabel a rescaled measurement
      // as another actual RPM value at this exact section.
      if (result.fieldMethods[key] !== 'measured-value' && positive(result[key]) && positive(speedBasis)) {
        result[key] = round(result[key] * options.workingSpeed / speedBasis, key);
        result.fieldMethods[key] += '-at-selected-speed';
        result.rpmSpeedBasis[key] = options.workingSpeed;
      }
    }
  }
  const bases = Object.values(result.rpmSpeedBasis);
  result.rpmWorkingSpeed = bases.length && bases.every(basis => positive(basis) && basis === bases[0]) ? bases[0] : null;
  result.anchors = [...allUsed.values()].sort((a, b) => a.section - b.section).map(record => ({ section: record.section, source: record.source,
    optionId: record.optionId ?? null, extruder1: record.extruder1, extruder2: record.extruder2, workingSpeed: record.maxSpeed }));
  const operatingMethods = ['extruder1', ...(mode === 'dual' ? ['extruder2'] : []), 'workingSpeed'].map(key => result.fieldMethods[key]);
  const interiorMethods = ['interpolation', 'measured-value', 'speed-normalized-interpolation', 'paired-balance-interpolation'];
  result.method = operatingMethods.every(method => interiorMethods.includes(method?.replace('-at-selected-speed', ''))) ? 'interpolation'
    : matchingOwn.some(record => positive(record.section)) ? 'extrapolation' : 'related-practical';
  result.rpmMethod = ['extruder1', ...(mode === 'dual' ? ['extruder2'] : [])].every(key => interiorMethods.includes(result.fieldMethods[key]?.replace('-at-selected-speed', '')))
    ? 'measured-values' : 'adaptive-practical';
  const operatingFields = ['extruder1', ...(mode === 'dual' ? ['extruder2'] : []), 'workingSpeed'];
  result.confidence = inferredMode || operatingMethods.some(method => !interiorMethods.includes(method?.replace('-at-selected-speed', '')))
    || operatingFields.some(key => result.fieldConfidence[key] === 'low') ? 'low'
    : operatingFields.every(key => result.fieldMethods[key] === 'measured-value') ? 'high' : 'medium';
  result.reason = result.confidence === 'low' ? 'Орієнтовно: використано обмежені практичні дані або заміри схожих кабелів. Уточніть налаштування на лінії.'
    : result.confidence === 'medium' ? 'Орієнтовно: значення між практичними замірами, потрібна перевірка на лінії.' : null;
  result.speed1 = firstSpeed(result.workingSpeed); result.speed2 = secondSpeed(result.workingSpeed);
  return result;
}

export function speedStages(workingSpeed) {
  const working = positive(workingSpeed) ? workingSpeed : null;
  return { speed1: firstSpeed(working), speed2: secondSpeed(working), workingSpeed: working };
}
