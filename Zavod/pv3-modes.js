// DRAW_5, interpreted with the operator's confirmations of 30.09.2026.
// The source recipe stays intact; a separate view selects the operating mode.
const MODES = {
  .5: { single: [58, null, 350], dual: [null, null, 350] },
  .75: { single: [68, null, 350], dual: [65, 85, 350] },
  1: { single: [null, null, 300], dual: [50, 130, 300] },
  1.5: { single: [75, null, 275], dual: [null, null, 275] },
  2.5: { single: [null, null, 210], dual: [80, 100, 210] },
  4: { single: [74, null, 150], dual: [64, 80, 150] },
  6: { single: [67, null, 120], dual: [64, 84, 130] },
};

export const hasPv3Modes = option => option?.practicalCableId === 'pv3';
export const pv3Mode = color => ['yellow-green', 'black'].includes(color) ? 'dual' : 'single';

// Black dye and the striped yellow-green head require both extruders.
// Both colours use the same recorded dual-extruder operating values.
export function modeFor(option, color, defaultMode = option?.mode) {
  if (['black', 'yellow-green'].includes(color)) return 'dual';
  const normal = ['single', 'dual'].includes(defaultMode) ? defaultMode : hasPv3Modes(option) ? 'single' : defaultMode ?? option?.mode ?? 'unknown';
  return normal;
}

export function pv3Recipe(record, mode) {
  if (record.cableId !== 'pv3' || record.origin === 'measurement') return record;
  const values = MODES[record.section]?.[mode];
  if (!values) return record;
  return {
    ...record, mode, modeResolved: true,
    extruder1: values[0], extruder2: values[1], maxSpeed: values[2],
    notes: [
      'ПВ3: один екструдер для звичайного кольору; два — для жовто-зеленого та чорного. Робочі значення спільні для всіх кольорів одного режиму.',
      ...(record.section === .75 ? ['Основний запис: 68 для одного екструдера; 65/85 для двох; робоча швидкість 350. Додаткові 57 і 300 залишені у джерелі, умови не уточнені.'] : []),
      ...(record.section === 6 ? ['Робоча швидкість: 120 для одного екструдера, 130 для двох. Підтверджено оператором 30.09.2026.'] : []),
      ...(record.notes ?? []).filter(note => !/екструд|швидк|68|57|65\s*\/\s*85|74|67/.test(note)),
    ],
    uncertain: (record.uncertain ?? []).filter(note => !/Екструдер|швидкість/.test(note)),
  };
}

export function operatingRecords(records) {
  return records.flatMap(record => record.cableId === 'pv3' && record.origin !== 'measurement' && !record.modeResolved
    ? ['single', 'dual'].map(mode => ({ ...pv3Recipe(record, mode), color: 'all' }))
    : [record]);
}
