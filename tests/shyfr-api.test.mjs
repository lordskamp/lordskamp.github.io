import assert from 'node:assert/strict';
import test from 'node:test';

import { dailyResetInfo, handleShyfrRequest } from '../api/shyfr-api.js';
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

function testEnv(kv = new MemoryKv()) {
  return { KOBZA_LEADERBOARD: kv, SHYFR_PUBLIC_CONTENT: TEST_PUBLIC_CONTENT };
}

async function json(response) {
  return { status: response.status, body: await response.json() };
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

test('Worker не віддає відповідь активного рівня', async () => {
  const env = testEnv();
  const token = await guest(env);
  const { level, started } = await startFirstLevel(env, token);
  assert.equal(level.hiddenPercent, 60);
  const startedText = JSON.stringify(started.body);
  assert.equal(started.status, 200);
  assert.equal(started.body.attempt.levelNumber, 1);
  assert.equal(started.body.attempt.hiddenPercent, 60);
  assert.ok(started.body.attempt.tokens.some(item => item.type === 'letter'));
  assert.equal('result' in started.body.attempt, false);
  assert.equal(startedText.includes('substitution'), false);
  assert.equal(startedText.includes('source'), false);
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
