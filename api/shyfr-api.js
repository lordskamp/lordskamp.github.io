import { loadPublicShyfrContent } from './shyfr-content.js';
import {
  SHYFR_CONFIG,
  createInitialRevealed,
  createLockRequirements,
  createSubstitution,
  difficultyForLevel,
  encodePhrase,
  evaluateGuess,
  fulfillPurchaseState,
  hasLevelAccess,
  hiddenRatioForLevel,
  isAttemptSolved,
  lockedPositionsForAttempt,
  lockModeForLevel,
  nextUnknownPosition,
  normalizeUkrainianLetter,
  resolveProduct,
  revealHint
} from './shyfr-core.js';

const API_PREFIX = '/shyfr';
const SESSION_PREFIX = 'Bearer ';
const TMA_PREFIX = 'tma ';
const DAILY_RESET_TIME_ZONE = 'Europe/Kyiv';
const KYIV_PARTS_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: DAILY_RESET_TIME_ZONE,
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  hourCycle: 'h23'
});
const PAYMENT_PAYLOAD_RE = /^shyfr:v1:([0-9a-f-]{36})$/iu;
const TELEGRAM_ID_RE = /^[1-9]\d{0,19}$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NICKNAME_RE = /^[\p{L}\p{N} _.'’ʼ-]{2,24}$/u;
const TUTORIAL_HINT_LIMIT = 3;
const AVATAR_URL_MAX_LENGTH = 2048;
const KEY = Object.freeze({
  content: 'shyfr:content:catalog',
  session: hash => `shyfr:session:${hash}`,
  user: id => `shyfr:user:${id}`,
  attempt: id => `shyfr:attempt:${id}`,
  purchase: id => `shyfr:purchase:${id}`,
  pending: (userId, productKey) => `shyfr:pending:${userId}:${productKey}`,
  charge: id => `shyfr:charge:${id}`,
  update: id => `shyfr:update:${id}`,
  rate: (userId, action, bucket) => `shyfr:rate:${userId}:${action}:${bucket}`,
  score: userId => `shyfr:score:${userId}`
});
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function shyfrConfigForEnv(env = {}) {
  const dailyLives = positiveInteger(env.SHYFR_DAILY_LIVES, SHYFR_CONFIG.dailyLives);
  const dailyHints = positiveInteger(env.SHYFR_DAILY_HINTS, SHYFR_CONFIG.dailyHints);
  const hintsQuantity = positiveInteger(env.SHYFR_HINTS_PACK_QUANTITY, SHYFR_CONFIG.packs.hints5.quantity);
  return {
    ...SHYFR_CONFIG,
    initialLives: dailyLives,
    maxLives: dailyLives,
    dailyLives,
    initialHints: dailyHints,
    dailyHints,
    categoryPriceStars: positiveInteger(env.SHYFR_CATEGORY_PRICE_STARS, SHYFR_CONFIG.categoryPriceStars),
    levelPriceStars: positiveInteger(env.SHYFR_LEVEL_PRICE_STARS, SHYFR_CONFIG.levelPriceStars),
    packs: {
      lives3: { ...SHYFR_CONFIG.packs.lives3, quantity: dailyLives, stars: positiveInteger(env.SHYFR_LIVES_PACK_STARS, SHYFR_CONFIG.packs.lives3.stars), title: 'Повністю відновити життя' },
      hints5: { ...SHYFR_CONFIG.packs.hints5, quantity: hintsQuantity, stars: positiveInteger(env.SHYFR_HINTS_PACK_STARS, SHYFR_CONFIG.packs.hints5.stars), title: `${hintsQuantity} підказок` }
    }
  };
}

function kyivDateParts(timestamp) {
  return Object.fromEntries(KYIV_PARTS_FORMATTER.formatToParts(new Date(timestamp))
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
}

function kyivOffsetAt(timestamp) {
  const parts = kyivDateParts(timestamp);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - timestamp;
}

function kyivMidnightUtc(year, month, day) {
  const localMidnight = Date.UTC(year, month - 1, day);
  let result = localMidnight;
  for (let index = 0; index < 3; index += 1) result = localMidnight - kyivOffsetAt(result);
  return result;
}

export function dailyResetInfo(now = Date.now()) {
  const parts = kyivDateParts(now);
  const key = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  return {
    key,
    resetAt: new Date(kyivMidnightUtc(parts.year, parts.month, parts.day + 1)).toISOString()
  };
}

function refreshDailyInventory(user, config, now = Date.now()) {
  const daily = dailyResetInfo(now);
  const changed = user.dailyResetKey !== daily.key || user.dailyResetTimeZone !== DAILY_RESET_TIME_ZONE;
  if (changed) {
    user.lives = config.dailyLives;
    user.hints = Math.max(config.dailyHints, Number(user.hints || 0));
    user.dailyResetKey = daily.key;
    user.dailyResetTimeZone = DAILY_RESET_TIME_ZONE;
  }
  user.dailyResetAt = daily.resetAt;
  return changed;
}

function inventoryFor(user, config) {
  const daily = dailyResetInfo();
  return {
    lives: Number(user.lives || 0),
    hints: Number(user.hints || 0),
    limits: { lives: config.dailyLives, hints: config.dailyHints },
    resetAt: user.dailyResetAt || daily.resetAt
  };
}

function bytesToHex(value) {
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key, value) {
  const encoder = new TextEncoder();
  const rawKey = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
}

async function sha256Hex(value) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function validateTelegramInitData(initData, botToken, options = {}) {
  if (!botToken || typeof initData !== 'string' || !initData) return { ok: false, reason: 'MISSING_INIT_DATA' };
  const params = new URLSearchParams(initData);
  const receivedHash = String(params.get('hash') || '').toLocaleLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(receivedHash)) return { ok: false, reason: 'INVALID_HASH' };
  params.delete('hash');
  const dataCheckString = Array.from(params.entries()).map(([key, value]) => `${key}=${value}`).sort().join('\n');
  const secretKey = await hmacSha256('WebAppData', botToken);
  const expectedHash = bytesToHex(await hmacSha256(secretKey, dataCheckString));
  if (!constantTimeEqual(expectedHash, receivedHash)) return { ok: false, reason: 'INVALID_HASH' };
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? SHYFR_CONFIG.initDataMaxAgeSeconds;
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + 60 || nowSeconds - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'EXPIRED_INIT_DATA' };
  }
  try {
    const user = JSON.parse(params.get('user') || '');
    if (!TELEGRAM_ID_RE.test(String(user?.id || ''))) return { ok: false, reason: 'INVALID_USER' };
    return { ok: true, user, authDate };
  } catch (_error) {
    return { ok: false, reason: 'INVALID_USER' };
  }
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function kvGet(env, key) {
  return env.KOBZA_LEADERBOARD.get(key, 'json');
}

async function kvPut(env, key, value, options) {
  return env.KOBZA_LEADERBOARD.put(key, JSON.stringify(value), options);
}

function displayName(telegramUser) {
  const username = String(telegramUser?.username || '').trim();
  const fullName = [telegramUser?.first_name, telegramUser?.last_name].map(value => String(value || '').trim()).filter(Boolean).join(' ');
  return (username ? `@${username}` : fullName || 'Гравець').slice(0, 80);
}

function cleanAvatarUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > AVATAR_URL_MAX_LENGTH) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch (_error) {
    return null;
  }
}

function cleanNickname(value) {
  const name = String(value || '').trim().replace(/\s+/gu, ' ');
  return NICKNAME_RE.test(name) ? name : '';
}

function freshUser({ id, kind, telegramId = null, name, avatarUrl = null, config }) {
  const daily = dailyResetInfo();
  return {
    id,
    kind,
    telegramId,
    name,
    avatarUrl: cleanAvatarUrl(avatarUrl),
    nicknameSet: kind === 'telegram',
    tutorialHintsUsed: 0,
    lives: Math.min(config.initialLives, config.maxLives),
    hints: config.initialHints,
    dailyResetKey: daily.key,
    dailyResetTimeZone: DAILY_RESET_TIME_ZONE,
    dailyResetAt: daily.resetAt,
    entitlements: [],
    progress: {},
    activeAttempts: {},
    purchases: [],
    processedCharges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeUser(user, config) {
  if (!user) return null;
  return {
    ...user,
    avatarUrl: cleanAvatarUrl(user.avatarUrl),
    nicknameSet: user.kind === 'telegram' || Boolean(user.nicknameSet),
    tutorialHintsUsed: Math.max(0, Math.min(TUTORIAL_HINT_LIMIT, Number(user.tutorialHintsUsed || 0))),
    lives: Math.max(0, Math.min(config.maxLives, Number(user.lives ?? config.initialLives))),
    hints: Math.max(0, Number(user.hints ?? config.initialHints)),
    entitlements: Array.isArray(user.entitlements) ? user.entitlements : [],
    progress: user.progress && typeof user.progress === 'object' ? user.progress : {},
    activeAttempts: user.activeAttempts && typeof user.activeAttempts === 'object' ? user.activeAttempts : {},
    purchases: Array.isArray(user.purchases) ? user.purchases : [],
    processedCharges: Array.isArray(user.processedCharges) ? user.processedCharges : []
  };
}

async function saveUser(env, user) {
  user.updatedAt = new Date().toISOString();
  await kvPut(env, KEY.user(user.id), user);
}

async function createSession(env, user, config) {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await kvPut(env, KEY.session(tokenHash), {
    userId: user.id,
    kind: user.kind,
    expiresAt: Date.now() + config.sessionTtlSeconds * 1000
  }, { expirationTtl: config.sessionTtlSeconds });
  return token;
}

async function browserLogin(env, config) {
  const user = freshUser({ id: `guest:${crypto.randomUUID()}`, kind: 'browser', name: 'Гість', config });
  await saveUser(env, user);
  return createSession(env, user, config);
}

async function telegramLogin(request, env, config) {
  const authorization = String(request.headers.get('Authorization') || '');
  if (!authorization.startsWith(TMA_PREFIX)) return { error: 'Telegram initData відсутні.', status: 401 };
  const validation = await validateTelegramInitData(authorization.slice(TMA_PREFIX.length), env.SHYFR_BOT_TOKEN, {
    maxAgeSeconds: config.initDataMaxAgeSeconds
  });
  if (!validation.ok) return { error: validation.reason, status: 401 };
  const telegramId = String(validation.user.id);
  const id = `tg:${telegramId}`;
  let user = normalizeUser(await kvGet(env, KEY.user(id)), config);
  if (!user) user = freshUser({ id, kind: 'telegram', telegramId, name: displayName(validation.user), avatarUrl: validation.user.photo_url, config });
  refreshDailyInventory(user, config);
  user.kind = 'telegram';
  user.telegramId = telegramId;
  user.name = displayName(validation.user);
  user.avatarUrl = cleanAvatarUrl(validation.user.photo_url);
  user.nicknameSet = true;
  await saveUser(env, user);
  return { token: await createSession(env, user, config) };
}

async function authenticate(request, env, config) {
  const authorization = String(request.headers.get('Authorization') || '');
  if (!authorization.startsWith(SESSION_PREFIX)) return null;
  const token = authorization.slice(SESSION_PREFIX.length).trim();
  if (!/^[a-f0-9]{64}$/iu.test(token)) return null;
  const session = await kvGet(env, KEY.session(await sha256Hex(token)));
  if (!session || Number(session.expiresAt) <= Date.now()) return null;
  const user = normalizeUser(await kvGet(env, KEY.user(session.userId)), config);
  if (!user) return null;
  if (refreshDailyInventory(user, config)) await saveUser(env, user);
  return { session, user };
}

function validPrivateLevel(level) {
  return Boolean(level && typeof level.id === 'string' && typeof level.categoryId === 'string'
    && Number.isSafeInteger(level.order) && typeof level.text === 'string' && level.text.trim()
    && level.source && typeof level.source.label === 'string');
}

async function serverContent(env) {
  const publicContent = await loadPublicShyfrContent(env);
  const privateLevels = await kvGet(env, KEY.content);
  const publicIds = new Set(publicContent.levels.map(level => level.id));
  const levels = [...publicContent.levels, ...(Array.isArray(privateLevels) ? privateLevels.filter(validPrivateLevel).filter(level => !publicIds.has(level.id)) : [])]
    .sort((left, right) => left.categoryId.localeCompare(right.categoryId) || left.order - right.order);
  return { categories: publicContent.categories, levels };
}

function categoryFor(categoryId, categories) {
  return categories.find(category => category.id === categoryId) || null;
}

function levelAccess(level, user, categories) {
  return hasLevelAccess({ level, category: categoryFor(level.categoryId, categories), entitlements: user.entitlements });
}

function letterCount(text) {
  return Array.from(String(text)).map(normalizeUkrainianLetter).filter(Boolean).length;
}

async function loadAttempt(env, id, userId) {
  const attempt = id ? await kvGet(env, KEY.attempt(id)) : null;
  return attempt?.userId === userId ? attempt : null;
}

function lockModeForAttempt(level, difficultyNumber = level.order) {
  if (level.categoryId === 'tutorial') return ['none', 'single', 'double'][level.order - 1] || 'double';
  return lockModeForLevel(difficultyNumber);
}

function ensureAttemptModel(attempt, level) {
  if (attempt.schemaVersion === 2 && attempt.lockRequirements && attempt.revealed) return attempt;
  const tokens = encodePhrase(level.text, attempt.substitution);
  const legacyRevealed = attempt.revealed || {};
  const revealed = Object.fromEntries(tokens
    .filter(token => token.type === 'letter' && legacyRevealed[token.code])
    .map(token => [token.position, legacyRevealed[token.code]]));
  attempt.schemaVersion = 2;
  attempt.revealed = revealed;
  attempt.lockRequirements = createLockRequirements({
    text: level.text,
    substitution: attempt.substitution,
    revealed,
    levelNumber: attempt.difficultyNumber || attempt.levelNumber,
    seed: attempt.seed,
    mode: lockModeForAttempt(level, attempt.difficultyNumber || attempt.levelNumber)
  });
  return attempt;
}

function publicAttempt(attempt, level, categories) {
  if (!attempt || !level) return null;
  ensureAttemptModel(attempt, level);
  const substitution = attempt.substitution;
  const revealed = attempt.revealed || {};
  const lockedPositions = attempt.status === 'active'
    ? lockedPositionsForAttempt(level.text, substitution, revealed, attempt.lockRequirements)
    : [];
  const locked = new Set(lockedPositions);
  const tokens = encodePhrase(level.text, substitution).map(token => token.type === 'letter'
    ? {
        ...token,
        locked: !revealed[token.position] && locked.has(token.position),
        lockType: locked.has(token.position) ? (Number(attempt.lockRequirements[token.position]) === 2 ? 'double' : 'single') : null
      }
    : token);
  const hiddenRemaining = tokens.filter(token => token.type === 'letter' && !revealed[token.position]).length;
  const response = {
    id: attempt.id,
    levelId: attempt.levelId,
    categoryId: attempt.categoryId,
    categoryTitle: categoryFor(attempt.categoryId, categories)?.title || '',
    levelNumber: attempt.levelNumber,
    difficultyNumber: attempt.difficultyNumber || attempt.levelNumber,
    hiddenPercent: attempt.hiddenPercent,
    hiddenTotal: attempt.hiddenTotal,
    hiddenRemaining,
    tokens,
    revealed,
    errors: Number(attempt.errors || 0),
    maxErrors: SHYFR_CONFIG.mistakesPerAttempt,
    hintsUsed: Number(attempt.hintsUsed || 0),
    status: attempt.status,
    startedAt: attempt.startedAt,
    selectedPosition: nextUnknownPosition(tokens, revealed, lockedPositions),
    tutorialStep: attempt.categoryId === 'tutorial' ? attempt.levelNumber : null
  };
  if (attempt.status === 'won') {
    response.result = {
      text: level.text,
      source: level.source,
      seconds: Math.max(1, Math.round((Date.parse(attempt.completedAt) - Date.parse(attempt.startedAt)) / 1000)),
      errors: response.errors,
      hintsUsed: response.hintsUsed
    };
  }
  return response;
}

function profileFor(user) {
  const entries = Object.values(user.progress || {});
  const bestSeconds = entries.map(entry => Number(entry.bestSeconds)).filter(Number.isFinite);
  return {
    name: user.name,
    avatarUrl: cleanAvatarUrl(user.avatarUrl),
    nicknameSet: Boolean(user.nicknameSet),
    completedLevels: entries.length,
    totalCompletions: entries.reduce((sum, entry) => sum + Number(entry.completions || 0), 0),
    bestSeconds: bestSeconds.length ? Math.min(...bestSeconds) : null
  };
}

function onboardingFor(user, levels) {
  const tutorialLevels = levels.filter(level => level.categoryId === 'tutorial');
  const tutorialCompleted = Boolean(tutorialLevels.length) && tutorialLevels.every(level => user.progress[level.id]);
  const nicknameRequired = user.kind === 'browser' && tutorialCompleted && !user.nicknameSet;
  const tutorialHintsUsed = Math.max(0, Math.min(TUTORIAL_HINT_LIMIT, Number(user.tutorialHintsUsed || 0)));
  return {
    tutorialCompleted,
    nicknameRequired,
    complete: tutorialCompleted && !nicknameRequired,
    tutorialHintsUsed,
    tutorialHintsRemaining: TUTORIAL_HINT_LIMIT - tutorialHintsUsed
  };
}

async function bootstrap(env, user, config) {
  const { categories: catalogCategories, levels } = await serverContent(env);
  const categories = catalogCategories.map(category => {
    const categoryLevels = levels.filter(level => level.categoryId === category.id);
    const completed = categoryLevels.filter(level => user.progress[level.id]).length;
    const categoryUnlocked = category.free || user.entitlements.includes(`category_unlock:${category.id}`);
    const playableLevels = categoryLevels.filter(level => levelAccess(level, user, catalogCategories));
    const nextLevel = playableLevels.find(level => !user.progress[level.id]) || null;
    return {
      ...category,
      priceStars: category.priceStars || config.categoryPriceStars,
      available: categoryLevels.length > 0,
      unlocked: categoryUnlocked,
      completed,
      total: categoryLevels.length,
      progress: categoryLevels.length ? completed / categoryLevels.length : 0,
      attemptId: user.activeAttempts[category.id] || null,
      nextLevelNumber: nextLevel?.order || null,
      completedAll: Boolean(categoryLevels.length) && completed === categoryLevels.length,
      levels: categoryLevels.map(level => ({
        id: level.id,
        number: level.order,
        hiddenPercent: Math.round(hiddenRatioForLevel(level.order) * 100),
        free: level.free || category.free,
        completed: Boolean(user.progress[level.id]),
        unlocked: levelAccess(level, user, catalogCategories),
        priceStars: config.levelPriceStars
      }))
    };
  });
  return {
    mode: user.kind,
    telegram: user.kind === 'telegram',
    profile: profileFor(user),
    onboarding: onboardingFor(user, levels),
    inventory: inventoryFor(user, config),
    categories,
    purchases: user.purchases.slice(0, 10),
    shop: {
      categoryPriceStars: config.categoryPriceStars,
      levelPriceStars: config.levelPriceStars,
      packs: Object.values(config.packs),
      paymentSupport: String(env.SHYFR_PAYMENT_SUPPORT || '@replace_with_support_username')
    }
  };
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch (_error) {
    return null;
  }
}

async function enforceRateLimit(env, userId, action, rule) {
  const bucket = Math.floor(Date.now() / (rule.windowSeconds * 1000));
  const key = KEY.rate(userId, action, bucket);
  const count = Number(await env.KOBZA_LEADERBOARD.get(key) || 0) + 1;
  await env.KOBZA_LEADERBOARD.put(key, String(count), { expirationTtl: rule.windowSeconds * 2 });
  if (count > rule.limit) throw Object.assign(new Error('RATE_LIMITED'), { status: 429 });
}

async function startAttempt(env, user, body, config) {
  const { categories, levels } = await serverContent(env);
  const categoryId = String(body?.categoryId || '');
  const onboarding = onboardingFor(user, levels);
  if (categoryId !== 'tutorial' && !onboarding.complete) {
    return json({ error: onboarding.nicknameRequired ? 'NICKNAME_REQUIRED' : 'TUTORIAL_REQUIRED' }, 409);
  }
  const categoryLevels = levels.filter(level => level.categoryId === categoryId && levelAccess(level, user, categories));
  if (!categoryLevels.length) return json({ error: 'NO_ACCESSIBLE_LEVELS' }, 403);
  const activeId = user.activeAttempts[categoryId];
  const active = await loadAttempt(env, activeId, user.id);
  if (active?.status === 'active') {
    const activeLevel = levels.find(level => level.id === active.levelId);
    return json({ ok: true, attempt: publicAttempt(active, activeLevel, categories), inventory: inventoryFor(user, config) });
  }
  if (categoryId !== 'tutorial' && Number(user.lives) <= 0) return json({ error: 'NO_LIVES', message: 'Життя закінчилися.' }, 409);
  const level = categoryLevels.find(item => !user.progress[item.id]);
  if (!level) return json({ error: 'CATEGORY_COMPLETED' }, 409);
  const id = crypto.randomUUID();
  const seed = randomToken();
  const substitution = createSubstitution(seed);
  const levelNumber = level.order;
  const completedGameLevels = levels.filter(item => item.categoryId !== 'tutorial' && user.progress[item.id]).length;
  const difficultyNumber = categoryId === 'tutorial' ? levelNumber : completedGameLevels + 1;
  const revealed = createInitialRevealed({ text: level.text, substitution, levelNumber: difficultyNumber, seed });
  const difficulty = difficultyForLevel(difficultyNumber, letterCount(level.text));
  const lockRequirements = createLockRequirements({
    text: level.text,
    substitution,
    revealed,
    levelNumber: difficultyNumber,
    seed,
    mode: lockModeForAttempt(level, difficultyNumber)
  });
  const now = new Date().toISOString();
  const attempt = {
    id,
    userId: user.id,
    levelId: level.id,
    categoryId,
    levelNumber,
    difficultyNumber,
    seed,
    substitution,
    schemaVersion: 2,
    revealed,
    lockRequirements,
    hiddenTotal: difficulty.hiddenCount,
    hiddenPercent: difficulty.percent,
    errors: 0,
    hintsUsed: 0,
    status: 'active',
    credited: false,
    startedAt: now,
    updatedAt: now,
    completedAt: null
  };
  user.activeAttempts[categoryId] = id;
  await Promise.all([kvPut(env, KEY.attempt(id), attempt), saveUser(env, user)]);
  return json({ ok: true, attempt: publicAttempt(attempt, level, categories), inventory: inventoryFor(user, config) });
}

async function updateScore(env, user) {
  if (user.kind === 'browser' && !user.nicknameSet) return;
  const profile = profileFor(user);
  await kvPut(env, KEY.score(user.id), {
    userId: user.id,
    name: user.name,
    avatarUrl: cleanAvatarUrl(user.avatarUrl),
    completedLevels: profile.completedLevels,
    totalCompletions: profile.totalCompletions,
    bestSeconds: profile.bestSeconds,
    updatedAt: new Date().toISOString()
  });
}

async function updateProfile(env, user, body) {
  if (user.kind !== 'browser') return json({ error: 'TELEGRAM_PROFILE_MANAGED' }, 409);
  const { levels } = await serverContent(env);
  if (!onboardingFor(user, levels).tutorialCompleted) return json({ error: 'TUTORIAL_REQUIRED' }, 409);
  const name = cleanNickname(body?.name);
  if (!name) return json({ error: 'INVALID_NICKNAME' }, 400);
  user.name = name;
  user.nicknameSet = true;
  await Promise.all([saveUser(env, user), updateScore(env, user)]);
  return json({ ok: true, profile: profileFor(user), onboarding: onboardingFor(user, levels) });
}

function creditCompletion(user, attempt) {
  if (attempt.credited) return;
  const seconds = Math.max(1, Math.round((Date.parse(attempt.completedAt) - Date.parse(attempt.startedAt)) / 1000));
  const previous = user.progress[attempt.levelId];
  user.progress[attempt.levelId] = previous
    ? { completions: Number(previous.completions || 0) + 1, bestSeconds: Math.min(Number(previous.bestSeconds || seconds), seconds) }
    : { completions: 1, bestSeconds: seconds };
  attempt.credited = true;
  delete user.activeAttempts[attempt.categoryId];
}

async function persistAttemptOutcome(env, user, attempt) {
  await Promise.all([kvPut(env, KEY.attempt(attempt.id), attempt), saveUser(env, user), updateScore(env, user)]);
}

async function guessAttempt(env, user, attemptId, body, config) {
  await enforceRateLimit(env, user.id, 'guess', config.rateLimits.guess);
  const attempt = await loadAttempt(env, attemptId, user.id);
  if (!attempt) return json({ error: 'ATTEMPT_NOT_FOUND' }, 404);
  const { categories, levels } = await serverContent(env);
  const level = levels.find(item => item.id === attempt.levelId);
  if (!level) return json({ error: 'LEVEL_NOT_FOUND' }, 404);
  if (attempt.status !== 'active') return json({ error: 'ATTEMPT_FINISHED', attempt: publicAttempt(attempt, level, categories) }, 409);
  ensureAttemptModel(attempt, level);
  const lockedPositions = lockedPositionsForAttempt(level.text, attempt.substitution, attempt.revealed, attempt.lockRequirements);
  const result = evaluateGuess(
    { text: level.text, substitution: attempt.substitution, revealed: attempt.revealed, errors: attempt.errors },
    body?.position,
    body?.letter,
    { maxErrors: config.mistakesPerAttempt, lockedPositions }
  );
  if (['INVALID_GUESS', 'LOCKED_CODE'].includes(result.reason)) return json({ error: result.reason }, 400);
  attempt.revealed = result.revealed;
  attempt.errors = result.errors;
  attempt.status = result.status;
  attempt.updatedAt = new Date().toISOString();
  if (result.status === 'lost') {
    attempt.completedAt = attempt.updatedAt;
    if (attempt.categoryId !== 'tutorial') user.lives = Math.max(0, user.lives - 1);
    delete user.activeAttempts[attempt.categoryId];
  } else if (result.status === 'won') {
    attempt.completedAt = attempt.updatedAt;
    creditCompletion(user, attempt);
  }
  await persistAttemptOutcome(env, user, attempt);
  return json({ ok: result.ok, reason: result.reason, attempt: publicAttempt(attempt, level, categories), inventory: inventoryFor(user, config) });
}

async function hintAttempt(env, user, attemptId, body, config) {
  await enforceRateLimit(env, user.id, 'hint', config.rateLimits.hint);
  const attempt = await loadAttempt(env, attemptId, user.id);
  if (!attempt) return json({ error: 'ATTEMPT_NOT_FOUND' }, 404);
  const { categories, levels } = await serverContent(env);
  const level = levels.find(item => item.id === attempt.levelId);
  if (!level) return json({ error: 'LEVEL_NOT_FOUND' }, 404);
  if (attempt.status !== 'active') return json({ error: 'ATTEMPT_FINISHED', attempt: publicAttempt(attempt, level, categories) }, 409);
  const tutorial = attempt.categoryId === 'tutorial';
  if (tutorial && Number(user.tutorialHintsUsed || 0) >= TUTORIAL_HINT_LIMIT) return json({ error: 'TUTORIAL_HINT_LIMIT' }, 409);
  if (!tutorial && user.hints <= 0) return json({ error: 'NO_HINTS' }, 409);
  ensureAttemptModel(attempt, level);
  const hint = revealHint({ text: level.text, substitution: attempt.substitution, revealed: attempt.revealed }, body?.position);
  if (!hint.ok) return json({ error: hint.reason }, 409);
  attempt.revealed = hint.revealed;
  attempt.hintsUsed += 1;
  if (tutorial) user.tutorialHintsUsed = Number(user.tutorialHintsUsed || 0) + 1;
  else user.hints -= 1;
  attempt.updatedAt = new Date().toISOString();
  if (isAttemptSolved(level.text, attempt.substitution, attempt.revealed)) {
    attempt.status = 'won';
    attempt.completedAt = attempt.updatedAt;
    creditCompletion(user, attempt);
  }
  await persistAttemptOutcome(env, user, attempt);
  return json({
    ok: true,
    hint: { position: hint.position, code: hint.code, letter: hint.letter },
    attempt: publicAttempt(attempt, level, categories),
    inventory: inventoryFor(user, config),
    tutorialHints: tutorial ? {
      used: Number(user.tutorialHintsUsed || 0),
      remaining: TUTORIAL_HINT_LIMIT - Number(user.tutorialHintsUsed || 0)
    } : null
  });
}

async function surrenderAttempt(env, user, attemptId, config) {
  const attempt = await loadAttempt(env, attemptId, user.id);
  if (!attempt) return json({ error: 'ATTEMPT_NOT_FOUND' }, 404);
  const { categories, levels } = await serverContent(env);
  const level = levels.find(item => item.id === attempt.levelId);
  if (!level) return json({ error: 'LEVEL_NOT_FOUND' }, 404);
  if (attempt.categoryId === 'tutorial') return json({ error: 'TUTORIAL_SURRENDER_DISABLED' }, 409);
  if (attempt.status !== 'active') return json({ error: 'ATTEMPT_FINISHED', attempt: publicAttempt(attempt, level, categories) }, 409);
  attempt.status = 'surrendered';
  attempt.updatedAt = new Date().toISOString();
  attempt.completedAt = attempt.updatedAt;
  user.lives = Math.max(0, user.lives - 1);
  delete user.activeAttempts[attempt.categoryId];
  await persistAttemptOutcome(env, user, attempt);
  return json({ ok: true, attempt: publicAttempt(attempt, level, categories), inventory: inventoryFor(user, config) });
}

async function leaderboard(env) {
  const rows = [];
  let cursor;
  for (let page = 0; page < 5; page += 1) {
    const listed = await env.KOBZA_LEADERBOARD.list({ prefix: 'shyfr:score:', limit: 200, ...(cursor ? { cursor } : {}) });
    const values = await Promise.all((listed.keys || []).map(item => kvGet(env, item.name)));
    rows.push(...values.filter(Boolean));
    if (listed.list_complete || !listed.cursor) break;
    cursor = listed.cursor;
  }
  return rows.sort((left, right) => Number(right.completedLevels) - Number(left.completedLevels)
    || Number(right.totalCompletions) - Number(left.totalCompletions)
    || Number(left.bestSeconds || Infinity) - Number(right.bestSeconds || Infinity)
    || String(left.name).localeCompare(String(right.name), 'uk')).slice(0, 50).map((row, index) => ({
      rank: index + 1,
    name: row.name,
    avatarUrl: cleanAvatarUrl(row.avatarUrl),
      completedLevels: Number(row.completedLevels || 0),
      totalCompletions: Number(row.totalCompletions || 0)
    }));
}

function botToken(env) {
  return String(env.SHYFR_BOT_TOKEN || '');
}

async function telegramBotCall(env, method, parameters) {
  if (!botToken(env)) throw new Error('BOT_NOT_CONFIGURED');
  const response = await fetch(`https://api.telegram.org/bot${botToken(env)}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(parameters)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) throw new Error(String(body?.description || `Telegram ${method} failed`));
  return body.result;
}

function purchaseSummary(purchase) {
  return { id: purchase.id, kind: purchase.kind, resourceId: purchase.resourceId, quantity: purchase.quantity, stars: purchase.stars, status: purchase.status, createdAt: purchase.createdAt };
}

function upsertPurchaseSummary(user, purchase) {
  user.purchases = [purchaseSummary(purchase), ...user.purchases.filter(item => item.id !== purchase.id)].slice(0, 10);
}

async function createInvoice(env, user, body, config) {
  if (user.kind !== 'telegram' || !user.telegramId) return json({ error: 'TELEGRAM_REQUIRED' }, 409);
  await enforceRateLimit(env, user.id, 'invoice', config.rateLimits.invoice);
  const { categories, levels } = await serverContent(env);
  const product = resolveProduct(body?.productKey, { categories, levels, config });
  if (!product) return json({ error: 'PRODUCT_UNAVAILABLE' }, 400);
  const entitlement = `${product.kind}:${product.id}`;
  if ((product.kind === 'category_unlock' || product.kind === 'level_unlock') && user.entitlements.includes(entitlement)) {
    return json({ error: 'ALREADY_OWNED' }, 409);
  }
  const pendingKey = KEY.pending(user.id, body.productKey);
  const pendingId = await env.KOBZA_LEADERBOARD.get(pendingKey);
  if (pendingId) {
    const pending = await kvGet(env, KEY.purchase(pendingId));
    const fresh = pending?.status === 'pending' && Number(pending.expiresAt) > Date.now();
    if (fresh && pending.invoiceLink) return json({ ok: true, purchaseId: pending.id, invoiceLink: pending.invoiceLink, reused: true });
    if (fresh) return json({ error: 'PURCHASE_PENDING' }, 409);
    await env.KOBZA_LEADERBOARD.delete(pendingKey);
  }
  const id = crypto.randomUUID();
  const purchase = {
    id,
    userId: user.id,
    telegramId: user.telegramId,
    productKey: body.productKey,
    kind: product.kind,
    resourceId: product.id,
    quantity: product.quantity,
    stars: product.stars,
    currency: 'XTR',
    payload: `shyfr:v1:${id}`,
    status: 'pending',
    invoiceLink: null,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + config.invoiceTtlSeconds * 1000
  };
  await Promise.all([kvPut(env, KEY.purchase(id), purchase), env.KOBZA_LEADERBOARD.put(pendingKey, id, { expirationTtl: config.invoiceTtlSeconds })]);
  try {
    purchase.invoiceLink = await telegramBotCall(env, 'createInvoiceLink', {
      title: product.title.slice(0, 32),
      description: 'Покупка для гри «Шифр».',
      payload: purchase.payload,
      currency: 'XTR',
      prices: [{ label: product.title.slice(0, 32), amount: product.stars }]
    });
    upsertPurchaseSummary(user, purchase);
    await Promise.all([kvPut(env, KEY.purchase(id), purchase), saveUser(env, user)]);
    return json({ ok: true, purchaseId: id, invoiceLink: purchase.invoiceLink });
  } catch (_error) {
    purchase.status = 'rejected';
    upsertPurchaseSummary(user, purchase);
    await Promise.all([kvPut(env, KEY.purchase(id), purchase), saveUser(env, user), env.KOBZA_LEADERBOARD.delete(pendingKey)]);
    return json({ error: 'INVOICE_CREATE_FAILED' }, 502);
  }
}

function payloadPurchaseId(payload) {
  return String(payload || '').match(PAYMENT_PAYLOAD_RE)?.[1] || '';
}

function webhookAuthorized(request, env) {
  const secret = String(env.SHYFR_WEBHOOK_SECRET || '');
  return Boolean(secret) && constantTimeEqual(secret, String(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || ''));
}

async function preCheckout(update, env) {
  const query = update.pre_checkout_query;
  const id = payloadPurchaseId(query?.invoice_payload);
  const purchase = id ? await kvGet(env, KEY.purchase(id)) : null;
  const valid = Boolean(purchase && purchase.status === 'pending' && Number(purchase.expiresAt) > Date.now()
    && purchase.payload === query.invoice_payload && String(purchase.telegramId) === String(query?.from?.id || '')
    && query.currency === 'XTR' && Number(query.total_amount) === Number(purchase.stars));
  await telegramBotCall(env, 'answerPreCheckoutQuery', {
    pre_checkout_query_id: query.id,
    ok: valid,
    ...(valid ? {} : { error_message: 'Рахунок недійсний або прострочений. Створіть новий у грі.' })
  });
}

async function successfulPayment(update, env, config) {
  const message = update.message;
  const payment = message?.successful_payment;
  const id = payloadPurchaseId(payment?.invoice_payload);
  const chargeId = String(payment?.telegram_payment_charge_id || '');
  if (!id || !chargeId || payment.currency !== 'XTR') return;
  if (await kvGet(env, KEY.charge(chargeId))) return;
  const purchase = await kvGet(env, KEY.purchase(id));
  if (!purchase || purchase.payload !== payment.invoice_payload || Number(purchase.stars) !== Number(payment.total_amount)
    || String(purchase.telegramId) !== String(message?.from?.id || '')) return;
  let user = normalizeUser(await kvGet(env, KEY.user(purchase.userId)), config);
  if (!user) return;
  user = fulfillPurchaseState(user, { ...purchase, chargeId }, config);
  purchase.status = 'paid';
  purchase.telegramPaymentChargeId = chargeId;
  purchase.paidAt = new Date().toISOString();
  upsertPurchaseSummary(user, purchase);
  await saveUser(env, user);
  await Promise.all([
    kvPut(env, KEY.purchase(id), purchase),
    kvPut(env, KEY.charge(chargeId), { purchaseId: id, userId: user.id }, { expirationTtl: 60 * 60 * 24 * 365 }),
    kvPut(env, KEY.update(String(update.update_id)), { purchaseId: id }, { expirationTtl: 60 * 60 * 24 * 30 }),
    env.KOBZA_LEADERBOARD.delete(KEY.pending(user.id, purchase.productKey))
  ]);
}

async function sendSupport(message, env) {
  const support = String(env.SHYFR_PAYMENT_SUPPORT || '@replace_with_support_username');
  await telegramBotCall(env, 'sendMessage', { chat_id: message.chat.id, text: `Підтримка з оплат гри «Шифр»: ${support}` });
}

async function sendStart(message, env) {
  const url = String(env.SHYFR_MINI_APP_URL || 'https://lordskamp.github.io/shyfr/');
  await telegramBotCall(env, 'sendMessage', {
    chat_id: message.chat.id,
    text: 'Розкрийте українську фразу у грі «Шифр».',
    reply_markup: { inline_keyboard: [[{ text: 'Грати', web_app: { url } }]] }
  });
}

async function handleWebhook(request, env, config) {
  if (!env.SHYFR_WEBHOOK_SECRET) return json({ error: 'WEBHOOK_NOT_CONFIGURED' }, 503);
  if (!webhookAuthorized(request, env)) return json({ error: 'UNAUTHORIZED_WEBHOOK' }, 401);
  const update = await parseJson(request);
  if (!update) return json({ error: 'INVALID_UPDATE' }, 400);
  if (update.pre_checkout_query) await preCheckout(update, env);
  else if (update.message?.successful_payment) await successfulPayment(update, env, config);
  else if (/^\/paysupport(?:@\w+)?(?:\s|$)/iu.test(String(update.message?.text || ''))) await sendSupport(update.message, env);
  else if (/^\/start(?:@\w+)?(?:\s|$)/iu.test(String(update.message?.text || ''))) await sendStart(update.message, env);
  return json({ ok: true });
}

async function refundPurchase(request, env, config) {
  const authorization = String(request.headers.get('Authorization') || '');
  if (!env.SHYFR_ADMIN_TOKEN || !constantTimeEqual(authorization, `Bearer ${env.SHYFR_ADMIN_TOKEN}`)) return json({ error: 'UNAUTHORIZED' }, 401);
  const body = await parseJson(request);
  const purchase = body?.purchaseId && UUID_RE.test(body.purchaseId) ? await kvGet(env, KEY.purchase(body.purchaseId)) : null;
  if (!purchase || purchase.status !== 'paid' || !purchase.telegramPaymentChargeId) return json({ error: 'PAID_PURCHASE_NOT_FOUND' }, 404);
  await telegramBotCall(env, 'refundStarPayment', { user_id: Number(purchase.telegramId), telegram_payment_charge_id: purchase.telegramPaymentChargeId });
  const user = normalizeUser(await kvGet(env, KEY.user(purchase.userId)), config);
  purchase.status = 'refunded';
  purchase.refundedAt = new Date().toISOString();
  if (user) {
    if (purchase.kind === 'category_unlock' || purchase.kind === 'level_unlock') {
      user.entitlements = user.entitlements.filter(item => item !== `${purchase.kind}:${purchase.resourceId}`);
    } else if (purchase.kind === 'lives_pack') user.lives = Math.max(0, user.lives - purchase.quantity);
    else if (purchase.kind === 'hints_pack') user.hints = Math.max(0, user.hints - purchase.quantity);
    upsertPurchaseSummary(user, purchase);
    await saveUser(env, user);
  }
  await kvPut(env, KEY.purchase(purchase.id), purchase);
  return json({ ok: true, status: 'refunded' });
}

export async function handleShyfrRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== API_PREFIX && !url.pathname.startsWith(`${API_PREFIX}/`)) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (!env.KOBZA_LEADERBOARD) return json({ error: 'KV binding KOBZA_LEADERBOARD is missing.' }, 503);
  const config = shyfrConfigForEnv(env);
  try {
    if (url.pathname === `${API_PREFIX}/telegram-webhook`) {
      return request.method === 'POST' ? handleWebhook(request, env, config) : json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }
    if (url.pathname === `${API_PREFIX}/admin/refund`) {
      return request.method === 'POST' ? refundPurchase(request, env, config) : json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }
    if (url.pathname === `${API_PREFIX}/auth/browser`) {
      return request.method === 'POST' ? json({ ok: true, sessionToken: await browserLogin(env, config) }) : json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }
    if (url.pathname === `${API_PREFIX}/auth/telegram`) {
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
      const login = await telegramLogin(request, env, config);
      return login.error ? json({ error: login.error }, login.status) : json({ ok: true, sessionToken: login.token });
    }
    const authenticated = await authenticate(request, env, config);
    if (!authenticated) return json({ error: 'SESSION_REQUIRED' }, 401);
    const user = authenticated.user;
    if (url.pathname === `${API_PREFIX}/bootstrap` && request.method === 'GET') return json({ ok: true, ...(await bootstrap(env, user, config)) });
    if (url.pathname === `${API_PREFIX}/leaderboard` && request.method === 'GET') return json({ ok: true, leaderboard: await leaderboard(env) });
    if (url.pathname === `${API_PREFIX}/profile` && request.method === 'POST') return updateProfile(env, user, await parseJson(request));
    if (url.pathname === `${API_PREFIX}/attempts` && request.method === 'POST') return startAttempt(env, user, await parseJson(request), config);
    if (url.pathname === `${API_PREFIX}/invoice` && request.method === 'POST') return createInvoice(env, user, await parseJson(request), config);
    const purchaseMatch = url.pathname.match(/^\/shyfr\/purchases\/([0-9a-f-]{36})$/iu);
    if (purchaseMatch && request.method === 'GET') {
      const purchase = await kvGet(env, KEY.purchase(purchaseMatch[1]));
      return purchase?.userId === user.id ? json({ ok: true, purchase: purchaseSummary(purchase) }) : json({ error: 'PURCHASE_NOT_FOUND' }, 404);
    }
    const attemptMatch = url.pathname.match(/^\/shyfr\/attempts\/([0-9a-f-]{36})(?:\/(guess|hint|surrender))?$/iu);
    if (attemptMatch) {
      const [, attemptId, action] = attemptMatch;
      if (!action && request.method === 'GET') {
        const attempt = await loadAttempt(env, attemptId, user.id);
        const content = attempt ? await serverContent(env) : null;
        const level = attempt && content.levels.find(item => item.id === attempt.levelId);
        return attempt && level ? json({ ok: true, attempt: publicAttempt(attempt, level, content.categories) }) : json({ error: 'ATTEMPT_NOT_FOUND' }, 404);
      }
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
      if (action === 'guess') return guessAttempt(env, user, attemptId, await parseJson(request), config);
      if (action === 'hint') return hintAttempt(env, user, attemptId, await parseJson(request), config);
      if (action === 'surrender') return surrenderAttempt(env, user, attemptId, config);
    }
    return json({ error: 'NOT_FOUND' }, 404);
  } catch (error) {
    if (error?.message === 'RATE_LIMITED') return json({ error: 'RATE_LIMITED' }, error.status || 429);
    return json({ error: 'SHYFR_REQUEST_FAILED' }, 500);
  }
}
