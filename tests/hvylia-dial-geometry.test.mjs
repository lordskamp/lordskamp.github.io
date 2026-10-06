import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME_CONFIG, scoreGuess } from '../api/hvylia-core.js';
import {
  DIAL_ARC, DIAL_GEOMETRY, DIAL_SECTOR_BOUNDARIES, angleForPosition, dialPoint, positionForAngle
} from '../hvylia/dial-geometry.js';

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);

test('rendered five sectors share the authoritative scoring boundaries and retain their proportions', () => {
  assert.deepEqual(GAME_CONFIG.sectorHalfWidths, [2.4, 7.2, 12]);
  assert.deepEqual(DIAL_SECTOR_BOUNDARIES, [-12, -7.2, -2.4, 2.4, 7.2, 12]);
  assert.ok(Object.isFrozen(DIAL_SECTOR_BOUNDARIES));
  assert.equal(DIAL_GEOMETRY.sectorHalfWidth, GAME_CONFIG.sectorHalfWidths[2]);
  assert.equal(DIAL_GEOMETRY.centerSectorHalfWidth, GAME_CONFIG.sectorHalfWidths[0]);
  for (let index = 0; index < 5; index += 1) {
    close(DIAL_SECTOR_BOUNDARIES[index + 1] - DIAL_SECTOR_BOUNDARIES[index], 4.8, `sector ${index} width`);
  }
});

test('the four-point wedge stays exposed at every target while outer wedges may hide behind the body', () => {
  const { centerX, centerY, faceRadius, shoulderOffsetX, shoulderOffsetY, sectorHalfWidth, centerSectorHalfWidth, clearanceDegrees } = DIAL_GEOMETRY;
  const lip = Math.atan2(shoulderOffsetY, shoulderOffsetX) * 180 / Math.PI;
  close(DIAL_ARC.lipDegrees, lip, 'lip angle');
  assert.ok(angleForPosition(-centerSectorHalfWidth) >= lip + clearanceDegrees);
  assert.ok(angleForPosition(100 + centerSectorHalfWidth) <= 180 - lip - clearanceDegrees);
  // Do not compress the range to expose the entire five-sector fan: the
  // original game permits the outer 3/2 wedges to be covered at either edge.
  assert.ok(angleForPosition(-sectorHalfWidth) < lip);
  assert.ok(angleForPosition(100 + sectorHalfWidth) > 180 - lip);
  const outerLabelOffset = (GAME_CONFIG.sectorHalfWidths[1] + sectorHalfWidth) / 2;
  assert.ok(angleForPosition(-outerLabelOffset) < 0, 'left outer two-point wedge is behind the body');
  assert.ok(angleForPosition(100 + outerLabelOffset) > 180, 'right outer two-point wedge is behind the body');

  for (let step = 0; step <= 1000; step += 1) {
    const target = step / 10;
    for (const offset of [-centerSectorHalfWidth, 0, centerSectorHalfWidth]) {
      const [x, y] = dialPoint(target + offset, faceRadius);
      close(Math.hypot(x - centerX, y - centerY), faceRadius, `target ${target}, sector ${offset} radius`);
      // An independent half-plane check also covers the diagonal shoulders,
      // unlike checking only the circular face or the target's center line.
      const windowBottom = centerY - Math.abs(x - centerX) * shoulderOffsetY / shoulderOffsetX;
      assert.ok(y < windowBottom, `sector ${offset} at target ${target} crosses the navy lip`);
    }
  }
});

test('the four-point label clears the lip and shutter handle even at the extreme targets', () => {
  const { centerX, centerY, shoulderOffsetX, shoulderOffsetY } = DIAL_GEOMETRY;
  for (let step = 0; step <= 1000; step += 1) {
    const [x, y] = dialPoint(step / 10, 243);
    // Bound the 23px numeral around its y+5 baseline, then rotate each corner
    // exactly as the tangential label does. This covers either extreme angle.
    const rotation = (angleForPosition(step / 10) - 90) * Math.PI / 180;
    for (const offsetX of [-10, 10]) for (const offsetY of [-18, 11]) {
      const cornerX = x + offsetX * Math.cos(rotation) - offsetY * Math.sin(rotation);
      const cornerY = y + offsetX * Math.sin(rotation) + offsetY * Math.cos(rotation);
      const windowBottom = centerY - Math.abs(cornerX - centerX) * shoulderOffsetY / shoulderOffsetX;
      assert.ok(cornerY < windowBottom, `four-point label at target ${step / 10} crosses the lip`);
      assert.ok(cornerY < 314, `four-point label at target ${step / 10} overlaps the handle`);
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
  assert.ok(angleForPosition(-DIAL_GEOMETRY.sectorHalfWidth) < angleForPosition(0), 'the outer fan must extend past the selectable center range');
  assert.ok(angleForPosition(100 + DIAL_GEOMETRY.sectorHalfWidth) > angleForPosition(100));
});

test('pointer-angle conversion preserves shared decimal score boundaries and opponent sides', () => {
  const samples = [[0, 4], [2.4, 4], [2.5, 3], [7.2, 3], [7.3, 2], [12, 2], [12.1, 0]];
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
