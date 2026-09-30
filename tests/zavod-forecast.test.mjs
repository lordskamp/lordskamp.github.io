import assert from 'node:assert/strict';
import test from 'node:test';
import { RECIPES } from '../Zavod/data.js';
import { REFERENCE_CARDS } from '../Zavod/reference-data.js';
import { forecastFor, speedStages } from '../Zavod/forecast.js';

const card = id => REFERENCE_CARDS.find(candidate => candidate.id === id);
const predict = (id, section, records = RECIPES, options) => forecastFor(card(id), card(id).rows.find(row => row.section === section), records, options);

test('missing PVS 1 mm² gets automatic same-family RPM and working speed', () => {
  const result = predict('pvs-380', 1);
  assert.deepEqual([result.extruder1, result.extruder2, result.workingSpeed], [65, 103, 512]);
  assert.equal(result.method, 'interpolation');
  assert.equal(result.rpmMethod, 'reference-ratio');
  assert.equal(result.anchors.length, 3);
  assert.equal(RECIPES.find(record => record.cableId === 'pvs-shvvp' && record.section === 1).extruder1, null);
});

test('endpoint extrapolation is explicit and does not extend a ratio slope', () => {
  const result = predict('pvs-380', 6);
  assert.deepEqual([result.extruder1, result.extruder2, result.workingSpeed], [81, 103, 150]);
  assert.equal(result.method, 'extrapolation');
  assert.equal(predict('pvs-380', .5).workingSpeed, 605);
  const vvg = predict('vvg-066', 4);
  assert.equal(vvg.workingSpeed, 220);
  assert.equal(vvg.anchors.length, 2);
  assert.equal(vvg.rpmMethod, 'insulation-volume');
});

test('single-extruder PV3 forecasts exclude all unconfirmed dual notes', () => {
  const result = predict('pv3', 1);
  assert.equal(result.mode, 'single');
  assert.equal(result.extruder2, null);
  assert.equal(result.workingSpeed, 281);
  assert.deepEqual(result.anchors.map(anchor => anchor.section), [.5, 1.5]);
  assert.equal(predict('pv3', 6).workingSpeed, 135);
  assert.equal(predict('pv3', 1, RECIPES, { mode: 'dual' }).extruder1, null);
});

test('DRAW_4 repetitions are one calibration sample per section, DRAW_6 is H05 only', () => {
  const common = predict('ysly-shared', 1.5);
  assert.equal(common.anchors.length, 5);
  assert.equal(common.workingSpeed, 439);
  assert.deepEqual(common.anchors.map(anchor => anchor.section), [.75, 1, 2.5, 4, 6]);
  assert.equal(predict('ysly-shared', 1.5, RECIPES, { cableId: 'ysly' }).workingSpeed, 439);
  const h05 = predict('ysly-shared', 1.5, RECIPES, { cableId: 'h05vv-f' });
  assert.equal(h05.anchors.length, 6);
  assert.equal(h05.workingSpeed, 325);
});

test('brand names alone do not transfer calibration to different specifications', () => {
  for (const id of ['h05-en', 'h05-partial', 'ysly-1000', 'h03-en', 'pv5', 'h07v-r', 'h07v-k', 'pvs-e', 'xymm']) {
    const result = forecastFor(card(id), card(id).rows[0]);
    assert.equal(result.workingSpeed, null, id);
    assert.equal(result.extruder1, null, id);
    assert.equal(result.extruder2, null, id);
    assert(result.reason, id);
  }
});

test('a newly measured card can calibrate itself without becoming another brand', () => {
  const reference = card('h03-en');
  const measurements = [.5, 1.5].map(section => ({
    referenceCardId: reference.id, section, mode: 'dual', origin: 'measurement',
    extruder1: 40, extruder2: 70, maxSpeed: section === .5 ? 400 : 300, source: 'Замір',
  }));
  const result = forecastFor(reference, reference.rows.find(row => row.section === 1), [...RECIPES, ...measurements]);
  assert.equal(result.mode, 'dual');
  assert(result.extruder1 > 0 && result.extruder2 > 0 && result.workingSpeed > 0);
  assert.equal(result.anchors.length, 2);
  assert.equal(predict('h05-en', 1, measurements).workingSpeed, null);
});

test('only independent sections qualify; invalid data cannot manufacture a forecast', () => {
  const pvs = RECIPES.find(record => record.cableId === 'pvs-shvvp' && record.section === .75);
  const repeated = Array.from({ length: 5 }, (_, index) => ({ ...pvs, id: `copy-${index}`, cableId: 'pvs-shvvp' }));
  assert.equal(predict('pvs-380', 1, repeated).workingSpeed, null);
  const second = RECIPES.find(record => record.cableId === 'pvs-shvvp' && record.section === 1.5);
  for (const maxSpeed of [NaN, Infinity, 0, -10, '400']) {
    assert.equal(predict('pvs-380', 1, [pvs, { ...second, maxSpeed }]).workingSpeed, null);
  }
});

test('current owner measurements supersede the reused original section', () => {
  const original = RECIPES.find(record => record.cableId === 'pvs-shvvp' && record.section === .75);
  const updated = { ...original, origin: 'measurement', extruder1: 70, updatedAt: '2026-09-30T12:00:00Z', revision: 2 };
  const result = predict('pvs-380', 1, [...RECIPES, updated]);
  assert.equal(result.anchors.find(anchor => anchor.section === .75).extruder1, 70);
  assert.equal(result.anchors.length, 3);
});

test('stage 2 is roughly half the working speed rounded down to a multiple of 20', () => {
  assert.deepEqual(speedStages(275), { speed1: 20, speed2: 120, workingSpeed: 275 });
  assert.deepEqual(speedStages(325), { speed1: 20, speed2: 160, workingSpeed: 325 });
  assert.deepEqual(speedStages(425), { speed1: 20, speed2: 200, workingSpeed: 425 });
  assert.deepEqual(speedStages(550), { speed1: 20, speed2: 260, workingSpeed: 550 });
  assert.deepEqual(speedStages(20), { speed1: 20, speed2: 20, workingSpeed: 20 });
  assert.deepEqual(speedStages(null), { speed1: 20, speed2: null, workingSpeed: null });
  assert.deepEqual(speedStages(0), { speed1: 20, speed2: null, workingSpeed: null });
  const result = predict('pvs-380', 1);
  assert.equal(result.speed1, 20);
  assert.equal(result.speed2, 240);
});

test('insufficient geometry leaves RPM empty while keeping a supported speed estimate', () => {
  const reference = card('pv1');
  const result = forecastFor(reference, { ...reference.rows[0], wireNom: null, outerNom: null });
  assert.equal(result.workingSpeed, 373);
  assert.equal(result.extruder1, null);
  assert.equal(result.extruder2, null);
  assert(result.reason);
});

test('geometry estimation scales with insulation area and working speed in the same single-extruder regime', () => {
  const reference = {
    id: 'measured-family',
    rows: [
      { section: 1, wireNom: 1, outerNom: 2, maxSpeed: 200 },
      { section: 1.5, wireNom: 1, outerNom: Math.sqrt(6), maxSpeed: 150 },
      { section: 2, wireNom: 1, outerNom: 3, maxSpeed: 100 },
    ],
  };
  // Both measurements have the same RPM per cubic millimetre of insulation.
  const measurements = [
    { referenceCardId: reference.id, section: 1, mode: 'single', extruder1: 30, maxSpeed: 100 },
    { referenceCardId: reference.id, section: 2, mode: 'single', extruder1: 40, maxSpeed: 50 },
  ];
  const result = forecastFor(reference, reference.rows[1], measurements);
  assert.equal(result.workingSpeed, 75);
  assert.equal(result.extruder1, 38);
  assert.equal(result.extruder2, null);
  assert.equal(result.rpmMethod, 'insulation-volume');
});
