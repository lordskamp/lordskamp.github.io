import assert from 'node:assert/strict';
import test from 'node:test';

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
  for (const winScore of [4, 31, '10', 10.5]) throwsCode('INVALID', () => applyAction(state, 'host', { type: 'settings', winScore }));
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
