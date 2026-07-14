import assert from 'node:assert/strict';
import test from 'node:test';

import { handleShyfrRequest } from '../api/shyfr-api.js';

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

async function json(response) {
  return { status: response.status, body: await response.json() };
}

async function guest(env) {
  const login = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/auth/browser', { method: 'POST' }), env));
  assert.equal(login.status, 200);
  return login.body.sessionToken;
}

async function startFirstLevel(env, token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const bootstrap = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/bootstrap', { headers }), env));
  const category = bootstrap.body.categories.find(item => item.available && item.free);
  const level = category.levels[0];
  const started = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: category.id, levelId: level.id })
  }), env));
  return { headers, bootstrap, category, level, started };
}

test('Worker не віддає відповідь активного рівня та використовує лише KV', async () => {
  const env = { KOBZA_LEADERBOARD: new MemoryKv() };
  const token = await guest(env);
  const { level, started } = await startFirstLevel(env, token);
  assert.equal(level.hiddenPercent, 30);
  const startedText = JSON.stringify(started.body);
  assert.equal(started.status, 200);
  assert.equal(started.body.attempt.levelNumber, 1);
  assert.equal(started.body.attempt.hiddenPercent, 30);
  assert.ok(started.body.attempt.tokens.some(item => item.type === 'letter'));
  assert.equal('result' in started.body.attempt, false);
  assert.equal(startedText.includes('substitution'), false);
  assert.equal(startedText.includes('source'), false);
});

test('помилки, життя, здача та підказка змінюються лише через Worker', async () => {
  const kv = new MemoryKv();
  const env = { KOBZA_LEADERBOARD: kv };
  const token = await guest(env);
  const { headers, category, level, started } = await startFirstLevel(env, token);
  let internal = await kv.get(`shyfr:attempt:${started.body.attempt.id}`, 'json');
  const code = started.body.attempt.tokens.find(item => item.type === 'letter' && !item.locked && !started.body.attempt.revealed[item.code]).code;
  const answer = Object.entries(internal.substitution).find(([, value]) => value === code)[0];
  const used = new Set(Object.values(internal.revealed));
  const wrong = Array.from('АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ').find(letter => letter !== answer && !used.has(letter));
  let last;
  for (let index = 1; index <= 3; index += 1) {
    last = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${internal.id}/guess`, {
      method: 'POST', headers, body: JSON.stringify({ code, letter: wrong })
    }), env));
    assert.equal(last.body.attempt.errors, index);
  }
  assert.equal(last.body.attempt.status, 'lost');
  assert.equal(last.body.inventory.lives, 4);

  const restarted = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/attempts', {
    method: 'POST', headers, body: JSON.stringify({ categoryId: category.id, levelId: level.id })
  }), env));
  assert.notEqual(restarted.body.attempt.id, internal.id);
  const hinted = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${restarted.body.attempt.id}/hint`, { method: 'POST', headers }), env));
  assert.equal(hinted.body.inventory.hints, 2);
  assert.equal(hinted.body.attempt.hintsUsed, 1);

  const surrendered = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${restarted.body.attempt.id}/surrender`, { method: 'POST', headers }), env));
  assert.equal(surrendered.body.attempt.status, 'surrendered');
  assert.equal(surrendered.body.inventory.lives, 3);
  assert.equal('result' in surrendered.body.attempt, false);
});

test('завершення рівня відкриває джерело і зараховується один раз', async () => {
  const kv = new MemoryKv();
  const env = { KOBZA_LEADERBOARD: kv };
  const token = await guest(env);
  const { headers, started } = await startFirstLevel(env, token);
  let publicAttempt = started.body.attempt;
  const internal = await kv.get(`shyfr:attempt:${publicAttempt.id}`, 'json');
  let finalCode = null;
  for (let step = 0; step < 40 && publicAttempt.status === 'active'; step += 1) {
    const target = publicAttempt.tokens.find(item => item.type === 'letter' && !item.locked && !publicAttempt.revealed[item.code]);
    assert.ok(target, 'каскад закритих символів завжди лишає доступний наступний код');
    finalCode = target.code;
    const letter = Object.entries(internal.substitution).find(([, value]) => value === target.code)[0];
    const response = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${publicAttempt.id}/guess`, {
      method: 'POST', headers, body: JSON.stringify({ code: target.code, letter })
    }), env));
    publicAttempt = response.body.attempt;
  }
  assert.equal(publicAttempt.status, 'won');
  assert.ok(publicAttempt.result.source.label);
  const repeated = await json(await handleShyfrRequest(new Request(`https://worker.test/shyfr/attempts/${publicAttempt.id}/guess`, {
    method: 'POST', headers, body: JSON.stringify({ code: finalCode, letter: 'А' })
  }), env));
  assert.equal(repeated.status, 409);
  const bootstrap = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/bootstrap', { headers }), env));
  assert.equal(bootstrap.body.profile.completedLevels, 1);
  assert.equal(bootstrap.body.profile.totalCompletions, 1);
});

test('лідерборд сортує гравців за кількістю різних завершених рівнів', async () => {
  const kv = new MemoryKv();
  await kv.put('shyfr:score:tg:1', JSON.stringify({ name: 'Другий', completedLevels: 3, totalCompletions: 9, bestSeconds: 30 }));
  await kv.put('shyfr:score:tg:2', JSON.stringify({ name: 'Перший', completedLevels: 5, totalCompletions: 5, bestSeconds: 40 }));
  const env = { KOBZA_LEADERBOARD: kv };
  const token = await guest(env);
  const response = await json(await handleShyfrRequest(new Request('https://worker.test/shyfr/leaderboard', { headers: { Authorization: `Bearer ${token}` } }), env));
  assert.deepEqual(response.body.leaderboard.map(item => item.name), ['Перший', 'Другий']);
  assert.deepEqual(response.body.leaderboard.map(item => item.completedLevels), [5, 3]);
});
