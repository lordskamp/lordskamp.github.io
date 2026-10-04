import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(import.meta.dirname, '..');
const clients = [];
let worker;
let origin;
let persistence;
let output = '';

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const { port } = server.address();
  await new Promise(done => server.close(done));
  return port;
}

before(async () => {
  const port = await freePort();
  const inspector = await freePort();
  origin = `http://127.0.0.1:${port}`;
  persistence = await mkdtemp(join(tmpdir(), 'hvylia-test-'));
  await mkdir(join(project, 'outputs/hvylia-site'), { recursive: true });
  worker = spawn(process.execPath, [
    join(project, 'node_modules/wrangler/bin/wrangler.js'),
    'dev', '--config', 'wrangler.hvylia.jsonc', '--local',
    '--port', String(port), '--ip', '127.0.0.1',
    '--inspector-port', String(inspector), '--persist-to', persistence,
    '--show-interactive-dev-session=false', '--log-level', 'error'
  ], { cwd: project, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const collect = chunk => { output = (output + chunk.toString()).slice(-6000); };
  worker.stdout.on('data', collect);
  worker.stderr.on('data', collect);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(`Worker exited during startup: ${output}`);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).ok) return;
    } catch { /* Wait for Wrangler and workerd to listen. */ }
    await delay(100);
  }
  throw new Error(`Local Worker did not become ready within 15 seconds: ${output}`);
});

after(async () => {
  for (const client of clients) client.close();
  if (worker && worker.exitCode === null) {
    if (process.platform === 'win32') {
      await new Promise(done => {
        const stop = spawn('taskkill', ['/pid', String(worker.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        stop.once('exit', done);
        stop.once('error', done);
      });
    } else {
      worker.kill('SIGTERM');
      await Promise.race([new Promise(done => worker.once('exit', done)), delay(2000)]);
      if (worker.exitCode === null) worker.kill('SIGKILL');
    }
  }
  if (persistence) {
    assert.equal(dirname(persistence), resolve(tmpdir()));
    assert.match(persistence.slice(dirname(persistence).length + 1), /^hvylia-test-/u);
    await rm(persistence, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function request(path, { body, token, method = 'POST' } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000)
  });
  return { status: response.status, data: await response.json() };
}

class PlayerClient {
  constructor(session, ticket) {
    this.session = session;
    this.packets = [];
    this.waiters = new Set();
    this.state = null;
    this.open = false;
    this.error = null;
    const url = new URL(`${origin.replace('http:', 'ws:')}/api/rooms/${session.code}/socket`);
    url.searchParams.set('ticket', ticket);
    assert.equal(url.searchParams.has('token'), false);
    assert.equal(url.href.includes(session.token), false);
    this.socket = new globalThis.WebSocket(url);
    this.socket.addEventListener('open', () => {
      this.open = true;
      this.heartbeat = setInterval(() => {
        if (this.socket.readyState === 1) this.socket.send(JSON.stringify({ type: 'ping' }));
      }, 15000);
      this.notify();
    });
    this.socket.addEventListener('message', event => {
      const packet = JSON.parse(event.data);
      this.packets.push(packet);
      if (packet.type === 'state') this.state = packet.state;
      this.notify();
    });
    this.socket.addEventListener('error', () => { this.error = new Error('WebSocket handshake failed'); this.notify(); });
    this.socket.addEventListener('close', event => {
      this.closed = event.code;
      clearInterval(this.heartbeat);
      this.notify();
    });
    clients.push(this);
  }

  notify() { for (const check of [...this.waiters]) check(); }

  wait(predicate, label, timeout = 5000) {
    if (predicate()) return Promise.resolve(predicate());
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`Timed out waiting for ${label}; latest phase ${this.state?.phase || 'none'}`));
      }, timeout);
      const check = () => {
        const value = predicate();
        if (value || this.error) {
          clearTimeout(timer);
          this.waiters.delete(check);
          if (this.error && !value) reject(this.error);
          else done(value);
        }
      };
      this.waiters.add(check);
      check();
    });
  }

  waitState(predicate) { return this.wait(() => this.state && predicate(this.state) && this.state, 'room state'); }

  action(action, id = randomUUID()) {
    const cursor = this.packets.length;
    this.socket.send(JSON.stringify({ type: 'action', id, action }));
    return this.wait(() => this.packets.slice(cursor).find(packet => packet.id === id && ['ack', 'error'].includes(packet.type)), `receipt for ${action.type}`);
  }

  async accept(action, id) {
    const packet = await this.action(action, id);
    assert.equal(packet.type, 'ack', `Action ${action.type} was rejected: ${packet.code || ''}`);
    return packet;
  }

  close() {
    clearInterval(this.heartbeat);
    if (this.socket.readyState === 0 || this.socket.readyState === 1) this.socket.close();
  }
}

async function connect(session) {
  const response = await request(`/api/rooms/${session.code}/socket-ticket`, { token: session.token });
  assert.equal(response.status, 200);
  assert.match(response.data.ticket, /^[a-f0-9-]{36}$/u);
  const client = new PlayerClient(session, response.data.ticket);
  await client.waitState(state => state.you?.id === session.playerId);
  return { client, ticket: response.data.ticket };
}

async function createPlayers() {
  const created = await request('/api/rooms', { body: { name: 'Олена' } });
  assert.equal(created.status, 201);
  assert.match(created.data.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/u);
  const sessions = [created.data];
  for (const name of ['Марко', 'Соломія', 'Тарас']) {
    const joined = await request(`/api/rooms/${created.data.code}/join`, { body: { name } });
    assert.equal(joined.status, 200);
    sessions.push(joined.data);
  }
  const players = [];
  for (const session of sessions) players.push((await connect(session)).client);
  await Promise.all(players.map(client => client.waitState(state => state.players.length === 4 && state.players.every(player => player.connected))));
  return players;
}

function sync(players, predicate) {
  return Promise.all(players.map(client => client.waitState(predicate)));
}

function privateTargets(players) {
  for (const client of players) {
    assert.equal(Object.hasOwn(client.state.round, 'target'), client.state.you.role === 'psychic');
    assert.equal(Object.keys(client.state).some(key => key.startsWith('_')), false);
    assert.equal(Object.hasOwn(client.state, 'token'), false);
  }
}

test('real Worker rejects malformed codes, nonexistent rooms and unauthorized sessions', async () => {
  const invalid = await request('/api/rooms/OO11/join', { body: { name: 'Гість' } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.code, 'ROOM_CODE');
  const missing = await request('/api/rooms/AAAA/join', { body: { name: 'Гість' } });
  assert.equal(missing.status, 404);
  assert.equal(missing.data.code, 'NOT_FOUND');
  const unauthorized = await request('/api/rooms/AAAA/resume');
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.data.code, 'SESSION');
});

test('four real WebSocket clients play an entire match with private targets, race protection and reconnect', { timeout: 40000 }, async t => {
  const players = await createPlayers();
  const host = players[0];
  const code = host.session.code;

  await t.test('duplicate names are rejected and one-time socket tickets cannot be reused', async () => {
    const duplicate = await request(`/api/rooms/${code}/join`, { body: { name: 'олена' } });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.data.code, 'NAME_TAKEN');
    const issued = await request(`/api/rooms/${code}/socket-ticket`, { token: host.session.token });
    const first = new PlayerClient(host.session, issued.data.ticket);
    await first.waitState(state => state.you.id === host.session.playerId);
    await host.wait(() => host.packets.find(packet => packet.type === 'replaced'), 'replacement notice');
    const repeated = new PlayerClient(host.session, issued.data.ticket);
    await assert.rejects(repeated.waitState(state => !!state), /WebSocket handshake failed/u);
    const resumed = await request(`/api/rooms/${code}/resume`, { token: host.session.token });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.playerId, host.session.playerId);
    const replacement = (await connect(host.session)).client;
    players[0] = replacement;
    await first.wait(() => first.packets.find(packet => packet.type === 'replaced'), 'second replacement notice');
  });

  let leader = players[0];
  await t.test('host forms two ready teams; a guest cannot start the match', async () => {
    for (let index = 0; index < players.length; index += 1) {
      await leader.accept({ type: 'team', playerId: players[index].session.playerId, team: Math.floor(index / 2) });
    }
    await sync(players, state => state.players.every(player => player.team !== null));
    for (const client of players) await client.accept({ type: 'ready', ready: true });
    await sync(players, state => state.players.every(player => player.ready));
    const invalid = await players[1].action({ type: 'start' });
    assert.equal(invalid.type, 'error');
    assert.equal(invalid.code, 'ROLE');
    await leader.accept({ type: 'start' });
    await sync(players, state => state.phase === 'PSYCHIC_VIEW');
    privateTargets(players);
  });

  await t.test('only the psychic replaces a card; concurrent replacements synchronize one new private-target round', async () => {
    const psychic = players.find(client => client.state.you.role === 'psychic');
    const before = structuredClone(psychic.state);
    const oldId = before.round.id;
    for (const client of players.filter(item => item !== psychic)) {
      const denied = await client.action({ type: 'replace-spectrum', roundId: oldId });
      assert.equal(denied.type, 'error');
      assert.equal(denied.code, 'ROLE');
    }
    const firstId = randomUUID();
    const secondId = randomUUID();
    const results = await Promise.all([
      psychic.action({ type: 'replace-spectrum', roundId: oldId }, firstId),
      psychic.action({ type: 'replace-spectrum', roundId: oldId }, secondId)
    ]);
    assert.equal(results.filter(packet => packet.type === 'ack').length, 1);
    assert.equal(results.find(packet => packet.type === 'error').code, 'STALE');
    await sync(players, state => state.phase === 'PSYCHIC_VIEW' && state.round.id !== oldId);
    const after = psychic.state;
    assert.notEqual(after.round.spectrum.id, before.round.spectrum.id);
    assert.equal(after.round.target, before.round.target);
    assert.equal(after.round.psychicId, before.round.psychicId);
    assert.equal(after.round.activeTeam, before.round.activeTeam);
    assert.equal(after.round.number, before.round.number);
    assert.deepEqual(after.teams, before.teams);
    assert.deepEqual(after.turnOrder, before.turnOrder);
    for (const client of players) {
      assert.deepEqual(client.state.round.spectrum, after.round.spectrum);
      assert.equal(client.state.round.id, after.round.id);
    }
    privateTargets(players);
    const staleClue = await psychic.action({ type: 'clue', roundId: oldId, text: 'Підказка до старої картки' });
    assert.equal(staleClue.code, 'STALE');
    const successfulId = results.find(packet => packet.type === 'ack').id;
    await psychic.accept({ type: 'replace-spectrum', roundId: oldId }, successfulId);
    assert.equal(psychic.state.round.id, after.round.id, 'a repeated receipt must not replace another card');
    assert.equal(psychic.state.round.spectrum.id, after.round.spectrum.id);
  });

  await t.test('a disconnected psychic resumes the same hidden target and role within the grace period', async () => {
    const index = players.findIndex(client => client.state.you.role === 'psychic');
    const psychic = players[index];
    const roundId = psychic.state.round.id;
    const target = psychic.state.round.target;
    psychic.close();
    const observer = players.find(client => client !== psychic);
    await observer.waitState(state => state.paused && state.players.find(player => player.id === psychic.session.playerId)?.connected === false);
    const resumed = await request(`/api/rooms/${code}/resume`, { token: psychic.session.token });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.state.you.role, 'psychic');
    assert.equal(resumed.data.state.round.target, target);
    const refreshed = (await connect(psychic.session)).client;
    players[index] = refreshed;
    if (leader === psychic) leader = refreshed;
    await sync(players, state => !state.paused && state.phase === 'PSYCHIC_VIEW' && state.round.id === roundId);
    assert.equal(refreshed.state.round.target, target);
    privateTargets(players);
  });

  let rounds = 0;
  await t.test('roles synchronize a full round and scoring reaches game over exactly once', async () => {
    while (leader.state.phase !== 'GAME_OVER') {
      rounds += 1;
      assert.ok(rounds <= 5, 'A perfect alternating 10-point match should end in five rounds');
      await sync(players, state => state.phase === 'PSYCHIC_VIEW' && state.round.number === rounds);
      privateTargets(players);
      const psychic = players.find(client => client.state.you.role === 'psychic');
      const guesser = players.find(client => client.state.you.role === 'guesser');
      const opponent = players.find(client => client.state.you.role === 'opponent');
      const target = psychic.state.round.target;
      const roundId = psychic.state.round.id;
      if (rounds === 1) {
        const nonPsychic = await request(`/api/rooms/${code}/resume`, { token: opponent.session.token });
        assert.equal(Object.hasOwn(nonPsychic.data.state.round, 'target'), false);
        const wrongClue = await guesser.action({ type: 'clue', roundId, text: 'Чужа підказка' });
        assert.equal(wrongClue.code, 'ROLE');
      }
      await psychic.accept({ type: 'clue', roundId, text: `Кава на вокзалі, раунд ${rounds}` });
      await sync(players, state => state.phase === 'TEAM_GUESS');
      privateTargets(players);
      if (rounds === 1) {
        const lateReplacement = await psychic.action({ type: 'replace-spectrum', roundId });
        assert.equal(lateReplacement.type, 'error');
        assert.equal(lateReplacement.code, 'PHASE');
        for (const actor of [psychic, opponent]) {
          const wrongMove = await actor.action({ type: 'move', roundId, position: 35 });
          assert.equal(wrongMove.code, 'ROLE');
        }
      }
      await guesser.accept({ type: 'move', roundId, position: target });
      await sync(players, state => state.round.guess === target);
      const locks = await Promise.all([
        guesser.action({ type: 'lock', roundId, position: target }),
        guesser.action({ type: 'lock', roundId, position: target })
      ]);
      assert.equal(locks.filter(packet => packet.type === 'ack').length, 1);
      assert.equal(locks.find(packet => packet.type === 'error').code, 'PHASE');
      await sync(players, state => state.phase === 'OPPONENT_BET');
      privateTargets(players);
      const betId = randomUUID();
      await opponent.accept({ type: 'bet', roundId, side: 'right' }, betId);
      await sync(players, state => state.phase === 'REVEAL' && !state.round.revealed);
      privateTargets(players);
      await sync(players, state => state.round.revealed && Object.hasOwn(state.round, 'target'));
      await sync(players, state => ['SCORE', 'GAME_OVER'].includes(state.phase));
      for (const client of players) {
        assert.equal(client.state.round.target, target);
        assert.equal(client.state.round.result.activePoints, 4);
        assert.equal(client.state.round.result.opponentPoints, 0);
        assert.equal(client.state.teams.reduce((sum, team) => sum + team.score, 0), rounds * 4 + 1);
      }
      const scores = leader.state.teams.map(team => team.score);
      const revision = leader.state.revision;
      await opponent.accept({ type: 'bet', roundId, side: 'left' }, betId);
      await delay(50);
      assert.deepEqual(leader.state.teams.map(team => team.score), scores);
      assert.equal(leader.state.revision, revision);
      if (leader.state.phase !== 'GAME_OVER') {
        await leader.accept({ type: 'next', roundId });
        await sync(players, state => state.phase === 'PSYCHIC_VIEW' && state.round.id !== roundId);
      }
    }
    assert.equal(rounds, 5);
    assert.equal(leader.state.teams[leader.state.winner].score, 12);
    assert.deepEqual(leader.state.teams.map(team => team.score).sort((a, b) => a - b), [9, 12]);
  });

  await t.test('refresh resumes the same player and completed match without changing scores', async () => {
    const old = players[2];
    const identity = old.session.playerId;
    const scores = old.state.teams.map(team => team.score);
    old.close();
    await leader.waitState(state => state.players.find(player => player.id === identity)?.connected === false);
    const resumed = await request(`/api/rooms/${code}/resume`, { token: old.session.token });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.data.playerId, identity);
    assert.equal(resumed.data.state.phase, 'GAME_OVER');
    const refreshed = (await connect(old.session)).client;
    await refreshed.waitState(state => state.phase === 'GAME_OVER' && state.you.id === identity);
    assert.deepEqual(refreshed.state.teams.map(team => team.score), scores);
    assert.equal(old.socket.readyState, 3);
    assert.equal(refreshed.state.players.filter(player => player.id === identity).length, 1);
  });
});
