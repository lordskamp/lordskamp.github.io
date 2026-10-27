import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_CALIBRATIONS } from '../Zavod/calibration-snapshot.js';
import { REFERENCE_CARDS } from '../Zavod/reference-data.js';
import { forecastFor } from '../Zavod/forecast.js';
import { threadSettings, THREAD_OPERATOR_ANCHORS } from '../Zavod/thread-settings.js';

test('unseen H05V-K measurements validate RPM and geometry at recorded line speeds', () => {
  const id = 'h07v-k--h05v-k';
  const excluded = PUBLIC_CALIBRATIONS.filter(record => record.optionId === id);
  const training = PUBLIC_CALIBRATIONS.filter(record => record.optionId !== id)
    .map(record => ({ ...record, origin: 'measurement' }));
  const card = REFERENCE_CARDS.find(item => item.id === 'h07v-k');
  const observations = [
    { section: .5, speed: 150, rpm: [24, 60], sikora: [.9, 2.35] },
    { section: .75, speed: 160, rpm: [26.5, 80], sikora: [1.12, 2.55] },
    { section: 1, speed: 150, rpm: [28, 80], sikora: [1.26, 2.63] }
  ];
  for (const sample of observations) {
    const row = card.rows.find(value => value.section === sample.section);
    const result = forecastFor(card, row, training, { optionId: id, mode: 'dual', workingSpeed: sample.speed });
    assert.equal(result.rpmSpeedBasis.extruder1, sample.speed);
    assert.equal(result.rpmSpeedBasis.extruder2, sample.speed);
    assert(Math.abs(result.extruder1 / sample.rpm[0] - 1) < .1, String(sample.section));
    assert(Math.abs(result.extruder2 / sample.rpm[1] - 1) < .2, String(sample.section));
    assert(Math.abs(result.sikoraWire - sample.sikora[0]) <= .04, String(sample.section));
    assert(Math.abs(result.sikoraOuter - sample.sikora[1]) <= .03, String(sample.section));
    assert(Object.values(result.fieldAnchors).flat().every(anchor => !excluded.some(item => item.id === anchor.measurementId)));
  }
  const single = forecastFor(card, card.rows.find(row => row.section === .5), training, { optionId: id, mode: 'single', workingSpeed: 150 });
  assert.equal(single.rpmSpeedBasis.extruder1, 150);
  assert(Math.abs(single.extruder1 / 28 - 1) < .1, 'single-mode holdout at the recorded speed');
  assert(single.fieldAnchors.extruder1.every(anchor => training.some(record => (record.measurementId ?? record.id) === anchor.measurementId && record.maxSpeed > 0)));
});

test('thread RPM is tested against each hidden bundled anchor at its actual speed', () => {
  for (const observation of THREAD_OPERATOR_ANCHORS) {
    const training = THREAD_OPERATOR_ANCHORS.filter(record => record.id !== observation.id);
    const result = threadSettings(observation.finalDiameter, {}, { operatorAnchors: training });
    const predicted = result.extruder1 * observation.maxSpeed / result.workingSpeed;
    assert(Math.abs(predicted / observation.extruder1 - 1) < .05);
    assert(!result.anchors.some(anchor => anchor.finalDiameter === observation.finalDiameter));
    assert.equal(result.fieldConfidence.extruder1, 'low');
  }
});

test('SIKORA outer uses matrix plus 0.15 when no exact operating measurement exists', () => {
  const card = REFERENCE_CARDS.find(item => item.id === 'h07v-k');
  const row = card.rows.find(item => item.section === .5);
  const result = forecastFor(card, row, [], { optionId: 'h07v-k--h05v-k', mode: 'dual', matrix: 2.2 });
  assert.equal(result.sikoraOuter, 2.35);
  assert.equal(result.fieldMethods.sikoraOuter, 'matrix-operator-allowance');
});
