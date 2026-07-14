import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UKRAINIAN_ALPHABET,
  createLockRequirements,
  createInitialRevealed,
  createSubstitution,
  difficultyForLevel,
  encodePhrase,
  evaluateGuess,
  fulfillPurchaseState,
  hasLevelAccess,
  hiddenRatioForLevel,
  lockedPositionsForAttempt,
  lockModeForLevel,
  nextUnknownPosition,
  normalizeUkrainianLetter,
  resolveProduct,
  revealHint
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

test('складність починається з 60% і поступово доходить до 98%', () => {
  assert.equal(hiddenRatioForLevel(1), 0.60);
  assert.equal(hiddenRatioForLevel(10), 0.78);
  assert.equal(hiddenRatioForLevel(20), 0.98);
  assert.equal(hiddenRatioForLevel(40), 0.98);
  assert.deepEqual(difficultyForLevel(1, 10), { ratio: 0.60, percent: 60, hiddenCount: 6 });
  assert.equal(difficultyForLevel(20, 10).hiddenCount, 10);
});

test('початкове відкриття залежить від номера рівня, а не запису контенту', () => {
  const substitution = createSubstitution('same-seed');
  const text = 'АБВГҐДЕЄЖЗ';
  const first = createInitialRevealed({ text, substitution, levelNumber: 1, seed: 'attempt' });
  const repeated = createInitialRevealed({ text, substitution, levelNumber: 1, seed: 'attempt' });
  const later = createInitialRevealed({ text, substitution, levelNumber: 7, seed: 'attempt' });
  assert.deepEqual(first, repeated);
  assert.equal(Array.from(text).length - Object.keys(first).length, 6);
  assert.ok(Object.keys(later).length < Object.keys(first).length);
});

test('однакова літера вводиться окремо в кожну комірку', () => {
  const substitution = Object.fromEntries(UKRAINIAN_ALPHABET.map((letter, index) => [letter, index + 1]));
  const first = evaluateGuess({ text: 'АБА', substitution, revealed: {} }, 0, 'А');
  assert.equal(first.ok, true);
  assert.deepEqual(first.revealed, { 0: 'А' });
  assert.equal(first.status, 'active');
  const repeated = evaluateGuess({ text: 'АБА', substitution, revealed: first.revealed }, 2, 'А');
  assert.equal(repeated.ok, true, 'ту саму літеру можна ввести в інше місце');
  assert.deepEqual(repeated.revealed, { 0: 'А', 2: 'А' });
});

test('звичайні замки з’являються після 10 рівня, подвійні — після 20', () => {
  const substitution = Object.fromEntries(UKRAINIAN_ALPHABET.map((letter, index) => [letter, index + 1]));
  const text = 'АБВГД';
  assert.equal(lockModeForLevel(10), 'none');
  assert.equal(lockModeForLevel(11), 'single');
  assert.equal(lockModeForLevel(20), 'single');
  assert.equal(lockModeForLevel(21), 'double');
  assert.deepEqual(createLockRequirements({ text, substitution, revealed: {}, levelNumber: 10, seed: 'test' }), {});

  const revealed = { 0: 'А' };
  const single = { 2: 1 };
  assert.deepEqual(lockedPositionsForAttempt(text, substitution, revealed, single), [2]);
  const afterNeighbor = { ...revealed, 1: 'Б' };
  assert.deepEqual(lockedPositionsForAttempt(text, substitution, afterNeighbor, single), []);
  assert.equal(nextUnknownPosition(encodePhrase(text, substitution), revealed, [2]), 1);

  const double = { 2: 2 };
  const locked = lockedPositionsForAttempt(text, substitution, afterNeighbor, double);
  assert.deepEqual(locked, [2]);
  const rejected = evaluateGuess({ text, substitution, revealed: afterNeighbor }, 2, 'В', { lockedPositions: locked });
  assert.equal(rejected.reason, 'LOCKED_CODE');
  assert.equal(rejected.errors, 0);
  assert.deepEqual(lockedPositionsForAttempt(text, substitution, { ...afterNeighbor, 3: 'Г' }, double), []);
});

test('підказка відкриває саме обрану комірку', () => {
  const substitution = Object.fromEntries(UKRAINIAN_ALPHABET.map((letter, index) => [letter, index + 1]));
  const hint = revealHint({ text: 'АБА', substitution, revealed: {} }, 2);
  assert.equal(hint.ok, true);
  assert.equal(hint.position, 2);
  assert.deepEqual(hint.revealed, { 2: 'А' });
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
  const user = { lives: 2, hints: 3, entitlements: [], processedCharges: [] };
  const purchase = { kind: 'hints_pack', resourceId: 'hints5', quantity: 5, chargeId: 'charge-1' };
  const credited = fulfillPurchaseState(user, purchase);
  const repeated = fulfillPurchaseState(credited, purchase);
  assert.equal(credited.hints, 8);
  assert.equal(repeated.hints, 8);
  assert.deepEqual(repeated.processedCharges, ['charge-1']);
  const refilled = fulfillPurchaseState(user, { kind: 'lives_pack', resourceId: 'lives3', quantity: 4, chargeId: 'charge-2' });
  assert.equal(refilled.lives, 4, 'покупка життя заповнює запас повністю');
});
