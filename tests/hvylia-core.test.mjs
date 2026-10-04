import assert from 'node:assert/strict';
import test from 'node:test';
import { ANIME_SPECTRA, GAMES_SPECTRA } from '../api/hvylia-premium-cards.js';

import {
  GAME_CONFIG,
  SPECTRA,
  addPlayer,
  applyAction,
  createRoom,
  recoverDisconnected,
  scoreGuess,
  setConnection,
  viewFor
} from '../api/hvylia-core.js';

function randomSequence(...values) {
  let index = 0;
  return () => values[index++] ?? 0.5;
}

function lobby(extra = false) {
  let state = createRoom('K7FM', { id: 'host', name: 'Оля' }, 1_000);
  for (const [id, name] of [['ally', 'Тарас'], ['other', 'Леся'], ['other2', 'Максим'], ...(extra ? [['ally2', 'Андрій']] : [])]) {
    state = addPlayer(state, { id, name });
  }
  for (const player of state.players) {
    state = applyAction(state, 'host', { type: 'team', playerId: player.id, team: ['host', 'ally', 'ally2'].includes(player.id) ? 0 : 1 });
    state = applyAction(state, player.id, { type: 'ready', ready: true });
  }
  return state;
}

function started(extra = false) {
  return applyAction(lobby(extra), 'host', { type: 'start' }, randomSequence(0, 0, 0.5));
}

function actor(state, team, excludePsychic = false) {
  return state.players.find(player => player.team === team && player.connected
    && (!excludePsychic || player.id !== state.round.psychicId)).id;
}

function submitted(state, position = 50, side = 'left') {
  const roundId = state.round.id;
  let next = applyAction(state, state.round.psychicId, { type: 'clue', text: 'Нічний потяг', roundId });
  next = applyAction(next, actor(next, next.round.activeTeam, true), { type: 'lock', position, roundId });
  return applyAction(next, actor(next, 1 - next.round.activeTeam), { type: 'bet', side, roundId });
}

function scored(state, position = 50, side = 'left') {
  const pending = submitted(state, position, side);
  return applyAction(pending, null, { type: 'advance', now: pending.round.revealAt + GAME_CONFIG.scoreDelayMs });
}

function throwsCode(code, fn) {
  assert.throws(fn, error => error.code === code && /[А-Яа-яІіЇїЄєҐґ]/u.test(error.message));
}

test('original Ukrainian content has at least 150 unique, complete spectra', () => {
  assert.ok(SPECTRA.length >= 150);
  assert.equal(new Set(SPECTRA.map(spectrum => spectrum.id)).size, SPECTRA.length);
  assert.equal(new Set(SPECTRA.map(spectrum => `${spectrum.left}|${spectrum.right}`)).size, SPECTRA.length);
  assert.ok(SPECTRA.every(spectrum => spectrum.left && spectrum.right && spectrum.category && spectrum.left !== spectrum.right));
});

test('score sectors include their exact boundaries on both sides of the center', () => {
  for (const direction of [-1, 1]) {
    for (const [distance, points] of [[0, 4], [2, 4], [2.1, 3], [6, 3], [6.1, 2], [10, 2], [10.1, 0], [50, 0]]) {
      assert.equal(scoreGuess(50, 50 + direction * distance, 'left').activePoints, points, `distance ${direction * distance}`);
    }
  }
  assert.equal(scoreGuess(0, 0, 'right').activePoints, 4);
  assert.equal(scoreGuess(100, 100, 'left').activePoints, 4);
});

test('opponents score a correct side only outside the four-point sector', () => {
  assert.deepEqual(scoreGuess(40, 50, 'left'), { activePoints: 2, opponentPoints: 1 });
  assert.deepEqual(scoreGuess(60, 50, 'right'), { activePoints: 2, opponentPoints: 1 });
  assert.equal(scoreGuess(40, 50, 'right').opponentPoints, 0);
  assert.equal(scoreGuess(60, 50, 'left').opponentPoints, 0);
  assert.equal(scoreGuess(49, 50, 'left').opponentPoints, 0);
  assert.equal(scoreGuess(51, 50, 'right').opponentPoints, 0);
  assert.equal(scoreGuess(50, 50, 'left').opponentPoints, 0);
  assert.equal(scoreGuess(50, 50, 'right').opponentPoints, 0);
  assert.equal(scoreGuess(0, 100, 'left').opponentPoints, 1);
});

test('decimal dial positions score exactly at all sector boundaries without floating-point misses', () => {
  for (let center = 100; center <= 900; center += 1) {
    for (const [distance, expected] of [[20, 4], [60, 3], [100, 2]]) {
      for (const sign of [-1, 1]) {
        assert.equal(scoreGuess(center / 10, (center + sign * distance) / 10, 'left').activePoints, expected);
      }
    }
  }
});

test('generated targets keep the four-point wedge visible and allow clipped outer wedges', () => {
  for (const value of [0, 0.001, 0.25, 0.5, 0.9, 0.999999999]) {
    const state = applyAction(lobby(), 'host', { type: 'start' }, randomSequence(0, 0, value));
    assert.ok(state.round.target >= 0);
    assert.ok(state.round.target <= 100);
    assert.equal(scoreGuess(state.round.target, state.round.target, null).activePoints, 4);
  }
  assert.equal(applyAction(lobby(), 'host', { type: 'start' }, randomSequence(0, 0, 0)).round.target, 0);
  assert.equal(applyAction(lobby(), 'host', { type: 'start' }, randomSequence(0, 0, 0.999999999)).round.target, 100);
});

test('the second team starts with one point whichever team wins the first-turn draw', () => {
  for (const [draw, firstTeam] of [[0, 0], [0.999999, 1]]) {
    const state = applyAction(lobby(), 'host', { type: 'start' }, randomSequence(draw, 0, 0.5));
    assert.equal(state.round.activeTeam, firstTeam);
    assert.equal(state.teams[firstTeam].score, 0);
    assert.equal(state.teams[1 - firstTeam].score, 1);
  }
});

test('room creation normalizes names and codes, preserves initial disconnected sockets', () => {
  const state = createRoom(' k7fm ', { id: 'host', name: '  Оля   К. ', connected: false }, 42);
  assert.equal(state.code, 'K7FM');
  assert.equal(state.players[0].name, 'Оля К.');
  assert.equal(state.players[0].connected, false);
  assert.equal(state.players[0].disconnectedAt, 42);
  throwsCode('INVALID_CODE', () => createRoom('../!', { id: 'p', name: 'Оля' }));
  throwsCode('INVALID', () => createRoom('TEST', { id: 'p', name: '' }));
  const other = addPlayer(state, { id: 'other', name: 'Леся', connected: false });
  assert.equal(other.players[1].connected, false);
  assert.equal(typeof other.players[1].disconnectedAt, 'number');
});

test('duplicate names, identities, oversized rooms and kicked identities are rejected', () => {
  let state = createRoom('TEST', { id: 'host', name: 'Оля' });
  throwsCode('NAME_TAKEN', () => addPlayer(state, { id: 'other', name: ' оЛя ' }));
  throwsCode('PLAYER_EXISTS', () => addPlayer(state, { id: 'host', name: 'Леся' }));
  for (let index = 1; index < GAME_CONFIG.maxPlayers; index += 1) state = addPlayer(state, { id: `p${index}`, name: `Гравець ${index}` });
  throwsCode('PLAYER_LIMIT', () => addPlayer(state, { id: 'too-many', name: 'Новачок' }));
  state = applyAction(state, 'host', { type: 'kick', playerId: 'p1' });
  throwsCode('KICKED', () => addPlayer(state, { id: 'p1', name: 'Знову тут' }));
  throwsCode('PLAYER_NOT_FOUND', () => applyAction(state, 'p1', { type: 'ready', ready: true }));
});

test('lobby host permissions and self-selection are enforced by the server', () => {
  let state = lobby();
  for (const action of [
    { type: 'settings', winScore: 15 }, { type: 'randomize' }, { type: 'kick', playerId: 'other' },
    { type: 'start' }, { type: 'lobby' }, { type: 'rematch' }, { type: 'team', playerId: 'other', team: 0 }
  ]) throwsCode('ROLE', () => applyAction(state, 'ally', action));
  state = applyAction(state, 'host', { type: 'settings', teamNames: ['Світанок', 'Захід'], winScore: 15, selfSelect: false });
  assert.deepEqual(state.teams.map(team => team.name), ['Світанок', 'Захід']);
  assert.equal(state.config.winScore, 15);
  throwsCode('ROLE', () => applyAction(state, 'ally', { type: 'team', team: 1 }));
  state = applyAction(state, 'host', { type: 'team', playerId: 'ally', team: 1 });
  assert.equal(state.players.find(player => player.id === 'ally').ready, false);
  throwsCode('INVALID', () => applyAction(state, 'host', { type: 'kick', playerId: 'host' }));
  for (const winScore of [4, 6, 11, 29, 31, '10', 10.5]) throwsCode('INVALID', () => applyAction(state, 'host', { type: 'settings', winScore }));
});

test('start requires two connected ready participants per team; unready extras do not block it', () => {
  let state = lobby();
  state = applyAction(state, 'other2', { type: 'ready', ready: false });
  throwsCode('NOT_READY', () => applyAction(state, 'host', { type: 'start' }));
  state = applyAction(state, 'other2', { type: 'ready', ready: true });
  state = setConnection(state, 'other2', false);
  throwsCode('NOT_READY', () => applyAction(state, 'host', { type: 'start' }));
  state = lobby(true);
  state = applyAction(state, 'host', { type: 'ready', ready: false });
  state = applyAction(state, 'host', { type: 'start' }, randomSequence(0, 0, 0.5));
  assert.equal(state.phase, 'PSYCHIC_VIEW');
  assert.notEqual(state.round.psychicId, 'host');
});

test('random assignment balances connected players and resets readiness', () => {
  let state = lobby(true);
  state = setConnection(state, 'ally2', false);
  state = applyAction(state, 'host', { type: 'randomize' }, () => 0.3);
  assert.equal(state.players.filter(player => player.team === 0).length, 2);
  assert.equal(state.players.filter(player => player.team === 1).length, 2);
  assert.equal(state.players.find(player => player.id === 'ally2').team, null);
  assert.ok(state.players.every(player => !player.ready));
});

test('round transitions enforce role, phase, input validation and round identity', () => {
  let state = started();
  const roundId = state.round.id;
  throwsCode('ROLE', () => applyAction(state, 'ally', { type: 'clue', text: 'Потяг', roundId }));
  throwsCode('PHASE', () => applyAction(state, 'ally', { type: 'move', position: 40, roundId }));
  throwsCode('STALE', () => applyAction(state, 'host', { type: 'clue', text: 'Потяг', roundId: 'old' }));
  throwsCode('INVALID', () => applyAction(state, 'host', { type: 'clue', text: ' ', roundId }));
  state = applyAction(state, 'host', { type: 'clue', text: '  Нічний   потяг ', roundId });
  assert.equal(state.round.clue, 'Нічний потяг');
  assert.equal(state.phase, 'TEAM_GUESS');
  for (const id of ['host', 'other', 'other2']) {
    for (const type of ['move', 'lock']) throwsCode('ROLE', () => applyAction(state, id, { type, position: 40, roundId }));
  }
  for (const position of [NaN, Infinity, -1, 101, '40']) {
    throwsCode('INVALID', () => applyAction(state, 'ally', { type: 'move', position, roundId }));
  }
  state = applyAction(state, 'ally', { type: 'move', position: 43.24, roundId });
  assert.equal(state.round.guess, 43.2);
  state = applyAction(state, 'ally', { type: 'lock', position: 46, roundId });
  assert.equal(state.phase, 'OPPONENT_BET');
  for (const id of ['host', 'ally']) throwsCode('ROLE', () => applyAction(state, id, { type: 'bet', side: 'right', roundId }));
  throwsCode('INVALID', () => applyAction(state, 'other', { type: 'bet', side: 'up', roundId }));
  throwsCode('ROLE', () => applyAction(state, 'host', { type: 'advance', now: Date.now() }));
  state = applyAction(state, 'other', { type: 'bet', side: 'right', roundId });
  assert.equal(state.phase, 'REVEAL');
  assert.equal(state.round.revealed, false);
  throwsCode('PHASE', () => applyAction(state, 'other2', { type: 'bet', side: 'left', roundId }));
  state = applyAction(state, null, { type: 'advance', now: state.round.revealAt + GAME_CONFIG.scoreDelayMs });
  assert.equal(state.phase, 'SCORE');
  assert.deepEqual(state.round.result, { activePoints: 3, opponentPoints: 1, catchUp: false });
  throwsCode('ROLE', () => applyAction(state, 'other', { type: 'next', roundId }));
  state = applyAction(state, 'host', { type: 'next', roundId }, () => 0.5);
  assert.equal(state.phase, 'PSYCHIC_VIEW');
  assert.equal(state.round.activeTeam, 1);
  throwsCode('STALE', () => applyAction(state, 'host', { type: 'next', roundId }));
  throwsCode('PHASE', () => applyAction(state, 'host', { type: 'settings', winScore: 15 }));
});

test('reveal is timed by server, does not score early, and repeated advances are idempotent', () => {
  const state = submitted(started(), 50, 'right');
  const initialScores = state.teams.map(team => team.score);
  const early = applyAction(state, null, { type: 'advance', now: state.round.revealAt - 1 });
  assert.deepEqual(early, state);
  let revealed = applyAction(state, null, { type: 'advance', now: state.round.revealAt });
  assert.equal(revealed.round.revealed, true);
  assert.equal(revealed.phase, 'REVEAL');
  assert.deepEqual(revealed.teams.map(team => team.score), initialScores);
  assert.deepEqual(applyAction(revealed, null, { type: 'advance', now: state.round.revealAt + 1 }), revealed);
  revealed = applyAction(revealed, null, { type: 'advance', now: state.round.revealAt + GAME_CONFIG.scoreDelayMs });
  assert.equal(revealed.teams[0].score, 4);
  assert.deepEqual(applyAction(revealed, null, { type: 'advance', now: state.round.revealAt + 999_999 }), revealed);
});

test('target and all private bookkeeping are absent from every non-psychic response before reveal', () => {
  let state = started();
  state._secretSeed = 'must-never-leak';
  state.players[0]._secret = 'must-never-leak';
  for (const id of ['ally', 'other', 'other2', null, 'unknown']) {
    const view = viewFor(state, id);
    assert.ok(!Object.hasOwn(view.round, 'target'));
    assert.ok(!JSON.stringify(view).includes('must-never-leak'));
    assert.ok(!Object.hasOwn(view, '_rotation'));
    assert.ok(!Object.hasOwn(view, '_usedSpectra'));
    assert.ok(!Object.hasOwn(view, '_kickedIds'));
  }
  assert.equal(viewFor(state, 'host').round.target, 50);
  state = submitted(state);
  assert.ok(!Object.hasOwn(viewFor(state, 'other').round, 'target'), 'the short reveal suspense must remain private');
  state = applyAction(state, null, { type: 'advance', now: state.round.revealAt });
  for (const id of ['host', 'ally', 'other', 'other2', null]) assert.equal(viewFor(state, id).round.target, 50);
  const view = viewFor(state, 'ally');
  view.round.spectrum.left = 'changed';
  view.teams[0].score = 999;
  assert.notEqual(state.round.spectrum.left, 'changed');
  assert.notEqual(state.teams[0].score, 999);
});

test('rounds alternate teams and rotate psychic after a team returns', () => {
  let state = scored(started(), 100, 'right');
  const originalPsychic = state.round.psychicId;
  state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
  assert.equal(state.round.activeTeam, 1);
  state = scored(state, 100, 'right');
  state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
  assert.equal(state.round.activeTeam, 0);
  assert.notEqual(state.round.psychicId, originalPsychic);
  assert.equal(state.round.number, 3);
});

test('public turn order follows the server rotation, skips offline players and returns after reconnect', () => {
  let state = started(true);
  assert.deepEqual(viewFor(state, 'other').turnOrder, [['ally', 'ally2', 'host'], ['other', 'other2']]);
  state = setConnection(state, 'ally', false, 1_000);
  assert.deepEqual(viewFor(state, 'other').turnOrder[0], ['ally2', 'host']);
  state = scored(state, 100, 'right');
  state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
  assert.deepEqual(viewFor(state, 'host').turnOrder[1], ['other2', 'other']);
  state = scored(state, 100, 'right');
  state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
  assert.equal(state.round.psychicId, 'ally2');
  state = setConnection(state, 'ally', true, 2_000);
  assert.deepEqual(viewFor(state, 'other').turnOrder[0], ['host', 'ally', 'ally2']);
  const view = viewFor(state, 'other');
  view.turnOrder[0].push('changed');
  assert.equal(viewFor(state, 'other').turnOrder[0].includes('changed'), false);
});

test('catch-up grants same team a turn and a different psychic only while still losing', () => {
  let state = started();
  state.teams[1].score = 7;
  state = scored(state);
  assert.equal(state.round.result.catchUp, true);
  const previous = state.round.psychicId;
  state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
  assert.equal(state.round.activeTeam, 0);
  assert.notEqual(state.round.psychicId, previous);
  state = scored(state);
  assert.equal(state.teams[0].score, 8);
  assert.equal(state.round.result.catchUp, false);
  state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
  assert.equal(state.round.activeTeam, 1);
});

test('tie at winning score gives BOTH teams a turn before choosing the overtime winner', () => {
  let state = started();
  state.teams[0].score = 8;
  state.teams[1].score = 9;
  state = scored(state, 60, 'left');
  assert.deepEqual(state.teams.map(team => team.score), [10, 10]);
  assert.equal(state.overtime, true);
  assert.equal(state.winner, null);
  assert.equal(state.phase, 'SCORE');
  assert.equal(viewFor(state, 'host').overtimeTurnsRemaining, 2);
  state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
  state = scored(state, 100, 'left');
  assert.deepEqual(state.teams.map(team => team.score), [11, 10]);
  assert.equal(state.phase, 'SCORE');
  assert.equal(state.winner, null);
  assert.equal(viewFor(state, 'host').overtimeTurnsRemaining, 1);
  state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
  assert.equal(state.round.activeTeam, 0);
  state = scored(state, 50, 'right');
  assert.deepEqual(state.teams.map(team => team.score), [15, 10]);
  assert.equal(state.phase, 'GAME_OVER');
  assert.equal(state.winner, 0);
  assert.equal(viewFor(state, 'host').overtimeTurnsRemaining, 0);
  throwsCode('PHASE', () => applyAction(state, 'host', { type: 'next', roundId: state.round.id }));
});

test('tied overtime pairs repeat, and a trailing team can still win its response turn', () => {
  let state = started();
  state.teams[0].score = 8;
  state.teams[1].score = 9;
  state = scored(state, 60, 'left');
  for (let turn = 0; turn < 2; turn += 1) {
    state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
    state = scored(state, 50, 'right');
    assert.equal(state.phase, 'SCORE');
    assert.equal(state.winner, null);
  }
  assert.deepEqual(state.teams.map(team => team.score), [14, 14]);
  assert.equal(viewFor(state, 'host').overtimeTurnsRemaining, 2);
  state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
  state = scored(state, 55, 'left');
  assert.deepEqual(state.teams.map(team => team.score), [15, 17]);
  assert.equal(state.phase, 'SCORE');
  state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
  state = scored(state, 50, 'right');
  assert.deepEqual(state.teams.map(team => team.score), [19, 17]);
  assert.equal(state.phase, 'GAME_OVER');
  assert.equal(state.winner, 0);
});

test('previously stored overtime rooms without turn bookkeeping receive a complete fair pair', () => {
  let state = started();
  state.overtime = true;
  delete state._overtimeTurns;
  state.teams[0].score = 10;
  state.teams[1].score = 20;
  assert.equal(viewFor(state, 'host').overtimeTurnsRemaining, 2);
  state = scored(state, 50, 'right');
  assert.equal(state.round.result.catchUp, false);
  assert.equal(state.phase, 'SCORE');
  assert.equal(viewFor(state, 'host').overtimeTurnsRemaining, 1);
  state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
  assert.equal(state.round.activeTeam, 1);
  state = scored(state, 100, 'right');
  assert.equal(state.phase, 'GAME_OVER');
  assert.equal(state.winner, 1);
});

test('full default-score match reaches game over, and host rematch restores lobby', () => {
  let state = started();
  let rounds = 0;
  while (state.phase !== 'GAME_OVER') {
    state = scored(state, state.round.activeTeam === 0 ? 50 : 100, 'right');
    rounds += 1;
    if (state.phase === 'SCORE') state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, () => 0.5);
    assert.ok(rounds <= 10, 'the full match must terminate');
  }
  assert.equal(rounds, 5);
  assert.equal(state.winner, 0);
  assert.deepEqual(state.teams.map(team => team.score), [12, 1]);
  throwsCode('ROLE', () => applyAction(state, 'other', { type: 'rematch' }));
  state = applyAction(state, 'host', { type: 'rematch' });
  assert.equal(state.phase, 'LOBBY');
  assert.equal(state.round, null);
  assert.equal(state.winner, null);
  assert.deepEqual(state.teams.map(team => team.score), [0, 0]);
  assert.ok(state.players.every(player => !player.ready));
});

test('reconnect inside presence grace preserves psychic, host and exact round', () => {
  const initial = started();
  let state = setConnection(initial, 'host', false, 1_000);
  assert.equal(state.paused, true);
  state = recoverDisconnected(state, 1_000 + GAME_CONFIG.presenceGraceMs - 1, () => 0.2);
  assert.deepEqual(state.round, initial.round);
  assert.equal(state.hostId, 'host');
  state = setConnection(state, 'host', true, 20_000);
  assert.equal(state.paused, false);
  assert.equal(state.hostId, 'host');
  assert.deepEqual(state.round, initial.round);
  assert.ok(!Object.hasOwn(state.players[0], 'disconnectedAt'));
});

test('expired disconnected host transfers role and psychic is redealt without scoring', () => {
  let state = started(true);
  state = applyAction(state, 'host', { type: 'clue', text: 'Потяг', roundId: state.round.id });
  const oldRound = state.round.id;
  state = setConnection(state, 'host', false, 1_000);
  state = recoverDisconnected(state, 31_000, () => 0.2);
  assert.equal(state.hostId, 'ally');
  assert.equal(state.round.psychicId, 'ally');
  assert.notEqual(state.round.id, oldRound);
  assert.equal(state.round.number, 1);
  assert.equal(state.round.target, 20);
  assert.equal(state.round.clue, '');
  assert.equal(state.phase, 'PSYCHIC_VIEW');
  assert.equal(state.paused, false);
  assert.deepEqual(state.teams.map(team => team.score), [0, 1]);
  assert.deepEqual(recoverDisconnected(state, 60_000, () => 0.4), state, 'expired presence must not repeatedly redeal');
  state = setConnection(state, 'host', true, 60_001);
  assert.equal(state.hostId, 'ally', 'returning old host must not displace current host');
});

test('explicit psychic leave recovers immediately; empty teams pause and host can restore lobby', () => {
  let state = started(true);
  const roundId = state.round.id;
  state = applyAction(state, 'host', { type: 'leave' }, () => 0.4);
  assert.equal(state.hostId, 'ally');
  assert.equal(state.round.psychicId, 'ally');
  assert.notEqual(state.round.id, roundId);
  assert.ok(!state.players.some(player => player.id === 'host'));
  state = applyAction(state, 'other', { type: 'leave' });
  state = applyAction(state, 'other2', { type: 'leave' });
  assert.equal(state.paused, true);
  throwsCode('PAUSED', () => applyAction(state, 'ally', { type: 'clue', text: 'Потяг', roundId: state.round.id }));
  state = applyAction(state, 'ally', { type: 'lobby' });
  assert.equal(state.phase, 'LOBBY');
  assert.equal(state.paused, false);
  assert.equal(state.round, null);
});

test('all-offline psychic recovery waits safely until a teammate returns', () => {
  let state = started();
  state = setConnection(state, 'host', false, 1_000);
  state = setConnection(state, 'ally', false, 1_000);
  state = recoverDisconnected(state, 31_000, () => 0.3);
  assert.equal(state.hostId, 'other');
  assert.equal(state.paused, true);
  assert.equal(state.round.psychicId, 'host');
  state = setConnection(state, 'ally', true, 31_001);
  state = recoverDisconnected(state, 31_001, () => 0.3);
  assert.equal(state.round.psychicId, 'ally');
  assert.equal(state.paused, true, 'one active player cannot give and guess a clue alone');
  state = setConnection(state, 'host', true, 31_002);
  assert.equal(state.paused, false);
});

test('late guests are spectators and cannot control the match', () => {
  const state = addPlayer(started(), { id: 'guest', name: 'Новачок' });
  assert.equal(viewFor(state, 'guest').you.role, 'spectator');
  assert.ok(!Object.hasOwn(viewFor(state, 'guest').round, 'target'));
  throwsCode('PHASE', () => applyAction(state, 'guest', { type: 'team', team: 0 }));
  throwsCode('ROLE', () => applyAction(state, 'guest', { type: 'clue', text: 'Потяг', roundId: state.round.id }));
});

test('public functions never mutate their input states, including failure paths', () => {
  const initial = lobby();
  const snapshot = structuredClone(initial);
  applyAction(initial, 'host', { type: 'start' }, () => 0.5);
  setConnection(initial, 'host', false);
  recoverDisconnected(initial, 100_000);
  addPlayer(initial, { id: 'guest', name: 'Новачок' });
  viewFor(initial, 'host');
  throwsCode('INVALID', () => applyAction(initial, 'host', { type: 'settings', teamNames: ['Нова', ''], winScore: 15 }));
  assert.deepEqual(initial, snapshot);
});


test('host goals use multiples of five and invalid pack settings are atomic', () => {
  const initial = lobby();
  for (const winScore of GAME_CONFIG.winScores) {
    assert.equal(applyAction(initial, 'host', { type: 'settings', winScore }).config.winScore, winScore);
  }
  throwsCode('INVALID', () => applyAction(initial, 'host', { type: 'settings', winScore: 15, packId: 'invented' }));
  assert.equal(initial.config.winScore, 10);
  assert.equal(initial.config.packId, 'standard');
  throwsCode('ROLE', () => applyAction(initial, 'ally', { type: 'settings', packId: 'anime' }));
});

test('server supplies the selected deck for first, next and recovered rounds', () => {
  for (const [packId, cards] of [['anime', ANIME_SPECTRA], ['games', GAMES_SPECTRA]]) {
    let state = applyAction(lobby(), 'host', { type: 'settings', packId });
    state = applyAction(state, 'host', { type: 'start' }, randomSequence(0, 0, .5), cards);
    assert.ok(cards.some(card => card.id === state.round.spectrum.id));
    const first = state.round.spectrum.id;
    state = scored(state);
    state = applyAction(state, 'host', { type: 'next', roundId: state.round.id }, randomSequence(0, .5), cards);
    assert.ok(cards.some(card => card.id === state.round.spectrum.id));
    assert.notEqual(state.round.spectrum.id, first);
    state = setConnection(state, state.round.psychicId, false, 1000);
    state = recoverDisconnected(state, 31001, randomSequence(0, .5), cards);
    assert.ok(cards.some(card => card.id === state.round.spectrum.id));
    assert.equal(viewFor(state, 'host').config.packId, packId);
  }
});

test('verified account identity remains private in all room views', () => {
  let state = createRoom('PRIV', { id: 'owner', name: 'Оля', _accountId: '123456789' });
  state = addPlayer(state, { id: 'friend', name: 'Друг', _accountId: '987654321' });
  assert.equal(state.players[0]._accountId, '123456789');
  for (const id of ['owner', 'friend', null]) {
    const encoded = JSON.stringify(viewFor(state, id));
    assert.equal(encoded.includes('123456789'), false);
    assert.equal(encoded.includes('987654321'), false);
    assert.equal(encoded.includes('_accountId'), false);
  }
});

test('psychic replaces only the spectrum and keeps the same target, turn, score and rotation', () => {
  const initial = started();
  const snapshot = structuredClone(initial);
  const next = applyAction(initial, initial.round.psychicId, {
    type: 'replace-spectrum', roundId: initial.round.id
  }, () => 0);
  assert.notEqual(next.round.spectrum.id, initial.round.spectrum.id);
  assert.notEqual(next.round.id, initial.round.id);
  assert.equal(next._roundSerial, initial._roundSerial + 1);
  assert.equal(next.revision, initial.revision + 1);
  assert.equal(next.phase, 'PSYCHIC_VIEW');
  assert.deepEqual({ ...next.round, id: initial.round.id, spectrum: initial.round.spectrum }, initial.round);
  assert.deepEqual(next.teams, initial.teams);
  assert.deepEqual(next.players, initial.players);
  assert.deepEqual(next._rotation, initial._rotation);
  assert.deepEqual(next._usedSpectra, [...initial._usedSpectra, next.round.spectrum.id]);
  assert.deepEqual(initial, snapshot, 'replacing must not mutate the supplied room');
  for (const id of ['host', 'ally', 'other', 'other2', null]) {
    const view = viewFor(next, id);
    assert.equal(view.round.spectrum.id, next.round.spectrum.id);
    assert.equal(Object.hasOwn(view.round, 'target'), id === next.round.psychicId);
    if (id === next.round.psychicId) assert.equal(view.round.target, initial.round.target);
  }
});

test('replacement checks psychic role, current round, connection, pause and pre-clue phase', () => {
  const initial = addPlayer(started(), { id: 'guest', name: 'Гість' });
  const action = { type: 'replace-spectrum', roundId: initial.round.id };
  for (const id of ['ally', 'other', 'other2', 'guest']) {
    throwsCode('ROLE', () => applyAction(initial, id, action));
  }
  const otherTeamStarts = applyAction(lobby(), 'host', { type: 'start' }, randomSequence(0.9, 0, 0.5));
  throwsCode('ROLE', () => applyAction(otherTeamStarts, 'host', { type: 'replace-spectrum', roundId: otherTeamStarts.round.id }));
  throwsCode('STALE', () => applyAction(initial, 'host', { type: 'replace-spectrum' }));
  throwsCode('STALE', () => applyAction(initial, 'host', { ...action, roundId: 'old-round' }));
  throwsCode('DISCONNECTED', () => applyAction(setConnection(initial, 'host', false), 'host', action));
  const paused = setConnection(initial, 'ally', false);
  assert.equal(paused.paused, true);
  throwsCode('PAUSED', () => applyAction(paused, 'host', action));
  const guessing = applyAction(initial, 'host', { type: 'clue', roundId: initial.round.id, text: 'Кава перед світанком' });
  throwsCode('PHASE', () => applyAction(guessing, 'host', action));
  const locked = applyAction(guessing, 'ally', { type: 'lock', roundId: guessing.round.id, position: 50 });
  throwsCode('PHASE', () => applyAction(locked, 'host', action));
  const revealed = scored(initial);
  throwsCode('PHASE', () => applyAction(revealed, 'host', action));
});

test('replacement invalidates queued commands for the previous card without changing scores', () => {
  const initial = started();
  const next = applyAction(initial, 'host', { type: 'replace-spectrum', roundId: initial.round.id }, () => 0);
  for (const action of [
    { type: 'clue', text: 'Підказка до старої картки' },
    { type: 'replace-spectrum' },
    { type: 'move', position: 50 }
  ]) throwsCode('STALE', () => applyAction(next, 'host', { ...action, roundId: initial.round.id }));
  const guessing = applyAction(next, 'host', { type: 'clue', text: 'Підказка до нової картки', roundId: next.round.id });
  assert.equal(guessing.phase, 'TEAM_GUESS');
  assert.equal(guessing.round.target, initial.round.target);
  assert.equal(guessing.round.spectrum.id, next.round.spectrum.id);
  assert.deepEqual(guessing.teams, initial.teams);
});

test('replacement draws unused cards from the supplied paid deck and avoids consecutive repeats after exhaustion', () => {
  for (const [packId, cards] of [['anime', ANIME_SPECTRA], ['games', GAMES_SPECTRA]]) {
    let state = applyAction(lobby(), 'host', { type: 'settings', packId });
    state = applyAction(state, 'host', { type: 'start' }, randomSequence(0, 0, 0.5), cards);
    const seen = new Set([state.round.spectrum.id]);
    const turn = { target: state.round.target, psychic: state.round.psychicId, team: state.round.activeTeam, number: state.round.number, rotation: structuredClone(state._rotation), scores: structuredClone(state.teams) };
    for (let index = 1; index < cards.length; index += 1) {
      state = applyAction(state, state.round.psychicId, { type: 'replace-spectrum', roundId: state.round.id }, () => 0, cards);
      assert.equal(seen.has(state.round.spectrum.id), false);
      assert.ok(cards.some(card => card.id === state.round.spectrum.id));
      assert.equal(SPECTRA.some(card => card.id === state.round.spectrum.id), false);
      seen.add(state.round.spectrum.id);
    }
    assert.equal(seen.size, cards.length);
    const previous = state.round.spectrum.id;
    state = applyAction(state, state.round.psychicId, { type: 'replace-spectrum', roundId: state.round.id }, () => 0, cards);
    assert.notEqual(state.round.spectrum.id, previous);
    assert.equal(state.round.target, turn.target);
    assert.equal(state.round.psychicId, turn.psychic);
    assert.equal(state.round.activeTeam, turn.team);
    assert.equal(state.round.number, turn.number);
    assert.deepEqual(state._rotation, turn.rotation);
    assert.deepEqual(state.teams, turn.scores);
  }
});

test('an empty or one-card replacement deck fails atomically instead of changing the target or repeating the card', () => {
  const initial = started();
  const snapshot = structuredClone(initial);
  const action = { type: 'replace-spectrum', roundId: initial.round.id };
  throwsCode('CONTENT', () => applyAction(initial, 'host', action, () => 0, []));
  throwsCode('CONTENT', () => applyAction(initial, 'host', action, () => 0, [initial.round.spectrum]));
  throwsCode('RANDOM', () => applyAction(initial, 'host', action, () => 1));
  assert.deepEqual(initial, snapshot);
});
