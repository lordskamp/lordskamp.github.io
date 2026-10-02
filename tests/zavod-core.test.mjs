import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_RULES,
  dyePlan,
  firstSpeed,
  number,
  outerEstimate,
  parseBreakdowns,
  planDrum,
  planSplices,
  positive,
  secondSpeed,
  sikoraAllowance,
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

test('перехід на жовто-зелений зберігає резерв та окрему зміну розсікача', () => {
  const result = planDrum(drum('brown'), drum('yellow-green'), 'dual');
  assert.equal(result.target, 15850);
  assert.equal(result.transition, true);
  assert.equal(result.setupChange, true);
  assert.equal(result.headChange, true);
  assert.equal(result.cableChange, false);
  assert.equal(result.modeChange, false);
  assert.deepEqual(result.events, [
    { extruder: 2, at: 13000, lead: 2000, dye: 'Зелений' },
    { extruder: 1, at: 14700, lead: 300, dye: 'Жовтий' }
  ]);
  assert.deepEqual(result.warnings, []);
  assert.equal(dyePlan('yellow-green', 'dual').first, 'Жовтий');
  assert.equal(dyePlan('yellow-green', 'dual').second, 'Зелений');
});

test('після жовто-зеленого видно обидві метрові підказки та зміну розсікача', () => {
  const result = planDrum(drum('yellow-green'), drum('blue'), 'dual');
  assert.equal(result.target, 15850);
  assert.equal(result.headChange, true);
  assert.equal(result.setupChange, true);
  assert.equal(result.transition, true);
  assert.deepEqual(result.events, [
    { extruder: 2, at: 13000, lead: 2000, dye: 'Синій' },
    { extruder: 1, at: 14700, lead: 300, dye: 'Біла основа' }
  ]);
  assert.deepEqual(result.warnings, []);
});

test('зміна проводу або перерізу зупиняє подачу на довжину ванни раніше незалежно від кольору', () => {
  for (const color of ['blue', 'brown']) {
    for (const nextSetup of [{ cableId: 'pv3', section: 2.5 }, { cableId: 'vvgng-p', section: 1.5 }]) {
      const current = Object.freeze({ ...drum('blue', 11000), cableId: 'vvgng-p', section: 2.5 });
      const next = Object.freeze({ ...drum(color), ...nextSetup });
      const result = planDrum(current, next, 'dual');
      assert.equal(result.target, 10850);
      assert.equal(result.cableChange, true);
      assert.equal(result.setupChange, true);
      assert.equal(result.headChange, false);
      assert.equal(result.transition, false);
      assert.deepEqual(result.events, []);
      assert.deepEqual(result.warnings, []);
      assert.equal(current.length, 11000);
      assert.equal(next.color, color);
    }
  }
});

test('поправка зміни жили використовує налаштовану довжину ванни навіть зі зміною розсікача', () => {
  const result = planDrum(
    { ...drum('yellow-green'), cableId: 'pv3', section: 2.5 },
    { ...drum('blue'), cableId: 'pv3', section: 4 },
    'dual', { bath: 200, reserve: 3000 }
  );
  assert.equal(result.target, 14800);
  assert.equal(result.headChange, true);
  assert.equal(result.cableChange, true);
  assert.equal(result.transition, false);
  assert.deepEqual(result.events, []);
  assert.match(result.formula, /15\s?000 − 200 = 14\s?800 м/);
});

test('барабан коротший за ванну при зміні жили не дає від’ємного завдання та попереджає про окремий план', () => {
  for (const length of [100, 150]) {
    const result = planDrum(
      { ...drum('blue', length), cableId: 'pv3', section: 2.5 },
      { ...drum('blue'), cableId: 'pv3', section: 4 },
      'single'
    );
    assert.equal(result.target, 0);
    assert.deepEqual(result.events, []);
    assert.ok(result.warnings.some(message => message.includes('автоматичне завдання не встановлюй')));
  }
});

test('пускові швидкості залежать від робочої та мають зручну проміжну сходинку', () => {
  for (const [working, first, second] of [[550, 80, 320], [275, 80, 180], [210, 80, 140], [200, 40, 120], [100, 40, 80], [80, 40, 60]]) {
    assert.equal(firstSpeed(working), first);
    assert.equal(secondSpeed(working), second);
    assert.ok(first < second && second < working);
  }
  assert.equal(firstSpeed('275,0'), 80);
  assert.equal(secondSpeed('275,0'), 180);
});

test('невідома чи мала робоча швидкість не створює завищеної пускової сходинки', () => {
  for (const working of ['', null, undefined, 0, -20, Infinity, 'abc']) {
    assert.equal(firstSpeed(working), null);
    assert.equal(secondSpeed(working), null);
  }
  for (const working of [20, 0.5, 40]) {
    assert.equal(firstSpeed(working), working);
    assert.equal(secondSpeed(working), working);
  }
  assert.equal(firstSpeed(41), 40);
  assert.equal(secondSpeed(41), 40.5);
});

test('той самий провід та чисельно однаковий переріз зберігають перехід звичайного кольору', () => {
  const result = planDrum(
    { ...drum('blue'), cableId: 'vvgng-p', section: '2,5', mode: 'dual' },
    { ...drum('brown'), cableId: 'vvgng-p', section: 2.5, mode: 'dual' },
    'dual'
  );
  assert.equal(result.target, 15850);
  assert.equal(result.transition, true);
  for (const key of ['setupChange', 'cableChange', 'headChange', 'modeChange']) assert.equal(result[key], false);
  assert.deepEqual(result.events, [{ extruder: 2, at: 13000, lead: 2000, dye: 'Коричневий' }]);
});

test('зміна кількості екструдерів потребує зупинки, а зміна кольору додає резерв і підказки', () => {
  for (const color of ['blue', 'brown']) {
    const result = planDrum({ ...drum('blue'), mode: 'dual' }, { ...drum(color), mode: 'single' }, 'dual');
    assert.equal(result.modeChange, true);
    assert.equal(result.setupChange, true);
    assert.equal(result.target, color === 'blue' ? 15000 : 15850);
    assert.equal(result.transition, color !== 'blue');
    assert.deepEqual(result.events, color === 'blue' ? [] : [
      { extruder: 2, at: 13000, lead: 2000, dye: 'Вимкнений' },
      { extruder: 1, at: 14700, lead: 300, dye: 'Коричневий' }
    ]);
    assert.deepEqual(result.warnings, []);
  }
});

test('перехід з одного екструдера на два не підказує барвник для ще вимкненого Е2', () => {
  const result = planDrum({ ...drum('blue'), mode: 'single' }, { ...drum('black'), mode: 'dual' }, 'single');
  assert.equal(result.target, 15850);
  assert.equal(result.modeChange, true);
  assert.equal(result.transition, true);
  assert.deepEqual(result.events, [{ extruder: 1, at: 14700, lead: 300, dye: 'Біла основа' }]);
});

test('останній барабан та відсутні поля старого плану не вигадують зміни налаштування', () => {
  const final = planDrum({ ...drum('yellow-green'), cableId: 'pv3', section: 2.5, mode: 'dual' }, null, 'dual');
  const legacy = planDrum(drum('blue'), { ...drum('brown'), cableId: 'pv3', section: 2.5, mode: 'single' }, 'dual');
  for (const result of [final, legacy]) {
    for (const key of ['setupChange', 'cableChange', 'headChange', 'modeChange']) assert.equal(result[key], false);
  }
  assert.equal(final.target, 15000);
  assert.equal(legacy.target, 15850);
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
    ['blue', 'brown', undefined]
  ]) {
    const result = planDrum(drum(current), drum(next), mode);
    assert.deepEqual(result.events, []);
    assert.ok(result.warnings.some(message => message.includes('уточніть схему')));
  }
  for (const [current, next] of [['blue', 'yellow-green'], ['yellow-green', 'brown']]) {
    const result = planDrum(drum(current), drum(next), 'single');
    assert.equal(result.headChange, true);
    assert.equal(result.target, 15850);
    assert.deepEqual(result.events, []);
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

test('поправка СІКОРИ до матриці менша для тонких жил і становить 0,15 мм для 2,5 мм²', () => {
  assert.equal(sikoraAllowance(2.5), 0.15);
  assert.equal(sikoraAllowance(1.5), 0.12);
  assert.equal(sikoraAllowance(.5), 0.07);
  assert.equal(sikoraAllowance(6), 0.15, 'no unmeasured increase beyond the supplied average');
  for (const section of ['', null, false, 0, -1, Infinity]) assert.equal(sikoraAllowance(section), null);
  assert.equal(outerEstimate(2.1, sikoraAllowance(1)), 2.19);
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

test('план скрутки: один пробій округлюється вниз, запас є тільки в завданні екрана', () => {
  const result = planSplices(15000, '6838');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.marks, [6838]);
  assert.deepEqual(result.roundedMarks, [6830]);
  assert.deepEqual(result.parts, [6830, 8170]);
  assert.equal(result.label, '(6830+8170)');
  assert.equal(result.target, 15030);
  assert.equal(result.spliceCount, 1);
  assert.equal(result.parts.reduce((sum, part) => sum + part, 0), 15000);
});

test('план скрутки: кілька накопичувальних пробоїв дають різниці та окремий запас на кожну заміну', () => {
  const result = planSplices('15000', '5385; 8459');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.roundedMarks, [5380, 8450]);
  assert.deepEqual(result.parts, [5380, 3070, 6550]);
  assert.equal(result.label, '(5380+3070+6550)');
  assert.equal(result.target, 15060);
  assert.equal(result.spliceCount, 2);
  assert.equal(result.parts.reduce((sum, part) => sum + part, 0), 15000);
});

test('план скрутки упорядковує пробої, залишає точні десятки та не змінює вхідний список', () => {
  const marks = Object.freeze([8459, 5380]);
  const result = planSplices(15000, marks, '45');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.marks, [5380, 8459]);
  assert.equal(result.label, '(5380+3070+6550)');
  assert.equal(result.target, 15090);
  assert.deepEqual(marks, [8459, 5380]);
  assert.deepEqual(planSplices(15000, marks, '45'), result);
  assert.equal(planSplices(15000, '5380, 8459', 0).target, 15000);
});

test('порожній план скрутки не додає запас і підтримує довжину не кратну десяти', () => {
  for (const marks of ['', null, undefined, []]) {
    const result = planSplices(15003, marks);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.parts, [15003]);
    assert.equal(result.label, '(15003)');
    assert.equal(result.target, 15003);
    assert.equal(result.spliceCount, 0);
  }
  const result = planSplices(15003, '14999');
  assert.deepEqual(result.parts, [14990, 13]);
  assert.equal(result.label, '(14990+13)');
  assert.equal(result.target, 15033);
});

test('план скрутки відхиляє некоректні довжини, резерви та позначки замість часткового результату', () => {
  const invalid = [
    ...['', null, undefined, false, 0, -1, 1.5, 'abc', Infinity, Number.MAX_SAFE_INTEGER + 1].map(length => [length, '6838']),
    ...['', null, false, -1, 1.5, Infinity].map(reserve => [15000, '6838', reserve]),
    ...['-1', '1.5', 'abc', '0', '15000', '15001', '6838; abc', '6838; 15000'].map(marks => [15000, marks]),
    [Number.MAX_SAFE_INTEGER, '6838']
  ];
  for (const args of invalid) {
    const result = planSplices(...args);
    assert.ok(result.errors.length, JSON.stringify(args));
    assert.equal(result.target, null);
    assert.equal(result.label, '');
    assert.deepEqual(result.parts, []);
  }
});

test('план скрутки не приховує пробої, які округлилися до нуля чи однакової позначки', () => {
  for (const marks of ['9', '5385; 5389', '5385; 5385']) {
    const result = planSplices(15000, marks);
    assert.ok(result.errors.length);
    assert.equal(result.target, null);
    assert.equal(result.label, '');
    assert.deepEqual(result.parts, []);
    assert.equal(result.spliceCount, parseBreakdowns(marks).values.length);
    assert.equal(result.roundedMarks.length, result.spliceCount);
  }
});
