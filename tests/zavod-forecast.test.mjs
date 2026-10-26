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
  assert.deepEqual([result.extruder1, result.extruder2, result.workingSpeed], [87.8, null, 160]);
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
  assert.notEqual(geometryChanged.extruder1, normal.extruder1);
  assert.equal(geometryChanged.workingSpeed, normal.workingSpeed);
  assert.notEqual(geometryChanged.sikoraWire, normal.sikoraWire);
});

test('latest measurement corrects its section and recomputes the forecast', () => {
  const records = [measured(2.5, { extruder1: 70, maxSpeed: 220 }), measured(6, { extruder1: 56, maxSpeed: 80 })];
  records.push(measured(6, { extruder1: 84, maxSpeed: 150 }, { id: 'new-sample', revision: 2, updatedAt: '2026-10-02T12:00:00Z' }));
  const result = predict('h07v-k', 4, records, { optionId: h07 });
  assert.deepEqual([result.extruder1, result.workingSpeed], [88.2, 190]);
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
  assert.equal(result.extruder1, 66.8);
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

test('SIKORA prediction uses selected matrix plus operator allowance, and exact measurements stay intact', () => {
  const records = [measured(2.5, { matrix: 3, dorn: 2, sikoraOuter: 3.2 }), measured(6, { matrix: 4.4, dorn: 3.4, sikoraOuter: 4.6 })];
  const result = predict('h07v-k', 4, records, { optionId: h07, mode: 'single', matrix: 4 });
  assert.equal(result.sikoraOuter, 4.15);
  assert.equal(result.fieldMethods.sikoraOuter, 'matrix-operator-allowance');
  assert.equal(result.fieldConfidence.sikoraOuter, 'low');
  const exact = predict('h07v-k', 2.5, records, { optionId: h07, mode: 'single', matrix: 3 });
  assert.equal(exact.sikoraOuter, 3.2);
  assert.equal(exact.fieldMethods.sikoraOuter, 'measured-value');
});

test('the operator allowance is approximately 0.15 mm for thin and thick cores', () => {
  const training = [measured(2.5, { matrix: 3, sikoraOuter: 3.15 })];
  for (const section of [.75, 1.5]) {
    const result = predict('h07v-k', section, training, { optionId: h07, mode: 'single', matrix: 3 });
    assert.equal(result.sikoraOuter, 3.15);
    assert.equal(result.fieldMethods.sikoraOuter, 'matrix-operator-allowance');
  }
});

test('exact admin and handwritten SIKORA settings remain actual values even if another matrix is selected', () => {
  const admin = predict('h07v-k', 2.5, [measured(2.5, { matrix: 3, sikoraOuter: 3.2 })], { optionId: h07, mode: 'single', matrix: 20 });
  assert.equal(admin.sikoraOuter, 3.2);
  assert.equal(admin.fieldMethods.sikoraOuter, 'measured-value');
  const handwritten = predict('pv3', 1, [], { optionId: 'pv3--pv3', mode: 'dual', matrix: 20 });
  assert.equal(handwritten.sikoraOuter, 2.5);
  assert.equal(handwritten.fieldMethods.sikoraOuter, 'measured-value');
});

test('unrelated and implausible measured allowances do not replace the operator rule', () => {
  const source = { optionId: 'h07v-k--h05v-k', cableId: 'h07v-k--h05v-k', mode: 'dual' };
  const training = [measured(1, { matrix: 2, sikoraOuter: 2.22 }, source),
    measured(.75, { matrix: 2, sikoraOuter: 1.9 }, source)];
  const result = predict('h07v-k', 4, training, { optionId: h07, mode: 'dual', matrix: 4 });
  assert.equal(result.sikoraOuter, 4.15);
  assert.equal(result.fieldMethods.sikoraOuter, 'matrix-operator-allowance');
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
  assert.deepEqual([result.extruder1, result.extruder2, result.workingSpeed], [62.4, 109.8, 500]);
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
  assert.equal(result.fieldMethods.extruder2, 'paired-balance');
  assert(result.borrowedFrom.includes('YSLY'));
  assert(result.borrowedFrom.includes('ПВС'));
});

test('H07V-K held-out 2.5 uses the curved construction geometry rather than underestimating its diameter and operating load', () => {
  const actual=realRecords.find(record=>record.section===2.5);
  const training=realRecords.filter(record=>record.section!==actual.section);
  const result=predict('h07v-k',2.5,training,{optionId:h07,mode:'dual',workingSpeed:actual.maxSpeed});
  for(const key of ['extruder1','extruder2']) assert(Math.abs(result[key]/actual[key]-1)<.08,`${key}: ${result[key]} vs ${actual[key]}`);
  for(const key of ['sikoraWire','matrix','sikoraOuter']) assert(Math.abs(result[key]/actual[key]-1)<.05,key);
  assert.equal(result.fieldMethods.matrix,'nominal-residual-interpolation');
  assert(Object.values(result.fieldAnchors).flat().every(anchor=>anchor.measurementId!==actual.id));
});

test('H07V-K 4 follows the measured speed curve instead of multiplying RPM by the printed maximum speed', () => {
  const records = realRecords.map(record => ({ ...record, baseId: baseFor(h07, record.section).id }));
  const result = setupFor(h07, 4, { calibrations: records }, 'blue', { mode: 'dual' });
  const actual = setupFor(h07, 6, { calibrations: records }, 'blue', { mode: 'dual' });
  assert.deepEqual([result.effective.extruder1, result.effective.extruder2, result.effective.workingSpeed], [60.3, 84.2, 137]);
  assert.deepEqual([actual.effective.extruder1, actual.effective.extruder2, actual.effective.workingSpeed], [59, 95, 120]);
  assert.equal(result.sources.workingSpeed, 'forecast');
  assert.equal(result.reference.workingSpeed, 250, 'printed maximum remains available for comparison');
  assert.equal(result.forecast.fieldMethods.extruder1, 'speed-normalized-interpolation');
  assert.equal(result.forecast.fieldMethods.extruder2, 'speed-normalized-interpolation');
  const heldOut = setupFor(h07, 6, { calibrations: records.filter(record => record.section !== 6) }, 'blue', { mode: 'dual' });
  assert.deepEqual([heldOut.effective.extruder1, heldOut.effective.extruder2, heldOut.effective.workingSpeed], [61.1, 94, 123]);
});

test('the calibrated operating curve controls setup values for every family with own same-mode admin speed anchors', () => {
  for (const optionId of ['h07v-r--h07v-r', 'pv1--pv1ng', 'pvs-380--pvsng', 'ysly-1000--ysly-jz']) {
    const records = [measured(2.5, { extruder1: 52, extruder2: 70, maxSpeed: 150 }, { optionId, cableId: optionId, mode: 'dual' }),
      measured(6, { extruder1: 60, extruder2: 95, maxSpeed: 120 }, { optionId, cableId: optionId, mode: 'dual' })]
      .map(record => ({ ...record, baseId: baseFor(optionId, record.section).id }));
    const result = setupFor(optionId, 4, { calibrations: records }, 'blue', { mode: 'dual' });
    assert.equal(result.effective.workingSpeed,137,optionId);
    assert(result.effective.extruder1>=52/150*137-.1&&result.effective.extruder1<=60/120*137+.1,optionId);
    assert(result.effective.extruder2>=70/150*137-.1&&result.effective.extruder2<=95/120*137+.1,optionId);
    assert.equal(result.sources.workingSpeed, 'forecast', optionId);
    assert.equal(result.forecast.fieldMethods.extruder1, 'speed-normalized-interpolation', optionId);
    assert.equal(result.forecast.fieldMethods.extruder2, 'speed-normalized-interpolation', optionId);
  }
});

test('an exact practical RPM is never rescaled or relabelled by an unrelated selected speed', () => {
  const result = predict('h07v-k', 6, realRecords, { optionId: h07, mode: 'dual', workingSpeed: 250 });
  assert.deepEqual([result.extruder1, result.extruder2, result.workingSpeed], [59, 95, 120]);
  assert.equal(result.fieldMethods.extruder1, 'measured-value');
  assert.equal(result.fieldMethods.extruder2, 'measured-value');
  assert.deepEqual(result.rpmSpeedBasis, { extruder1: 120, extruder2: 120 });
  const precise=predict('h07v-k',6,[measured(6,{extruder1:72.25,extruder2:120.125,maxSpeed:300},{mode:'dual'})],{optionId:h07,mode:'dual',workingSpeed:150});
  assert.deepEqual([precise.extruder1,precise.extruder2],[72.25,120.125]);
});

test('unmeasured larger sections have greater measured load at the same speed, while modes and exact measurements remain independent', () => {
  for (const mode of ['single','dual']) {
    const records = [measured(1.5, { extruder1:72,extruder2:mode==='dual'?120:null,maxSpeed:300 }, {mode}),
      measured(6, { extruder1:100,extruder2:mode==='dual'?180:null,maxSpeed:200 }, {mode})];
    const smaller=predict('h07v-k',2.5,records,{optionId:h07,mode,workingSpeed:150});
    const larger=predict('h07v-k',4,records,{optionId:h07,mode,workingSpeed:150});
    const doubled=predict('h07v-k',4,records,{optionId:h07,mode,workingSpeed:300});
    assert(larger.extruder1>smaller.extruder1);
    assert(Math.abs(doubled.extruder1-larger.extruder1*2)<.11);
    if(mode==='dual') {
      assert(larger.extruder2>smaller.extruder2);
      assert(Math.abs(doubled.extruder2-larger.extruder2*2)<.21);
      assert(doubled.extruder2-doubled.extruder1>40);
    } else assert.equal(larger.extruder2,null);
    const actual=predict('h07v-k',1.5,records,{optionId:h07,mode,workingSpeed:150});
    assert.deepEqual([actual.extruder1,actual.extruder2],[72,mode==='dual'?120:null]);
  }
});

test('secondary extrapolation below the observed range preserves a real measured RPM per metre instead of a foreign balance', () => {
  const donors=realRecords;
  const source='h07v-k--h05v-k';
  const result=predict('h07v-k',.75,donors,{optionId:source,mode:'dual',workingSpeed:160});
  assert.equal(result.fieldMethods.extruder2,'nearest-secondary-load-at-selected-speed');
  assert(Math.abs(result.extruder2-65/150*160)<.11);
  assert.equal(result.confidence,'low');
});

test('second-extruder color change uses class anchors, exact practical values first and no assumption that PV3 is class 5', () => {
  const flexible=predict('h07v-k',1.5,[],{optionId:h07,mode:'dual'});
  assert.equal(flexible.colorLead2,1600);
  assert.equal(flexible.fieldMethods.colorLead2,'operator-anchor');
  assert.equal(flexible.colorLead2Model.approximate,true);
  const actual=predict('h07v-k',1.5,[measured(1.5,{colorLead2:0},{mode:'dual'})],{optionId:h07,mode:'dual'});
  assert.equal(actual.colorLead2,0);
  assert.equal(actual.fieldMethods.colorLead2,'measured-value');
  assert.equal(predict('h07v-k',1.5,[],{optionId:h07,mode:'single'}).colorLead2,null);
  const pv3=predict('pv3',1.5,[],{optionId:'pv3--pv3',mode:'dual'});
  assert(!pv3.fieldMethods.colorLead2.startsWith('operator-'));
});

test('a measured paired balance scales both estimated RPM together without an absolute difference clamp', () => {
  const records = [measured(2.5, { extruder1: 40, extruder2: 120, maxSpeed: 150 }, { mode: 'dual' }),
    measured(6, { extruder1: 40, extruder2: 120, maxSpeed: 120 }, { mode: 'dual' })];
  for (const workingSpeed of [undefined, 300]) {
    const result = predict('h07v-k', 4, records, { optionId: h07, mode: 'dual', workingSpeed });
    assert(Math.abs(result.extruder2 / result.extruder1 - 3) < .01);
    assert(result.extruder2 > result.extruder1 + 40);
    assert.equal(result.rpmLimit, undefined);
    assert(result.fieldMethods.extruder2.startsWith('paired-balance-interpolation'));
  }
  const recorded = predict('h07v-k', 6, records, { optionId: h07, mode: 'dual' });
  assert.deepEqual([recorded.extruder1, recorded.extruder2], [40, 120]);
  assert.equal(recorded.fieldMethods.extruder2, 'measured-value');
  const handwritten = predict('pv3', 1, RECIPES, { mode: 'dual' });
  assert.deepEqual([handwritten.extruder1, handwritten.extruder2], [50, 130]);
});

test('an estimated second RPM follows the paired balance at an exact practical main RPM', () => {
  const records = [measured(2.5, { extruder1: 100, extruder2: 120, maxSpeed: 150 }, { mode: 'dual' }),
    measured(6, { extruder1: 100, extruder2: 120, maxSpeed: 120 }, { mode: 'dual' }),
    measured(4, { extruder1: 25 }, { mode: 'dual', updatedAt: '2026-10-03T12:00:00Z' })]
    .map(record => ({ ...record, baseId: baseFor(h07, record.section).id }));
  const result = setupFor(h07, 4, { calibrations: records }, 'black');
  assert.equal(result.effective.extruder1, 25);
  assert.equal(result.sources.extruder1, 'practical');
  assert.equal(result.forecast.extruder2, 30);
  assert.equal(result.effective.extruder2, null);
  assert.equal(result.forecast.rpmSpeedBasis.extruder2, null);
  assert.equal(result.forecast.fieldMethods.extruder2, 'paired-balance-interpolation');
  assert.equal(result.rpmConflict, undefined);
});

test('actual and reference paired RPM remain intact even when their difference exceeds 40', () => {
  const records = [measured(6, { extruder1: 40, extruder2: 120, maxSpeed: 120 }, { mode: 'dual' })]
    .map(record => ({ ...record, baseId: baseFor(h07, record.section).id }));
  const actual = setupFor(h07, 6, { calibrations: records }, 'black');
  assert.deepEqual([actual.effective.extruder1, actual.effective.extruder2], [40, 120]);
  assert.equal(actual.rpmConflict, undefined);
  const printed = setupFor('pvs-380--pvsng', 4, {}, 'black');
  assert.deepEqual([printed.reference.extruder1, printed.reference.extruder2], [122, 244]);
  assert.deepEqual([printed.effective.extruder1, printed.effective.extruder2], [printed.forecast.extruder1, printed.forecast.extruder2]);
  assert.equal(printed.rpmConflict, undefined);
});

test('compatible same-mode admin donors replace older mixed operating curves without relabelling borrowed values as practical', () => {
  const records = realRecords.map(record => ({ ...record, baseId: baseFor(h07, record.section).id }));
  for (const [optionId, section] of [['h07v-k--h05v-k', 1], ['pv5--pv5', 4]]) {
    const result = setupFor(optionId, section, { calibrations: records }, 'blue', { mode: 'dual' });
    assert(result.forecast.calibratedSpeedCurve, optionId);
    assert(result.forecast.borrowedFrom.includes('H07V-K'), optionId);
    assert.equal(result.sources.workingSpeed, 'forecast', optionId);
    assert.equal(result.sources.extruder1, 'forecast', optionId);
    assert.equal(result.practical.extruder1, null, optionId);
    assert(result.effective.extruder1 < 60, optionId);
    assert(finitePositive(result.effective.extruder2), optionId);
  }
  const single = setupFor('pv5--pv5', 4, { calibrations: records }, 'brown');
  assert.equal(single.mode, 'single');
  assert.equal(single.forecast.calibratedSpeedCurve, false, 'dual printing limits are not a single-mode measurement');
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
  assert.equal(result.extruder1, 99.8);
  assert.deepEqual(result.fieldAnchors.workingSpeed.map(anchor => anchor.section), [1.5, 6]);
  const borrowed = predict('pv1', 4, [], { optionId, mode: 'single' });
  assert.equal(borrowed.method, 'related-practical');
  assert(borrowed.borrowedFrom.includes('ПВ1'));
  assert.equal(borrowed.confidence, 'low');
});

test('RPM without measured speed extrapolates empirically and never claims a flow or selected-speed basis', () => {
  const training = [measured(1.5, { extruder1: 40, extruder2: 60 }, { mode: 'dual' }), measured(2.5, { extruder1: 60, extruder2: 80 }, { mode: 'dual' })];
  for(const section of [.75,6]) {
    const unscaled=predict('h07v-k',section,training,{optionId:h07,mode:'dual'});
    const selected=predict('h07v-k',section,training,{optionId:h07,mode:'dual',workingSpeed:250});
    assert.deepEqual([selected.extruder1,selected.extruder2],[unscaled.extruder1,unscaled.extruder2]);
    assert.equal(selected.rpmWorkingSpeed,null);
  }
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

test('every metallic catalog section has finite applicable estimates, including inferred mode and related-family fallback', () => {
  for (const option of CATALOG_OPTIONS.filter(option => option.coreKind !== 'thread')) for (const section of option.sections) {
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

test('held-out ПВС 0.75 blends paired load after training-only comparison', () => {
  const target = RECIPES.find(row => row.cableId === 'pvs-shvvp' && row.section === 0.75);
  const training = RECIPES.filter(row => !(row.cableId === 'pvs-shvvp' && row.section === target.section));
  const reference = card('pvs-380'), row = reference.rows.find(item => item.section === target.section);
  const result = forecastFor(reference, row, [], {
    optionId: 'pvs-380--pvs', mode: 'dual', workingSpeed: target.maxSpeed, baselineRecords: training
  });
  assert.equal(target.extruder2, 100);
  assert.equal(result.extruder2, 128.1);
  assert.equal(result.fieldMethods.extruder2, 'validated-secondary-blend-at-selected-speed');
  assert.equal(result.fieldConfidence.extruder2, 'low');
  assert(result.fieldAnchors.extruder2.every(anchor => anchor.section !== target.section));
  assert.equal(result.rpmSpeedBasis.extruder2, target.maxSpeed);
});

test('out-of-sample interpolation is not labelled high confidence', () => {
  const records = realRecords.filter(record => record.section !== 2.5);
  const result = predict('h07v-k', 2.5, records, { optionId: h07, mode: 'dual', workingSpeed: 150 });
  assert.equal(result.fieldConfidence.extruder1, 'low');
  assert.equal(result.fieldConfidence.extruder2, 'low');
  assert.notEqual(result.confidence, 'high');
});

test('ПВ3 dual interpolation exposes uncertainty when a hidden practical measurement disagrees', () => {
  const target = RECIPES.find(row => row.cableId === 'pv3' && row.section === 0.75);
  const baselineRecords = RECIPES.filter(row => !(row.cableId === 'pv3' && row.section === 0.75));
  const training = [{ id: 'pv3-thin', optionId: 'pv3--pv3', cableId: 'pv3--pv3', section: 0.5, mode: 'dual',
    origin: 'measurement', extruder1: 47, extruder2: 90, maxSpeed: 350 }];
  const result = predict('pv3', 0.75, training, { optionId: 'pv3--pv3', mode: 'dual', workingSpeed: 350, baselineRecords });
  assert.equal(result.extruder2, 120.8);
  assert.equal(result.fieldConfidence.extruder2, 'low');
  assert(Math.abs(result.extruder2 / 85 - 1) > 0.4, 'the 85 RPM handwritten dual setting is deliberately hidden');
  assert(result.fieldAnchors.extruder2.every(anchor => anchor.section !== target.section));
});
