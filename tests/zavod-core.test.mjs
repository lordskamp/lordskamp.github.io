import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_RULES,
  dyePlan,
  number,
  outerEstimate,
  parseBreakdowns,
  planDrum,
  positive,
  spliceTarget
} from '../Zavod/core.js';

const drum = (color, length = 15000) => ({ color, length });

test('15 км зі зміною кольору: екран 15 850 м, барвник Е2 на 13 000 м', () => {
  const result = planDrum(drum('blue'), drum('brown'), 'dual');
  assert.deepEqual(result.errors, []);
  assert.equal(result.target, 15850);
  assert.equal(result.transition, true);
  assert.deepEqual(result.events, [{ extruder: 2, at: 13000, lead: 2000, dye: 'Коричневий' }]);
});

test('перехід на жовто-зелений додає жовту основу Е1 на 14 700 м', () => {
  const result = planDrum(drum('brown'), drum('yellow-green'), 'dual');
  assert.equal(result.target, 15850);
  assert.deepEqual(result.events, [
    { extruder: 2, at: 13000, lead: 2000, dye: 'Зелений' },
    { extruder: 1, at: 14700, lead: 300, dye: 'Жовтий' }
  ]);
  assert.equal(dyePlan('yellow-green', 'dual').first, 'Жовтий');
  assert.equal(dyePlan('yellow-green', 'dual').second, 'Зелений');
});

test('після жовто-зеленого Е1 повертається до білої основи', () => {
  const result = planDrum(drum('yellow-green'), drum('blue'), 'dual');
  assert.deepEqual(result.events, [
    { extruder: 2, at: 13000, lead: 2000, dye: 'Синій' },
    { extruder: 1, at: 14700, lead: 300, dye: 'Біла основа' }
  ]);
});

test('однаковий колір наступного барабана не додає резерву й переходів', () => {
  const result = planDrum(drum('blue'), drum('blue', 12000), 'dual');
  assert.deepEqual(result.errors, []);
  assert.equal(result.target, 15000);
  assert.equal(result.transition, false);
  assert.deepEqual(result.events, []);
});

test('останній барабан не отримує резерву зміни кольору', () => {
  const result = planDrum(drum('yellow-green'), null, 'dual');
  assert.equal(result.target, 15000);
  assert.equal(result.transition, false);
  assert.deepEqual(result.events, []);
});

test('заміна вхідного барабана додає 30 до поточного екрана, повторно — ще 30', () => {
  const first = spliceTarget(15030);
  assert.equal(first, 15060);
  assert.equal(spliceTarget(first), 15090);
  assert.equal(spliceTarget(15850), 15880);
  assert.equal(spliceTarget('15030', '45'), 15075);
});

test('повторний розрахунок і зміна кольору не накопичують резерви', () => {
  const current = Object.freeze(drum('blue'));
  const next = Object.freeze(drum('brown'));
  const first = planDrum(current, next, 'dual');
  assert.deepEqual(planDrum(current, next, 'dual'), first);
  assert.equal(planDrum(current, drum('blue'), 'dual').target, 15000);
  assert.equal(planDrum(current, next, 'dual').target, 15850);
  assert.equal(current.length, 15000);
});

test('порожні, від’ємні, нечислові та дробові довжини не дають завдання екрана', () => {
  for (const length of ['', '   ', null, undefined, false, -1, 0, 1.5, 'abc', Infinity, NaN]) {
    const result = planDrum({ color: 'blue', length }, drum('brown'), 'dual');
    assert.equal(result.target, null, `length=${String(length)}`);
    assert.ok(result.errors.length > 0);
    assert.deepEqual(result.events, []);
  }
  for (const current of ['', ' ', null, undefined, -1, 0, 1.5, Infinity, NaN]) {
    assert.equal(spliceTarget(current), null, `current=${String(current)}`);
  }
});

test('хибні параметри довжини відхиляються, нульове випередження дозволене', () => {
  for (const key of ['bath', 'reserve', 'lead1', 'lead2', 'splice']) {
    for (const value of ['', -1, 1.5, Infinity]) {
      const result = planDrum(drum('blue'), drum('brown'), 'dual', { [key]: value });
      assert.equal(result.target, null, `${key}=${String(value)}`);
      assert.ok(result.errors.length > 0);
    }
  }
  assert.equal(planDrum(drum('blue'), drum('brown'), 'dual', { lead2: 0 }).events[0].at, 15000);
  for (const reserve of ['', -30, 1.5, Infinity]) assert.equal(spliceTarget(15030, reserve), null);
});

test('короткий барабан не створює від’ємної позначки або екстраполяції переходу', () => {
  const result = planDrum(drum('blue', 1000), drum('brown'), 'dual');
  assert.equal(result.target, 1850);
  assert.deepEqual(result.events, []);
  assert.ok(result.warnings.some(message => message.includes('окремого плану')));

  const boundary = planDrum(drum('blue', 2000), drum('brown'), 'dual');
  assert.equal(boundary.events[0].at, 0);
  for (const length of [100, 150]) {
    const tooShort = planDrum(drum('blue', length), drum('brown'), 'dual');
    assert.equal(tooShort.target, null);
    assert.ok(tooShort.errors.length > 0);
  }
});

test('невідомий режим та жовто-зелений з одним екструдером не вигадують зміни барвника', () => {
  for (const [current, next, mode] of [
    ['blue', 'brown', 'unknown'],
    ['blue', 'brown', undefined],
    ['blue', 'yellow-green', 'single'],
    ['yellow-green', 'brown', 'single']
  ]) {
    const result = planDrum(drum(current), drum(next), mode);
    assert.deepEqual(result.events, []);
    assert.ok(result.warnings.some(message => message.includes('уточніть схему')));
  }
  assert.equal(dyePlan('yellow-green', 'single').valid, false);
  assert.equal(dyePlan('blue', 'unknown').valid, false);
});

test('з одним екструдером звичайний колір подається тільки в Е1', () => {
  const result = planDrum(drum('blue'), drum('brown'), 'single');
  assert.deepEqual(result.events, [{ extruder: 1, at: 14700, lead: 300, dye: 'Коричневий' }]);
  assert.equal(dyePlan('brown', 'single').second, 'Вимкнений');
});

test('невідомі кольори відхиляються до розрахунку переходу', () => {
  for (const [current, next] of [[drum(''), drum('brown')], [drum('blue'), drum('violet')]]) {
    const result = planDrum(current, next, 'dual');
    assert.equal(result.target, null);
    assert.ok(result.errors.length > 0);
    assert.deepEqual(result.events, []);
  }
  assert.equal(dyePlan('violet', 'dual'), null);
});

test('Сікора: матриця плюс 0,15 з десятковою комою, без порожніх чи від’ємних значень', () => {
  assert.equal(outerEstimate('3,2'), 3.35);
  assert.equal(outerEstimate(2.4), 2.55);
  assert.equal(outerEstimate(3.2, '0,2'), 3.4);
  assert.equal(outerEstimate(3.2, 0), 3.2);
  for (const matrix of ['', null, 0, -1, Infinity]) assert.equal(outerEstimate(matrix), null);
  for (const offset of ['', null, -0.15, Infinity]) assert.equal(outerEstimate(3.2, offset), null);
  assert.equal(number('1,5'), 1.5);
  assert.equal(positive(' '), null);
  assert.equal(DEFAULT_RULES.sikoraOffset, 0.15);
});

test('пробої зберігають порядок і повтори; порожній список допустимий', () => {
  assert.deepEqual(parseBreakdowns(''), { values: [], error: null });
  assert.deepEqual(parseBreakdowns(null), { values: [], error: null });
  assert.deepEqual(parseBreakdowns(' 120; 0;\n 400; 120 '), { values: [120, 0, 400, 120], error: null });
  assert.deepEqual(parseBreakdowns('100, 200'), { values: [100, 200], error: null });
});

test('хибні позначки пробою не перетворюються на частково правдивий список', () => {
  for (const input of ['100; -1; 200', '100; 1.5', '100; abc', 'Infinity', 'NaN']) {
    const result = parseBreakdowns(input);
    assert.deepEqual(result.values, []);
    assert.ok(result.error);
  }
});
