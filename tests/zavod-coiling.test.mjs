import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProduction, coilLength } from '../Zavod/coiling.js';
import { scheduleJobs } from '../Zavod/planner.js';

test('coil lengths use only confirmed brand and section pairs', () => {
  for (const [brand, section, expected] of [
    ['ПВ1', .5, 300], ['ПВ3', 1, 300], ['ПВ3', 1.5, 200],
    ['ПВ1', 2.5, 100], ['ПВ3', 6, 100], ['H05V-K', .5, 200],
    ['H05V-U', .75, 100], ['H07V-K', 6, 100], ['H07V-U', 1, 100],
    ['ПВ3нг', 1, null], ['H05V-K', 10, null]
  ]) assert.equal(coilLength(brand, section), expected);
});

test('faults and actual joints are distinct on ordinary wire', () => {
  const fault = calculateProduction(1000, '250', '', false, null);
  const joint = calculateProduction(1000, '', '250', false, null);
  assert.equal(fault.target, 1000);
  assert.equal(joint.target, 1030);
  assert.equal(joint.splice.label, '(250+750)');
  assert.equal(calculateProduction(1000, '', '', false, null).target, 1000);
});

test('coiling keeps planned count after fault or joint and adds only incomplete portions', () => {
  for (const [fault, joint] of [['250', ''], ['', '250']]) {
    const result = calculateProduction(1000, fault, joint, true, 100);
    assert.deepEqual([result.coils, result.waste, result.target], [10, 50, 1050]);
    assert.deepEqual(result.errors, []);
  }
  const result = calculateProduction(1000, '250; 700', '1040', true, 100);
  assert.deepEqual([result.coils, result.waste, result.target], [10, 140, 1140]);
  assert.ok(calculateProduction(1000, '', '', true, null).errors.length);
});

test('task generation and regeneration keep coiling choice and recorded marks', () => {
  const job = { id: 'j', cableId: 'pv3', section: 2.5, colors: ['blue'], lengthsText: '1', coiling: true };
  const first = scheduleJobs([job]).drums;
  assert.equal(first[0].coiling, true);
  first[0].breakdowns = '250'; first[0].joints = '700';
  const again = scheduleJobs([job], first).drums[0];
  assert.equal(again.coiling, true);
  assert.equal(again.breakdowns, '250');
  assert.equal(again.joints, '700');
  assert.equal(scheduleJobs([{ ...job, coiling: false }], [again]).drums[0].coiling, undefined);
});
