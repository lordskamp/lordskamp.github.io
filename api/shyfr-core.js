export const UKRAINIAN_ALPHABET = Object.freeze(Array.from('АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ'));

export const SHYFR_CONFIG = Object.freeze({
  initialLives: 4,
  maxLives: 4,
  initialHints: 3,
  dailyLives: 4,
  dailyHints: 3,
  mistakesPerAttempt: 3,
  categoryPriceStars: 200,
  levelPriceStars: 10,
  sessionTtlSeconds: 60 * 60 * 24 * 30,
  initDataMaxAgeSeconds: 60 * 60 * 24,
  invoiceTtlSeconds: 60 * 30,
  packs: Object.freeze({
    lives3: Object.freeze({ id: 'lives3', kind: 'lives_pack', quantity: 4, stars: 30, title: 'Повністю відновити життя' }),
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
  return Array.from(String(text || '').normalize('NFC')).map((character, position) => {
    const letter = normalizeUkrainianLetter(character);
    return letter ? { type: 'letter', code: substitution[letter], position } : { type: 'literal', value: character, position };
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
  const number = Math.max(1, Number(levelNumber) || 1);
  return Number(Math.min(0.98, 0.60 + (number - 1) * 0.02).toFixed(2));
}

export function difficultyForLevel(levelNumber, totalLetters) {
  const total = Math.max(0, Number(totalLetters) || 0);
  const ratio = hiddenRatioForLevel(levelNumber);
  return {
    ratio,
    percent: Math.round(ratio * 100),
    hiddenCount: Math.min(total, Math.max(total ? 1 : 0, Math.round(total * ratio)))
  };
}

export function createInitialRevealed({ text, substitution, levelNumber, seed }) {
  const tokens = encodePhrase(text, substitution);
  const positions = tokens.filter(token => token.type === 'letter').map(token => token.position);
  const { hiddenCount } = difficultyForLevel(levelNumber, positions.length);
  const shuffled = [...positions];
  const random = seededRandom(`${seed}:hidden`);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const hidden = new Set(shuffled.slice(0, hiddenCount));
  return Object.fromEntries(tokens
    .filter(token => token.type === 'letter' && !hidden.has(token.position))
    .map(token => [token.position, letterForCode(substitution, token.code)]));
}

function neighborPositions(tokens, position) {
  const neighbors = [];
  for (const direction of [-1, 1]) {
    for (let index = position + direction; index >= 0 && index < tokens.length; index += direction) {
      const token = tokens[index];
      if (token.type === 'letter') { neighbors.push(token.position); break; }
      if (/\s/u.test(token.value)) break;
    }
  }
  return neighbors;
}

export function lockModeForLevel(levelNumber) {
  const number = Math.max(1, Number(levelNumber) || 1);
  if (number <= 10) return 'none';
  return number <= 20 ? 'single' : 'double';
}

export function createLockRequirements({ text, substitution, revealed = {}, levelNumber, seed, mode }) {
  const tokens = encodePhrase(text, substitution);
  const lockMode = mode || lockModeForLevel(levelNumber);
  if (lockMode === 'none') return {};
  const requirement = lockMode === 'double' ? 2 : 1;
  const candidates = tokens.filter(token => {
    if (token.type !== 'letter' || revealed[token.position]) return false;
    const neighbors = neighborPositions(tokens, token.position);
    const revealedNeighbors = neighbors.filter(position => revealed[position]).length;
    return requirement === 2
      ? neighbors.length === 2 && revealedNeighbors < 2
      : neighbors.length > 0 && revealedNeighbors === 0;
  }).map(token => token.position);
  const random = seededRandom(`${seed}:locks:${lockMode}`);
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
  }
  const hiddenCount = tokens.filter(token => token.type === 'letter' && !revealed[token.position]).length;
  const targetCount = Math.min(candidates.length, Math.max(candidates.length ? 1 : 0, Math.ceil(hiddenCount * 0.18)));
  const selected = [];
  for (const position of candidates) {
    if (selected.some(value => neighborPositions(tokens, value).includes(position))) continue;
    selected.push(position);
    if (selected.length >= targetCount) break;
  }
  return Object.fromEntries(selected.map(position => [position, requirement]));
}

export function lockedPositionsForAttempt(text, substitution, revealed = {}, requirements = {}) {
  const tokens = encodePhrase(text, substitution);
  const locked = [];
  for (const [rawPosition, rawRequirement] of Object.entries(requirements)) {
    const position = Number(rawPosition);
    if (revealed[position]) continue;
    const requirement = Number(rawRequirement) === 2 ? 2 : 1;
    const neighbors = neighborPositions(tokens, position);
    const revealedNeighbors = neighbors.filter(value => revealed[value]).length;
    if ((requirement === 1 && revealedNeighbors < 1) || (requirement === 2 && (neighbors.length < 2 || revealedNeighbors < 2))) locked.push(position);
  }
  return locked;
}

export function lockedCodesForAttempt(text, substitution, revealed = {}, requirements = {}) {
  return lockedPositionsForAttempt(text, substitution, revealed, requirements);
}

export function isAttemptSolved(text, substitution, revealed = {}) {
  return encodePhrase(text, substitution).every(token => token.type !== 'letter' || Boolean(revealed[token.position]));
}

export function evaluateGuess({ text, substitution, revealed = {}, errors = 0 }, position, value, options = {}) {
  const selectedPosition = Number(position);
  const letter = normalizeUkrainianLetter(value);
  const token = encodePhrase(text, substitution)[selectedPosition];
  const answer = token?.type === 'letter' ? letterForCode(substitution, token.code) : '';
  const maxErrors = options.maxErrors || SHYFR_CONFIG.mistakesPerAttempt;
  const locked = new Set(options.lockedPositions || options.lockedCodes || []);
  if (locked.has(selectedPosition)) {
    return { ok: false, reason: 'LOCKED_CODE', revealed, errors, status: 'active' };
  }
  if (!answer || !letter || revealed[selectedPosition]) {
    return { ok: false, reason: 'INVALID_GUESS', revealed, errors, status: 'active' };
  }
  if (answer !== letter) {
    const nextErrors = Math.min(maxErrors, errors + 1);
    return { ok: false, reason: 'WRONG_LETTER', revealed, errors: nextErrors, status: nextErrors >= maxErrors ? 'lost' : 'active' };
  }
  const nextRevealed = { ...revealed, [selectedPosition]: answer };
  return {
    ok: true,
    reason: 'CORRECT_LETTER',
    revealed: nextRevealed,
    errors,
    status: isAttemptSolved(text, substitution, nextRevealed) ? 'won' : 'active'
  };
}

export function revealHint({ text, substitution, revealed = {} }, position) {
  const selectedPosition = Number(position);
  const token = encodePhrase(text, substitution)[selectedPosition];
  if (!token || token.type !== 'letter' || revealed[selectedPosition]) return { ok: false, reason: 'INVALID_HINT_POSITION', revealed };
  const letter = letterForCode(substitution, token.code);
  return { ok: true, position: selectedPosition, code: token.code, letter, revealed: { ...revealed, [selectedPosition]: letter } };
}

export function nextUnknownPosition(tokens, revealed = {}, lockedPositions = []) {
  const locked = new Set(lockedPositions.map(Number));
  for (const token of tokens || []) {
    if (token.type === 'letter' && !revealed[token.position] && !locked.has(token.position)) return token.position;
  }
  return (tokens || []).find(token => token.type === 'letter' && !revealed[token.position])?.position ?? null;
}

export function nextUnknownCode(tokens, revealed = {}, lockedPositions = []) {
  return nextUnknownPosition(tokens, revealed, lockedPositions);
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
    next.lives = config.maxLives;
  } else if (purchase.kind === 'hints_pack') {
    next.hints = Math.max(0, Number(next.hints || 0)) + purchase.quantity;
  }
  return next;
}
