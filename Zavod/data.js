// Transcribed from the source photographs. Missing or disputed values stay null.
// See ../docs/ZAVOD-SOURCES.md for the audit and unresolved source annotations.
export const CABLES = [
  { id: 'vvgng-p', label: 'ВВГнг-П', sections: [1.5, 2.5], note: 'Застосування таблиці ВВГ до ВВГнг-П підтверджено користувачем 29.09.2026.' },
  { id: 'vvg', label: 'ВВГ', sections: [1.5, 2.5] },
  { id: 'pv1', label: 'ПВ1 / H07V-U', sections: [1, 1.5, 2.5, 4, 6] },
  { id: 'pv3', label: 'ПВ3', sections: [0.5, 0.75, 1, 1.5, 2.5, 4, 6], note: 'Для частини перерізів у записах є альтернативні режими, що потребують уточнення.' },
  { id: 'ysly', label: 'YSLY', sections: [0.5, 0.75, 1, 1.5, 2.5, 4, 6], note: 'Спільна таблиця YSLY / (H)05VV-F у DRAW_4. Режим 1,5 мм² з окремого листа H05VV-F сюди не перенесено.' },
  { id: 'h05vv-f', label: 'H05VV-F', sections: [0.5, 0.75, 1, 1.5, 2.5, 4, 6], note: 'DRAW_4; для 1,5 мм² — окремий запис DRAW_6.' },
  { id: 'pvs-shvvp', label: 'ПВС / ШВВП', sections: [0.5, 0.75, 1, 1.5, 2.5, 4, 6], note: 'Рукописна таблиця IMG_3843. Незавершений рядок 6 мм² не використовується.' },
];

function recipe(cableId, section, source, values = {}) {
  return {
    id: `${cableId}-${String(section).replace('.', '-')}`,
    cableId,
    section,
    dorn: null,
    matrix: null,
    sikoraWire: null,
    sikoraOuter: null,
    extruder1: null,
    extruder2: null,
    maxSpeed: null,
    mode: 'unknown',
    source,
    notes: [],
    uncertain: [],
    ...values,
  };
}

function empty(cableId, section, source, explanation = 'Рядок у рукописній таблиці порожній.') {
  return recipe(cableId, section, source, {
    notes: [explanation],
    uncertain: ['Усі робочі значення: підтвердженого режиму для цього перерізу немає.'],
  });
}

const vvg = [
  recipe('vvg', 1.5, 'DRAW_3.JPG', {
    dorn: 1.4, matrix: 2.45, sikoraWire: 1.37, sikoraOuter: 2.6,
    extruder1: 140, extruder2: 195, maxSpeed: 800, mode: 'dual',
    notes: ['Максимальну швидкість 800 підтверджено користувачем 29.09.2026.'],
  }),
  recipe('vvg', 2.5, 'DRAW_3.JPG', {
    dorn: 1.8, matrix: 2.75, sikoraWire: 1.75, sikoraOuter: 2.88,
    extruder1: 104, extruder2: 152, maxSpeed: 550, mode: 'dual',
    notes: ['Біля швидкості є окрема приписка «675 Padana»; умову її застосування не пояснено.'],
    uncertain: ['Додаткова швидкість «675 Padana»: не використовується як робоча установка до уточнення.'],
  }),
];

const sharedFlexible = [
  [0.75, { dorn: 1.2, matrix: 1.9, sikoraWire: 1.1, sikoraOuter: 2.05, extruder1: 39, extruder2: 70, maxSpeed: 350 }],
  [1, { dorn: 1.35, matrix: 2.1, sikoraWire: 1.2, sikoraOuter: 2.12, extruder1: 38, extruder2: 95, maxSpeed: 425 }],
  [2.5, { dorn: 2.1, matrix: 3, sikoraWire: 2.1, sikoraOuter: 3.15, extruder1: 86, extruder2: 140, maxSpeed: 400 }],
  [4, { dorn: 2.6, matrix: 3.5, sikoraWire: 2.5, sikoraOuter: 3.68, extruder1: 66, extruder2: 100, maxSpeed: 250 }],
  [6, { dorn: 3.3, matrix: 4.25, sikoraWire: 3.05, sikoraOuter: 4.4, extruder1: 91, extruder2: 156, maxSpeed: 260 }],
];

export const RECIPES = [
  ...vvg.map((row) => ({
    ...row, id: row.id.replace('vvg-', 'vvgng-p-'), cableId: 'vvgng-p',
    notes: [...row.notes, 'Режим ВВГ застосовано до ВВГнг-П за підтвердженням користувача від 29.09.2026.'],
    uncertain: [...row.uncertain],
  })),
  ...vvg,
  empty('pv1', 1, 'DRAW_1.JPG'),
  recipe('pv1', 1.5, 'DRAW_1.JPG', {
    dorn: 1.45, matrix: 2.8, sikoraWire: 1.37, sikoraOuter: 2.85,
    extruder1: 75, maxSpeed: 320, mode: 'single',
    notes: ['Роботу лише першим екструдером підтверджено користувачем 29.09.2026; колонка E2 у джерелі порожня.'],
  }),
  recipe('pv1', 2.5, 'DRAW_1.JPG', {
    dorn: 1.8, matrix: 3.4, sikoraWire: 1.75, sikoraOuter: 3.55,
    extruder1: 50, maxSpeed: 150, mode: 'single',
    notes: ['Роботу лише першим екструдером підтверджено користувачем 29.09.2026; колонка E2 у джерелі порожня.'],
  }),
  empty('pv1', 4, 'DRAW_1.JPG'),
  empty('pv1', 6, 'DRAW_1.JPG'),
  recipe('pv3', 0.5, 'DRAW_5.JPG', {
    dorn: 0.95, matrix: 2.2, sikoraWire: 1.1, sikoraOuter: 2.25,
    extruder1: 58, maxSpeed: 350, mode: 'single',
    notes: ['Дорн 0,95 у джерелі обведено/виправлено.', 'Перша Sikora 1,1 більша за записаний дорн 0,95. Значення збережено дослівно.', 'Роботу лише першим екструдером підтверджено користувачем 29.09.2026; колонка E2 у джерелі порожня.'],
    uncertain: ['Дорн і перша Sikora: необхідно звірити розбіжність 0,95 / 1,1.'],
  }),
  recipe('pv3', 0.75, 'DRAW_5.JPG', {
    dorn: 1.25, matrix: 2.4, sikoraWire: 1.25, sikoraOuter: 2.5,
    notes: ['Біля екструдера 1 записано 68 і нижче 57; поруч — «65 / 85». У швидкості — 350 і нижче 300.'],
    uncertain: ['Екструдери 1/2 і максимальна швидкість: зв’язок між альтернативними значеннями 68, 57, 65/85 та 350/300 не пояснено.'],
  }),
  recipe('pv3', 1, 'DRAW_5.JPG', {
    dorn: 1.35, matrix: 2.2, sikoraOuter: 2.5,
    extruder1: 50, extruder2: 130, maxSpeed: 300, mode: 'dual',
    notes: ['Перше значення Sikora переписано поверх попереднього запису.'],
    uncertain: ['Перша Sikora: виправлене число не читається достатньо надійно.'],
  }),
  recipe('pv3', 1.5, 'DRAW_5.JPG', {
    dorn: 1.65, matrix: 3, sikoraWire: 1.5, sikoraOuter: 3.08,
    extruder1: 75, maxSpeed: 275, mode: 'single',
    notes: ['Роботу лише першим екструдером підтверджено користувачем 29.09.2026; колонка E2 у джерелі порожня.'],
  }),
  recipe('pv3', 2.5, 'DRAW_5.JPG', {
    dorn: 2.15, matrix: 3.7, sikoraWire: 2, sikoraOuter: 3.83,
    extruder1: 80, extruder2: 100, maxSpeed: 210, mode: 'dual',
  }),
  recipe('pv3', 4, 'DRAW_5.JPG', {
    dorn: 2.65, matrix: 4.2, sikoraWire: 2.5, sikoraOuter: 4.35, maxSpeed: 150,
    notes: ['Дослівний запис екструдерів: «74 (64 / 80)».'],
    uncertain: ['Екструдери 1/2 і режим роботи: потрібно пояснити вибір між 74 та парою 64/80.'],
  }),
  recipe('pv3', 6, 'DRAW_5.JPG', {
    dorn: 3.1, matrix: 4.7, sikoraWire: 3, sikoraOuter: 4.82,
    notes: ['Дослівний запис екструдерів: «67 (64 / 84)»; у швидкості записано 120 і нижче 130.'],
    uncertain: ['Екструдери 1/2 і режим роботи: потрібно пояснити вибір між 67 та парою 64/84.', 'Максимальна швидкість: записані 120 та 130 без пояснення умов.'],
  }),
  ...['ysly', 'h05vv-f'].flatMap((cableId) => [
    empty(cableId, 0.5, 'DRAW_4.JPG'),
    ...sharedFlexible.map(([section, values]) => recipe(cableId, section, 'DRAW_4.JPG', { ...values, mode: 'dual' })),
  ]),
  empty('ysly', 1.5, 'DRAW_4.JPG', 'Рядок YSLY 1,5 мм² порожній. Окремий запис H05VV-F із DRAW_6 не підтверджує цей режим для YSLY.'),
  recipe('h05vv-f', 1.5, 'DRAW_6.JPG', {
    dorn: 1.7, matrix: 2.8, sikoraWire: 1.5, sikoraOuter: 2.98,
    extruder1: 70, extruder2: 112, maxSpeed: 325, mode: 'dual',
  }),
  empty('pvs-shvvp', 0.5, 'IMG_3843.JPG'),
  recipe('pvs-shvvp', 0.75, 'IMG_3843.JPG', {
    dorn: 1.2, matrix: 2, sikoraWire: 1.12, sikoraOuter: 2.1,
    extruder1: 60, extruder2: 100, maxSpeed: 550, mode: 'dual',
  }),
  empty('pvs-shvvp', 1, 'IMG_3843.JPG'),
  recipe('pvs-shvvp', 1.5, 'IMG_3843.JPG', {
    dorn: 1.65, matrix: 2.7, sikoraWire: 1.53, sikoraOuter: 2.8,
    extruder1: 81, extruder2: 118, maxSpeed: 400, mode: 'dual', colorLead2: 2000,
    notes: ['Під колонкою другого екструдера є запис «колір 2000» — орієнтир зміни кольору за 2000 м.'],
  }),
  recipe('pvs-shvvp', 2.5, 'IMG_3843.JPG', {
    dorn: 2.1, matrix: 3.4, sikoraWire: 1.97, sikoraOuter: 3.55,
    extruder1: 78, extruder2: 100, maxSpeed: 240, mode: 'dual', colorLead2: 1500,
    notes: ['Під колонкою другого екструдера є запис «колір 1500» — орієнтир зміни кольору за 1500 м.'],
  }),
  empty('pvs-shvvp', 4, 'IMG_3843.JPG'),
  empty('pvs-shvvp', 6, 'IMG_3843.JPG', 'Рядок незавершений і повторює окремі числа з 2,5 мм². Його значення не використовуються до уточнення.'),
];
