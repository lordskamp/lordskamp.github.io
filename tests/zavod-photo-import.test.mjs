import test from 'node:test';
import assert from 'node:assert/strict';
import { photoRowsToJobs } from '../Zavod/photo-import.js';
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
