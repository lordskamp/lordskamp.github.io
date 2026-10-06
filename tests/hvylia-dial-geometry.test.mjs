import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreGuess } from '../api/hvylia-core.js';
import {
  DIAL_ARC, DIAL_GEOMETRY, angleForPosition, dialPoint, positionForAngle
} from '../hvylia/dial-geometry.js';

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);

test('the complete scoring fan stays above the physical window lip at every possible target', () => {
  const { centerX, centerY, faceRadius, shoulderOffsetX, shoulderOffsetY, sectorHalfWidth, clearanceDegrees } = DIAL_GEOMETRY;
  const lip = Math.atan2(shoulderOffsetY, shoulderOffsetX) * 180 / Math.PI;
  close(DIAL_ARC.lipDegrees, lip, 'lip angle');
  assert.ok(angleForPosition(-sectorHalfWidth) >= lip + clearanceDegrees);
  assert.ok(angleForPosition(100 + sectorHalfWidth) <= 180 - lip - clearanceDegrees);

  for (let step = 0; step <= 1000; step += 1) {
    const target = step / 10;
    for (const offset of [-10, -6, -2, 2, 6, 10]) {
      const [x, y] = dialPoint(target + offset, faceRadius);
      close(Math.hypot(x - centerX, y - centerY), faceRadius, `target ${target}, sector ${offset} radius`);
      // An independent half-plane check also covers the diagonal shoulders,
      // unlike checking only the circular face or the target's center line.
      const windowBottom = centerY - Math.abs(x - centerX) * shoulderOffsetY / shoulderOffsetX;
      assert.ok(y < windowBottom, `sector ${offset} at target ${target} crosses the navy lip`);
    }
  }
});

test('all five score labels clear the lip and shutter handle even at the extreme targets', () => {
  const { centerX, centerY, shoulderOffsetX, shoulderOffsetY } = DIAL_GEOMETRY;
  for (let step = 0; step <= 1000; step += 1) {
    for (const offset of [-8, -4, 0, 4, 8]) {
      const [x, y] = dialPoint(step / 10 + offset, 243);
      // Allow a 20px-wide numeral and a 6px descent below its y+5 baseline.
      // This is deliberately larger than the visible digit at the mobile 23px font size.
      const farthestX = Math.abs(x - centerX) + 10;
      const windowBottom = centerY - farthestX * shoulderOffsetY / shoulderOffsetX;
      assert.ok(y + 11 < windowBottom, `label ${offset} at target ${step / 10} crosses the lip`);
      assert.ok(y + 11 < 314, `label ${offset} at target ${step / 10} overlaps the handle`);
    }
  }
});

test('every normalized dial position is reachable and round-trips through its physical angle', () => {
  let previousAngle = null, stepSize = null;
  for (let step = 0; step <= 1000; step += 1) {
    const position = step / 10, angle = angleForPosition(position);
    close(positionForAngle(angle), position, `position ${position}`);
    if (previousAngle !== null) {
      assert.ok(angle > previousAngle);
      if (stepSize === null) stepSize = angle - previousAngle;
      else close(angle - previousAngle, stepSize, 'uniform angular spacing');
    }
    previousAngle = angle;
  }
  close(angleForPosition(0), DIAL_ARC.startDegrees, 'left endpoint');
  close(angleForPosition(100), DIAL_ARC.endDegrees, 'right endpoint');
  close(angleForPosition(50), 90, 'vertical midpoint');
  assert.equal(positionForAngle(-180), 0);
  assert.equal(positionForAngle(0), 0);
  assert.equal(positionForAngle(180), 100);
  assert.equal(positionForAngle(360), 100);
  assert.ok(angleForPosition(-10) < angleForPosition(0), 'the outer fan must extend past the selectable center range');
  assert.ok(angleForPosition(110) > angleForPosition(100));
});

test('pointer-angle conversion preserves existing decimal score boundaries and opponent sides', () => {
  const samples = [[0, 4], [2, 4], [2.1, 3], [6, 3], [6.1, 2], [10, 2], [10.1, 0]];
  for (let step = 0; step <= 1000; step += 1) {
    const target = step / 10;
    for (const direction of [-1, 1]) {
      for (const [distance, points] of samples) {
        const originalGuess = Math.round((target + direction * distance) * 10) / 10;
        if (originalGuess < 0 || originalGuess > 100) continue;
        // Real pointer input quantizes to a tenth after converting the angle.
        const guess = Math.round(positionForAngle(angleForPosition(originalGuess)) * 10) / 10;
        assert.equal(guess, originalGuess);
        const side = target < guess ? 'left' : target > guess ? 'right' : null;
        assert.deepEqual(scoreGuess(target, guess, side), {
          activePoints: points, opponentPoints: points !== 4 && side !== null ? 1 : 0
        }, `target ${target}, guess ${originalGuess}`);
      }
    }
  }
  // Old stored rounds may contain either endpoint. Their exact-center guesses
  // must still be reachable and earn four points after the rendering change.
  for (const target of [0, 100]) {
    assert.equal(scoreGuess(target, positionForAngle(angleForPosition(target)), null).activePoints, 4);
  }
});
