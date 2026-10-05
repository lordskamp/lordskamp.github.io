import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { t as locale } from '../hvylia/locale.js';

const EventTarget = globalThis.EventTarget;
const Event = globalThis.Event;

// Inject the browser surfaces without changing production imports or global DOM.
const source = (await readFile(new URL('../hvylia/transport.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gmu, '')
  .replace(/\bexport\s+/gu, '');
const { default: createModule } = await import(`data:text/javascript;base64,${Buffer.from(`export default function(window, document, telegramHeaders, telegramReady, t) { ${source}\nreturn { RoomTransport, savedSession, lastRoom }; }`).toString('base64')}`);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

class Clock {
  now = 100_000;
  serial = 0;
  tasks = new Map();
  set(callback, delay, interval = false) {
    const id = ++this.serial;
    this.tasks.set(id, { callback, at: this.now + delay, interval: interval ? delay : null });
    return id;
  }
  clear(id) { this.tasks.delete(id); }
  tick(delay) {
    const end = this.now + delay;
    for (;;) {
      const next = [...this.tasks].filter(([, task]) => task.at <= end).sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      const [id, task] = next;
      this.now = task.at;
      if (task.interval === null) this.tasks.delete(id);
      else task.at += task.interval;
      task.callback();
    }
    this.now = end;
  }
}

function harness(t) {
  const clock = new Clock();
  t.mock.method(Date, 'now', () => clock.now);
  t.mock.method(Math, 'random', () => 0);
  const window = new EventTarget();
  const document = new EventTarget();
  document.hidden = false;
  document.querySelector = () => null;
  window.location = { hostname: 'localhost', origin: 'http://localhost:8787' };
  const storage = new Map();
  window.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  window.setTimeout = (callback, delay) => clock.set(callback, delay);
  window.clearTimeout = id => clock.clear(id);
  window.setInterval = (callback, delay) => clock.set(callback, delay, true);
  window.clearInterval = id => clock.clear(id);
  window.AbortSignal = { timeout: () => ({}) };
  let serial = 0;
  window.crypto = { randomUUID: () => `action-${++serial}` };
  const requests = [], ticketResponses = [], sockets = [];
  const ok = data => ({ ok: true, json: async () => data });
  window.fetch = async (url, options) => {
    requests.push({ url, options });
    const queued = ticketResponses.shift();
    return queued ? queued : ok({ ticket: `ticket-${requests.length}` });
  };
  window.WebSocket = class extends EventTarget {
    readyState = 0;
    sent = [];
    constructor(url) { super(); this.url = String(url); sockets.push(this); }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    message(value) { this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(value) })); }
    send(value) {
      if (this.readyState !== 1) throw new Error('Socket is closed');
      this.sent.push(JSON.parse(value));
    }
    close(code = 1000) { this.readyState = 3; this.dispatchEvent(Object.assign(new Event('close'), { code })); }
  };
  const states = [], statuses = [], errors = [];
  const { RoomTransport } = createModule(window, document, () => ({}), Promise.resolve(), locale);
  const transport = new RoomTransport({ state: state => states.push(state), status: status => statuses.push(status), error: error => errors.push(error) });
  t.after(() => transport.close());
  return {
    transport, clock, window, document, requests, sockets, states, statuses, errors, ok,
    holdTicket() { const held = deferred(); ticketResponses.push(held.promise); return held; },
    async attach(code = 'TEST') {
      transport.attach({ code, playerId: 'player', token: `room-token-${code}`, state: { code, revision: 1 } });
      await flush();
    },
    async connect(code = 'TEST') {
      await this.attach(code);
      const socket = sockets.at(-1);
      socket.open(); socket.message({ type: 'state', state: { code, revision: 2 } });
      await flush();
      return socket;
    },
    async tick(delay) { clock.tick(delay); await flush(); },
    wake(type) {
      const event = new Event(type);
      if (type === 'pageshow') event.persisted = true;
      (type === 'visibilitychange' ? document : window).dispatchEvent(event);
    }
  };
}

test('closing a pending connection and attaching another room ignores an old successful ticket', async t => {
  const run = harness(t);
  const old = run.holdTicket();
  await run.attach('OLD1');
  run.transport.close();
  const current = run.holdTicket();
  await run.attach('NEW2');
  assert.equal(run.requests.length, 2, 'a pending request from the previous room must not block a new connection');
  old.resolve(run.ok({ ticket: 'abandoned-ticket' }));
  await flush();
  assert.equal(run.sockets.length, 0);
  current.resolve(run.ok({ ticket: 'current-ticket' }));
  await flush();
  assert.equal(run.sockets.length, 1);
  assert.match(run.sockets[0].url, /\/rooms\/NEW2\/socket\?ticket=current-ticket$/u);
  run.sockets[0].open();
  run.sockets[0].message({ type: 'state', state: { code: 'NEW2', revision: 3 } });
  assert.equal(run.statuses.at(-1), 'connected');
  assert.equal(run.states.at(-1).code, 'NEW2');
});

test('a stale failed ticket cannot expire the newly attached room', async t => {
  const run = harness(t);
  const old = run.holdTicket();
  await run.attach('OLD1');
  const current = run.holdTicket();
  await run.attach('NEW2');
  old.resolve({ ok: false, json: async () => ({ code: 'SESSION', message: 'Стара сесія' }) });
  await flush();
  assert.equal(run.errors.length, 0);
  assert.equal(run.statuses.at(-1), 'connecting');
  current.resolve(run.ok({ ticket: 'current' }));
  await flush();
  run.sockets[0].open();
  run.sockets[0].message({ type: 'state', state: { code: 'NEW2', revision: 3 } });
  assert.equal(run.statuses.at(-1), 'connected');
});

test('the socket becomes playable after an authoritative state, and obsolete socket callbacks are ignored', async t => {
  const run = harness(t);
  await run.attach();
  const old = run.sockets[0];
  old.open();
  old.message({ type: 'pong' });
  assert.equal(run.statuses.includes('connected'), false);
  old.message({ type: 'state', state: { code: 'TEST', revision: 3 } });
  assert.equal(run.statuses.at(-1), 'connected');
  await run.attach('NEXT');
  old.message({ type: 'state', state: { code: 'TEST', revision: 999 } });
  old.message({ type: 'error', code: 'SESSION', message: 'Стара сесія' });
  old.dispatchEvent(new Event('error'));
  assert.equal(run.states.at(-1).code, 'NEXT');
  assert.equal(run.errors.length, 0);
  assert.equal(run.requests.length, 2);
  const current = run.sockets[1];
  current.open(); current.message({ type: 'state', state: { code: 'NEXT', revision: 2 } });
  const action = run.transport.action({ type: 'ready', ready: true });
  const sent = current.sent.find(message => message.type === 'action');
  current.message({ type: 'ack', id: sent.id });
  await action;
});

test('navigation inside a state callback cannot make the next room playable before its handshake', async t => {
  const run = harness(t);
  await run.attach('OLD1');
  const old = run.sockets[0];
  old.open();
  const nextTicket = run.holdTicket();
  const onState = run.transport.callbacks.state;
  run.transport.callbacks.state = state => {
    onState(state);
    if (state.code === 'OLD1' && state.revision === 3) {
      run.transport.attach({ code: 'NEW2', playerId: 'player', token: 'new-token', state: { code: 'NEW2', revision: 1 } });
    }
  };
  old.message({ type: 'state', state: { code: 'OLD1', revision: 3 } });
  await flush();
  assert.equal(run.states.at(-1).code, 'NEW2');
  assert.equal(run.statuses.at(-1), 'connecting');
  nextTicket.resolve(run.ok({ ticket: 'new-ticket' }));
  await flush();
  const current = run.sockets[1];
  current.open();
  assert.equal(run.statuses.at(-1), 'connecting');
  current.message({ type: 'state', state: { code: 'NEW2', revision: 2 } });
  assert.equal(run.statuses.at(-1), 'connected');
});

test('a transient ticket network failure retries automatically and reconnects without a reload', async t => {
  const run = harness(t);
  const ticket = run.holdTicket();
  await run.attach();
  ticket.reject(new Error('Network connection was lost'));
  await flush();
  assert.equal(run.statuses.at(-1), 'offline');
  assert.equal(run.errors.length, 0);
  await run.tick(400);
  assert.equal(run.requests.length, 2);
  const socket = run.sockets[0];
  socket.open(); socket.message({ type: 'state', state: { code: 'TEST', revision: 2 } });
  assert.equal(run.statuses.at(-1), 'connected');
});

test('a lost acknowledgment replays the same action ID only after reconnect receives current state', async t => {
  const run = harness(t);
  const old = await run.connect();
  const completion = run.transport.action({ type: 'lock', position: 37, roundId: 'round-2' });
  const sent = old.sent.find(message => message.type === 'action');
  old.close(1006);
  await run.tick(400);
  const current = run.sockets[1];
  current.open();
  assert.equal(current.sent.some(message => message.type === 'action'), false);
  old.message({ type: 'ack', id: sent.id });
  current.message({ type: 'state', state: { code: 'TEST', revision: 5 } });
  assert.deepEqual(current.sent.filter(message => message.type === 'action'), [sent]);
  current.message({ type: 'ack', id: sent.id });
  await completion;
  await run.tick(20_000);
  assert.equal(run.errors.length, 0);
  assert.equal(run.statuses.at(-1), 'connected');
});

test('a DISCONNECTED response automatically reconnects and retries the pending command without a reload', async t => {
  const run = harness(t);
  const old = await run.connect();
  const completion = run.transport.action({ type: 'clue', text: 'Нічний потяг', roundId: 'round-2' });
  const sent = old.sent.find(message => message.type === 'action');
  let settled = false;
  completion.then(() => { settled = true; }, () => { settled = true; });
  old.message({ type: 'error', id: sent.id, code: 'DISCONNECTED', message: 'Підключення втрачено.' });
  await flush();
  assert.equal(settled, false);
  assert.equal(run.errors.length, 0);
  assert.equal(run.requests.length, 2);
  const current = run.sockets[1];
  current.open(); current.message({ type: 'state', state: { code: 'TEST', revision: 4 } });
  assert.deepEqual(current.sent.filter(message => message.type === 'action'), [sent]);
  current.message({ type: 'ack', id: sent.id });
  await completion;
  assert.equal(settled, true);
  assert.equal(run.statuses.at(-1), 'connected');
});

for (const event of ['online', 'pageshow', 'visibilitychange']) {
  test(`${event} repairs a stale socket immediately instead of waiting for a refresh`, async t => {
    const run = harness(t);
    const old = await run.connect();
    await run.tick(26_000);
    run.wake(event);
    await flush();
    assert.equal(old.readyState, 3);
    assert.equal(run.sockets.length, 2);
    const current = run.sockets[1];
    current.open(); current.message({ type: 'state', state: { code: 'TEST', revision: 4 } });
    assert.equal(run.statuses.at(-1), 'connected');
  });
}

test('background watchdog timers keep a hidden phone tab intact and reconnect when it becomes visible', async t => {
  const run = harness(t);
  const old = await run.connect();
  run.document.hidden = true;
  run.wake('visibilitychange');
  await run.tick(120_000);
  assert.equal(old.readyState, 1);
  assert.equal(run.sockets.length, 1);
  assert.equal(run.requests.length, 1);
  assert.deepEqual(old.sent, [], 'hidden intervals should neither close the socket nor queue pings');
  run.document.hidden = false;
  run.wake('visibilitychange');
  await flush();
  assert.equal(old.readyState, 3);
  assert.equal(run.sockets.length, 2);
});

test('a socket that never delivers its initial state is replaced after the handshake deadline', async t => {
  const run = harness(t);
  await run.attach();
  const old = run.sockets[0];
  old.open();
  await run.tick(10_000);
  assert.equal(old.readyState, 3);
  assert.equal(run.sockets.length, 2);
  old.message({ type: 'state', state: { code: 'TEST', revision: 999 } });
  assert.equal(run.statuses.includes('connected'), false);
  const current = run.sockets[1];
  current.open(); current.message({ type: 'state', state: { code: 'TEST', revision: 3 } });
  assert.equal(run.statuses.at(-1), 'connected');
  assert.equal(run.states.at(-1).revision, 3);
});

test('permanent session expiration rejects pending actions and stops timers and browser wakeups', async t => {
  const run = harness(t);
  const socket = await run.connect();
  const pending = run.transport.action({ type: 'ready', ready: true });
  const rejected = assert.rejects(pending, error => error.code === 'SESSION');
  socket.message({ type: 'error', code: 'SESSION', message: 'Сесію завершено.' });
  await rejected;
  assert.equal(socket.readyState, 3);
  assert.equal(run.statuses.at(-1), 'expired');
  assert.equal(run.errors.length, 1);
  await run.tick(120_000);
  run.wake('online'); run.wake('pageshow'); run.wake('visibilitychange');
  await flush();
  assert.equal(run.requests.length, 1);
  assert.equal(run.clock.tasks.size, 0);
  assert.equal(run.statuses.at(-1), 'expired');
});

test('a permanent ticket error stops reconnecting before creating a socket', async t => {
  const run = harness(t);
  const ticket = run.holdTicket();
  await run.attach();
  ticket.resolve({ ok: false, json: async () => ({ code: 'KICKED', message: 'Ведучий видалив вас.' }) });
  await flush();
  assert.equal(run.statuses.at(-1), 'expired');
  await run.tick(120_000);
  run.wake('online');
  await flush();
  assert.equal(run.requests.length, 1);
  assert.equal(run.sockets.length, 0);
  assert.equal(run.errors[0].code, 'KICKED');
});
