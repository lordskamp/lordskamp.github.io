import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(import.meta.dirname, '..');
const BOT_TOKEN = '123456:local_feature_tests_only';
const WEBHOOK_SECRET = 'local_feature_webhook_tests_only';
const clients = [];
let worker;
let origin;
let sandbox;
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
  sandbox = await mkdtemp(join(tmpdir(), 'hvylia-features-'));
  await mkdir(join(project, 'outputs/hvylia-site'), { recursive: true });
  const config = join(sandbox, 'wrangler.jsonc');
  await writeFile(config, JSON.stringify({
    name: 'hvylia-feature-integration-test',
    main: join(project, 'tests/fixtures/hvylia-feature-worker.mjs'),
    compatibility_date: '2026-10-04',
    compatibility_flags: ['nodejs_compat'],
    assets: { directory: join(project, 'outputs/hvylia-site'), binding: 'ASSETS', run_worker_first: true },
    durable_objects: { bindings: [
      { name: 'ROOMS', class_name: 'FeatureRoomDO' },
      { name: 'HVYLIA_ACCOUNTS', class_name: 'FeatureAccountDO' },
      { name: 'HVYLIA_LEADERBOARD', class_name: 'FeatureLeaderboardDO' },
      { name: 'HVYLIA_LOGINS', class_name: 'WaveLoginDO' }
    ] },
    migrations: [{ tag: 'test-v1', new_sqlite_classes: ['FeatureRoomDO', 'FeatureAccountDO', 'FeatureLeaderboardDO', 'WaveLoginDO'] }],
    vars: {
      SITE_ORIGIN: origin,
      ROOM_TTL_MS: '86400000',
      HVYLIA_BOT_TOKEN: BOT_TOKEN,
      HVYLIA_AUTH_SECRET: 'local_feature_auth_tests_32_bytes_minimum',
      HVYLIA_WEBHOOK_SECRET: WEBHOOK_SECRET,
      HVYLIA_BOT_USERNAME: 'local_feature_test_bot',
      HVYLIA_PAYMENT_SUPPORT: '@local_feature_support'
    }
  }));
  worker = spawn(process.execPath, [
    join(project, 'node_modules/wrangler/bin/wrangler.js'),
    'dev', '--config', config, '--local', '--port', String(port), '--ip', '127.0.0.1',
    '--inspector-port', String(inspector), '--persist-to', join(sandbox, 'storage'),
    '--show-interactive-dev-session=false', '--log-level', 'error'
  ], { cwd: project, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const collect = chunk => { output = (output + chunk.toString()).slice(-8000); };
  worker.stdout.on('data', collect);
  worker.stderr.on('data', collect);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(`Feature Worker exited during startup: ${output}`);
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).ok) return;
    } catch { /* Wait for the isolated local Worker to listen. */ }
    await delay(100);
  }
  throw new Error(`Feature Worker was not ready within 20 seconds: ${output}`);
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
  if (sandbox) {
    assert.equal(dirname(sandbox), resolve(tmpdir()));
    assert.match(sandbox.slice(dirname(sandbox).length + 1), /^hvylia-features-/u);
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function initData(userId, name = 'Український гравець', authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: `query-${userId}`,
    user: JSON.stringify({ id: userId, first_name: name, language_code: 'uk' })
  });
  const check = [...params.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

async function request(path, { body, token, telegram, profile, secret, requestOrigin, method = 'POST' } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(telegram ? { 'X-Telegram-Init-Data': telegram } : {}),
      ...(profile ? { 'X-Hvylia-Profile': profile } : {}),
      ...(requestOrigin ? { Origin: requestOrigin } : {}),
      ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(6000)
  });
  let data = null;
  if (response.status !== 204) {
    const raw = await response.text();
    try { data = JSON.parse(raw); }
    catch { throw new Error(`Non-JSON ${response.status} response from ${path}; isolated Worker output: ${output}`); }
  }
  return { status: response.status, data, headers: response.headers };
}

class PlayerClient {
  constructor(session, ticket) {
    this.session = session;
    this.state = null;
    this.packets = [];
    this.waiters = new Set();
    const url = new URL(`${origin.replace('http:', 'ws:')}/api/rooms/${session.code}/socket`);
    url.searchParams.set('ticket', ticket);
    this.socket = new globalThis.WebSocket(url);
    this.socket.addEventListener('open', () => {
      this.heartbeat = setInterval(() => {
        if (this.socket.readyState === 1) this.socket.send(JSON.stringify({ type: 'ping' }));
      }, 15000);
    });
    this.socket.addEventListener('message', event => {
      const packet = JSON.parse(event.data);
      this.packets.push(packet);
      if (packet.type === 'state') this.state = packet.state;
      for (const check of [...this.waiters]) check();
    });
    this.socket.addEventListener('error', () => {
      this.error = new Error('Feature WebSocket handshake failed');
      for (const check of [...this.waiters]) check();
    });
    this.socket.addEventListener('close', () => clearInterval(this.heartbeat));
    clients.push(this);
  }

  wait(predicate, label) {
    const initial = predicate();
    if (initial) return Promise.resolve(initial);
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`Timed out waiting for ${label}; phase ${this.state?.phase || 'none'}`));
      }, 6000);
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

  waitState(predicate) { return this.wait(() => this.state && predicate(this.state) && this.state, 'feature room state'); }

  action(action) {
    const id = randomUUID();
    const cursor = this.packets.length;
    this.socket.send(JSON.stringify({ type: 'action', id, action }));
    return this.wait(() => this.packets.slice(cursor).find(packet => packet.id === id && ['ack', 'error'].includes(packet.type)), `receipt for ${action.type}`);
  }

  async accept(action) {
    const receipt = await this.action(action);
    assert.equal(receipt.type, 'ack', `${action.type}: ${receipt.code || ''}`);
  }

  close() {
    clearInterval(this.heartbeat);
    if (this.socket.readyState <= 1) this.socket.close();
  }
}

async function connect(session) {
  const ticket = await request(`/api/rooms/${session.code}/socket-ticket`, { token: session.token });
  assert.equal(ticket.status, 200);
  const client = new PlayerClient(session, ticket.data.ticket);
  await client.waitState(state => state.you?.id === session.playerId);
  return client;
}

function sync(players, predicate) {
  return Promise.all(players.map(client => client.waitState(predicate)));
}

function assertPrivate(players, userIds = []) {
  for (const client of players) {
    const wire = JSON.stringify(client.state);
    assert.ok(!wire.includes('_accountId'));
    assert.ok(!wire.includes('_ratedRoster'));
    assert.ok(!wire.includes('_matchId'));
    assert.ok(!wire.includes('ownedPacks'));
    assert.ok(!wire.includes('SPECTRA'));
    assert.ok(!wire.includes(client.session.token));
    for (const userId of userIds) assert.ok(!wire.includes(String(userId)), 'Telegram ID must stay server-side');
    if (client.state.round && !client.state.round.revealed) {
      assert.equal(Object.hasOwn(client.state.round, 'target'), client.state.you.role === 'psychic');
    }
  }
}

async function formMatch(players, ranked) {
  const host = players[0];
  const invalid = await host.action({ type: 'settings', winScore: 6 });
  assert.equal(invalid.code, 'INVALID');
  await host.accept({ type: 'settings', winScore: 5 });
  for (let index = 0; index < players.length; index += 1) {
    await host.accept({ type: 'team', playerId: players[index].session.playerId, team: Math.floor(index / 2) });
  }
  for (const player of players) await player.accept({ type: 'ready', ready: true });
  await sync(players, state => state.players.every(player => player.ready));
  await host.accept({ type: 'start' });
  await sync(players, state => state.phase === 'PSYCHIC_VIEW');
  assert.equal(host.state.config.ranked, ranked);
  assert.equal(host.state.config.winScore, 5);
}

async function playPerfectMatch(players, packId, userIds = []) {
  const host = players[0];
  for (let round = 1; round <= 2; round += 1) {
    await sync(players, state => state.phase === 'PSYCHIC_VIEW' && state.round.number === round);
    assertPrivate(players, userIds);
    assert.equal(host.state.config.packId, packId);
    if (packId !== 'standard') assert.match(host.state.round.spectrum.id, new RegExp(`^${packId}-`, 'u'));
    const psychic = players.find(player => player.state.you.role === 'psychic');
    const guesser = players.find(player => player.state.you.role === 'guesser');
    const opponent = players.find(player => player.state.you.role === 'opponent');
    const roundId = psychic.state.round.id;
    const target = psychic.state.round.target;
    await psychic.accept({ type: 'clue', roundId, text: `Українська підказка ${round}` });
    await sync(players, state => state.phase === 'TEAM_GUESS');
    assertPrivate(players, userIds);
    await guesser.accept({ type: 'lock', roundId, position: target });
    await sync(players, state => state.phase === 'OPPONENT_BET');
    await opponent.accept({ type: 'bet', roundId, side: 'right' });
    await sync(players, state => ['SCORE', 'GAME_OVER'].includes(state.phase));
    assert.equal(host.state.round.result.activePoints, 4);
    if (round === 1) {
      assert.equal(host.state.phase, 'SCORE');
      await host.accept({ type: 'next', roundId });
    }
  }
  assert.equal(host.state.phase, 'GAME_OVER');
  assert.deepEqual(host.state.teams.map(team => team.score).sort((left, right) => left - right), [4, 5]);
  return host.state.winner;
}

test('verified Telegram profiles expose the 150-Star catalogue without accepting forged identities or purchases', async () => {
  const guest = await request('/api/hvylia/account', { method: 'GET' });
  assert.equal(guest.status, 200);
  assert.equal(guest.data.profile, null);
  assert.equal(guest.data.paymentReady, true);
  assert.deepEqual(guest.data.packs.map(pack => [pack.id, pack.priceStars, pack.owned]), [['standard', 0, true], ['anime', 150, false], ['games', 150, false]]);
  const userId = 910001;
  const signed = initData(userId, 'Гравець із Telegram');
  const verified = await request('/api/hvylia/account', { method: 'GET', telegram: signed });
  assert.equal(verified.status, 200);
  assert.match(verified.data.profile.publicId, /^[a-f0-9-]{36}$/u);
  assert.equal(verified.data.profile.name, 'Гравець із Telegram');
  assert.deepEqual(verified.data.profile.ownedPacks, []);
  assert.ok(!JSON.stringify(verified.data).includes(String(userId)));
  const tampered = new URLSearchParams(signed);
  tampered.set('user', JSON.stringify({ id: userId, first_name: 'Підробка' }));
  for (const telegram of [tampered.toString(), initData(userId, 'Гравець', Math.floor(Date.now() / 1000) - 13 * 60 * 60)]) {
    const rejected = await request('/api/hvylia/account', { method: 'GET', telegram });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.data.code, 'TELEGRAM_AUTH');
  }
  for (const telegram of [undefined, signed]) {
    const locked = await request('/api/rooms', { telegram, body: { name: 'Платний ведучий', packId: 'anime', ownedPacks: ['anime'], accountId: userId } });
    assert.equal(locked.status, 403);
    assert.equal(locked.data.code, 'PACK_LOCKED');
  }
  const invoice = await request('/api/hvylia/invoice', { body: { packId: 'anime' } });
  assert.equal(invoice.status, 401);
  assert.equal(invoice.data.code, 'TELEGRAM_AUTH');
});

test('a confirmed Stars receipt unlocks the host pack, admits guests, and remains idempotent', { timeout: 25000 }, async () => {
  const userId = 910001;
  const telegram = initData(userId, 'Гравець із Telegram');
  const seeded = await request('/__test/seed', { body: { userId, packId: 'anime' } });
  assert.equal(seeded.status, 200);
  assert.equal(seeded.data.amount, 150);
  const update = {
    update_id: 101,
    message: {
      from: { id: userId },
      successful_payment: {
        currency: 'XTR', total_amount: 150, invoice_payload: seeded.data.payload,
        telegram_payment_charge_id: 'local-feature-charge-101', provider_payment_charge_id: ''
      }
    }
  };
  const wrongSecret = await request('/api/hvylia/telegram-webhook', { secret: 'incorrect', body: update });
  assert.equal(wrongSecret.status, 403);
  assert.equal(wrongSecret.data.code, 'WEBHOOK_AUTH');
  const wrongAmount = structuredClone(update);
  wrongAmount.message.successful_payment.total_amount = 1;
  const rejected = await request('/api/hvylia/telegram-webhook', { secret: WEBHOOK_SECRET, body: wrongAmount });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.code, 'PAYMENT');
  const pending = await request('/api/hvylia/account', { method: 'GET', telegram });
  assert.deepEqual(pending.data.profile.ownedPacks, []);
  const accepted = await request('/api/hvylia/telegram-webhook', { secret: WEBHOOK_SECRET, body: update });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.ok, true);
  const purchased = await request('/api/hvylia/account', { method: 'GET', telegram });
  assert.deepEqual(purchased.data.profile.ownedPacks, ['anime']);
  assert.equal(purchased.data.packs.find(pack => pack.id === 'anime').owned, true);
  const replay = await request('/api/hvylia/telegram-webhook', { secret: WEBHOOK_SECRET, body: update });
  assert.equal(replay.status, 200);
  const duplicate = await request('/api/hvylia/account', { method: 'GET', telegram });
  assert.equal(duplicate.data.profile.revision, purchased.data.profile.revision);
  const history = await request('/__test/history', { body: { userId } });
  assert.equal(history.data.purchases.length, 1);
  assert.equal(history.data.purchases[0].status, 'paid');
  const created = await request('/api/rooms', { telegram, body: { name: 'Аніме ведучий', packId: 'anime' } });
  assert.equal(created.status, 201);
  const sessions = [created.data];
  for (const name of ['Аніме друг', 'Аніме суперник', 'Аніме напарник']) {
    const joined = await request(`/api/rooms/${created.data.code}/join`, { body: { name } });
    assert.equal(joined.status, 200);
    sessions.push(joined.data);
  }
  const players = [];
  for (const session of sessions) players.push(await connect(session));
  await sync(players, state => state.players.length === 4 && state.players.every(player => player.connected));
  const locked = await players[0].action({ type: 'settings', packId: 'games' });
  assert.equal(locked.code, 'PACK_LOCKED');
  assert.equal(players[0].state.config.packId, 'anime');
  await formMatch(players, false);
  await playPerfectMatch(players, 'anime', [userId]);
  await request('/__test/flush', { body: { code: created.data.code } });
  const finalProfile = await request('/api/hvylia/account', { method: 'GET', telegram });
  assert.equal(finalProfile.data.profile.stats.played, 0, 'A match with anonymous guests is friendly');
  const leaders = await request('/api/hvylia/leaderboard', { method: 'GET' });
  assert.equal(leaders.data.entries.length, 0);
  for (const player of players) player.close();
});

test('four distinct verified players earn network wins once per match and rematch starts a new receipt', { timeout: 30000 }, async () => {
  const userIds = [920001, 920002, 920003, 920004];
  const names = ['Рейтинг Олена', 'Рейтинг Марко', 'Рейтинг Леся', 'Рейтинг Тарас'];
  const signed = userIds.map((id, index) => initData(id, names[index]));
  const created = await request('/api/rooms', { telegram: signed[0], body: { name: names[0] } });
  assert.equal(created.status, 201);
  const code = created.data.code;
  const sessions = [created.data];
  for (let index = 1; index < userIds.length; index += 1) {
    const joined = await request(`/api/rooms/${code}/join`, { telegram: signed[index], body: { name: names[index] } });
    assert.equal(joined.status, 200);
    sessions.push(joined.data);
  }
  const sameIdentity = await request(`/api/rooms/${code}/join`, { telegram: signed[1], body: { name: 'Інший нікнейм' } });
  assert.equal(sameIdentity.status, 200);
  assert.equal(sameIdentity.data.playerId, sessions[1].playerId);
  assert.equal(sameIdentity.data.state.players.length, 4);
  const wrongIdentity = await request(`/api/rooms/${code}/resume`, { token: sessions[0].token, telegram: signed[1] });
  assert.equal(wrongIdentity.status, 403);
  assert.equal(wrongIdentity.data.code, 'SESSION');
  const players = [];
  for (const session of sessions) players.push(await connect(session));
  await sync(players, state => state.players.every(player => player.connected));
  await formMatch(players, true);
  assertPrivate(players, userIds);
  const firstWinner = await playPerfectMatch(players, 'standard', userIds);
  await request('/__test/flush', { body: { code } });
  const first = await request('/api/hvylia/leaderboard', { method: 'GET' });
  assert.equal(first.status, 200);
  assert.equal(first.data.entries.length, 4);
  assert.deepEqual(first.data.entries.map(entry => entry.wins), [1, 1, 0, 0]);
  assert.ok(first.data.entries.every(entry => entry.played === 1));
  assert.ok(first.data.entries.every(entry => entry.wins + entry.losses === entry.played));
  assert.ok(!JSON.stringify(first.data).includes('telegram_id'));
  for (const id of userIds) assert.ok(!JSON.stringify(first.data).includes(String(id)));
  for (let index = 0; index < userIds.length; index += 1) {
    const entry = first.data.entries.find(item => item.name === names[index]);
    assert.equal(entry.wins, Math.floor(index / 2) === firstWinner ? 1 : 0);
  }
  await request('/__test/flush', { body: { code } });
  const unchanged = await request('/api/hvylia/leaderboard', { method: 'GET' });
  assert.deepEqual(unchanged.data.entries, first.data.entries);
  await players[0].accept({ type: 'rematch' });
  await sync(players, state => state.phase === 'LOBBY' && !state.config.ranked);
  for (const player of players) await player.accept({ type: 'ready', ready: true });
  await players[0].accept({ type: 'start' });
  await sync(players, state => state.phase === 'PSYCHIC_VIEW' && state.config.ranked);
  await playPerfectMatch(players, 'standard', userIds);
  await request('/__test/flush', { body: { code } });
  const second = await request('/api/hvylia/leaderboard', { method: 'GET' });
  assert.equal(second.data.entries.length, 4);
  assert.ok(second.data.entries.every(entry => entry.played === 2));
  assert.equal(second.data.entries.reduce((sum, entry) => sum + entry.wins, 0), 4);
  for (const userId of userIds) {
    const history = await request('/__test/history', { body: { userId } });
    assert.equal(history.data.matches.length, 2);
    assert.notEqual(history.data.matches[0].id, history.data.matches[1].id);
  }
  for (const player of players) player.close();
});

test('expired room retries an interrupted ranking delivery after deletion without counting its match twice', async () => {
  const userId = 930001;
  const telegram = initData(userId, 'Рейтинг після закриття');
  const created = await request('/api/rooms', { telegram, body: { name: 'Пізній рейтинг' } });
  assert.equal(created.status, 201);
  const code = created.data.code;
  const account = await request('/api/hvylia/account', { method: 'GET', telegram });
  assert.equal(account.status, 200);
  const publicId = account.data.profile.publicId;
  const receipt = { matchId: randomUUID(), won: true, points: 5, packId: 'standard', finishedAt: Date.now(), name: 'Пізній рейтинг' };

  const unavailable = await request('/__test/unavailable', { body: { value: true } });
  assert.equal(unavailable.status, 200);
  const enqueue = await request('/__test/outbox', { body: { code, userId, receipt } });
  assert.equal(enqueue.status, 200);
  const pending = await request('/__test/pending', { body: { code } });
  assert.deepEqual([pending.data.pending, pending.data.roomRows], [1, 1]);
  const expired = await request('/__test/alarm', { body: { code } });
  assert.equal(expired.status, 200);
  assert.deepEqual([expired.data.pending, expired.data.roomRows], [1, 0]);
  assert.ok(expired.data.alarmAt > Date.now(), 'A deleted room must schedule its pending ranking retry');
  assert.ok(expired.data.alarmAt <= Date.now() + 11000, 'The retry must replace the expired room deadline with the 10-second delivery retry');
  const interrupted = await request('/api/hvylia/account', { method: 'GET', telegram });
  assert.deepEqual(interrupted.data.profile.stats, { wins: 1, losses: 0, played: 1, points: 5 });
  const beforeRetry = await request('/api/hvylia/leaderboard', { method: 'GET' });
  assert.ok(!beforeRetry.data.entries.some(entry => entry.publicId === publicId), 'Account commit precedes the interrupted global index update');
  const missing = await request(`/api/rooms/${code}/resume`, { token: created.data.token, telegram });
  assert.equal(missing.status, 404);
  assert.equal(missing.data.code, 'NOT_FOUND');

  await request('/__test/unavailable', { body: { value: false } });
  const retried = await request('/__test/alarm', { body: { code } });
  assert.equal(retried.status, 200);
  assert.deepEqual([retried.data.pending, retried.data.roomRows], [0, 0]);
  const afterRetry = await request('/api/hvylia/leaderboard', { method: 'GET' });
  const entry = afterRetry.data.entries.find(item => item.publicId === publicId);
  assert.ok(entry);
  assert.deepEqual([entry.wins, entry.losses, entry.played, entry.points], [1, 0, 1, 5]);

  // Replay the same durable receipt after cleanup, rather than only invoking an
  // empty alarm: account and index RPCs must both remain idempotent.
  await request('/__test/outbox', { body: { code, userId, receipt } });
  const repeated = await request('/__test/alarm', { body: { code } });
  assert.equal(repeated.status, 200);
  assert.deepEqual([repeated.data.pending, repeated.data.roomRows], [0, 0]);
  const finalAccount = await request('/api/hvylia/account', { method: 'GET', telegram });
  assert.equal(finalAccount.data.profile.revision, interrupted.data.profile.revision);
  assert.deepEqual(finalAccount.data.profile.stats, interrupted.data.profile.stats);
  const finalIndex = await request('/api/hvylia/leaderboard', { method: 'GET' });
  assert.deepEqual(finalIndex.data.entries, afterRetry.data.entries);
  const history = await request('/__test/history', { body: { userId } });
  assert.equal(history.data.matches.length, 1);
  assert.equal(history.data.matches[0].id, receipt.matchId);
});

async function guestProfile(name, profile) {
  const registered = await request('/api/hvylia/auth/guest', { profile, body: { name } });
  assert.equal(registered.status, 200);
  assert.equal(registered.data.profile.kind, 'guest');
  assert.equal(registered.data.identityType, 'nickname');
  return registered.data;
}

test('nickname credentials persist independent stats, allow renaming, enforce account ownership and require Telegram for purchases', async () => {
  const first = await guestProfile('Самостійний нік');
  assert.ok(first.expiresAt > Date.now() + 364 * 86400000);
  const reopened = await request('/api/hvylia/account', { method: 'GET', profile: first.token });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.identityType, 'nickname');
  assert.equal(reopened.data.profile.publicId, first.profile.publicId);
  const renamed = await guestProfile('Новий нік', first.token);
  assert.equal(renamed.profile.publicId, first.profile.publicId);
  assert.equal(renamed.profile.name, 'Новий нік');
  const other = await guestProfile('Новий нік');
  assert.notEqual(other.profile.publicId, renamed.profile.publicId, 'A nickname is not somebody else’s credential');
  const invoice = await request('/api/hvylia/invoice', { profile: renamed.token, body: { packId: 'anime' } });
  assert.equal(invoice.status, 401);
  assert.equal(invoice.data.code, 'TELEGRAM_REQUIRED');
  const locked = await request('/api/rooms', { profile: renamed.token, body: { name: 'Платний нік', packId: 'anime', ownedPacks: ['anime'] } });
  assert.equal(locked.status, 403);
  assert.equal(locked.data.code, 'PACK_LOCKED');
  const forged = await request('/api/hvylia/account', { method: 'GET', profile: `${renamed.token}tampered` });
  assert.equal(forged.status, 401);
  assert.equal(forged.data.code, 'TELEGRAM_AUTH');
  const created = await request('/api/rooms', { profile: renamed.token, body: { name: 'Новий нік' } });
  assert.equal(created.status, 201);
  const wrongIdentity = await request(`/api/rooms/${created.data.code}/resume`, { profile: other.token, token: created.data.token });
  assert.equal(wrongIdentity.status, 403);
  assert.equal(wrongIdentity.data.code, 'SESSION');
  const resumed = await request(`/api/rooms/${created.data.code}/resume`, { profile: renamed.token, token: created.data.token });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.playerId, created.data.playerId);
});

test('bot-code browser login verifies the bound secret and one-time code and supports authenticated CORS requests', async () => {
  const start = await request('/api/hvylia/auth/telegram/start', { body: {}, requestOrigin: origin });
  assert.equal(start.status, 200);
  assert.match(start.data.loginId, /^[a-f0-9]{48}$/u);
  assert.match(start.data.secret, /^[a-f0-9]{48}$/u);
  assert.equal(new URL(start.data.url).searchParams.get('start'), `login_${start.data.loginId}`);
  assert.equal(start.data.url.includes(start.data.secret), false);
  assert.equal(start.headers.get('Access-Control-Allow-Origin'), origin);
  const body = { loginId: start.data.loginId, secret: start.data.secret, code: '000000' };
  const pending = await request('/api/hvylia/auth/telegram/finish', { body });
  assert.equal(pending.status, 401);
  assert.equal(pending.data.code, 'LOGIN_PENDING');
  const user = { id: 940001, first_name: 'Браузер Олена' };
  const attached = await request('/__test/login/attach', { body: { loginId: body.loginId, user } });
  assert.equal(attached.status, 200);
  assert.match(attached.data.code, /^\d{6}$/u);
  const wrongOwner = await request('/__test/login/attach', { body: { loginId: body.loginId, user: { ...user, id: user.id + 1 } } });
  assert.equal(wrongOwner.status, 401);
  assert.equal(wrongOwner.data.code, 'LOGIN_OWNER');
  const wrongSecret = await request('/api/hvylia/auth/telegram/finish', { body: { ...body, secret: 'ef'.repeat(24), code: attached.data.code } });
  assert.equal(wrongSecret.status, 401);
  assert.equal(wrongSecret.data.code, 'LOGIN_SECRET');
  const wrongCode = await request('/api/hvylia/auth/telegram/finish', { body: { ...body, code: 'invalid' } });
  assert.equal(wrongCode.status, 401);
  assert.equal(wrongCode.data.code, 'LOGIN_CODE');
  const finished = await request('/api/hvylia/auth/telegram/finish', { body: { ...body, code: attached.data.code }, requestOrigin: origin });
  assert.equal(finished.status, 200);
  assert.equal(finished.data.identityType, 'telegram');
  assert.equal(finished.data.profile.name, user.first_name);
  assert.equal(finished.data.profile.kind, 'telegram');
  assert.ok(!JSON.stringify(finished.data.profile).includes(String(user.id)));
  const repeated = await request('/api/hvylia/auth/telegram/finish', { body: { ...body, code: attached.data.code } });
  assert.equal(repeated.status, 401);
  assert.equal(repeated.data.code, 'LOGIN_USED');
  const native = await request('/api/hvylia/account', { method: 'GET', telegram: initData(user.id, user.first_name) });
  const browser = await request('/api/hvylia/account', { method: 'GET', profile: finished.data.token, requestOrigin: origin });
  assert.equal(browser.status, 200);
  assert.equal(browser.data.profile.publicId, native.data.profile.publicId);
  assert.equal(browser.headers.get('Access-Control-Allow-Origin'), origin);
  const preflight = await request('/api/hvylia/account', { method: 'OPTIONS', requestOrigin: origin });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /X-Hvylia-Profile/u);
  const blockedOrigin = await request('/api/hvylia/account', { method: 'GET', profile: finished.data.token, requestOrigin: 'https://unrelated.example' });
  assert.equal(blockedOrigin.status, 403);
  assert.equal(blockedOrigin.data.code, 'ORIGIN');
  const room = await request('/api/rooms', { profile: finished.data.token, body: { name: 'Браузерна Олена' } });
  assert.equal(room.status, 201);
});

test('real bot-code login caps bad attempts and preserves that cap when requesting a new code', async () => {
  const start = await request('/api/hvylia/auth/telegram/start', { body: {} });
  const loginId = start.data.loginId;
  const user = { id: 940002, first_name: 'Код Марко' };
  const attached = await request('/__test/login/attach', { body: { loginId, user } });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const invalid = await request('/api/hvylia/auth/telegram/finish', { body: { loginId, secret: start.data.secret, code: 'wrong' } });
    assert.equal(invalid.status, attempt === 4 ? 429 : 401);
    assert.equal(invalid.data.code, attempt === 4 ? 'LOGIN_LOCKED' : 'LOGIN_CODE');
    if (attempt === 1) {
      const resent = await request('/__test/login/attach', { body: { loginId, user } });
      assert.equal(resent.status, 200);
    }
  }
  const validAfterLock = await request('/api/hvylia/auth/telegram/finish', { body: { loginId, secret: start.data.secret, code: attached.data.code } });
  assert.equal(validAfterLock.status, 429);
  assert.equal(validAfterLock.data.code, 'LOGIN_LOCKED');
  const resendAfterLock = await request('/__test/login/attach', { body: { loginId, user } });
  assert.equal(resendAfterLock.status, 429);
});

test('nickname players earn wins exactly once while late joiners enter the smaller team without earning the ongoing match', { timeout: 30000 }, async () => {
  const names = ['Нік Олена', 'Нік Марко', 'Нік Леся', 'Нік Тарас', 'Пізня Оксана', 'Пізній Петро'];
  const profiles = [];
  for (const name of names) profiles.push(await guestProfile(name));
  const created = await request('/api/rooms', { profile: profiles[0].token, body: { name: names[0] } });
  const code = created.data.code;
  const sessions = [created.data];
  for (let index = 1; index < 4; index += 1) {
    const joined = await request(`/api/rooms/${code}/join`, { profile: profiles[index].token, body: { name: names[index] } });
    assert.equal(joined.status, 200);
    sessions.push(joined.data);
  }
  const players = [];
  for (const session of sessions) players.push(await connect(session));
  await sync(players, state => state.players.every(player => player.connected));
  await formMatch(players, true);
  const psychic = players.find(client => client.state.you.role === 'psychic');
  const before = structuredClone(psychic.state.round);
  for (let index = 4; index < 6; index += 1) {
    const joined = await request(`/api/rooms/${code}/join`, { profile: profiles[index].token, body: { name: names[index] } });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.state.you.role, 'spectator');
    assert.equal(Object.hasOwn(joined.data.state.round, 'target'), false);
    const newcomer = await connect(joined.data);
    players.push(newcomer);
    await sync(players, state => state.players.length === index + 1 && state.players.every(player => player.connected));
    if (index === 5) {
      const wrongTeam = await newcomer.action({ type: 'team', team: 0 });
      assert.equal(wrongTeam.type, 'error');
      assert.equal(wrongTeam.code, 'TEAM_BALANCE');
    }
    await newcomer.accept({ type: 'team', team: index === 4 ? 0 : 1 });
    await sync(players, state => state.players.find(player => player.id === newcomer.session.playerId)?.team === (index === 4 ? 0 : 1));
    assert.deepEqual(psychic.state.round, before);
    assert.equal(psychic.state.phase, 'PSYCHIC_VIEW');
    assert.equal(psychic.state.config.ranked, true);
    assertPrivate(players);
  }
  const winner = await playPerfectMatch(players, 'standard');
  await request('/__test/flush', { body: { code } });
  const rankings = await request('/api/hvylia/leaderboard', { method: 'GET' });
  for (let index = 0; index < profiles.length; index += 1) {
    const profile = await request('/api/hvylia/account', { method: 'GET', profile: profiles[index].token });
    assert.equal(profile.status, 200);
    assert.equal(profile.data.profile.publicId, profiles[index].profile.publicId);
    assert.equal(profile.data.profile.stats.played, index < 4 ? 1 : 0);
    if (index < 4) {
      assert.equal(profile.data.profile.stats.wins, Math.floor(index / 2) === winner ? 1 : 0);
      assert.ok(rankings.data.entries.some(entry => entry.publicId === profile.data.profile.publicId && entry.name === names[index]));
    } else assert.ok(!rankings.data.entries.some(entry => entry.publicId === profile.data.profile.publicId));
  }
  await request('/__test/flush', { body: { code } });
  const repeated = await request('/api/hvylia/leaderboard', { method: 'GET' });
  assert.deepEqual(repeated.data.entries, rankings.data.entries);
  const previousEntry = rankings.data.entries.find(entry => entry.publicId === profiles[0].profile.publicId);
  const renamed = await guestProfile('Нік Олена оновлена', profiles[0].token);
  assert.equal(renamed.profile.publicId, previousEntry.publicId);
  assert.deepEqual(renamed.profile.stats, { wins: previousEntry.wins, losses: previousEntry.losses, played: previousEntry.played, points: previousEntry.points });
  const afterRename = await request('/api/hvylia/leaderboard', { method: 'GET' });
  assert.equal(afterRename.data.entries.length, rankings.data.entries.length);
  assert.deepEqual(afterRename.data.entries.find(entry => entry.publicId === previousEntry.publicId), { ...previousEntry, name: 'Нік Олена оновлена' });
  const repeatedRename = await guestProfile('Нік Олена оновлена', profiles[0].token);
  assert.equal(repeatedRename.profile.revision, renamed.profile.revision);
  const remembered = await request('/api/hvylia/account', { method: 'GET', profile: renamed.token });
  assert.equal(remembered.data.profile.name, 'Нік Олена оновлена');
  assert.deepEqual(remembered.data.profile.stats, renamed.profile.stats);
  for (const player of players) player.close();
});

test('a match containing players without a profile remains unranked even when nickname profiles participate', { timeout: 20000 }, async () => {
  const first = await guestProfile('Дружня Олена');
  const second = await guestProfile('Дружній Марко');
  const created = await request('/api/rooms', { profile: first.token, body: { name: 'Дружня Олена' } });
  const sessions = [created.data];
  const guests = [{ name: 'Дружній Марко', profile: second.token }, { name: 'Без профілю Леся' }, { name: 'Без профілю Тарас' }];
  for (const guest of guests) {
    const joined = await request(`/api/rooms/${created.data.code}/join`, { profile: guest.profile, body: { name: guest.name } });
    assert.equal(joined.status, 200);
    sessions.push(joined.data);
  }
  const players = [];
  for (const session of sessions) players.push(await connect(session));
  await sync(players, state => state.players.every(player => player.connected));
  await formMatch(players, false);
  await playPerfectMatch(players, 'standard');
  await request('/__test/flush', { body: { code: created.data.code } });
  for (const profile of [first, second]) {
    const refreshed = await request('/api/hvylia/account', { method: 'GET', profile: profile.token });
    assert.equal(refreshed.data.profile.stats.played, 0);
  }
  for (const player of players) player.close();
});

test('a replacement socket survives stale close and alarm callbacks and heals false disconnection on ping or action', { timeout: 15000 }, async () => {
  const created = await request('/api/rooms', { body: { name: 'Відновлення' } });
  const session = created.data;
  const first = await connect(session);
  const before = await request('/__test/connection/status', { body: { code: session.code, playerId: session.playerId } });
  const replacement = await connect(session);
  await first.wait(() => first.packets.find(packet => packet.type === 'replaced'), 'replacement notice');
  const current = await request('/__test/connection/status', { body: { code: session.code, playerId: session.playerId } });
  assert.notEqual(current.data.connectionId, before.data.connectionId);
  const stale = await request('/__test/connection/stale-close', { body: { code: session.code, playerId: session.playerId, connectionId: before.data.connectionId } });
  assert.equal(stale.data.connected, true);
  assert.equal(stale.data.connectionId, current.data.connectionId);
  const expired = await request('/__test/connection/expired', { body: { code: session.code, playerId: session.playerId } });
  assert.equal(expired.status, 200);
  assert.equal(expired.data.expiredSocketBefore, 1);
  assert.ok([2, 3].includes(expired.data.expiredSocketAfter), 'The real alarm closes the stale socket');
  assert.equal(expired.data.connected, true);
  assert.equal(expired.data.connectionId, current.data.connectionId);
  for (const mode of ['ping', 'action']) {
    const falsePresence = await request('/__test/connection/false', { body: { code: session.code, playerId: session.playerId } });
    assert.equal(falsePresence.data.connected, false);
    await replacement.waitState(state => state.players.find(player => player.id === session.playerId)?.connected === false);
    if (mode === 'ping') {
      const cursor = replacement.packets.length;
      replacement.socket.send(JSON.stringify({ type: 'ping' }));
      await replacement.wait(() => replacement.packets.slice(cursor).some(packet => packet.type === 'pong'), 'healing pong');
    } else await replacement.accept({ type: 'settings', winScore: 15 });
    await replacement.waitState(state => state.players.find(player => player.id === session.playerId)?.connected === true);
    const healed = await request('/__test/connection/status', { body: { code: session.code, playerId: session.playerId } });
    assert.equal(healed.data.connected, true);
    assert.equal(healed.data.connectionId, current.data.connectionId);
    assert.equal(replacement.socket.readyState, 1);
  }
  replacement.close();
});
