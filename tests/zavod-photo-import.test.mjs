import test from 'node:test';
import assert from 'node:assert/strict';
import { photoRowsToJobs, photoLengthStatus } from '../Zavod/photo-import.js';
import { applyMarkingSpeed } from '../Zavod/marking.js';
import { setupFor } from '../Zavod/setup-data.js';
import { baseline } from '../Zavod/store.js';
import { restorePlanner } from '../Zavod/plan-ui.js';
import { scheduleJobs } from '../Zavod/planner.js';

test('photo split lengths become separate drums for every listed colour', () => {
  const result = photoRowsToJobs([{ cableId: 'vvg3--vvgzng-p', section: 2.5, coreClass: 3,
    colors: ['yellow-green', 'blue', 'brown'], totalKm: '15,350', lengthsText: '10,200 + 5,150' }], () => 'photo-job');
  assert.deepEqual(result.errors, []);
  const scheduled = scheduleJobs(result.jobs);
  assert.deepEqual(scheduled.errors, []);
  assert.equal(scheduled.drums.length, 6);
  assert.equal(scheduled.drums.reduce((sum, row) => sum + Number(row.length), 0), 46050);
});

test('uncertain readings, mismatched totals and missing colours cannot generate jobs', () => {
  const valid = { cableId: 'pv3--pv3', section: 2.5, colors: ['blue'], totalKm: '15,350', lengthsText: '10,200 + 5,150' };
  for (const changes of [{ uncertain: true }, { totalKm: '15,360' }, { colors: [] }, { cableId: 'missing' }]) {
    const result = photoRowsToJobs([{ ...valid, ...changes }], () => 'id');
    assert(result.errors.length);
    assert.deepEqual(result.jobs, []);
  }
});

test('ideal colour and marking survive planning, with two extruders for black and yellow-green', () => {
  const result = photoRowsToJobs([{ cableId: 'pv3--pv3', section: '1,5/4', colors: ['blue', 'black', 'yellow-green'],
    lengthsText: '10', idealColor: true, marking: true }], () => 'photo');
  assert.deepEqual(result.errors, []);
  assert.equal(result.jobs[0].coreClass, 4);
  const scheduled = scheduleJobs(result.jobs);
  assert.deepEqual(scheduled.errors, []);
  for (const drum of scheduled.drums) {
    assert.equal(drum.coreClass, 4);
    assert.equal(drum.marking, true);
    assert.equal(drum.idealColor, true);
    assert.equal(drum.mode, drum.color === 'blue' ? 'single' : 'dual');
  }
  assert(photoRowsToJobs([{...result.jobs[0], section:'1,5/4', coreClass:5}]).errors.length);
});

test('marked cable never exceeds 150 m/min while a lower speed remains unchanged', () => {
  const info = setupFor('vvg', 1.5, baseline(), 'blue', {mode:'dual'});
  assert(info.effective.workingSpeed > 150);
  const marked = applyMarkingSpeed(info, true);
  assert.equal(marked.effective.workingSpeed,150);
  const slower = {...info, effective:{...info.effective,workingSpeed:120}};
  assert.equal(applyMarkingSpeed(slower,true).effective.workingSpeed,120);
  assert.equal(applyMarkingSpeed(info,false).effective.workingSpeed,info.effective.workingSpeed);
});

test('marking and ideal colour survive restoring saved tasks and drums', () => {
  const jobs = photoRowsToJobs([{cableId:'pv3--pv3',section:'1,5/4',colors:['blue'],lengthsText:'10',idealColor:true,marking:true}], () => 'saved').jobs;
  const drums = scheduleJobs(jobs).drums;
  const state = {cableId:'pv3--pv3',section:1.5,drums:[]};
  restorePlanner({jobs,planJobs:jobs,drums},state);
  assert.equal(state.jobs[0].marking,true);
  assert.equal(state.jobs[0].idealColor,true);
  assert.equal(state.drums[0].marking,true);
  assert.equal(state.drums[0].idealColor,true);
  assert.equal(state.drums[0].coreClass,4);
});

test('photo drum lengths show their per-colour sum and flag disagreements with the sheet', () => {
  assert.deepEqual(photoLengthStatus('10,200 + 5,150', '15,350'), { warning:false, message:'Разом: 15,35 км на кожен колір · збігається з фото' });
  assert.equal(photoLengthStatus('10,200 + 5,150', '15,360').warning, true);
  assert.equal(photoLengthStatus('', '15,350').warning, true);
  assert.match(photoLengthStatus('', '15,350').message, /довжини барабанів/);
  assert.equal(photoLengthStatus('2x8,130', '').warning, false);
  assert.equal(photoLengthStatus('нечитабельно', '15,350').warning, true);
});
