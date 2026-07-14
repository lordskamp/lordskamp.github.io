export const UKRAINIAN_ALPHABET = Object.freeze(Array.from('АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ'));

export const SHYFR_CONFIG = Object.freeze({
  initialLives: 5,
  maxLives: 8,
  initialHints: 3,
  maxHints: 25,
  mistakesPerAttempt: 3,
  categoryPriceStars: 200,
  levelPriceStars: 10,
  sessionTtlSeconds: 60 * 60 * 24 * 30,
  initDataMaxAgeSeconds: 60 * 60 * 24,
  invoiceTtlSeconds: 60 * 30,
  packs: Object.freeze({
    lives3: Object.freeze({ id: 'lives3', kind: 'lives_pack', quantity: 3, stars: 30, title: '3 життя' }),
    hints5: Object.freeze({ id: 'hints5', kind: 'hints_pack', quantity: 5, stars: 20, title: '5 підказок' })
  }),
  rateLimits: Object.freeze({
    guess: Object.freeze({ limit: 60, windowSeconds: 60 }),
    hint: Object.freeze({ limit: 10, windowSeconds: 60 }),
    invoice: Object.freeze({ limit: 8, windowSeconds: 60 })
  })
});

const LETTER_SET = new Set(UKRAINIAN_ALPHABET);

export function normalizeUkrainianLetter(value) {
  const letter = String(value || '').normalize('NFC').toLocaleUpperCase('uk-UA');
  return Array.from(letter).length === 1 && LETTER_SET.has(letter) ? letter : '';
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let value = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    value += 0x6d2b79f5;
    let current = value;
    current = Math.imul(current ^ (current >>> 15), current | 1);
    current ^= current + Math.imul(current ^ (current >>> 7), current | 61);
    return ((current ^ (current >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSubstitution(seed) {
  const codes = UKRAINIAN_ALPHABET.map((_, index) => index + 1);
  const random = seededRandom(seed);
  for (let index = codes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [codes[index], codes[swapIndex]] = [codes[swapIndex], codes[index]];
  }
  return Object.fromEntries(UKRAINIAN_ALPHABET.map((letter, index) => [letter, codes[index]]));
}

export function encodePhrase(text, substitution) {
  return Array.from(String(text || '').normalize('NFC')).map(character => {
    const letter = normalizeUkrainianLetter(character);
    return letter ? { type: 'letter', code: substitution[letter] } : { type: 'literal', value: character };
  });
}

export function codesInPhrase(text, substitution) {
  const codes = [];
  for (const token of encodePhrase(text, substitution)) {
    if (token.type === 'letter' && !codes.includes(token.code)) codes.push(token.code);
  }
  return codes;
}

export function letterForCode(substitution, code) {
  const target = Number(code);
  return Object.entries(substitution).find(([, value]) => Number(value) === target)?.[0] || '';
}

export function hiddenRatioForLevel(levelNumber) {
  const fixed = [0.30, 0.40, 0.50, 0.60, 0.70, 0.78, 0.84, 0.88, 0.92];
  const number = Math.max(1, Number(levelNumber) || 1);
  return fixed[number - 1] ?? Math.min(0.96, 0.92 + (number - fixed.length) * 0.01);
}

export function difficultyForLevel(levelNumber, totalUniqueLetters) {
  const total = Math.max(0, Number(totalUniqueLetters) || 0);
  const ratio = hiddenRatioForLevel(levelNumber);
  const maximum = total > 1 ? total - 1 : total;
  return {
    ratio,
    percent: Math.round(ratio * 100),
    hiddenCount: Math.min(maximum, Math.max(total ? 1 : 0, Math.ceil(total * ratio)))
  };
}

export function createInitialRevealed({ text, substitution, levelNumber, seed }) {
  const codes = codesInPhrase(text, substitution);
  const { hiddenCount } = difficultyForLevel(levelNumber, codes.length);
  const shuffled = [...codes];
  const random = seededRandom(`${seed}:hidden`);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const hidden = new Set(shuffled.slice(0, hiddenCount));
  return Object.fromEntries(codes.filter(code => !hidden.has(code)).map(code => [code, letterForCode(substitution, code)]));
}

export function lockedCodesForAttempt(text, substitution, revealed = {}) {
  const tokens = encodePhrase(text, substitution);
  const letterIndexes = tokens.map((token, index) => token.type === 'letter' ? index : -1).filter(index => index >= 0);
  const revealedCodes = new Set(Object.keys(revealed).map(Number));
  const occurrences = new Map();
  for (const index of letterIndexes) {
    const code = tokens[index].code;
    if (revealedCodes.has(code)) continue;
    const list = occurrences.get(code) || [];
    list.push(index);
    occurrences.set(code, list);
  }

  const locked = [];
  for (const [code, indexes] of occurrences) {
    const canOpen = indexes.some(index => {
      let left = index - 1;
      while (left >= 0 && tokens[left].type !== 'letter') left -= 1;
      let right = index + 1;
      while (right < tokens.length && tokens[right].type !== 'letter') right += 1;
      const neighbors = [left, right].filter(value => value >= 0 && value < tokens.length);
      return !neighbors.length || neighbors.some(value => revealedCodes.has(tokens[value].code));
    });
    if (!canOpen) locked.push(code);
  }
  return locked;
}

export function isAttemptSolved(text, substitution, revealed = {}) {
  const known = new Set(Object.keys(revealed).map(Number));
  return codesInPhrase(text, substitution).every(code => known.has(code));
}

export function evaluateGuess({ text, substitution, revealed = {}, errors = 0 }, code, value, options = {}) {
  const selectedCode = Number(code);
  const letter = normalizeUkrainianLetter(value);
  const answer = letterForCode(substitution, selectedCode);
  const maxErrors = options.maxErrors || SHYFR_CONFIG.mistakesPerAttempt;
  if (new Set(options.lockedCodes || []).has(selectedCode)) {
    return { ok: false, reason: 'LOCKED_CODE', revealed, errors, status: 'active' };
  }
  if (!answer || !letter || revealed[selectedCode]) {
    return { ok: false, reason: 'INVALID_GUESS', revealed, errors, status: 'active' };
  }
  if (Object.values(revealed).includes(letter)) {
    return { ok: false, reason: 'LETTER_ALREADY_USED', revealed, errors, status: 'active' };
  }
  if (answer !== letter) {
    const nextErrors = Math.min(maxErrors, errors + 1);
    return { ok: false, reason: 'WRONG_LETTER', revealed, errors: nextErrors, status: nextErrors >= maxErrors ? 'lost' : 'active' };
  }
  const nextRevealed = { ...revealed, [selectedCode]: answer };
  return {
    ok: true,
    reason: 'CORRECT_LETTER',
    revealed: nextRevealed,
    errors,
    status: isAttemptSolved(text, substitution, nextRevealed) ? 'won' : 'active'
  };
}

export function revealHint({ text, substitution, revealed = {} }, randomValue = Math.random()) {
  const unknown = codesInPhrase(text, substitution).filter(code => !revealed[code]);
  if (!unknown.length) return { ok: false, reason: 'NO_UNKNOWN_CODES', revealed };
  const index = Math.min(unknown.length - 1, Math.floor(Math.max(0, randomValue) * unknown.length));
  const code = unknown[index];
  const letter = letterForCode(substitution, code);
  return { ok: true, code, letter, revealed: { ...revealed, [code]: letter } };
}

export function nextUnknownCode(tokens, revealed = {}, lockedCodes = []) {
  const locked = new Set(lockedCodes.map(Number));
  const unknown = [];
  for (const token of tokens || []) {
    if (token.type === 'letter' && !revealed[token.code] && !unknown.includes(token.code)) unknown.push(token.code);
  }
  return unknown.find(code => !locked.has(code)) ?? unknown[0] ?? null;
}

export function parseProductKey(productKey) {
  const [kind, id, ...extra] = String(productKey || '').split(':');
  if (extra.length || !id || !['category_unlock', 'level_unlock', 'lives_pack', 'hints_pack'].includes(kind)) return null;
  return { kind, id };
}

export function resolveProduct(productKey, { categories, levels, config = SHYFR_CONFIG }) {
  const parsed = parseProductKey(productKey);
  if (!parsed) return null;
  if (parsed.kind === 'category_unlock') {
    const category = categories.find(item => item.id === parsed.id);
    const count = levels.filter(level => level.categoryId === parsed.id).length;
    if (!category || category.free || !count) return null;
    return { ...parsed, title: category.title, quantity: 1, stars: category.priceStars || config.categoryPriceStars };
  }
  if (parsed.kind === 'level_unlock') {
    const level = levels.find(item => item.id === parsed.id);
    const category = level && categories.find(item => item.id === level.categoryId);
    if (!level || level.free || category?.free) return null;
    return { ...parsed, title: `Рівень ${level.order} · ${category.title}`, quantity: 1, stars: config.levelPriceStars };
  }
  const pack = config.packs[parsed.id];
  return pack && pack.kind === parsed.kind ? { ...parsed, ...pack } : null;
}

export function hasLevelAccess({ level, category, entitlements = [] }) {
  if (!level || !category) return false;
  if (category.free || level.free) return true;
  return entitlements.includes(`category_unlock:${category.id}`) || entitlements.includes(`level_unlock:${level.id}`);
}

export function fulfillPurchaseState(user, purchase, config = SHYFR_CONFIG) {
  const next = structuredClone(user);
  next.processedCharges ||= [];
  next.entitlements ||= [];
  if (next.processedCharges.includes(purchase.chargeId)) return next;
  next.processedCharges.push(purchase.chargeId);
  if (purchase.kind === 'category_unlock' || purchase.kind === 'level_unlock') {
    const key = `${purchase.kind}:${purchase.resourceId}`;
    if (!next.entitlements.includes(key)) next.entitlements.push(key);
  } else if (purchase.kind === 'lives_pack') {
    next.lives = Math.min(config.maxLives, Number(next.lives || 0) + purchase.quantity);
  } else if (purchase.kind === 'hints_pack') {
    next.hints = Math.min(config.maxHints, Number(next.hints || 0) + purchase.quantity);
  }
  return next;
}
