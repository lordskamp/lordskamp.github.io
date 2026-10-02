import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { RECIPES } from '../Zavod/data.js';
import { REFERENCE_CARDS } from '../Zavod/reference-data.js';
import { CATALOG_OPTIONS } from '../Zavod/catalog-options.js';
import { forecastFor, speedStages } from '../Zavod/forecast.js';
import { baseFor } from '../Zavod/catalog-base.js';
import { setupFor } from '../Zavod/setup-data.js';

const card = id => REFERENCE_CARDS.find(candidate => candidate.id === id);
const predict = (id, section, records = RECIPES, options) => forecastFor(card(id), card(id).rows.find(row => row.section === section), records, options);
const h07 = 'h07v-k--h07v-k';
const measured = (section, values = {}, extra = {}) => ({ id: `sample-${section}`, optionId: h07, cableId: h07, section, mode: 'single', color: 'all', origin: 'measurement', source: 'Замір', updatedAt: '2026-10-01T12:00:00Z', revision: 1, ...values, ...extra });
const fixture = JSON.parse(readFileSync(new URL('./fixtures/zavod-h07-calibrations.json', import.meta.url), 'utf8'));
const realRecords = fixture.measurements.map(values => measured(values.section, values, { mode: fixture.mode, id: `public-h07-${values.section}` }));
const ownAnchors = result => result.anchors.filter(anchor => anchor.optionId === h07);
const finitePositive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

test('H07V-K predicts another section directly from its recorded 1.5, 2.5 and 6 values', () => {
  const records = [measured(1.5, { extruder1: 80, maxSpeed: 300 }), measured(2.5, { extruder1: 70, maxSpeed: 220 }), measured(6, { extruder1: 56, maxSpeed: 80 })];
  const result = predict('h07v-k', 4, records, { optionId: h07, mode: 'single' });
  assert.deepEqual([result.extruder1, result.extruder2, result.workingSpeed], [64, null, 160]);
  assert.equal(result.method, 'interpolation');
  assert.equal(result.rpmMethod, 'measured-values');
  assert.deepEqual(result.fieldAnchors.extruder1.map(anchor => anchor.section), [2.5, 6]);
  assert.deepEqual(ownAnchors(result).map(anchor => anchor.section), [1.5, 2.5, 6]);
});

test('printed speed and RPM never train operating forecasts; nominal geometry is only a geometric feature', () => {
  const reference = card('h07v-k'), row = reference.rows.find(row => row.section === 4);
  const records = [measured(2.5, { extruder1: 70, maxSpeed: 220 }), measured(6, { extruder1: 56, maxSpeed: 80 })];
  const normal = forecastFor(reference, row, records, { optionId: h07 });
  const changed = forecastFor(reference, { ...row, maxSpeed: 1, rpm1: 9999, rpm2: 9999 }, records, { optionId: h07 });
  assert.deepEqual(changed, normal);
  const geometryChanged = forecastFor(reference, { ...row, wireNom: 3, outerNom: 5 }, records, { optionId: h07 });
  assert.equal(geometryChanged.extruder1, normal.extruder1);
  assert.equal(geometryChanged.workingSpeed, normal.workingSpeed);
  assert.notEqual(geometryChanged.sikoraWire, normal.sikoraWire);
});

test('latest measurement corrects its section and recomputes the forecast', () => {
  const records = [measured(2.5, { extruder1: 70, maxSpeed: 220 }), measured(6, { extruder1: 56, maxSpeed: 80 })];
  records.push(measured(6, { extruder1: 84, maxSpeed: 150 }, { id: 'new-sample', revision: 2, updatedAt: '2026-10-02T12:00:00Z' }));
  const result = predict('h07v-k', 4, records, { optionId: h07 });
  assert.deepEqual([result.extruder1, result.workingSpeed], [76, 190]);
  assert.equal(ownAnchors(result).length, 2);
});

test('each partial field uses its own independent anchors', () => {
  const records = [measured(1.5, { extruder1: 80 }), measured(2.5, { maxSpeed: 220 }), measured(6, { extruder1: 56, maxSpeed: 80, matrix: 5 })];
  const result = predict('h07v-k', 4, records, { optionId: h07 });
  assert.deepEqual([result.extruder1, result.workingSpeed], [66.7, 160]);
  assert.equal(result.matrix, 4.5); // Recorded +0.3 offset from the source's nominal matrix.
  assert.deepEqual(result.fieldAnchors.extruder1.map(anchor => anchor.section), [1.5, 6]);
  assert.deepEqual(result.fieldAnchors.workingSpeed.map(anchor => anchor.section), [2.5, 6]);
});

test('a partial update does not erase the older recorded field in the same section', () => {
  const records = [measured(2.5, { extruder1: 70, maxSpeed: 220 }), measured(6, { extruder1: 56, maxSpeed: 80 }), measured(6, { maxSpeed: 150 }, { revision: 2, updatedAt: '2026-10-02T12:00:00Z' })];
  const result = predict('h07v-k', 4, records, { optionId: h07 });
  assert.equal(result.extruder1, 64);
  assert.equal(result.workingSpeed, 190);
});

test('outside the measured range values extrapolate with explicit low-confidence methods', () => {
  const records = [measured(2.5, { extruder1: 70, maxSpeed: 220 }), measured(6, { extruder1: 56, maxSpeed: 80 })];
  const result = predict('h07v-k', 1.5, records, { optionId: h07 });
  assert(finitePositive(result.extruder1));
  assert(finitePositive(result.workingSpeed));
  assert.equal(result.method, 'extrapolation');
  assert.equal(result.confidence, 'low');
  assert.equal(result.fieldMethods.extruder1, 'annular-flow');
  assert(result.reason.includes('Орієнтовно'));
});

test('repeated colours and invalid numeric values cannot create two independent sections', () => {
  const copies = Array.from({ length: 5 }, (_, i) => measured(2.5, { extruder1: 70, maxSpeed: 220 }, { id: `copy-${i}` }));
  const repeated = predict('h07v-k', 4, copies, { optionId: h07 });
  assert(finitePositive(repeated.workingSpeed));
  assert.equal(repeated.fieldMethods.workingSpeed, 'load-extrapolation');
  assert.deepEqual([...new Set(repeated.fieldAnchors.workingSpeed.map(anchor => anchor.section))], [2.5]);
  for (const maxSpeed of [NaN, Infinity, 0, -10, '400']) {
    const result = predict('h07v-k', 4, [measured(2.5, { maxSpeed: 220 }), measured(6, { maxSpeed })], { optionId: h07 });
    assert(finitePositive(result.workingSpeed));
    assert.deepEqual(result.fieldAnchors.workingSpeed.map(anchor => anchor.section), [2.5]);
  }
});

test('other PVC families provide labelled fallback rather than own-brand calibration', () => {
  for (const id of ['pv3--pv3', 'h07v-r--h07v-r', 'pv3--pv3ng']) {
    const records = [measured(2.5, { extruder1: 70, maxSpeed: 220 }, { optionId: id, cableId: id }), measured(6, { extruder1: 56, maxSpeed: 80 }, { optionId: id, cableId: id })];
    const result = predict('h07v-k', 4, records, { optionId: h07, mode: 'single' });
    assert(finitePositive(result.workingSpeed), id);
    assert.equal(result.method, 'related-practical', id);
    assert.equal(result.confidence, 'low', id);
    assert(result.borrowedFrom.length, id);
    assert.equal(ownAnchors(result).length, 0, id);
  }
});

test('all colours share the same mode forecast and only single/dual remain independent', () => {
  const records = ['all', 'yellow-green', 'black'].flatMap((color, i) => [2.5, 6].map(section => measured(section, { extruder1: 50 + i * 20, extruder2: color === 'all' ? null : 60 + i * 20, maxSpeed: 100 + i * 50 }, { color, mode: color === 'all' ? 'single' : 'dual', updatedAt: `2026-10-0${i + 1}T12:00:00Z` })));
  const options = { optionId: h07, normalMode: 'single' };
  assert.equal(predict('h07v-k', 4, records, { ...options, mode: 'single', color: 'blue' }).extruder1, 50);
  assert.equal(predict('h07v-k', 4, records, { ...options, mode: 'dual', color: 'yellow-green' }).extruder1, 90);
  const black = predict('h07v-k', 4, records, { ...options, mode: 'dual', color: 'black' });
  assert.deepEqual([black.extruder1, black.extruder2, black.workingSpeed], [90, 100, 200]);
  assert.deepEqual(black,predict('h07v-k', 4, records, { ...options, mode: 'dual', color: 'yellow-green' }));
  assert.equal(predict('pv3', 1, RECIPES, { mode: 'dual', color: 'black', normalMode: 'single' }).extruder1, 50);
});

test('verified ПВ1/H07V-U family is an explicit fallback and own measurements take priority', () => {
  const records = [1.5, 6].map(section => measured(section, { extruder1: 70, maxSpeed: 240 }, { optionId: 'h07v-u--h07v-u', cableId: 'pv1' }));
  const shared = predict('pv1', 4, records, { optionId: 'pv1--pv1', mode: 'single' });
  assert.equal(shared.workingSpeed, 240);
  assert(shared.borrowedFrom.includes('H07V-U'));
  const own = [1.5, 6].map(section => measured(section, { extruder1: 90, maxSpeed: 300 }, { optionId: 'pv1--pv1', cableId: 'pv1' }));
  const result = predict('pv1', 4, [...records, ...own], { optionId: 'pv1--pv1', mode: 'single' });
  assert.equal(result.workingSpeed, 300);
  assert.deepEqual(result.fieldAnchors.workingSpeed.map(anchor => anchor.optionId), ['pv1--pv1', 'pv1--pv1']);
});

test('own geometry interpolates and missing SIKORA follows the predicted matrix with a positive allowance', () => {
  const records = [measured(2.5, { matrix: 3, dorn: 2, sikoraOuter: 3.2 }), measured(6, { matrix: 4.4, dorn: 3.4, sikoraOuter: 4.6 })];
  const result = predict('h07v-k', 4, records, { optionId: h07 });
  assert.deepEqual([result.matrix, result.dorn, result.sikoraOuter], [3.6, 2.6, 3.8]);
  const missing = predict('h07v-k', 4, records.map(record => ({ ...record, sikoraOuter: null })), { optionId: h07 });
  const changedMatrix = predict('h07v-k', 4, records.map(record => ({ ...record, sikoraOuter: null, matrix: 20 })), { optionId: h07 });
  assert(finitePositive(missing.sikoraOuter));
  assert.equal(missing.sikoraOuter, 3.75);
  assert.equal(changedMatrix.sikoraOuter, 20.15);
  assert.equal(missing.fieldMethods.sikoraOuter, 'matrix-related-allowance');
});

test('forecast SIKORA uses the selected practical or reference matrix and a learned positive measured allowance', () => {
  const training = [measured(2.5, { matrix: 3, sikoraOuter: 3.25 }), measured(6, { matrix: 4.4, sikoraOuter: 4.65 })];
  const result = predict('h07v-k', 4, training, { optionId: h07, mode: 'single', matrix: 4 });
  assert.equal(result.matrix, 3.6);
  assert.equal(result.sikoraOuterMatrix, 4);
  assert.equal(result.sikoraOuter, 4.25);
  assert.equal(result.fieldMethods.sikoraOuter, 'matrix-measured-allowance');
  assert.deepEqual(result.fieldAnchors.sikoraOuter.map(anchor => anchor.section), [2.5, 6]);
});

test('a thinner core has a smaller SIKORA allowance below the actual measured range', () => {
  const training = [measured(2.5, { matrix: 3, sikoraOuter: 3.15 })];
  const thin = predict('h07v-k', .75, training, { optionId: h07, mode: 'single', matrix: 3 });
  const medium = predict('h07v-k', 1.5, training, { optionId: h07, mode: 'single', matrix: 3 });
  const actual = predict('h07v-k', 2.5, training, { optionId: h07, mode: 'single', matrix: 3 });
  assert.deepEqual([thin.sikoraOuter, medium.sikoraOuter, actual.sikoraOuter], [3.08, 3.12, 3.15]);
});

test('exact admin and handwritten SIKORA settings remain actual values even if another matrix is selected', () => {
  const admin = predict('h07v-k', 2.5, [measured(2.5, { matrix: 3, sikoraOuter: 3.2 })], { optionId: h07, mode: 'single', matrix: 20 });
  assert.equal(admin.sikoraOuter, 3.2);
  assert.equal(admin.fieldMethods.sikoraOuter, 'measured-value');
  const handwritten = predict('pv3', 1, [], { optionId: 'pv3--pv3', mode: 'dual', matrix: 20 });
  assert.equal(handwritten.sikoraOuter, 2.5);
  assert.equal(handwritten.fieldMethods.sikoraOuter, 'measured-value');
  const otherSections = [.75, 2.5].map(section => measured(section, { matrix: 3, sikoraOuter: 3.4 },
    { optionId: 'pv3--pv3', cableId: 'pv3', mode: 'dual' }));
  const keptHandwritten = predict('pv3', 1, otherSections, { optionId: 'pv3--pv3', mode: 'dual', matrix: 20 });
  assert.equal(keptHandwritten.sikoraOuter, 2.5);
  assert.equal(keptHandwritten.fieldMethods.sikoraOuter, 'measured-value');
});

test('nonpositive outer-minus-matrix pairs cannot train a predicted SIKORA target', () => {
  const training = [measured(2.5, { matrix: 3, sikoraOuter: 2.9 }), measured(6, { matrix: 4.4, sikoraOuter: 4.6 })];
  const result = predict('h07v-k', 4, training, { optionId: h07, mode: 'single', matrix: 4 });
  assert.equal(result.sikoraOuter, 4.16);
  assert.equal(result.fieldMethods.sikoraOuter, 'matrix-measured-allowance');
  assert.deepEqual(result.fieldAnchors.sikoraOuter.map(anchor => anchor.section), [6]);
});

test('related allowances use actual compatible positive pairs and ignore missing, negative, flat and other-mode pairs', () => {
  const source = { optionId: 'h07v-k--h05v-k', cableId: 'h07v-k--h05v-k', mode: 'dual' };
  const training = [measured(1, { matrix: 2, sikoraOuter: 2.22 }, source),
    measured(.75, { matrix: 2, sikoraOuter: 1.9 }, source),
    measured(.5, { sikoraOuter: 9 }, source)];
  const options = { optionId: h07, mode: 'dual', matrix: 4 };
  const result = predict('h07v-k', 4, training, options);
  assert.equal(result.sikoraOuter, 4.22);
  assert.equal(result.fieldMethods.sikoraOuter, 'matrix-related-allowance');
  assert.deepEqual(result.fieldAnchors.sikoraOuter.map(anchor => anchor.section), [1]);
  assert(result.borrowedFrom.includes('H05V-K'));
  const thin = predict('h07v-k', 1.5, training, options);
  assert.equal(thin.sikoraOuter, 4.17);
  const unusable = [measured(1.5, { matrix: 1, sikoraOuter: 99 }, { ...source, mode: 'single' }),
    measured(1, { matrix: 1, sikoraOuter: 99 }, { optionId: 'speaker--speaker', cableId: 'speaker', mode: 'dual' })];
  assert.deepEqual(predict('h07v-k', 4, [...training, ...unusable], options), result);
});

test('corrected SIKORA geometry is used by load and annular-flow predictions', () => {
  const training = realRecords.filter(record => record.section !== 6);
  const smaller = predict('h07v-k', 6, training, { optionId: h07, mode: 'dual', matrix: 4.7 });
  const larger = predict('h07v-k', 6, training, { optionId: h07, mode: 'dual', matrix: 5 });
  assert.equal(smaller.sikoraOuter, 4.85);
  assert.equal(larger.sikoraOuter, 5.15);
  assert(larger.workingSpeed < smaller.workingSpeed);
  assert(larger.extruder1 > smaller.extruder1);
});

test('deleted measurements are excluded from calibration', () => {
  const records = [measured(2.5, { extruder1: 70, maxSpeed: 220 }), measured(6, { extruder1: 56, maxSpeed: 80 }, { deletedAt: '2026-10-02T12:00:00Z' })];
  const result = predict('h07v-k', 4, records, { optionId: h07 });
  assert(finitePositive(result.workingSpeed));
  assert.deepEqual(result.fieldAnchors.workingSpeed.map(anchor => anchor.section), [2.5]);
});

test('original handwritten values can fill gaps by measured-value interpolation', () => {
  const result = predict('pvs-380', 1);
  assert.deepEqual([result.extruder1, result.extruder2, result.workingSpeed], [67, 106, 500]);
  assert.equal(result.rpmMethod, 'measured-values');
  assert(finitePositive(predict('pvs-380', 6).workingSpeed));
});

test('actual H07V-K 1.5 and 2.5 predict held-out 6 without using the 6 measurement', () => {
  const training = realRecords.filter(record => record.section !== 6);
  const actual = realRecords.find(record => record.section === 6);
  const result = predict('h07v-k', 6, training, { optionId: h07, mode: 'dual' });
  // These are held-out acceptance bounds, not coefficients in the estimator.
  for (const key of ['extruder1', 'extruder2']) assert(Math.abs(result[key] / actual[key] - 1) < .1, `${key}: ${result[key]} vs ${actual[key]}`);
  assert(Math.abs(result.workingSpeed / actual.maxSpeed - 1) < .12);
  for (const key of ['dorn', 'matrix', 'sikoraWire', 'sikoraOuter']) assert(Math.abs(result[key] / actual[key] - 1) < .05, key);
  assert.deepEqual(ownAnchors(result).map(anchor => anchor.section), [1.5, 2.5]);
  assert(Object.values(result.fieldAnchors).flat().every(anchor => anchor.measurementId !== actual.id));
  assert.equal(result.fieldMethods.extruder1, 'annular-flow');
  assert.equal(result.fieldMethods.extruder2, 'empirical-extrapolation');
  assert(result.borrowedFrom.includes('YSLY'));
  assert(result.borrowedFrom.includes('ПВС'));
});

test('H07V-K 4 follows the measured speed curve instead of multiplying RPM by the printed maximum speed', () => {
  const records = realRecords.map(record => ({ ...record, baseId: baseFor(h07, record.section).id }));
  const result = setupFor(h07, 4, { calibrations: records }, 'blue', { mode: 'dual' });
  const actual = setupFor(h07, 6, { calibrations: records }, 'blue', { mode: 'dual' });
  assert.deepEqual([result.effective.extruder1, result.effective.extruder2, result.effective.workingSpeed], [56, 82, 137]);
  assert.deepEqual([actual.effective.extruder1, actual.effective.extruder2, actual.effective.workingSpeed], [59, 95, 120]);
  assert.equal(result.sources.workingSpeed, 'forecast');
  assert.equal(result.reference.workingSpeed, 250, 'printed maximum remains available for comparison');
  assert.equal(result.forecast.fieldMethods.extruder1, 'interpolation');
  assert.equal(result.forecast.fieldMethods.extruder2, 'interpolation');
  const heldOut = setupFor(h07, 6, { calibrations: records.filter(record => record.section !== 6) }, 'blue', { mode: 'dual' });
  assert.deepEqual([heldOut.effective.extruder1, heldOut.effective.extruder2, heldOut.effective.workingSpeed], [61.1, 97.4, 123]);
});

test('the calibrated operating curve controls setup values for every family with own same-mode admin speed anchors', () => {
  for (const optionId of ['h07v-r--h07v-r', 'pv1--pv1ng', 'pvs-380--pvsng', 'ysly-1000--ysly-jz']) {
    const records = [measured(2.5, { extruder1: 52, extruder2: 70, maxSpeed: 150 }, { optionId, cableId: optionId, mode: 'dual' }),
      measured(6, { extruder1: 60, extruder2: 95, maxSpeed: 120 }, { optionId, cableId: optionId, mode: 'dual' })]
      .map(record => ({ ...record, baseId: baseFor(optionId, record.section).id }));
    const result = setupFor(optionId, 4, { calibrations: records }, 'blue', { mode: 'dual' });
    assert.deepEqual([result.effective.extruder1, result.effective.extruder2, result.effective.workingSpeed], [55.4, 80.7, 137], optionId);
    assert.equal(result.sources.workingSpeed, 'forecast', optionId);
    assert.equal(result.forecast.fieldMethods.extruder1, 'interpolation', optionId);
    assert.equal(result.forecast.fieldMethods.extruder2, 'interpolation', optionId);
  }
});

test('an exact practical RPM is never rescaled or relabelled by an unrelated selected speed', () => {
  const result = predict('h07v-k', 6, realRecords, { optionId: h07, mode: 'dual', workingSpeed: 250 });
  assert.deepEqual([result.extruder1, result.extruder2, result.workingSpeed], [59, 95, 120]);
  assert.equal(result.fieldMethods.extruder1, 'measured-value');
  assert.equal(result.fieldMethods.extruder2, 'measured-value');
  assert.deepEqual(result.rpmSpeedBasis, { extruder1: 120, extruder2: 120 });
});

test('adding held-out actual measurements replaces the estimate and subsequent partial saves preserve older fields', () => {
  const result = predict('h07v-k', 6, realRecords, { optionId: h07, mode: 'dual' });
  assert.deepEqual([result.extruder1, result.extruder2, result.workingSpeed], [59, 95, 120]);
  const partial = measured(6, { maxSpeed: 130 }, { id: 'new-speed', mode: 'dual', createdAt: '2026-10-02T10:00:00Z' });
  const revised = predict('h07v-k', 6, [...realRecords, partial], { optionId: h07, mode: 'dual' });
  assert.deepEqual([revised.extruder1, revised.extruder2, revised.workingSpeed], [59, 95, 130]);
});

test('reapplying an old sample does not outrank a newer recorded sample', () => {
  const old = measured(6, { extruder1: 50 }, { createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-03T10:00:00Z', revision: 8 });
  const recent = measured(6, { extruder1: 80 }, { createdAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z', revision: 2 });
  assert.equal(predict('h07v-k', 6, [old, recent], { optionId: h07, mode: 'single' }).extruder1, 80);
});

test('RPM forecast can match displayed speed without changing the independent speed prediction', () => {
  const training = realRecords.filter(record => record.section !== 6);
  const result = predict('h07v-k', 6, training, { optionId: h07, mode: 'dual' });
  const scaled = predict('h07v-k', 6, training, { optionId: h07, mode: 'dual', workingSpeed: 250 });
  assert.equal(scaled.modelWorkingSpeed, result.workingSpeed);
  assert.equal(scaled.rpmWorkingSpeed, 250);
  assert(Math.abs(scaled.extruder1 - result.extruder1 * 250 / result.workingSpeed) < .11);
  assert(scaled.fieldMethods.extruder1.endsWith('-at-selected-speed'));
  const withoutSpeed = predict('h07v-k', 4, [measured(2.5, { extruder1: 70 }), measured(6, { extruder1: 56 })], { optionId: h07, mode: 'single', workingSpeed: 250 });
  assert.equal(withoutSpeed.extruder1, 64);
  assert.equal(withoutSpeed.fieldMethods.extruder1, 'interpolation');
});

test('selected-speed RPM uses the same own admin speed anchors and legacy base-brand records stay borrowed', () => {
  const optionId = 'pv1--pv1ng';
  const training = [measured(1.5, { extruder1: 100, maxSpeed: 300 }, { optionId, cableId: optionId }),
    measured(6, { extruder1: 100, maxSpeed: 120 }, { optionId, cableId: optionId })];
  const raw = predict('pv1', 4, training, { optionId, mode: 'single' });
  assert.equal(raw.workingSpeed, 200);
  const result = predict('pv1', 4, training, { optionId, mode: 'single', workingSpeed: 160 });
  assert.equal(result.extruder1, 80);
  assert.deepEqual(result.fieldAnchors.workingSpeed.map(anchor => anchor.section), [1.5, 6]);
  const borrowed = predict('pv1', 4, [], { optionId, mode: 'single' });
  assert.equal(borrowed.method, 'related-practical');
  assert(borrowed.borrowedFrom.includes('ПВ1'));
  assert.equal(borrowed.confidence, 'low');
});

test('RPM without measured speed extrapolates empirically and never claims a flow or selected-speed basis', () => {
  const training = [measured(1.5, { extruder1: 40, extruder2: 60 }, { mode: 'dual' }), measured(2.5, { extruder1: 60, extruder2: 80 }, { mode: 'dual' })];
  const raw = predict('h07v-k', 6, training, { optionId: h07, mode: 'dual' });
  const scaled = predict('h07v-k', 6, training, { optionId: h07, mode: 'dual', workingSpeed: 250 });
  assert.equal(scaled.extruder1, raw.extruder1);
  assert.equal(scaled.extruder2, raw.extruder2);
  assert.equal(scaled.fieldMethods.extruder1, 'empirical-extrapolation');
  assert.deepEqual(scaled.rpmSpeedBasis, { extruder1: null, extruder2: null });
  assert.equal(scaled.rpmWorkingSpeed, null);
});

test('a separate interpolated speed curve cannot invent the missing speed at an RPM anchor', () => {
  const training = [measured(1.5, { maxSpeed: 300 }), measured(2.5, { extruder1: 70 }), measured(6, { extruder1: 56, maxSpeed: 120 })];
  const result = predict('h07v-k', 4, training, { optionId: h07, mode: 'single', workingSpeed: 250 });
  assert.equal(result.extruder1, 64);
  assert.equal(result.rpmSpeedBasis.extruder1, null);
  assert.equal(result.fieldMethods.extruder1, 'interpolation');
});

test('dual records and historic unknown-mode RPM cannot contaminate a single-mode forecast', () => {
  const training = [measured(2.5, { extruder1: 60, maxSpeed: 150 }), measured(6, { extruder1: 40, maxSpeed: 100 })];
  const bad = [measured(4, { extruder1: 9999, extruder2: 9999, maxSpeed: 9999 }, { mode: 'unknown' }), ...realRecords];
  const baseline = predict('h07v-k', 4, training, { optionId: h07, mode: 'single' });
  const result = predict('h07v-k', 4, [...training, ...bad], { optionId: h07, mode: 'single' });
  assert.equal(result.extruder1, baseline.extruder1);
  assert.equal(result.workingSpeed, baseline.workingSpeed);
  assert.equal(result.extruder2, null);
  assert.equal(result.colorLead2, null);
});

test('a flat twin source does not contribute circular geometry or operating data to a round cable', () => {
  const flatRecords = [1.5, 2.5].map(section => measured(section, { sikoraWire: 20, sikoraOuter: 30, extruder1: 9999, extruder2: 9999, maxSpeed: 9999 }, { optionId: 'speaker--speaker', cableId: 'speaker', mode: 'dual' }));
  const baseline = predict('h07v-k', 4, [], { optionId: h07, mode: 'dual' });
  const result = predict('h07v-k', 4, flatRecords, { optionId: h07, mode: 'dual' });
  assert.deepEqual(result, baseline);
});

test('Speaker missing dual RPM uses its own handwritten pair and preserves paired tooling', () => {
  const result = predict('speaker', 1, [], { optionId: 'speaker--speaker', mode: 'dual' });
  assert.equal(result.extruder1, 60);
  assert.equal(result.extruder2, 38.3);
  assert.equal(result.dorn, null);
  assert.equal(result.matrix, null);
  assert.equal(result.sikoraOuter, null);
  assert(result.fieldAnchors.extruder1.every(anchor => anchor.source === 'IMG_3856.JPG'));
});

test('partial operating data on a reference row without geometry still borrow a real insulation gap', () => {
  const optionId = 'yms-j--yms-j';
  const training = [measured(10, { extruder1: 90, maxSpeed: 110 }, { optionId, cableId: optionId, mode: 'dual' })];
  const result = predict('yms-j', 16, training, { optionId, mode: 'dual' });
  assert(finitePositive(result.sikoraWire));
  assert(result.sikoraOuter > result.sikoraWire);
  assert(result.dorn > result.sikoraWire);
  assert(finitePositive(result.matrix));
  assert(finitePositive(result.extruder2));
});

test('every catalog section has finite applicable estimates, including inferred mode and related-family fallback', () => {
  for (const option of CATALOG_OPTIONS) for (const section of option.sections) {
    const reference = card(option.cardId), row = reference.rows.find(candidate => candidate.section === section);
    const result = forecastFor(reference, row, realRecords, { optionId: option.id });
    assert(['single', 'dual'].includes(result.mode), option.id);
    const keys = ['extruder1', 'workingSpeed', 'sikoraWire', ...(reference.id === 'speaker' ? [] : ['dorn', 'matrix', 'sikoraOuter']), ...(result.mode === 'dual' ? ['extruder2'] : [])];
    for (const key of keys) assert(finitePositive(result[key]), `${option.id} ${section} ${key}`);
    if (reference.id !== 'speaker' && result.fieldMethods.sikoraOuter !== 'measured-value') {
      assert(result.sikoraOuter > result.matrix, `${option.id} ${section}: SIKORA ${result.sikoraOuter} <= matrix ${result.matrix}`);
    }
    assert.equal(result.colorLead1 === null, false);
    assert.equal(result.mode === 'single' ? result.colorLead2 : null, null);
    if (result.inferredMode) assert.equal(result.confidence, 'low');
  }
});

test('speed stages start at 80 or 40 and use a round intermediate speed', () => {
  assert.deepEqual(speedStages(275), { speed1: 80, speed2: 180, workingSpeed: 275 });
  assert.deepEqual(speedStages(550), { speed1: 80, speed2: 320, workingSpeed: 550 });
  assert.deepEqual(speedStages(200), { speed1: 40, speed2: 120, workingSpeed: 200 });
  assert.deepEqual(speedStages(100), { speed1: 40, speed2: 80, workingSpeed: 100 });
  assert.deepEqual(speedStages(20), { speed1: 20, speed2: 20, workingSpeed: 20 });
  assert.deepEqual(speedStages(null), { speed1: null, speed2: null, workingSpeed: null });
});
