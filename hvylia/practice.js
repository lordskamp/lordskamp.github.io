import { createRoom, addPlayer, applyAction, viewFor, GAME_CONFIG } from './practice-engine.js';

// These are local role seats used by the same rules as the multiplayer game.
// They never connect to a room, appear as other people, or persist a session.
const SEATS = [
  { id: 'practice-psychic-0', name: 'Роль Телепата 1', team: 0 },
  { id: 'practice-guesser-0', name: 'Роль команди 1', team: 0 },
  { id: 'practice-psychic-1', name: 'Роль Телепата 2', team: 1 },
  { id: 'practice-guesser-1', name: 'Роль команди 2', team: 1 }
];
const SCENARIOS = [
  { spectrum: 0, target: 38 },
  { spectrum: 0.28, target: 66 },
  { spectrum: 0.54, target: 50 },
  { spectrum: 0.78, target: 72 }
];

export class PracticeSession {
  constructor(onState) {
    this.onState = onState;
    this.room = null;
    this.session = null;
    this.timers = new Set();
    this.closed = false;
    this.run = 0;
  }

  start() {
    this.clearTimers();
    this.closed = false;
    this.run += 1;
    let room = createRoom('SOLO', SEATS[0]);
    for (const seat of SEATS.slice(1)) room = addPlayer(room, seat);
    const host = room.hostId;
    room = applyAction(room, host, {
      type: 'settings', winScore: 5, teamNames: ['Перша хвиля', 'Друга хвиля']
    });
    for (const seat of SEATS) {
      room = applyAction(room, host, { type: 'team', playerId: seat.id, team: seat.team });
      room = applyAction(room, seat.id, { type: 'ready', ready: true });
    }
    // Keep round IDs unique across restarts so existing inputs always reset.
    room._roundSerial = this.run * 1000;
    this.room = applyAction(room, host, { type: 'start' }, this.roundRandom(0, true));
    this.publish();
  }

  roundRandom(index, starting = false) {
    const scenario = SCENARIOS[index % SCENARIOS.length];
    const draws = [scenario.spectrum, scenario.target / 100];
    if (starting) draws.unshift(0);
    return () => draws.shift() ?? 0.5;
  }

  actor() {
    const round = this.room.round;
    if (this.room.phase === 'PSYCHIC_VIEW') return round.psychicId;
    if (this.room.phase === 'TEAM_GUESS') {
      return this.room.players.find(player => player.team === round.activeTeam && player.id !== round.psychicId).id;
    }
    if (this.room.phase === 'OPPONENT_BET' || this.room.phase === 'REVEAL') {
      return this.room.players.find(player => player.team === 1 - round.activeTeam).id;
    }
    return this.room.hostId;
  }

  publish() {
    if (this.closed) return;
    const playerId = this.actor();
    this.session = { playerId };
    this.onState(viewFor(this.room, playerId));
  }

  async action(action) {
    if (this.closed) return;
    if (action.type === 'rematch') { this.start(); return; }
    const allowed = ['replace-spectrum', 'clue', 'move', 'lock', 'bet', 'next'];
    if (!allowed.includes(action.type)) throw new Error('У тренуванні ця дія недоступна.');
    const random = action.type === 'next' ? this.roundRandom(this.room.round.number) : Math.random;
    this.room = applyAction(this.room, this.actor(), action, random);
    this.publish();
    if (action.type === 'bet') this.scheduleReveal();
  }

  scheduleReveal() {
    const roundId = this.room.round.id;
    const schedule = (delay, at) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (this.closed || this.room.round.id !== roundId) return;
        this.room = applyAction(this.room, null, { type: 'advance', now: at });
        this.publish();
      }, delay);
      this.timers.add(timer);
    };
    const revealAt = this.room.round.revealAt;
    schedule(Math.max(0, revealAt - Date.now()), revealAt);
    schedule(Math.max(0, revealAt + GAME_CONFIG.scoreDelayMs - Date.now()), revealAt + GAME_CONFIG.scoreDelayMs);
  }

  clearTimers() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  close() {
    this.closed = true;
    this.clearTimers();
  }
}
