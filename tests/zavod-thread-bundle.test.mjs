import assert from 'node:assert/strict';
import test from 'node:test';
import { RECIPES } from '../Zavod/data.js';
import { baseFor, optionFor, referenceCard } from '../Zavod/catalog-base.js';
import { forecastFor } from '../Zavod/forecast.js';
import { setupFor, tableSetups } from '../Zavod/setup-data.js';
import { modeFor } from '../Zavod/pv3-modes.js';

const id = 'thread-bundle';
const card = referenceCard(optionFor(id));
const row = card.rows[0];
const measurement = (values, extra = {}) => ({ ...baseFor(id, 1), baseId: baseFor(id, 1).id,
  optionId: id, id: 'thread-measurement', origin: 'measurement', mode: 'single', source: 'Замір', color: 'all',
  updatedAt: '2026-10-07T12:00:00Z', ...values, ...extra });

test('thread settings remain unknown without a genuine own measurement, for every colour', () => {
  const catalog = { recipes: RECIPES };
  for (const color of ['blue', 'brown', 'black', 'yellow-green']) {
    assert.equal(modeFor(optionFor(id), color), 'unknown');
    const result = setupFor(id, 1, catalog, color);
    assert.equal(result.mode, 'unknown');
    assert.equal(result.forecast.borrowedFrom.length, 0);
    for (const key of ['extruder1', 'extruder2', 'workingSpeed', 'sikoraWire', 'sikoraOuter', 'dorn', 'matrix']) {
      assert.equal(result.effective[key], null, `${color} ${key}`);
    }
    assert.deepEqual(result.stages, { first: null, second: null, working: null, source: null });
  }
});

test('a real thread measurement is practical for all colours and remains separate by extruder mode', () => {
  const single = measurement({ extruder1: 25, maxSpeed: 100, sikoraWire: .3, sikoraOuter: 1.2, dorn: .5, matrix: 1, colorLead1: 50 });
  const dual = measurement({ extruder1: 20, extruder2: 30, maxSpeed: 80, colorLead1: 40, colorLead2: 60 },
    { id: 'thread-dual', mode: 'dual', updatedAt: '2026-10-07T13:00:00Z' });
  const catalog = { recipes: RECIPES, calibrations: [single, dual] };
  for (const color of ['blue', 'brown', 'black', 'yellow-green']) {
    const info = setupFor(id, 1, catalog, color);
    assert.equal(info.mode, 'single');
    assert.deepEqual([info.effective.extruder1, info.effective.extruder2, info.effective.workingSpeed], [25, null, 100]);
    assert.equal(info.sources.extruder1, 'practical');
    assert.equal(info.sources.sikoraWire, 'practical');
    const dualInfo = setupFor(id, 1, catalog, color, { mode: 'dual' });
    assert.deepEqual([dualInfo.effective.extruder1, dualInfo.effective.extruder2, dualInfo.effective.workingSpeed], [20, 30, 80]);
    assert.equal(dualInfo.effective.sikoraWire, null, 'single-mode geometry is not an unknown-mode measurement');
  }
  assert.deepEqual(new Set(tableSetups(catalog, id).map(info => info.mode)), new Set(['single', 'dual']));
});

test('partial thread measurements merge own fields while unknown-mode geometry cannot establish RPM', () => {
  const first = measurement({ extruder1: 25, maxSpeed: 100, matrix: 1 });
  const newer = measurement({ extruder1: 27 }, { id: 'thread-partial', updatedAt: '2026-10-07T14:00:00Z' });
  const info = setupFor(id, 1, { calibrations: [first, newer] });
  assert.deepEqual([info.effective.extruder1, info.effective.workingSpeed, info.effective.matrix], [27, 100, 1]);
  assert.equal(info.effective.sikoraOuter, null, 'metallic section allowance cannot manufacture a thread diameter');
  const unknown = measurement({ sikoraWire: .2, matrix: .7, extruder1: 999, maxSpeed: 999 }, { mode: 'unknown' });
  const unconfirmed = setupFor(id, 1, { calibrations: [unknown] });
  assert.equal(unconfirmed.effective.matrix, .7);
  assert.equal(unconfirmed.effective.extruder1, null);
  assert.equal(unconfirmed.effective.workingSpeed, null);
});

test('thread records never train metallic estimates and metallic records never train thread estimates', () => {
  const metal = referenceCard(optionFor('h07v-k--h07v-k'));
  const metalRow = metal.rows.find(row => row.section === 4);
  const thread = measurement({ extruder1: 9999, extruder2: 9999, maxSpeed: 9999, sikoraWire: 20, sikoraOuter: 30, dorn: 22, matrix: 28 }, { mode: 'dual' });
  assert.deepEqual(forecastFor(metal, metalRow, [thread], { optionId: 'h07v-k--h07v-k', mode: 'dual' }),
    forecastFor(metal, metalRow, [], { optionId: 'h07v-k--h07v-k', mode: 'dual' }));
  const empty = forecastFor(card, row, RECIPES, { optionId: id });
  assert.equal(empty.mode, 'unknown');
  assert.deepEqual(empty.anchors, []);
  assert.deepEqual(empty.borrowedFrom, []);
  assert.equal(empty.extruder1, null);
  const withdrawn = { ...thread, withdrawnAt: '2026-10-07T15:00:00Z' };
  assert.deepEqual(forecastFor(card, row, [withdrawn], { optionId: id }), empty);
});
