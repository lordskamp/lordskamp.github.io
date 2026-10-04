import assert from 'node:assert/strict';
import test from 'node:test';
import { PracticeSession } from '../hvylia/practice.js';
import { GAME_CONFIG, scoreGuess } from '../api/hvylia-core.js';

function practice(t) {
  let now = 100_000;
  let serial = 0;
  const scheduled = new Map();
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++serial;
    scheduled.set(id, { at: now + delay, callback });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => scheduled.delete(id));
  const states = [];
  const session = new PracticeSession(state => states.push(state));
  session.start();
  return {
    session, states, scheduled,
    get state() { return states.at(-1); },
    action(type, extra = {}) {
      return session.action({ type, roundId: states.at(-1).round.id, ...extra });
    },
    tick(delay) {
      const end = now + delay;
      for (;;) {
        const next = [...scheduled.entries()].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, item] = next;
        scheduled.delete(id);
        now = item.at;
        item.callback();
      }
      now = end;
    }
  };
}

test('local practice rotates through actual roles and hides the target after the clue', async t => {
  const run = practice(t);
  assert.equal(run.state.phase, 'PSYCHIC_VIEW');
  assert.equal(run.state.you.role, 'psychic');
  assert.equal(run.state.round.target, 38);
  assert.equal(run.state.config.winScore, 5);

  await run.action('clue', { text: 'Знайомий із сусіднього двору' });
  assert.equal(run.state.phase, 'TEAM_GUESS');
  assert.equal(run.state.you.role, 'guesser');
  assert.equal('target' in run.state.round, false);
  assert.equal(run.state.round.clue, 'Знайомий із сусіднього двору');
  await run.action('move', { position: 43 });
  assert.equal(run.state.round.guess, 43);
  await run.action('lock', { position: 43 });
  assert.equal(run.state.phase, 'OPPONENT_BET');
  assert.equal(run.state.you.role, 'opponent');
  assert.equal('target' in run.state.round, false);

  await run.action('bet', { side: 'left' });
  assert.equal(run.state.phase, 'REVEAL');
  assert.equal('target' in run.state.round, false);
  run.tick(GAME_CONFIG.revealDelayMs - 1);
  assert.equal(run.state.round.revealed, false);
  run.tick(1);
  assert.equal(run.state.round.revealed, true);
  assert.equal(run.state.round.target, 38);
  assert.equal(run.state.round.result, null);
  run.tick(GAME_CONFIG.scoreDelayMs);
  assert.equal(run.state.phase, 'SCORE');
  assert.deepEqual(run.state.round.result, { ...scoreGuess(38, 43, 'left'), catchUp: false });
  assert.deepEqual(run.state.teams.map(team => team.score), [3, 2]);
  run.session.close();
});

test('practice completes a short match with the second-team starting point and rematches using normal rules', async t => {
  const run = practice(t);
  const originalId = run.state.round.id;
  for (let round = 1; round <= 2; round += 1) {
    const target = run.state.round.target;
    assert.equal(run.state.round.number, round);
    await run.action('clue', { text: `Підказка раунду ${round}` });
    await run.action('lock', { position: target });
    await run.action('bet', { side: 'right' });
    run.tick(GAME_CONFIG.revealDelayMs + GAME_CONFIG.scoreDelayMs);
    assert.equal(run.state.round.result.activePoints, 4);
    assert.equal(run.state.round.result.opponentPoints, 0);
    if (round < 2) {
      assert.equal(run.state.phase, 'SCORE');
      await run.action('next');
    }
  }
  assert.equal(run.state.phase, 'GAME_OVER');
  assert.equal(run.state.winner, 1);
  assert.deepEqual(run.state.teams.map(team => team.score), [4, 5]);
  await run.session.action({ type: 'rematch' });
  assert.equal(run.state.phase, 'PSYCHIC_VIEW');
  assert.equal(run.state.round.number, 1);
  assert.notEqual(run.state.round.id, originalId);
  assert.deepEqual(run.state.teams.map(team => team.score), [0, 1]);
  run.session.close();
});

test('practice rejects duplicate and stale actions without awarding points twice', async t => {
  const run = practice(t);
  const originalId = run.state.round.id;
  await run.action('clue', { text: 'Тиха вулиця' });
  await assert.rejects(run.action('clue', { text: 'Друга підказка' }), { code: 'PHASE' });
  await assert.rejects(run.action('move', { position: 101 }), { code: 'INVALID' });
  assert.equal(run.state.round.guess, 50);
  await run.action('lock', { position: 0 });
  await run.action('bet', { side: 'right' });
  await assert.rejects(run.action('bet', { side: 'right' }), { code: 'PHASE' });
  run.tick(GAME_CONFIG.revealDelayMs + GAME_CONFIG.scoreDelayMs);
  assert.deepEqual(run.state.teams.map(team => team.score), [0, 2]);
  await run.action('next');
  await assert.rejects(run.session.action({ type: 'clue', text: 'Стара підказка', roundId: originalId }), { code: 'STALE' });
  assert.equal(run.state.phase, 'PSYCHIC_VIEW');
  assert.deepEqual(run.state.teams.map(team => team.score), [0, 2]);
  run.session.close();
});

test('exiting or restarting practice cancels both reveal timers', async t => {
  const run = practice(t);
  await run.action('clue', { text: 'Невелика хвиля' });
  await run.action('lock', { position: 38 });
  await run.action('bet', { side: 'left' });
  assert.equal(run.scheduled.size, 2);
  run.session.close();
  assert.equal(run.scheduled.size, 0);
  const count = run.states.length;
  run.tick(10_000);
  await run.action('next');
  assert.equal(run.states.length, count);

  run.session.start();
  await run.action('clue', { text: 'Нове тренування' });
  await run.action('lock', { position: 38 });
  await run.action('bet', { side: 'right' });
  assert.equal(run.scheduled.size, 2);
  run.session.start();
  assert.equal(run.scheduled.size, 0);
  run.tick(10_000);
  assert.equal(run.state.phase, 'PSYCHIC_VIEW');
  assert.equal(run.state.round.revealed, false);
  run.session.close();
});
