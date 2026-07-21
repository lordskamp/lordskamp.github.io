import assert from 'node:assert/strict';
import test from 'node:test';

import { dailyResetInfo, handleShyfrRequest } from '../api/shyfr-api.js';
import { encodePhrase, evaluateGuess, lockedPositionsForAttempt } from '../api/shyfr-core.js';
import { loadShyfrContent } from '../scripts/shyfr-content.mjs';

const loadedContent = await loadShyfrContent();
const TEST_PUBLIC_CONTENT = {
  categories: loadedContent.categories,
  levels: loadedContent.levels.map(({ __raw, __file, __index, ...level }) => level)
};

class MemoryKv {
  constructor() { this.values = new Map(); }
  async get(key, type) {
    const value = this.values.get(key);
    if (value == null) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value) { this.values.set(key, String(value)); }
  async delete(key) { this.values.delete(key); }
  async list({ prefix = '', limit = 1000 } = {}) {
    const keys = [...this.values.keys()].filter(key => key.startsWith(prefix)).slice(0, limit).map(name => ({ name }));
    return { keys, list_complete: true };
  }
}

function testEnv(kv = new MemoryKv(), content = TEST_PUBLIC_CONTENT) {
  return { KOBZA_LEADERBOARD: kv, SHYFR_PUBLIC_CONTENT: content };
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

function hex(buffer) {
  return Buffer.from(buffer).toString('hex');
}

async function signedTelegramInitData(token, values) {
  const params = new URLSearchParams(values);
  const data = [...params.entries()].map(([key, value]) => `${key}=${value}`).sort().join('\n');
  const encoder = new TextEncoder();
  const secret = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(token));
  const signingKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  params.set('hash', hex(await crypto.subtle.sign('HMAC', signingKey, encoder.encode(data))));
  return params.toString();
}

async function guest(env) {
  const login = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/auth/browser', { method: 'POST' }), env));
  assert.equal(login.status, 200);
  return login.body.sessionToken;
}

async function markTutorialDone(env) {
  const userKey = [...env.KOBZA_LEADERBOARD.values.keys()].find(key => key.startsWith('shyfr:user:'));
  const user = await env.KOBZA_LEADERBOARD.get(userKey, 'json');
  for (const level of TEST_PUBLIC_CONTENT.levels.filter(item => item.categoryId === 'tutorial')) {
    user.progress[level.id] = { completions: 1, bestSeconds: 1 };
  }
  user.nicknameSet = true;
  user.name = 'Тестовий гравець';
  await env.KOBZA_LEADERBOARD.put(userKey, JSON.stringify(user));
}

async function startFirstLevel(env, token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  await markTutorialDone(env);
  const bootstrap = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/bootstrap', { headers }), env));
  const category = bootstrap.body.categories.find(item => item.id === 'poetry');
  const level = category.levels[0];
  const started = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: category.id, levelId: level.id })
  }), env));
  return { headers, bootstrap, category, level, started };
}

async function startTutorial(env, token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const response = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: 'tutorial' })
  }), env));
  assert.equal(response.status, 200);
  return { headers, started: response };
}

async function solveAttempt(env, kv, headers, attempt) {
  let current = attempt;
  for (let step = 0; step < 200 && current.status === 'active'; step += 1) {
    for (const key of [...kv.values.keys()].filter(key => key.startsWith('shyfr:rate:'))) await kv.delete(key);
    const target = current.tokens.find(token => token.type === 'letter' && !token.locked && !current.revealed[token.position]);
    assert.ok(target, 'активна спроба завжди має доступну комірку');
    const internal = await kv.get(`shyfr:attempt:${current.id}`, 'json');
    const letter = Object.entries(internal.substitution).find(([, code]) => code === target.code)?.[0];
    assert.ok(letter, 'внутрішня підстановка містить відповідь для коду');
    const response = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${current.id}/guess`, {
      method: 'POST', headers, body: JSON.stringify({ position: target.position, letter })
    }), env));
    assert.equal(response.status, 200);
    current = response.body.attempt;
  }
  assert.equal(current.status, 'won');
  return current;
}

test('щоденне поновлення прив’язане до опівночі за київським часом', () => {
  assert.deepEqual(dailyResetInfo(Date.parse('2026-01-15T20:00:00.000Z')), {
    key: '2026-01-15', resetAt: '2026-01-15T22:00:00.000Z'
  });
  assert.deepEqual(dailyResetInfo(Date.parse('2026-07-15T20:00:00.000Z')), {
    key: '2026-07-15', resetAt: '2026-07-15T21:00:00.000Z'
  });
});

test('Worker gives the active level to the offline game, while the public attempt stays encrypted', async () => {
  const env = testEnv();
  const token = await guest(env);
  const { level, started } = await startFirstLevel(env, token);
  assert.equal(level.hiddenPercent, 60);
  const publicAttemptText = JSON.stringify(started.body.attempt);
  assert.equal(started.status, 200);
  assert.equal(started.body.attempt.levelNumber, 1);
  assert.equal(started.body.attempt.hiddenPercent, 60);
  assert.ok(started.body.attempt.tokens.some(item => item.type === 'letter'));
  assert.equal('result' in started.body.attempt, false);
  assert.equal(publicAttemptText.includes('substitution'), false);
  assert.equal(publicAttemptText.includes('source'), false);
  assert.equal(typeof started.body.offline.text, 'string');
  assert.ok(started.body.offline.text.length > 0);
  assert.ok(started.body.offline.substitution);
  assert.equal(typeof started.body.offline.source.label, 'string');
});

test('offline action log completes a level with one final Worker request', async () => {
  const kv = new MemoryKv();
  const env = testEnv(kv);
  const token = await guest(env);
  const { headers, started } = await startFirstLevel(env, token);
  const initial = started.body.attempt;
  const internal = await kv.get(`shyfr:attempt:${initial.id}`, 'json');
  let revealed = initial.revealed;
  let errors = initial.errors;
  let status = 'active';
  const actions = [];
  for (let step = 0; step < 200 && status === 'active'; step += 1) {
    const locked = lockedPositionsForAttempt(initial.offline?.text || started.body.offline.text, internal.substitution, revealed, internal.lockRequirements);
    const target = encodePhrase(started.body.offline.text, internal.substitution)
      .find(token => token.type === 'letter' && !revealed[token.position] && !locked.includes(token.position));
    assert.ok(target, 'offline game has a selectable cell until completion');
    const letter = Object.entries(internal.substitution).find(([, code]) => code === target.code)?.[0];
    const result = evaluateGuess({ text: started.body.offline.text, substitution: internal.substitution, revealed, errors }, target.position, letter, { lockedPositions: locked });
    actions.push({ type: 'guess', position: target.position, letter });
    revealed = result.revealed;
    errors = result.errors;
    status = result.status;
  }
  assert.equal(status, 'won');
  const completed = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${initial.id}/complete`, {
    method: 'POST', headers, body: JSON.stringify({ actions, playedSeconds: 42 })
  }), env));
  assert.equal(completed.status, 200);
  assert.equal(completed.body.attempt.status, 'won');
  assert.equal(completed.body.attempt.result.seconds, 42);
  assert.equal([...kv.values.keys()].some(key => key.startsWith('shyfr:rate:')), false);
  const repeated = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${initial.id}/complete`, {
    method: 'POST', headers, body: JSON.stringify({ actions, playedSeconds: 42 })
  }), env));
  assert.equal(repeated.status, 409);
});

test('Telegram authentication uses a signed session without a KV session write', async () => {
  const kv = new MemoryKv();
  const env = { ...testEnv(kv), SHYFR_BOT_TOKEN: 'test-telegram-bot-token' };
  const initData = await signedTelegramInitData(env.SHYFR_BOT_TOKEN, {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'test-query',
    user: JSON.stringify({ id: 123456789, first_name: 'Тест' })
  });
  const login = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/auth/telegram', {
    method: 'POST', headers: { Authorization: `tma ${initData}` }
  }), env));
  assert.equal(login.status, 200);
  assert.match(login.body.sessionToken, /^t1\./u);
  assert.equal([...kv.values.keys()].some(key => key.startsWith('shyfr:session:')), false);
  const bootstrap = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/bootstrap', {
    headers: { Authorization: `Bearer ${login.body.sessionToken}` }
  }), env));
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.body.telegram, true);
});

test('a stale active attempt does not block opening its category', async () => {
  const kv = new MemoryKv();
  const env = testEnv(kv);
  const token = await guest(env);
  await markTutorialDone(env);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const userKey = [...kv.values.keys()].find(key => key.startsWith('shyfr:user:'));
  const user = await kv.get(userKey, 'json');
  const categoryId = 'ukrainian-idioms';
  const staleAttemptId = '00000000-0000-4000-8000-000000000000';
  user.activeAttempts[categoryId] = staleAttemptId;
  await kv.put(userKey, JSON.stringify(user));
  await kv.put(`shyfr:attempt:${staleAttemptId}`, JSON.stringify({
    id: staleAttemptId,
    userId: user.id,
    categoryId,
    levelId: 'shyfr-ukrainian-idioms-removed-level',
    status: 'active'
  }));

  const response = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId })
  }), env));

  assert.equal(response.status, 200);
  assert.equal(response.body.attempt.categoryId, categoryId);
  assert.notEqual(response.body.attempt.id, staleAttemptId);
});

test('manual access unlocks the owner and paid categories follow free ones by content size', async () => {
  const kv = new MemoryKv();
  const content = {
    ...TEST_PUBLIC_CONTENT,
    manualAccess: { users: [{ telegramUsername: 'Lordskamp', grants: ['all'] }] }
  };
  const env = testEnv(kv, content);
  const token = await guest(env);
  await markTutorialDone(env);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const userKey = [...kv.values.keys()].find(key => key.startsWith('shyfr:user:'));
  const user = await kv.get(userKey, 'json');
  user.kind = 'telegram';
  user.telegramUsername = 'Lordskamp';
  user.name = '@Lordskamp';
  await kv.put(userKey, JSON.stringify(user));

  const bootstrap = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/bootstrap', { headers }), env));
  const firstPaidIndex = bootstrap.body.categories.findIndex(category => !category.free);
  const songLyrics = bootstrap.body.categories.find(category => category.id === 'song-lyrics');
  assert.ok(bootstrap.body.categories.slice(0, firstPaidIndex).every(category => category.free));
  assert.equal(bootstrap.body.categories[firstPaidIndex].id, 'song-lyrics');
  assert.equal(songLyrics.unlocked, true);

  const started = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: 'song-lyrics' })
  }), env));
  assert.equal(started.status, 200);
  assert.equal(started.body.attempt.categoryId, 'song-lyrics');
});

test('помилки, життя, здача та підказка змінюються лише через Worker', async () => {
  const kv = new MemoryKv();
  const env = testEnv(kv);
  const token = await guest(env);
  const { headers, category, level, started } = await startFirstLevel(env, token);
  let internal = await kv.get(`shyfr:attempt:${started.body.attempt.id}`, 'json');
  const target = started.body.attempt.tokens.find(item => item.type === 'letter' && !item.locked && !started.body.attempt.revealed[item.position]);
  const answer = Object.entries(internal.substitution).find(([, value]) => value === target.code)[0];
  const used = new Set(Object.values(internal.revealed));
  const wrong = Array.from('АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ').find(letter => letter !== answer && !used.has(letter));
  let last;
  for (let index = 1; index <= 3; index += 1) {
    last = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${internal.id}/guess`, {
      method: 'POST', headers, body: JSON.stringify({ position: target.position, letter: wrong })
    }), env));
    assert.equal(last.body.attempt.errors, index);
  }
  assert.equal(last.body.attempt.status, 'lost');
  assert.equal(last.body.inventory.lives, 3);

  const restarted = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: category.id, levelId: level.id })
  }), env));
  assert.notEqual(restarted.body.attempt.id, internal.id);
  const hintTarget = restarted.body.attempt.tokens.find(item => item.type === 'letter' && !restarted.body.attempt.revealed[item.position]);
  const hinted = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${restarted.body.attempt.id}/hint`, { method: 'POST', headers, body: JSON.stringify({ position: hintTarget.position }) }), env));
  assert.equal(hinted.body.inventory.hints, 2);
  assert.equal(hinted.body.attempt.hintsUsed, 1);

  const surrendered = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${restarted.body.attempt.id}/surrender`, { method: 'POST', headers }), env));
  assert.equal(surrendered.body.attempt.status, 'surrendered');
  assert.equal(surrendered.body.inventory.lives, 2);
  assert.equal('result' in surrendered.body.attempt, false);
});

test('завершення рівня відкриває джерело і зараховується один раз', async () => {
  const kv = new MemoryKv();
  const env = testEnv(kv);
  const token = await guest(env);
  const { headers, category, started } = await startFirstLevel(env, token);
  let publicAttempt = started.body.attempt;
  const internal = await kv.get(`shyfr:attempt:${publicAttempt.id}`, 'json');
  let finalCode = null;
  for (let step = 0; step < 40 && publicAttempt.status === 'active'; step += 1) {
    const target = publicAttempt.tokens.find(item => item.type === 'letter' && !item.locked && !publicAttempt.revealed[item.position]);
    assert.ok(target, 'каскад закритих символів завжди лишає доступний наступний код');
    finalCode = target.position;
    const letter = Object.entries(internal.substitution).find(([, value]) => value === target.code)[0];
    const response = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${publicAttempt.id}/guess`, {
      method: 'POST', headers, body: JSON.stringify({ position: target.position, letter })
    }), env));
    publicAttempt = response.body.attempt;
  }
  assert.equal(publicAttempt.status, 'won');
  assert.ok(publicAttempt.result.source.label);
  const repeated = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${publicAttempt.id}/guess`, {
    method: 'POST', headers, body: JSON.stringify({ position: finalCode, letter: 'А' })
  }), env));
  assert.equal(repeated.status, 409);
  const bootstrap = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/bootstrap', { headers }), env));
  assert.equal(bootstrap.body.profile.completedLevels, 4);
  assert.equal(bootstrap.body.profile.totalCompletions, 4);
  const forcedThird = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: category.id, levelId: category.levels[2].id })
  }), env));
  assert.equal(forcedThird.body.attempt.levelNumber, 2, 'сервер запускає лише наступний рівень, навіть якщо клієнт просить третій');
  // Lock thresholds are defined by level difficulty; the core module verifies
  // their exact single/double mechanics separately.
  for (const key of [...kv.values.keys()].filter(key => key.startsWith('shyfr:rate:'))) await kv.delete(key);
  let secondAttempt = forcedThird.body.attempt;
  const secondInternal = await kv.get(`shyfr:attempt:${secondAttempt.id}`, 'json');
  for (let step = 0; step < 80 && secondAttempt.status === 'active'; step += 1) {
    const target = secondAttempt.tokens.find(token => token.type === 'letter' && !token.locked && !secondAttempt.revealed[token.position]);
    assert.ok(target, 'одинарні замки не створюють тупика');
    const letter = Object.entries(secondInternal.substitution).find(([, code]) => code === target.code)[0];
    const response = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${secondAttempt.id}/guess`, {
      method: 'POST', headers, body: JSON.stringify({ position: target.position, letter })
    }), env));
    secondAttempt = response.body.attempt;
  }
  assert.equal(secondAttempt.status, 'won');
  const thirdStarted = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: category.id })
  }), env));
  assert.equal(thirdStarted.body.attempt.levelNumber, 3);
});

test('навчання є обов’язковим, підказки в ньому безкоштовні, а нікнейм відкриває меню', async () => {
  const kv = new MemoryKv();
  const env = testEnv(kv);
  const token = await guest(env);
  const { headers } = await startTutorial(env, token);

  const blocked = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: 'poetry' })
  }), env));
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'TUTORIAL_REQUIRED');

  let active = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: 'tutorial' })
  }), env));
  assert.equal(active.status, 200);
  let attempt = active.body.attempt;
  const livesBefore = active.body.inventory.lives;
  const hintsBefore = active.body.inventory.hints;
  const surrender = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${attempt.id}/surrender`, { method: 'POST', headers }), env));
  assert.equal(surrender.status, 409);
  assert.equal(surrender.body.error, 'TUTORIAL_SURRENDER_DISABLED');

  for (let number = 1; number <= 3; number += 1) {
    const target = attempt.tokens.find(token => token.type === 'letter' && !token.locked && !attempt.revealed[token.position]);
    assert.ok(target);
    const hinted = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${attempt.id}/hint`, {
      method: 'POST', headers, body: JSON.stringify({ position: target.position })
    }), env));
    assert.equal(hinted.status, 200);
    assert.equal(hinted.body.inventory.hints, hintsBefore);
    assert.equal(hinted.body.inventory.lives, livesBefore);
    assert.equal(hinted.body.tutorialHints.remaining, 3 - number);
    attempt = hinted.body.attempt;
  }
  const fourthTarget = attempt.tokens.find(token => token.type === 'letter' && !token.locked && !attempt.revealed[token.position]);
  const capped = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${attempt.id}/hint`, {
    method: 'POST', headers, body: JSON.stringify({ position: fourthTarget?.position })
  }), env));
  assert.equal(capped.status, 409);
  assert.equal(capped.body.error, 'TUTORIAL_HINT_LIMIT');

  await solveAttempt(env, kv, headers, attempt);
  for (let level = 2; level <= 3; level += 1) {
    const next = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
      method: 'POST', headers, body: JSON.stringify({ categoryId: 'tutorial' })
    }), env));
    assert.equal(next.body.attempt.tutorialStep, level);
    await solveAttempt(env, kv, headers, next.body.attempt);
  }

  const afterTutorial = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/bootstrap', { headers }), env));
  assert.equal(afterTutorial.body.onboarding.tutorialCompleted, true);
  assert.equal(afterTutorial.body.onboarding.nicknameRequired, true);
  const nicknameBlocked = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: 'poetry' })
  }), env));
  assert.equal(nicknameBlocked.body.error, 'NICKNAME_REQUIRED');

  const saved = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/profile', {
    method: 'POST', headers, body: JSON.stringify({ name: 'Шифрувальник' })
  }), env));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profile.name, 'Шифрувальник');
  assert.equal(saved.body.onboarding.complete, true);
  const available = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: 'poetry' })
  }), env));
  assert.equal(available.status, 200);
});

test('життя й підказки щодня поновлюються до лімітів 4 і 3', async () => {
  const kv = new MemoryKv();
  const env = testEnv(kv);
  const token = await guest(env);
  const userKey = [...kv.values.keys()].find(key => key.startsWith('shyfr:user:'));
  const user = await kv.get(userKey, 'json');
  user.lives = 0;
  user.hints = 1;
  user.dailyResetKey = '2000-01-01';
  await kv.put(userKey, JSON.stringify(user));
  const response = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/bootstrap', {
    headers: { Authorization: `Bearer ${token}` }
  }), env));
  assert.deepEqual(response.body.inventory.limits, { lives: 4, hints: 3 });
  assert.equal(response.body.inventory.lives, 4);
  assert.equal(response.body.inventory.hints, 3);
  assert.ok(Date.parse(response.body.inventory.resetAt) > Date.now());
});

test('лідерборд сортує гравців за кількістю різних завершених рівнів і передає аватар', async () => {
  const kv = new MemoryKv();
  await kv.put('shyfr:score:tg:1', JSON.stringify({ name: 'Другий', avatarUrl: 'https://example.com/avatar.jpg', completedLevels: 3, totalCompletions: 9, bestSeconds: 30 }));
  await kv.put('shyfr:score:tg:2', JSON.stringify({ name: 'Перший', completedLevels: 5, totalCompletions: 5, bestSeconds: 40 }));
  const env = testEnv(kv);
  const token = await guest(env);
  const response = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/leaderboard', { headers: { Authorization: `Bearer ${token}` } }), env));
  assert.deepEqual(response.body.leaderboard.map(item => item.name), ['Перший', 'Другий']);
  assert.deepEqual(response.body.leaderboard.map(item => item.completedLevels), [5, 3]);
  assert.equal(response.body.leaderboard[1].avatarUrl, 'https://example.com/avatar.jpg');
});
