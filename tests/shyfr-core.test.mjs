import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UKRAINIAN_ALPHABET,
  codesInPhrase,
  createInitialRevealed,
  createSubstitution,
  difficultyForLevel,
  encodePhrase,
  evaluateGuess,
  fulfillPurchaseState,
  hasLevelAccess,
  hiddenRatioForLevel,
  lockedCodesForAttempt,
  nextUnknownCode,
  normalizeUkrainianLetter,
  resolveProduct
} from '../api/shyfr-core.js';

test('український алфавіт має 33 унікальні літери', () => {
  assert.equal(UKRAINIAN_ALPHABET.length, 33);
  assert.equal(new Set(UKRAINIAN_ALPHABET).size, 33);
  assert.equal(normalizeUkrainianLetter('ґ'), 'Ґ');
  assert.equal(normalizeUkrainianLetter('ы'), '');
});

test('підстановка є детермінованою бієкцією, а пунктуація не шифрується', () => {
  const first = createSubstitution('attempt-1');
  const second = createSubstitution('attempt-1');
  assert.deepEqual(first, second);
  assert.equal(new Set(Object.values(first)).size, 33);
  assert.deepEqual(encodePhrase('Я, є!', first).map(token => token.type), ['letter', 'literal', 'literal', 'letter', 'literal']);
});

test('складність починається з 30% і поступово доходить до 96%', () => {
  assert.equal(hiddenRatioForLevel(1), 0.30);
  assert.equal(hiddenRatioForLevel(5), 0.70);
  assert.equal(hiddenRatioForLevel(9), 0.92);
  assert.equal(hiddenRatioForLevel(20), 0.96);
  assert.deepEqual(difficultyForLevel(1, 10), { ratio: 0.30, percent: 30, hiddenCount: 3 });
  assert.equal(difficultyForLevel(20, 10).hiddenCount, 9, 'щонайменше одна унікальна літера лишається відкритою');
});

test('початкове відкриття залежить від номера рівня, а не запису контенту', () => {
  const substitution = createSubstitution('same-seed');
  const text = 'АБВГҐДЕЄЖЗ';
  const first = createInitialRevealed({ text, substitution, levelNumber: 1, seed: 'attempt' });
  const repeated = createInitialRevealed({ text, substitution, levelNumber: 1, seed: 'attempt' });
  const later = createInitialRevealed({ text, substitution, levelNumber: 7, seed: 'attempt' });
  assert.deepEqual(first, repeated);
  assert.equal(codesInPhrase(text, substitution).length - Object.keys(first).length, 3);
  assert.ok(Object.keys(later).length < Object.keys(first).length);
});

test('закритий символ не можна вибрати, доки до нього не дійде відкрита сусідня літера', () => {
  const substitution = Object.fromEntries(UKRAINIAN_ALPHABET.map((letter, index) => [letter, index + 1]));
  const text = 'АБВГД';
  const revealed = { 2: 'Б' };
  const locked = lockedCodesForAttempt(text, substitution, revealed);
  assert.deepEqual(locked, [4, 6]);
  assert.equal(nextUnknownCode(encodePhrase(text, substitution), revealed, locked), 1);

  const rejected = evaluateGuess({ text, substitution, revealed }, 4, 'Г', { lockedCodes: locked });
  assert.equal(rejected.reason, 'LOCKED_CODE');
  assert.equal(rejected.errors, 0);

  const afterC = { ...revealed, 3: 'В' };
  assert.deepEqual(lockedCodesForAttempt(text, substitution, afterC), [6]);
  const afterD = { ...afterC, 4: 'Г' };
  assert.deepEqual(lockedCodesForAttempt(text, substitution, afterD), []);
});

test('товари й права доступу визначає серверний каталог', () => {
  const categories = [{ id: 'paid', title: 'Платна', free: false, priceStars: 200 }];
  const levels = [{ id: 'level-1', categoryId: 'paid', order: 1, free: false }];
  assert.deepEqual(resolveProduct('category_unlock:paid', { categories, levels }), {
    kind: 'category_unlock', id: 'paid', title: 'Платна', quantity: 1, stars: 200
  });
  assert.equal(resolveProduct('category_unlock:missing', { categories, levels }), null);
  assert.equal(hasLevelAccess({ level: levels[0], category: categories[0], entitlements: [] }), false);
  assert.equal(hasLevelAccess({ level: levels[0], category: categories[0], entitlements: ['level_unlock:level-1'] }), true);
  assert.equal(hasLevelAccess({ level: levels[0], category: categories[0], entitlements: ['category_unlock:paid'] }), true);
});

test('повторний Telegram charge не нараховує товар двічі', () => {
  const user = { lives: 5, hints: 3, entitlements: [], processedCharges: [] };
  const purchase = { kind: 'hints_pack', resourceId: 'hints5', quantity: 5, chargeId: 'charge-1' };
  const credited = fulfillPurchaseState(user, purchase);
  const repeated = fulfillPurchaseState(credited, purchase);
  assert.equal(credited.hints, 8);
  assert.equal(repeated.hints, 8);
  assert.deepEqual(repeated.processedCharges, ['charge-1']);
});
