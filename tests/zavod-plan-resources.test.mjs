import assert from 'node:assert/strict';
import test from 'node:test';
import { conductorRequirements, estimateShift, parseCorePieces, requiredTools, SHIFT_DEFAULTS, shiftSettings } from '../Zavod/plan-resources.js';
import { duplicateJob, newJob, restorePlanner } from '../Zavod/plan-ui.js';
import { expandJobs, productionSummary, scheduleJobs } from '../Zavod/planner.js';
import { planDrum } from '../Zavod/core.js';
import { optionFor } from '../Zavod/catalog-base.js';

const drum = (extra = {}) => ({ id: 'one', cableId: 'pv3', section: 2.5, coreClass: 3, color: 'blue', length: '15000', ...extra });
const zeroTime = Object.fromEntries(Object.keys(SHIFT_DEFAULTS).map(key => [key, 0]));
const setup = (extra = {}) => ({ mode: 'single', reference: { workingSpeed: 100 }, effective: { dorn: 2, matrix: 3, workingSpeed: 200 }, ...extra });

test('core inventory pools all colours and jobs once, with separate conductor classes', () => {
  const drums = [drum(), drum({ id: 'two', jobId: 'other', color: 'brown' }), drum({ id: 'three', color: 'white' }), drum({ id: 'four', coreClass: 4, length: '18000' })];
  const before = structuredClone(drums);
  const groups = conductorRequirements(drums, { '2.5:3': { piecesText: '3000, 5000' } });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].totalMetres, 45000);
  assert.equal(groups[0].fullMetres, 18500);
  assert.equal(groups[0].piecesMetres, 8000);
  assert.equal(groups[0].fullDrums, 2);
  assert.equal(groups[0].leftover, 0);
  assert.equal(groups[1].fullMetres, 18000);
  assert.equal(groups[1].fullDrums, 1);
  assert.deepEqual(drums, before);
});

test('6 / class 3 defaults to 8 km and permits the operator 7.2 km alternative', () => {
  const rows = [drum({ section: 6 })];
  assert.equal(conductorRequirements(rows)[0].fullDrums, 2);
  const alternate = conductorRequirements(rows, { '6:3': { fullLengthKm: '7,2' } })[0];
  assert.equal(alternate.fullMetres, 7200);
  assert.equal(alternate.fullDrums, 3);
  assert.equal(alternate.leftover, 6600);
});

test('unknown capacities stay unknown, sufficient pieces need no full drum, and threads need no metallic inventory', () => {
  const unknown = drum({ section: 4, coreClass: 4 });
  assert.equal(conductorRequirements([unknown])[0].fullDrums, null);
  const supplied = conductorRequirements([unknown], { '4:4': { piecesText: '5000, 10000' } })[0];
  assert.equal(supplied.fullDrums, 0);
  assert.equal(supplied.leftover, 0);
  assert.deepEqual(conductorRequirements([drum({ cableId: 'thread-bundle' })]), []);
  assert.equal(conductorRequirements([drum({ coreClass: undefined })])[0].coreClass, null);
});

test('checking off output drums never recycles input pieces into the same task', () => {
  const rows = [drum(), drum({ id: 'two' })], stock = { '2.5:3': { piecesText: '12000' } };
  const initial = conductorRequirements(rows, stock)[0];
  const progressed = conductorRequirements(rows.map((item, index) => ({ ...item, status: index ? 'queued' : 'done' })), stock)[0];
  assert.equal(initial.fullDrums, 1);
  assert.equal(progressed.fullDrums, initial.fullDrums);
  assert.equal(progressed.totalMetres, 30000);
  assert.equal(progressed.remainingMetres, 15000);
});

test('piece and full-capacity validation never produces partial or fractional-metre instructions', () => {
  assert.deepEqual(parseCorePieces('3200, 5400; 1000\n2000'), { pieces: [3200, 5400, 1000, 2000], total: 11600, errors: [] });
  assert.deepEqual(parseCorePieces(''), { pieces: [], total: 0, errors: [] });
  for (const text of ['3200,', '3.2', '0', '-10', 'ten', '1,,2', '9007199254740992', '9007199254740991, 1']) {
    const parsed = parseCorePieces(text);
    assert.equal(parsed.total, null, text);
    assert(parsed.errors.length, text);
    assert.equal(conductorRequirements([drum()], { '2.5:3': { piecesText: text } })[0].fullDrums, null);
  }
  for (const fullLengthKm of ['0', '-18', '18,5001', 'bad']) {
    const result = conductorRequirements([drum()], { '2.5:3': { fullLengthKm } })[0];
    assert.equal(result.fullDrums, null);
    assert(result.errors.length);
  }
});

test('12-hour forecast subtracts downtime and setup and prioritises reference speeds', () => {
  const result = estimateShift([drum({ length: '60000' })], () => setup(), { ...zeroTime, lunch: 60, alarms: 60, breaks: 30, startup: 30 });
  assert.equal(result.available, 570);
  assert.equal(result.runningMinutes, 600);
  assert.equal(result.requiredMinutes, 630);
  assert.equal(result.possibleMetres, 54000);
  assert.equal(result.completedDrums, 0);
  assert.equal(result.partial.metres, 54000);
  assert.equal(result.minimumShifts, 2);
  assert.equal(result.rows[0].source, 'reference');
  assert.equal(result.fits, false);
});

test('shift forecast follows queue order, includes partial drums, excludes done work and counts real changes', () => {
  const rows = [drum({ status: 'done' }), drum({ id: 'second', length: '30000' }), drum({ id: 'third', section: 6, color: 'white', length: '30000' })];
  const result = estimateShift(rows, item => setup({ effective: { dorn: item.section === 6 ? 3 : 2, matrix: 4 } }), { ...zeroTime, lunch: 60, drum: 5, conductor: 10, tooling: 20, color: 8 });
  assert.equal(result.pendingCount, 2);
  assert.equal(result.setupMinutes, 48);
  assert.equal(result.possibleMetres, 60000);
  assert.equal(result.completedDrums, 2);
  assert.equal(result.partial, null);
  assert.equal(result.fits, true);
  const reordered = estimateShift([drum({ length: '100000' }), drum({ id: 'short', length: '1000' })], () => setup(), zeroTime);
  assert.equal(reordered.completedDrums, 0, 'cannot skip the long first drum to finish a later short drum');
  assert.equal(reordered.possibleMetres, 72000);
});

test('missing speeds block all downstream forecasts while a sourced working speed may fill a missing reference', () => {
  const rows = [drum({ length: '1000' }), drum({ id: 'unknown' }), drum({ id: 'third' })];
  const result = estimateShift(rows, item => item.id === 'unknown' ? {} : setup(), zeroTime);
  assert.equal(result.blocked, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.possibleMetres, 1000);
  assert.equal(result.requiredMinutes, null);
  assert.equal(result.fits, false);
  const fallback = estimateShift([rows[0]], () => setup({ reference: {}, sources: { workingSpeed: 'practical' } }), zeroTime);
  assert.equal(fallback.rows[0].speed, 200);
  assert.equal(fallback.fallbackSpeeds, 1);
  assert.equal(estimateShift(rows, () => setup(), { ...zeroTime, lunch: 720 }).possibleMetres, 0);
  assert.equal(estimateShift([], () => setup(), zeroTime).minimumShifts, 0);
});

test('tool list deduplicates colours, retains class differences and shaped tool text, and leaves unknown tools empty', () => {
  const rows = [drum(), drum({ id: 'brown', color: 'brown' }), drum({ id: 'class-4', coreClass: 4 }), drum({ id: 'other', section: 6 })];
  const tools = requiredTools(rows, item => item.section === 6 ? {} : setup({ effective: { dorn: '2 × 1,5', matrix: '3 × 2,5' } }));
  assert.equal(tools.length, 3);
  assert.equal(tools[0].drumCount, 2);
  assert.equal(tools[0].dorn, '2 × 1,5');
  assert.equal(tools[1].coreClass, 4);
  assert.equal(tools[2].dorn, null);
});

test('duplicate job copies every production parameter with an independent colour list and new identity', () => {
  const previous = newJob(optionFor('pv3').id, 2.5, { coreClass: 4, colors: ['white', 'black'], lengthsText: '2×6 + 4', mode: 'dual', urgent: true, batchSize: 2 });
  const next = duplicateJob(previous);
  assert.notEqual(next.id, previous.id);
  assert.deepEqual({ ...next, id: previous.id }, previous);
  next.colors.pop();
  assert.deepEqual(previous.colors, ['white', 'black']);
  const thread = newJob('thread-bundle', 1, { finalDiameter: '1,7', lengthsText: '6' });
  assert.equal(duplicateJob(thread).finalDiameter, '1,7');
});

test('colours define strand count regardless of obsolete saved cores, and class changes reset physical progress', () => {
  const task = newJob(optionFor('pv3').id, 2.5, { id: 'task', coreClass: 3, colors: ['white', 'blue'], lengthsText: '1' });
  for (const cores of [undefined, 0, 1, 9, 'invalid']) {
    const result = expandJobs([{ ...task, cores }]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.drums.length, 2);
    assert(result.drums.every(item => item.coreClass === 3));
  }
  const completed = scheduleJobs([task]).drums.map(item => ({ ...item, status: 'done' }));
  const changed = scheduleJobs([{ ...task, coreClass: 4 }], completed);
  assert(changed.drums.every(item => item.coreClass === 4 && item.status === 'queued'));
  assert(changed.warnings.length);
  assert.equal(productionSummary(completed.map(item => ({ ...item, coreClass: 4 })), [task]).ready[0].readyMetres, 0);
  const transition = planDrum(drum(), drum({ coreClass: 4, color: 'brown' }), 'dual');
  assert.equal(transition.cableChange, true);
  assert.equal(transition.transition, false);
  assert.equal(transition.target, 14850);
});

test('classes, inventory, shift assumptions and undo metadata survive restoration without altering source', () => {
  const task = newJob(optionFor('pv3').id, 2.5, { coreClass: 4, lengthsText: '1', colors: ['white'] });
  const saved = { jobs: [task], planJobs: [task], drums: scheduleJobs([task]).drums, coreStock: { '2.5:4': { fullLengthKm: '18', piecesText: '500, 800' } }, shiftSettings: { alarms: 130 },
    previousPlan: { planJobs: [task], drums: scheduleJobs([task]).drums, manualOrder: true } };
  const before = structuredClone(saved), state = { cableId: optionFor('pv3').id, section: 2.5 };
  restorePlanner(saved, state);
  assert.deepEqual(state.coreStock, saved.coreStock);
  assert.equal(state.shiftSettings.alarms, 130);
  assert.equal(state.shiftSettings.lunch, 60);
  assert.equal(state.jobs[0].coreClass, 4);
  assert.equal(state.drums[0].coreClass, 4);
  assert.equal(state.previousPlan.drums[0].coreClass, 4);
  assert.deepEqual(saved, before);
  assert.deepEqual(shiftSettings({ alarms: -1, lunch: 'oops', breaks: 721 }), SHIFT_DEFAULTS);
});
