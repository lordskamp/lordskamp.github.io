import assert from 'node:assert/strict';
import test from 'node:test';
import { THREAD_OPERATOR_ANCHORS, threadSettings, threadDiameters } from '../Zavod/thread-settings.js';

const own = (finalDiameter, extruder1, maxSpeed, extra = {}) => ({ id: `admin-${finalDiameter}`, optionId: 'thread-bundle',
  cableId: 'thread-bundle', section: 1, origin: 'measurement', mode: 'single', finalDiameter, extruder1, maxSpeed,
  updatedAt: '2026-10-07T12:00:00Z', ...extra });

test('all three operator examples remain exact practical pairs at their original speeds', () => {
  for (const anchor of THREAD_OPERATOR_ANCHORS) {
    const value = threadSettings(String(anchor.finalDiameter).replace('.', ','));
    assert.deepEqual([value.extruder1, value.workingSpeed], [anchor.extruder1, anchor.maxSpeed]);
    assert.equal(value.sources.extruder1, 'practical');
    assert.equal(value.sources.workingSpeed, 'practical');
    assert.equal(value.matrix, Math.round((anchor.finalDiameter + .2) * 1000) / 1000);
    assert.equal(value.dorn, .95);
    assert.equal(value.knownMaxSpeed, 700);
  }
});

test('an unmeasured diameter interpolates normalized RPM at the default speed with explicit low confidence', () => {
  const value = threadSettings(1.8);
  assert.equal(value.extruder1, 61.5);
  assert.equal(value.workingSpeed, 600);
  assert.equal(value.sources.extruder1, 'forecast');
  assert.equal(value.fieldMethods.extruder1, 'thread-area-interpolation');
  assert.equal(value.confidence, 'low');
  assert.deepEqual(value.usedAnchors, [1.7, 2.1]);
  assert.match(value.reason, /Орієнтовно/);
  let previous = 0;
  for (let i = 150; i <= 210; i++) {
    const current = threadSettings(i / 100);
    const normalized = current.extruder1 / current.workingSpeed;
    assert(normalized >= previous - .0002, `${i / 100}: ${normalized} < ${previous}`);
    previous = normalized;
  }
});

test('outside measured diameters extrapolation remains positive with an explicitly bounded area slope', () => {
  const low = threadSettings(1), high = threadSettings(4);
  for (const value of [low, high]) {
    assert.equal(value.fieldMethods.extruder1, 'thread-area-extrapolation');
    assert.equal(value.confidence, 'low');
    assert(value.extruder1 > 0);
  }
  assert(high.extruder1 / high.workingSpeed <= (84.8 / 600) * (4 ** 2 / 2.1 ** 2) + .001);
  assert(low.extruder1 < 50);
});

test('blank or invalid diameter keeps fixed dorn and default speed without inventing matrix or RPM', () => {
  for (const diameter of [undefined, null, '', ' ', 0, -1, 'bad', Infinity, 1001, '0x10', [], ['1.5']]) {
    const value = threadSettings(diameter);
    assert.equal(value.finalDiameter, null);
    assert.equal(value.extruder1, null);
    assert.equal(value.matrix, null);
    assert.equal(value.dorn, .95);
    assert.equal(value.workingSpeed, 600);
    assert.equal(value.noDye, true);
    assert.equal(value.extruder2, null);
  }
});

test('new own practical anchors correct neighbouring estimates and override the bundled exact example', () => {
  const catalog = { calibrations: [own('1,8', 66, 600), own(1.7, 70, 700)] };
  const direct = threadSettings(1.8, catalog);
  assert.deepEqual([direct.extruder1, direct.workingSpeed], [66, 600]);
  assert.equal(direct.sources.extruder1, 'practical');
  assert.equal(threadSettings(1.7, catalog).extruder1, 70);
  assert(threadSettings(1.9, catalog).extruder1 > threadSettings(1.9).extruder1);
  assert.deepEqual(threadDiameters(catalog), [1.5, 1.7, 1.8, 2.1]);
  catalog.calibrations.push(own(1.8, 72, 600, { id: 'newest', updatedAt: '2026-10-07T14:00:00Z' }));
  assert.equal(threadSettings(1.8, catalog).extruder1, 72);
});

test('paired RPM/speed training excludes legacy unsized, other-mode, other-brand and withdrawn values', () => {
  const baseline = threadSettings(1.8);
  const invalid = [own(null, 9999, 9999), own(1.8, 9999, 9999, { mode: 'dual' }), own(1.8, 9999, 9999, { optionId: 'pv3--pv3' }),
    own(1.8, 9999, 9999, { withdrawnAt: '2026-10-07T15:00:00Z' }), own(1.8, 9999, 9999, { deletedAt: '2026-10-07T15:00:00Z' })];
  assert.deepEqual(threadSettings(1.8, { calibrations: invalid }), baseline);
  const partial = own(1.9, 75, null);
  const exactPartial = threadSettings(1.9, { calibrations: [partial] });
  assert.equal(exactPartial.extruder1, 75);
  assert.equal(exactPartial.sources.extruder1, 'practical');
  assert.equal(exactPartial.rpmWorkingSpeed, null);
  assert.equal(exactPartial.confidence, 'low');
  const withPartial = threadSettings(2, { calibrations: [partial] });
  assert.equal(withPartial.extruder1, threadSettings(2).extruder1);
  assert(!withPartial.anchors.some(anchor => anchor.finalDiameter === 1.9));
});

test('a partial correction merges the earlier speed for the same diameter and corrects nearby forecasts', () => {
  const baseline = threadSettings(1.8);
  const rpmOnly = own(1.7, 70, null, { id: 'partial-rpm' });
  const catalog = { calibrations: [rpmOnly] };
  const actual = threadSettings(1.7, catalog);
  assert.deepEqual([actual.extruder1, actual.workingSpeed], [70, 700]);
  const recalculated = threadSettings(1.8, catalog);
  assert(recalculated.extruder1 > baseline.extruder1);
  assert.equal(recalculated.anchors.find(anchor => anchor.finalDiameter === 1.7).measurementId, 'partial-rpm');
  assert.equal(recalculated.anchors.find(anchor => anchor.finalDiameter === 1.7).speedMeasurementId, 'thread-operator-1-7');
  const speedOnly = own(1.7, null, 600, { id: 'partial-speed', updatedAt: '2026-10-07T14:00:00Z' });
  catalog.calibrations.push(speedOnly);
  assert.deepEqual([threadSettings(1.7, catalog).extruder1, threadSettings(1.7, catalog).workingSpeed], [70, 600]);
  assert(threadSettings(1.8, catalog).extruder1 > recalculated.extruder1);
  rpmOnly.withdrawnAt = '2026-10-07T15:00:00Z'; speedOnly.deletedAt = '2026-10-07T15:00:00Z';
  assert.equal(threadSettings(1.8, catalog).extruder1, baseline.extruder1);
});

test('a contradictory practical sample remains exact while nearby estimates retain a monotone normalized curve', () => {
  const catalog = { calibrations: [own(1.9, 30, 600)] };
  assert.equal(threadSettings(1.9, catalog).extruder1, 30);
  const low = threadSettings(1.85, catalog), high = threadSettings(1.95, catalog);
  assert(low.extruder1 / low.workingSpeed <= high.extruder1 / high.workingSpeed);
  assert.equal(low.confidence, 'low');
  assert.equal(high.confidence, 'low');
});
