import assert from 'node:assert/strict';
import test from 'node:test';
import { speedRpm } from '../Zavod/rpm.js';
import { speedKey, speedLimit, speedSetup } from '../Zavod/speed-override.js';
import { setupFor } from '../Zavod/setup-data.js';

const base = (changes = {}) => ({
  option: { id: 'h07v-k--h07v-k' }, row: { section: 2.5, maxSpeed: 400 }, mode: 'dual', color: 'blue',
  effective: { extruder1: 53.7, extruder2: 72.2, workingSpeed: 150, matrix: 3.6 },
  practical: { extruder1: 53.7, extruder2: 72.2, workingSpeed: 150 },
  reference: { workingSpeed: 400 }, sources: { extruder1: 'practical', extruder2: 'practical', workingSpeed: 'practical', matrix: 'practical' },
  stages: { first: 40, second: 100, working: 150, source: 'practical' }, ...changes,
});

test('manual speed adjusts both extruders from one measured pair without changing measurements', () => {
  const info = base(), original = structuredClone(info);
  const result = speedSetup(info, 100);
  assert.equal(result.error, null);
  assert.equal(result.info.effective.extruder1, 35.8);
  assert.equal(result.info.effective.extruder2, 48.1);
  assert.equal(result.info.effective.workingSpeed, 100);
  assert.equal(result.info.effective.matrix, 3.6);
  assert.equal(result.info.sources.extruder1, 'manual');
  assert.deepEqual(result.info.stages, { first: 40, second: 80, working: 100, source: 'manual' });
  assert.deepEqual(info, original);
});

test('manual speed always scales the original pair and reset preserves exact practical RPM', () => {
  const info = base();
  speedSetup(info, 100);
  assert.equal(speedSetup(info, 80).info.effective.extruder1, 28.6);
  assert.strictEqual(speedSetup(info, 150).info, info);
  const widePair = base({ effective: { extruder1: 30, extruder2: 85, workingSpeed: 150 } });
  assert.equal(speedSetup(widePair, 150).info.effective.extruder2, 85);
  assert.equal(speedSetup(widePair, 100).info.effective.extruder2, 56.7);
});

test('same physical mode shares a saved speed while option, section and mode isolate it', () => {
  const info = base();
  assert.equal(speedKey(info), speedKey(base({ color: 'yellow-green' })));
  assert.notEqual(speedKey(info), speedKey(base({ mode: 'single' })));
  assert.notEqual(speedKey(info), speedKey(base({ row: { section: 4 } })));
  assert.notEqual(speedKey(info), speedKey(base({ option: { id: 'pv3--pv3' } })));
});

test('printer speed can be raised to a known reference maximum but never above known values', () => {
  const info = base();
  assert.equal(speedLimit(info), 400);
  assert.equal(speedSetup(info, 400).error, null);
  assert.equal(speedSetup(info, 401).info, info);
  assert.match(speedSetup(info, 401).error, /400/);
  assert.equal(speedSetup(info, '120,5').info.effective.workingSpeed, 120.5);
  for (const target of ['', 0, -3, 'abc', Infinity]) assert.ok(speedSetup(info, target).error);
});

test('derived dual RPM difference never exceeds 40, including a faster local speed', () => {
  const info = base({ effective: { extruder1: 50, extruder2: 80, workingSpeed: 100 } });
  const result = speedSetup(info, 300).info;
  assert.equal(result.effective.extruder1, 150);
  assert.equal(result.effective.extruder2, 190);
  assert.equal(result.stages.first, 80);
  assert.ok(result.stages.second > 80 && result.stages.second < 300);
});

test('single mode keeps second extruder off and unavailable modes cannot produce adjusted RPM', () => {
  const info = base({ mode: 'single', effective: { extruder1: 75, extruder2: 0, workingSpeed: 150 } });
  const result = speedSetup(info, 100).info;
  assert.equal(result.effective.extruder1, 50);
  assert.equal(result.effective.extruder2, null);
  assert.equal(speedRpm({ mode: 'unknown', extruder1: 40, extruder2: 50, maxSpeed: 100 }, 80).first, null);
  assert.equal(speedRpm({ mode: 'dual', extruder1: 40, extruder2: null, maxSpeed: 100 }, 80).first, null);
  assert.equal(speedRpm({ mode: 'single', extruder1: 40, maxSpeed: null }, 80).first, null);
});

test('thread speed adjustment scales the known practical pair for the selected diameter', () => {
  for (const [diameter, target, expected] of [[1.5, 600, 42.9], [1.7, 600, 54.5], [2.1, 700, 98.9], [1.8, 700, 71.8]]) {
    const info = setupFor('thread-bundle', 1, {}, 'white', { finalDiameter: diameter });
    const original = structuredClone(info);
    const result = speedSetup(info, target);
    assert.equal(result.error, null);
    assert.equal(result.info.effective.extruder1, expected);
    assert.equal(result.info.effective.extruder2, null);
    assert.equal(result.info.effective.workingSpeed, target);
    assert.equal(result.info.rpmWorkingSpeed, target);
    assert.equal(result.info.rpmSpeedBasis.extruder1, target);
    assert.equal(result.info.noDye, true);
    assert.equal(result.info.effective.sikoraOuter, null);
    assert.equal(result.info.effective.matrix, info.effective.matrix);
    assert.deepEqual(info, original);
  }
});

test('thread overrides use separate normalized diameter keys and the known line speed limit', () => {
  const first = setupFor('thread-bundle', 1, {}, 'white', { finalDiameter: '1,5' });
  const same = setupFor('thread-bundle', 1, {}, 'blue', { finalDiameter: '1.50' });
  const other = setupFor('thread-bundle', 1, {}, 'white', { finalDiameter: 1.7 });
  assert.equal(speedKey(first), speedKey(same));
  assert.notEqual(speedKey(first), speedKey(other));
  assert.equal(speedLimit(first), 700);
  assert.match(speedSetup(first, 701).error, /700/);
  assert.strictEqual(speedSetup(first, 700).info, first);
  speedSetup(first, 600);
  assert.equal(speedSetup(first, 500).info.effective.extruder1, 35.7, 'each adjustment uses the unmodified practical pair');
});

test('a partial thread RPM without same-diameter speed cannot be scaled using the default 600', () => {
  const partial = { id: 'thread-partial', baseId: 'thread-bundle-1', optionId: 'thread-bundle', cableId: 'thread-bundle',
    origin: 'measurement', mode: 'single', section: 1, finalDiameter: 1.9, extruder1: 75, maxSpeed: null,
    updatedAt: '2026-10-08T12:00:00Z' };
  const catalog = { calibrations: [partial] };
  const info = setupFor('thread-bundle', 1, catalog, 'white', { finalDiameter: 1.9 });
  assert.equal(info.effective.extruder1, 75);
  assert.equal(info.effective.workingSpeed, 600);
  assert.equal(info.rpmSpeedBasis.extruder1, null);
  const result = speedSetup(info, 500);
  assert.strictEqual(result.info, info);
  assert.match(result.error, /швидкість, за якої записані ці оберти/);
  assert.strictEqual(speedSetup(info, 600).info, info, 'keeping the default does not pretend to recalculate a measurement');
  const known = setupFor('thread-bundle', 1, { calibrations: [partial, { ...partial, id: 'thread-speed', extruder1: null, maxSpeed: 700,
    updatedAt: '2026-10-08T13:00:00Z' }] }, 'white', { finalDiameter: 1.9 });
  assert.equal(speedSetup(known, 600).info.effective.extruder1, 64.3);
  const missing = setupFor('thread-bundle', 1, {}, 'white');
  assert.match(speedSetup(missing, 500).error, /фінальний діаметр/);
});
