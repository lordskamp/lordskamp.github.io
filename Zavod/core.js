export const COLORS = [
  { id: 'blue', label: 'Синій', hex: '#3874bc' },
  { id: 'brown', label: 'Коричневий', hex: '#916044' },
  { id: 'yellow-green', label: 'Жовто-зелений', hex: '#dbc844' },
  { id: 'black', label: 'Чорний', hex: '#303534' },
  { id: 'white', label: 'Білий', hex: '#f5f4ee' },
  { id: 'gray', label: 'Сірий', hex: '#939b99' },
  { id: 'red', label: 'Червоний', hex: '#c84e47' },
  { id: 'green', label: 'Зелений', hex: '#528463' },
  { id: 'yellow', label: 'Жовтий', hex: '#dcc447' }
];

export const DEFAULT_RULES = Object.freeze({ bath: 150, reserve: 1000, lead2: 2000, lead1: 300, splice: 30, sikoraOffset: 0.15 });

export function number(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
  const parsed = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function positive(value) {
  const parsed = number(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function secondSpeed(workingSpeed) {
  const working = positive(workingSpeed);
  return working === null ? null : Math.min(working, Math.max(20, Math.floor(working / 40) * 20));
}

export function fmt(value, digits = 2) {
  const parsed = number(value);
  return parsed === null ? '—' : new Intl.NumberFormat('uk-UA', { maximumFractionDigits: digits }).format(parsed);
}

export function outerEstimate(matrix, offset = DEFAULT_RULES.sikoraOffset) {
  const m = positive(matrix);
  const extra = number(offset);
  if (m === null || extra === null || extra < 0) return null;
  return Math.round((m + extra) * 1000) / 1000;
}

export function colorName(id) {
  return COLORS.find(color => color.id === id)?.label ?? 'Колір не обрано';
}

export function dyePlan(color, mode) {
  if (!COLORS.some(item => item.id === color)) return null;
  if (mode === 'single') {
    if (color === 'yellow-green') return { first: 'Потрібне уточнення', second: 'Вимкнений', valid: false, note: 'Схему жовто-зеленого для одного екструдера не описано.' };
    return { first: colorName(color), second: 'Вимкнений', valid: true, note: 'Увесь колір подає екструдер №1.' };
  }
  if (mode !== 'dual') return { first: 'Уточніть режим', second: 'Уточніть режим', valid: false, note: 'Порожня колонка у записі не означає автоматично вимкнений екструдер.' };
  return {
    first: color === 'yellow-green' ? 'Жовтий' : 'Біла основа',
    second: color === 'yellow-green' ? 'Зелений' : colorName(color),
    valid: true,
    note: color === 'yellow-green' ? 'Жовта основа — №1; зелені смуги — №2.' : 'Основа — №1; обраний колір верхнього шару — №2.'
  };
}

/** Every counter here is local to one output drum. No automatic machine control. */
export function planDrum(drum, nextDrum, mode, inputRules = {}) {
  const rules = { ...DEFAULT_RULES, ...inputRules };
  const length = positive(drum.length);
  const supplied = value => value !== null && value !== undefined;
  const cableChange = Boolean(nextDrum && (
    supplied(drum.cableId) && supplied(nextDrum.cableId) && drum.cableId !== nextDrum.cableId ||
    supplied(drum.section) && supplied(nextDrum.section) && (number(drum.section) ?? drum.section) !== (number(nextDrum.section) ?? nextDrum.section)
  ));
  const headChange = Boolean(nextDrum && (drum.color === 'yellow-green') !== (nextDrum.color === 'yellow-green'));
  const modeChange = Boolean(nextDrum && supplied(drum.mode) && supplied(nextDrum.mode) && drum.mode !== nextDrum.mode);
  const setupChange = cableChange || headChange || modeChange;
  const changes = { setupChange, cableChange, headChange, modeChange };
  const errors = [];
  for (const key of ['bath', 'reserve', 'lead1', 'lead2', 'splice']) {
    const value = number(rules[key]);
    if (value === null || value < 0 || !Number.isInteger(value)) errors.push('Параметри довжини мають бути цілими невід’ємними метрами.');
    rules[key] = value;
  }
  if (length === null || !Number.isInteger(length)) errors.push('Вкажіть довжину барабана цілим числом метрів, більшим за нуль.');
  if (!COLORS.some(color => color.id === drum.color)) errors.push('Оберіть колір барабана.');
  if (nextDrum && !COLORS.some(color => color.id === nextDrum.color)) errors.push('Оберіть колір наступного барабана.');
  if (errors.length) return { errors: [...new Set(errors)], warnings: [], events: [], target: null, ...changes };

  // A cable, distributor or extruder change requires a separate setup. The
  // in-run dye countdown only applies while the current setup continues.
  const transition = Boolean(nextDrum && nextDrum.color !== drum.color && !setupChange);
  const events = [];
  const warnings = [];
  let target = length;
  let formula = `${fmt(length)} м`;
  if (transition) {
    target = length - rules.bath + rules.reserve;
    formula = `${fmt(length)} − ${fmt(rules.bath)} + ${fmt(rules.reserve)} = ${fmt(target)} м`;
    if (length <= rules.bath) errors.push('Довжина барабана має перевищувати запас кабелю у ванні.');
    if (target <= length) warnings.push('Запас не перевищує довжину кабелю у ванні: завдання може не відкласти автоматичне перекидання.');
    const first = dyePlan(drum.color, mode);
    const next = dyePlan(nextDrum.color, mode);
    if (!first?.valid || !next?.valid) {
      warnings.push('Для цього режиму спочатку уточніть схему барвників. Метрові підказки зміни барвника не розраховано.');
    } else {
      const addEvent = (extruder, lead, dye) => {
        const at = length - lead;
        if (at < 0) warnings.push(`Для №${extruder} випередження ${fmt(lead)} м більше за довжину барабана. Перехід потребує окремого плану.`);
        else events.push({ extruder, at, lead, dye });
      };
      if (mode === 'dual' && first.second !== next.second) addEvent(2, rules.lead2, next.second);
      if (first.first !== next.first) addEvent(1, rules.lead1, next.first);
    }
  }
  events.sort((a, b) => a.at - b.at);
  return { errors, warnings, length, target: errors.length ? null : target, formula, transition, events, nextColor: nextDrum?.color ?? null, ...changes };
}

/** Add to the current screen setting, including any earlier +30 additions. */
export function spliceTarget(currentSetting, reserve = DEFAULT_RULES.splice) {
  const current = positive(currentSetting);
  const extra = number(reserve);
  if (current === null || extra === null || extra < 0 || !Number.isInteger(current) || !Number.isInteger(extra)) return null;
  return current + extra;
}

export function parseBreakdowns(value) {
  const input = String(value ?? '').trim();
  if (!input) return { values: [], error: null };
  const parts = input.split(/[;,\n]+/).map(item => item.trim()).filter(Boolean);
  const values = parts.map(number);
  if (values.some(item => item === null || item < 0 || !Number.isInteger(item))) return { values: [], error: 'Метрові позначки — цілі невід’ємні числа, розділені крапкою з комою.' };
  return { values, error: null };
}
