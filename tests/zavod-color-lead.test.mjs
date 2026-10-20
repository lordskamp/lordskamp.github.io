import assert from 'node:assert/strict';
import test from 'node:test';
import { COLOR_LEAD2_ANCHORS, estimateColorLead2, scaleColorLead } from '../Zavod/color-lead.js';

test('operator approximate advances apply to extruder 2 and retain all five confirmed class/section anchors', () => {
  assert.equal(COLOR_LEAD2_ANCHORS.length, 5);
  for (const { conductorClass, section, lead } of COLOR_LEAD2_ANCHORS) {
    const result = estimateColorLead2({ conductorClass, section });
    assert.equal(result.value, lead);
    assert.equal(result.extruder, 2);
    assert.equal(result.method, 'operator-anchor');
    assert.equal(result.source, 'forecast');
    assert.equal(result.approximate, true);
    assert.equal(result.confidence, 'low');
    assert.equal(result.anchors[0].rpm, undefined, 'no screw speed is fabricated for an operator anchor');
  }
});

test('exact own lead wins over class defaults, including a recorded zero and unlisted conductor classes', () => {
  for (const practicalLead of [0, 300, 1450]) {
    const result = estimateColorLead2({ conductorClass: 5, section: 1.5, practicalLead });
    assert.equal(result.value, practicalLead);
    assert.equal(result.source, 'practical');
    assert.equal(result.approximate, false);
  }
  assert.equal(estimateColorLead2({ conductorClass: 3, section: 4, practicalLead: 800 }).value, 800);
  assert.equal(estimateColorLead2({ conductorClass: 5, section: 1.5, practicalLead: '' }).value, 1600);
});

test('between-anchor estimates remain approximate and never silently extrapolate unsupported sections or classes', () => {
  assert.equal(estimateColorLead2({ conductorClass: 5, section: 2 }).value, 1400);
  assert.equal(estimateColorLead2({ conductorClass: 1, section: '2,0' }).value, 1750);
  assert.equal(estimateColorLead2({ conductorClass: 5, section: 1.25 }).value, 1750);
  assert.equal(estimateColorLead2({ conductorClass: 5, section: 2 }).method, 'operator-interpolation');
  for (const input of [{ conductorClass: 3, section: 1.5 }, { conductorClass: 4, section: 2.5 },
    { conductorClass: 5, section: 6 }, { conductorClass: 1, section: 1 }, { conductorClass: 5, section: '' }]) {
    assert.equal(estimateColorLead2(input).value, null);
  }
});

test('single operation, undyed products and threads cannot receive a second-extruder dye instruction', () => {
  for (const changes of [{ mode: 'single' }, { mode: 'unknown' }, { noDye: true }, { coreKind: 'thread' }]) {
    const result = estimateColorLead2({ conductorClass: 5, section: 1.5, practicalLead: 300, ...changes });
    assert.equal(result.value, null);
    assert.ok(result.reason);
  }
});

test('residence scaling preserves metre lead when line speed and the same screw RPM scale together', () => {
  const known = { lead: 1600, baseSpeed: 250, baseRpm: 100, speed: 300, rpm: 120, sameMaterial: true, sameExtruder: true };
  const original = structuredClone(known);
  assert.equal(scaleColorLead(known).value, 1600);
  assert.equal(scaleColorLead({ ...known, rpm: 100 }).value, 1920, 'unchanged RPM with faster wire extends transition length');
  assert.equal(scaleColorLead({ ...known, speed: 250, rpm: 125 }).value, 1280, 'greater turnover shortens approximate residence length');
  assert.equal(scaleColorLead(known).confidence, 'low');
  assert.deepEqual(known, original);
});

test('residence scaling needs measured speeds and RPM plus an explicitly unchanged material and extruder', () => {
  const known = { lead: 1600, baseSpeed: 250, baseRpm: 100, speed: 300, rpm: 120, sameMaterial: true, sameExtruder: true };
  for (const changes of [{ sameMaterial: false }, { sameExtruder: false }, { sameMaterial: undefined },
    { baseRpm: null }, { baseSpeed: '' }, { rpm: 0 }, { speed: Infinity }, { lead: -1 }]) {
    assert.equal(scaleColorLead({ ...known, ...changes }).value, null);
  }
  assert.equal(scaleColorLead({ lead: 1600, speed: 300, rpm: 120 }).value, null, 'operator anchors alone are not a speed/RPM calibration');
});
