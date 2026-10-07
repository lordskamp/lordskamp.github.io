import assert from 'node:assert/strict';
import test from 'node:test';
import { RECIPES } from '../Zavod/data.js';
import { baseFor, optionFor, referenceCard } from '../Zavod/catalog-base.js';
import { forecastFor } from '../Zavod/forecast.js';
import { setupFor, tableSetups, metricValues } from '../Zavod/setup-data.js';
import { modeFor } from '../Zavod/pv3-modes.js';

const id = 'thread-bundle';
const measurement = (values, extra = {}) => ({ ...baseFor(id, 1), baseId: baseFor(id, 1).id,
  optionId: id, id: 'thread-measurement', origin: 'measurement', mode: 'single', source: null, color: 'all',
  updatedAt: '2026-10-07T12:00:00Z', ...values, ...extra });

test('thread setup uses one extruder without dye and operator tool rules for all colours', () => {
  for (const color of ['blue', 'brown', 'black', 'yellow-green']) {
    assert.equal(modeFor(optionFor(id), color, 'dual'), 'single');
    const result = setupFor(id, 1, { recipes: RECIPES }, color, { finalDiameter: '1,8', mode: 'dual' });
    assert.equal(result.mode, 'single');
    assert.equal(result.noDye, true);
    assert.equal(result.finalDiameter, 1.8);
    assert.deepEqual([result.effective.extruder1, result.effective.extruder2, result.effective.workingSpeed], [61.5, null, 600]);
    assert.deepEqual([result.effective.dorn, result.effective.matrix], [.95, 2]);
    assert.deepEqual([result.effective.sikoraWire, result.effective.sikoraOuter, result.effective.colorLead1, result.effective.colorLead2], [null, null, null, null]);
    assert.equal(metricValues(result, 'dorn')[0].label, 'За налаштуванням');
    assert.equal(metricValues(result, 'matrix')[0].label, 'Із завдання');
    assert.equal(result.forecast.borrowedFrom.length, 0);
  }
});

test('thread table exposes only known diameters and a single mode instead of the internal section slot', () => {
  const values = tableSetups({}, id);
  assert.deepEqual(values.map(info => info.finalDiameter), [1.5, 1.7, 2.1]);
  assert(values.every(info => info.mode === 'single' && info.noDye));
  const actual = measurement({ finalDiameter: 1.8, extruder1: 64, maxSpeed: 600 });
  assert.deepEqual(tableSetups({ calibrations: [actual] }, id).map(info => info.finalDiameter), [1.5, 1.7, 1.8, 2.1]);
});

test('thread admin values stay specific to the final diameter and cannot establish SIKORA or dye settings', () => {
  const own = measurement({ finalDiameter: 1.8, extruder1: 64, maxSpeed: 600, sikoraWire: .3, sikoraOuter: 1.2, dorn: 8, matrix: 9, colorLead1: 50 });
  const unsized = measurement({ extruder1: 9999, maxSpeed: 9999 }, { id: 'legacy-unsized' });
  const dual = measurement({ finalDiameter: 1.8, extruder1: 9999, extruder2: 9999, maxSpeed: 9999 }, { mode: 'dual', id: 'legacy-dual' });
  const catalog = { calibrations: [own, unsized, dual] };
  const actual = setupFor(id, 1, catalog, 'black', { finalDiameter: 1.8 });
  assert.deepEqual([actual.effective.extruder1, actual.effective.workingSpeed], [64, 600]);
  assert.equal(actual.sources.extruder1, 'practical');
  assert.equal(actual.sources.workingSpeed, 'practical');
  assert.deepEqual([actual.effective.dorn, actual.effective.matrix], [.95, 2]);
  assert.equal(actual.effective.sikoraOuter, null);
  assert.equal(actual.effective.colorLead1, null);
  const next = setupFor(id, 1, catalog, 'black', { finalDiameter: 1.9 });
  assert.equal(next.sources.extruder1, 'forecast');
  assert.notEqual(next.effective.extruder1, 64);
  assert(next.effective.extruder1 < 100);
});

test('thread records never train metallic estimates and metal records do not change thread settings', () => {
  const metal = referenceCard(optionFor('h07v-k--h07v-k'));
  const metalRow = metal.rows.find(row => row.section === 4);
  const thread = measurement({ finalDiameter: 1.8, extruder1: 9999, maxSpeed: 9999 });
  assert.deepEqual(forecastFor(metal, metalRow, [thread], { optionId: 'h07v-k--h07v-k', mode: 'dual' }),
    forecastFor(metal, metalRow, [], { optionId: 'h07v-k--h07v-k', mode: 'dual' }));
  const baseline = setupFor(id, 1, {}, 'white', { finalDiameter: 1.8 });
  const withMetal = setupFor(id, 1, { recipes: RECIPES }, 'blue', { finalDiameter: 1.8 });
  assert.deepEqual(withMetal.effective, baseline.effective);
  const withdrawn = { ...thread, withdrawnAt: '2026-10-07T15:00:00Z' };
  assert.deepEqual(setupFor(id, 1, { calibrations: [withdrawn] }, 'white', { finalDiameter: 1.8 }).effective, baseline.effective);
});
