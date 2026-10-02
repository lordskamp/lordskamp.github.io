import assert from 'node:assert/strict';
import test from 'node:test';
import { inferMeasurementMode, measurementRecords, measurementSignature, parseExtruderInput, refreshPendingMeasurements } from '../Zavod/measurement-input.js';
import { baseFor } from '../Zavod/catalog-base.js';
import { validateMeasurement } from '../api/zavod-worker.js';

const input = overrides => ({ baseId: baseFor('h07v-k--h07v-k', 2.5).id, optionId: 'h07v-k--h07v-k', section: 2.5, color: 'all', mode: 'dual', note: '', extruder1: '', extruder2: '', sikoraWire: '', sikoraOuter: '', dorn: '', matrix: '', maxSpeed: '', colorLead1: '', colorLead2: '', ...overrides });
const rpm = rows => rows.map(({ mode, extruder1, extruder2 }) => ({ mode, extruder1, extruder2 }));

test('decimal comma pairs are parsed in physical extruder order', () => {
  assert.deepEqual(parseExtruderInput(' 53,7 / 72,2 '), { kind: 'pair', values: [53.7, 72.2] });
  assert.deepEqual(parseExtruderInput('0'), { kind: 'off', value: 0 });
  assert.deepEqual(parseExtruderInput('75'), { kind: 'number', value: 75 });
});

test('single value plus paired second field saves independent single and dual RPM', () => {
  const rows = measurementRecords(input({ extruder1: '75', extruder2: '53,7/72,2', maxSpeed: '150', matrix: '3,6', colorLead1: '300', colorLead2: '2000', note: 'Практичний замір' }));
  assert.deepEqual(rpm(rows), [{ mode: 'dual', extruder1: 53.7, extruder2: 72.2 }, { mode: 'single', extruder1: 75, extruder2: null }]);
  assert.equal(rows[0].maxSpeed, 150);
  assert.equal(rows[0].matrix, 3.6);
  assert.equal(rows[0].colorLead2, 2000);
  assert.equal(rows[1].maxSpeed, null);
  assert.equal(rows[1].matrix, null);
  assert.equal(rows[1].colorLead1, null);
  assert.equal(rows[1].note, '');
  rows.forEach((row, index) => assert.doesNotThrow(() => validateMeasurement({ ...row, id: `${index + 1}2345678-1234-1234-1234-123456789012` })));
});

test('legacy single mode cannot redirect paired second-field measurements', () => {
  const rows = measurementRecords(input({ mode: 'single', extruder1: '75', extruder2: '53.7/72.2', maxSpeed: '125', colorLead1: '250', colorLead2: '2000', sikoraWire: '1,97' }));
  assert.deepEqual(rpm(rows), [{ mode: 'dual', extruder1: 53.7, extruder2: 72.2 }, { mode: 'single', extruder1: 75, extruder2: null }]);
  assert.equal(rows[0].maxSpeed, 125);
  assert.equal(rows[0].colorLead2, 2000);
  assert.equal(rows[0].sikoraWire, 1.97);
  assert.equal(rows[1].maxSpeed, null);
  assert.equal(rows[1].sikoraWire, null);
});

test('working mode is inferred only from RPM fields, including partial input', () => {
  for (const mode of ['single', 'dual', 'unknown', undefined]) {
    assert.equal(inferMeasurementMode({ mode, extruder1: '75', extruder2: '' }), 'single');
    assert.equal(inferMeasurementMode({ mode, extruder1: '75', extruder2: '0' }), 'single');
    assert.equal(inferMeasurementMode({ mode, extruder1: '53,7', extruder2: '72,2' }), 'dual');
    assert.equal(inferMeasurementMode({ mode, extruder1: '75', extruder2: '53,7/72,2' }), 'dual');
    assert.equal(inferMeasurementMode({ mode, extruder1: '', extruder2: '' }), 'unknown');
    assert.equal(inferMeasurementMode({ mode, extruder1: '75', extruder2: '53,7/' }), 'unknown');
    assert.equal(inferMeasurementMode({ mode, extruder1: '53,7/72,2', extruder2: '' }), 'dual');
  }
});

test('an ordinary first RPM with a blank second field saves single despite stale dual mode', () => {
  const rows = measurementRecords(input({ mode: 'dual', extruder1: '75', maxSpeed: '150', colorLead2: '2000' }));
  assert.deepEqual(rpm(rows), [{ mode: 'single', extruder1: 75, extruder2: null }]);
  assert.equal(rows[0].maxSpeed, 150);
  assert.equal(rows[0].colorLead2, null);
});

test('legacy retry signatures ignore property and record order while retaining payload changes', () => {
  const rows = measurementRecords(input({ extruder1: '75', extruder2: '53,7/72,2', matrix: '3,6' }));
  const legacy = [...rows].reverse().map(row => Object.fromEntries(Object.entries(row).reverse()));
  assert.equal(measurementSignature(JSON.stringify(legacy)), measurementSignature(rows));
  assert.equal(measurementSignature(JSON.stringify(legacy[0])), measurementSignature([rows[1]]));
  assert.notEqual(measurementSignature([{ ...rows[0], matrix: null }, { ...rows[1], matrix: 3.6 }]), measurementSignature(rows));
  assert.notEqual(measurementSignature([{ ...rows[0], extruder1: 54 }, rows[1]]), measurementSignature(rows));
  assert.equal(measurementSignature('invalid-json'), null);
  assert.equal(measurementSignature(undefined), null);
});

test('ordinary numeric two-extruder values remain a single dual record', () => {
  assert.deepEqual(rpm(measurementRecords(input({ extruder1: '53,7', extruder2: '72,2' }))), [{ mode: 'dual', extruder1: 53.7, extruder2: 72.2 }]);
});

test('zero in second field marks extruder off rather than storing zero RPM', () => {
  const rows = measurementRecords(input({ extruder1: '75', extruder2: '0', colorLead2: '2000' }));
  assert.deepEqual(rpm(rows), [{ mode: 'single', extruder1: 75, extruder2: null }]);
  assert.equal(rows[0].colorLead2, null);
});

test('a pair alone works in either field without inventing a single RPM', () => {
  for (const key of ['extruder1', 'extruder2']) {
    const rows = measurementRecords(input({ mode: 'unknown', [key]: '53,7/72,2', matrix: '3,6' }));
    assert.deepEqual(rpm(rows), [{ mode: 'dual', extruder1: 53.7, extruder2: 72.2 }]);
    assert.equal(rows[0].matrix, 3.6);
  }
  assert.deepEqual(rpm(measurementRecords(input({ mode: 'single', extruder1: '0', extruder2: '53,7/72,2' }))), [{ mode: 'dual', extruder1: 53.7, extruder2: 72.2 }]);
});

test('malformed, negative, incomplete, zero-component and repeated pairs are rejected', () => {
  for (const value of ['53,7/', '/72,2', '53,7/72,2/80', '-53/72', '53/-72', '0/72', '53/0', '53,7,1/72,2', '0x35/72', '1e3/72', '100001']) assert.throws(() => measurementRecords(input({ extruder1: '75', extruder2: value })));
  assert.throws(() => measurementRecords(input({ extruder1: '53/72', extruder2: '53/72' })), /лише в одному/);
  assert.throws(() => measurementRecords(input({ extruder1: '53/72', extruder2: '90' })), /Залиш поле №2/);
});

test('disabled first extruder cannot be silently reassigned to physical second', () => {
  assert.throws(() => measurementRecords(input({ extruder1: '0', extruder2: '72' })), /тільки з екструдером №2/);
  assert.throws(() => measurementRecords(input({ extruder1: '0', extruder2: '0' })), /Обидва екструдери вимкнені/);
});

test('existing ancillary numeric and whole-meter validation remains', () => {
  assert.throws(() => measurementRecords(input({ extruder1: '75', mode: 'single', matrix: '-1' })), /Матриця/);
  assert.throws(() => measurementRecords(input({ extruder1: '75', mode: 'single', colorLead1: '300,5' })), /цілі метри/);
  assert.equal(measurementRecords(input({ extruder1: '75', mode: 'single', colorLead1: '0' }))[0].colorLead1, 0);
  for (const mode of ['unknown', 'single', 'dual']) assert.throws(() => measurementRecords(input({ mode, matrix: '3,6' })), /Вкажи оберти/);
});

test('explicit conflict refresh renews only the failed mode and preserves the completed mode', () => {
  const pending = { signature: 'entered-values', entries: [
    { mode: 'single', id: 'completed-single', expectedRevision: 3, recorded: true, published: true },
    { mode: 'dual', id: 'old-dual', expectedRevision: 2, recorded: true, published: false, conflict: true },
  ] };
  let calls = 0;
  const renewed = refreshPendingMeasurements(pending, { revisionFor: mode => mode === 'single' ? 8 : 5, createId: () => { calls++; return 'fresh-dual'; } });
  assert.equal(renewed, 1);
  assert.equal(calls, 1);
  assert.deepEqual(pending.entries[0], { mode: 'single', id: 'completed-single', expectedRevision: 3, recorded: true, published: true });
  assert.deepEqual(pending.entries[1], { mode: 'dual', id: 'fresh-dual', expectedRevision: 5, recorded: false, published: false, conflict: false });
  assert.equal(pending.signature, 'entered-values');
});

test('a lost response retry keeps the fresh ID, even after another refresh', () => {
  const pending = { entries: [{ mode: 'dual', id: 'fresh-dual', expectedRevision: 5, recorded: false, published: false, conflict: false }] };
  assert.equal(refreshPendingMeasurements(pending, { revisionFor: () => 6, createId: () => assert.fail('A connection retry must not create a new measurement.') }), 0);
  assert.deepEqual(pending.entries[0], { mode: 'dual', id: 'fresh-dual', expectedRevision: 6, recorded: false, published: false, conflict: false });
});

test('repeated refresh before resaving does not create another snapshot', () => {
  const pending = { entries: [{ mode: 'dual', id: 'old-dual', expectedRevision: 2, recorded: true, published: false, conflict: true }] };
  let calls = 0;
  const options = { revisionFor: () => 5, createId: () => { calls++; return 'new-dual'; } };
  assert.equal(refreshPendingMeasurements(pending, options), 1);
  assert.equal(refreshPendingMeasurements(pending, options), 0);
  assert.equal(calls, 1);
  assert.equal(pending.entries[0].id, 'new-dual');
});
