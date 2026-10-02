import assert from 'node:assert/strict';
import test from 'node:test';
import { RECIPES } from '../Zavod/data.js';
import { OPERATOR_REFERENCE, OPERATOR_HANDWRITTEN } from '../Zavod/operator-data.js';
import { trialRpm, additionalRpm, handwrittenAlternatives } from '../Zavod/rpm.js';

const pv1 = RECIPES.find(r => r.id === 'pv1-1-5');
const vvg = RECIPES.find(r => r.id === 'vvgng-p-1-5');

test('перерахунок обертів за швидкістю зберігає вимкнений другий екструдер', () => {
  const result = trialRpm(pv1, '300', 'blue');
  assert.equal(result.first, 70.3);
  assert.equal(result.second, null);
  assert.equal(trialRpm(pv1, '288', 'blue').first, 67.5);
});

test('обидва екструдери перераховуються для того самого режиму', () => {
  const result = trialRpm(vvg, '760', 'blue');
  assert.equal(result.first, 133);
  assert.equal(result.second, 173);
});

test('прогноз не виходить за межі швидкості й не приймає порожні або хибні числа', () => {
  for (const speed of ['', '0', '-1', 'abc', 'Infinity', '287', '321']) {
    const result = trialRpm(pv1, speed, 'blue');
    assert.equal(result.first, null, speed);
    assert.equal(result.second, null, speed);
  }
  assert.equal(trialRpm(pv1, '300,5', 'blue').first, 70.4);
});

test('відсутні режими та непідтверджені пари ПВ3 не породжують прогнозу', () => {
  assert.equal(trialRpm({ ...pv1, mode: 'unknown' }, 300, 'blue').first, null);
  assert.equal(trialRpm(pv1, 300, 'yellow-green').first, null);
  assert.equal(trialRpm({ ...pv1, extruder1: null }, 300, 'blue').first, null);
  const pv3 = RECIPES.find(r => r.cableId === 'pv3' && r.section === 1);
  assert.equal(trialRpm(pv3, 290, 'yellow-green').first, null);
  assert.equal(trialRpm({ ...pv3, origin: 'measurement' }, 290, 'yellow-green').first, 48.3);
  const pvs = RECIPES.find(r => r.cableId === 'pvs-shvvp' && r.section === 1);
  assert.equal(trialRpm(pvs, 450, 'blue').first, null);
});

test('власний замір не приховує оберти з початкового рукопису', () => {
  assert(!additionalRpm(pv1, 1).some(r => r.label === 'Рукопис колеги'));
  const rows = additionalRpm({ ...pv1, baseId: pv1.id, id: 'measurement-1', extruder1: 80 }, 1);
  assert.equal(rows.find(r => r.label === 'Рукопис колеги').value, 75);
  assert(!additionalRpm(pv1, 2).some(r => r.label === 'Рукопис колеги'));
});

test('довідкові числа різних специфікацій мають окремі підписи', () => {
  const h05 = RECIPES.find(r => r.cableId === 'h05vv-f' && r.section === .75);
  assert.equal(additionalRpm(h05, 1).find(r => r.label === 'Довідка EN').value, 92);
  const ysly = RECIPES.find(r => r.cableId === 'ysly' && r.section === 2.5);
  assert.equal(additionalRpm(ysly, 2).find(r => r.label === 'Довідка 600/1000 В').value, 100);
  assert.equal(handwrittenAlternatives({ cableId: 'pv3', section: .75 }), '68; 57; пара 65/85');
  assert.equal(handwrittenAlternatives(h05), null);
});

test('імпорт Excel не перетворює порожні прогнози на готові налаштування', () => {
  assert.equal(OPERATOR_REFERENCE.length, 122);
  assert.equal(OPERATOR_HANDWRITTEN.length, 37);
  assert(OPERATOR_REFERENCE.every(r => r.forecast1 === null && r.forecast2 === null));
  for (const row of OPERATOR_HANDWRITTEN) {
    const original = RECIPES.find(r => r.id === row.id);
    assert(original, row.id);
    for (const key of ['extruder1', 'extruder2', 'maxSpeed']) assert.equal(row[key], original[key], `${row.id}: ${key}`);
  }
});
