// Card appearance is independent of the editor's wording and row order.
export const CARD_PALETTES = Object.freeze([
  ['#e8bfbe', '#efbd43', '#123247', '#123247'],
  ['#68b2c0', '#e7b8c1', '#123247', '#123247'],
  ['#79a786', '#e98061', '#123247', '#123247'],
  ['#676b7d', '#edbc47', '#fffaf0', '#123247'],
  ['#f0eddf', '#b8dce0', '#123247', '#123247'],
  ['#6d7383', '#c4d5b9', '#fffaf0', '#123247'],
  ['#eec14f', '#e98468', '#123247', '#123247'],
  ['#77a58a', '#eeeada', '#123247', '#123247'],
  ['#e9beca', '#a6d1c4', '#123247', '#123247']
].map(palette => Object.freeze(palette)));

const axisKey = (left, right) => [left, right].map(pole => String(pole).normalize('NFC')).sort().join('|');

// Editorial difficulty: abstract distinctions, competing philosophies, or
// comparisons with no obvious physical scale. A long label alone is never hard.
const difficultAxes = new Set([
  ['Знання', 'Мудрість'],
  ['Практичне', 'Теоретичне'],
  ['Свобода', 'Контроль'],
  ['Релігія', 'Наука'],
  ['Правило', 'Виняток'],
  ['Заслужене', 'Несподіване'],
  ['Практика', 'Теорія'],
  ['Мистецтво', 'Ремесло'],
  ['Романтичне', 'Цинічне'],
  ['Доля', 'Випадок'],
  ['Неусвідомлене', 'Усвідомлене'],
  ["Об'єктивне", "Суб'єктивне"],
  ['Без сенсу', 'Із сенсом'],
  ['Переконливий доказ', 'Слабкий доказ'],
  ['Поезія', 'Проза'],
  ['Вільна воля', 'Доля'],
  ['Усвідомлене', 'Інтуїтивне'],
  ['Штучний інтелект', 'Людський розум'],
  ['Мистецтво', 'Натуризм'],
  ['Несправедливе', 'Заслужене'],
  ['Висока культура', 'Низька культура'],
  ['Справжній сенс', 'Цілковите безглуздя']
].map(([left, right]) => axisKey(left, right)));

export function cardPresentation(card) {
  const key = axisKey(card.left, card.right);
  let hash = 2166136261;
  for (const letter of key) hash = Math.imul(hash ^ letter.codePointAt(0), 16777619) >>> 0;
  const [left, right, leftInk, rightInk] = CARD_PALETTES[hash % CARD_PALETTES.length];
  return Object.freeze({ left, right, leftInk, rightInk, difficult: difficultAxes.has(key) });
}
