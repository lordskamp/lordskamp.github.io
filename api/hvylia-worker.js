import { DurableObject } from 'cloudflare:workers';
import { createRoom, addPlayer, applyAction, viewFor, setConnection, recoverDisconnected, GAME_CONFIG } from './hvylia-core.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/u;
const BODY_LIMIT = 2048;
const HEARTBEAT_TIMEOUT = 65000;
const TICKET_TTL = 30000;

function fault(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function random() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}

function roomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), byte => ALPHABET[byte % ALPHABET.length]).join('');
}

async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function nickname(raw) {
  if (typeof raw !== 'string') throw fault('INVALID', 'Введіть нікнейм.');
  const name = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (name.length < 2 || name.length > 24 || /[\p{Cc}\p{Cf}<>]/u.test(name)) {
    throw fault('INVALID', 'Нікнейм має містити від 2 до 24 символів.');
  }
  return name;
}

async function readJson(request) {
  if (!request.body) throw fault('INVALID', 'Запит порожній.');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > BODY_LIMIT) {
      await reader.cancel();
      throw fault('INVALID', 'Запит завеликий.', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw fault('INVALID', 'Некоректний запит.'); }
}

function originAllowed(origin, request, env) {
  if (!origin) return true;
  if (origin === env.SITE_ORIGIN || origin === new URL(request.url).origin) return true;
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
  } catch { return false; }
}

function json(data, status = 200, origin = '') {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin'
    }
  });
}

function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!/^[a-f0-9-]{36}\.[a-f0-9-]{36}$/u.test(token)) throw fault('SESSION', 'Не вдалося відновити гравця. Приєднайтеся ще раз.', 401);
  return token;
}

export class WaveRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id = 1), state TEXT NOT NULL, last_activity INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS tickets (ticket_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS receipts (player_id TEXT NOT NULL, action_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(player_id, action_id))');
  }

  read() {
    const row = this.ctx.storage.sql.exec('SELECT state, last_activity FROM room WHERE id = 1').toArray()[0];
    if (!row) throw fault('NOT_FOUND', 'Кімнати вже немає. Створіть нову.', 404);
    if (Date.now() - row.last_activity >= this.ttl()) throw fault('NOT_FOUND', 'Час цієї кімнати минув. Створіть нову.', 404);
    return { state: JSON.parse(row.state), lastActivity: row.last_activity };
  }

  ttl() { return Number(this.env.ROOM_TTL_MS) || 86400000; }

  write(state, activity = true) {
    // Synchronous SQL and transactionSync prevent conflicting socket actions from interleaving.
    if (activity) {
      this.ctx.storage.sql.exec('INSERT INTO room (id, state, last_activity) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, last_activity=excluded.last_activity', JSON.stringify(state), Date.now());
    } else {
      this.ctx.storage.sql.exec('UPDATE room SET state = ? WHERE id = 1', JSON.stringify(state));
    }
  }

  async initialize(code, rawName) {
    if (this.ctx.storage.sql.exec('SELECT id FROM room WHERE id = 1').toArray().length) return { collision: true };
    const player = { id: crypto.randomUUID(), name: nickname(rawName), connected: false };
    const token = `${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const tokenHash = await hash(token);
    // Another creation may have finished while digesting the token.
    if (this.ctx.storage.sql.exec('SELECT id FROM room WHERE id = 1').toArray().length) return { collision: true };
    const state = createRoom(code, player);
    this.ctx.storage.transactionSync(() => {
      this.write(state);
      this.ctx.storage.sql.exec('INSERT INTO sessions VALUES (?, ?)', tokenHash, player.id);
    });
    await this.schedule();
    return { code, playerId: player.id, token, state: viewFor(state, player.id) };
  }

  async join(rawName) {
    const player = { id: crypto.randomUUID(), name: nickname(rawName), connected: false };
    const token = `${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const tokenHash = await hash(token);
    const { state } = this.read();
    if (state.players.length >= GAME_CONFIG.maxPlayers) throw fault('FULL', 'У кімнаті вже 24 гравці.');
    const next = addPlayer(state, player);
    this.ctx.storage.transactionSync(() => {
      this.write(next);
      this.ctx.storage.sql.exec('INSERT INTO sessions VALUES (?, ?)', tokenHash, player.id);
    });
    this.broadcast(next);
    await this.schedule();
    return { code: next.code, playerId: player.id, token, state: viewFor(next, player.id) };
  }

  async authenticate(token) {
    const tokenHash = await hash(token);
    const session = this.ctx.storage.sql.exec('SELECT player_id FROM sessions WHERE token_hash = ?', tokenHash).toArray()[0];
    const { state } = this.read();
    if (!session || !state.players.some(player => player.id === session.player_id)) throw fault('SESSION', 'Ви вже вийшли з кімнати. Приєднайтеся ще раз.', 401);
    return { playerId: session.player_id, state };
  }

  async resume(token) {
    const { playerId, state } = await this.authenticate(token);
    return { code: state.code, playerId, token, state: viewFor(state, playerId) };
  }

  async socketTicket(token) {
    const { playerId } = await this.authenticate(token);
    const ticket = crypto.randomUUID();
    const ticketHash = await hash(ticket);
    this.read();
    this.ctx.storage.sql.exec('DELETE FROM tickets WHERE expires_at < ?', Date.now());
    const count = this.ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM tickets WHERE player_id = ?', playerId).one().count;
    if (count >= 5) throw fault('RATE', 'Зачекайте трохи перед повторним підключенням.', 429);
    this.ctx.storage.sql.exec('INSERT INTO tickets VALUES (?, ?, ?)', ticketHash, playerId, Date.now() + TICKET_TTL);
    return { ticket };
  }

  async fetch(request) {
    try {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw fault('INVALID', 'Потрібне підключення до гри.', 426);
      const ticket = new URL(request.url).searchParams.get('ticket') || '';
      if (!/^[a-f0-9-]{36}$/u.test(ticket)) throw fault('SESSION', 'Підключення застаріло. Спробуйте ще раз.', 401);
      const ticketHash = await hash(ticket);
      const entry = this.ctx.storage.sql.exec('SELECT * FROM tickets WHERE ticket_hash = ?', ticketHash).toArray()[0];
      this.ctx.storage.sql.exec('DELETE FROM tickets WHERE ticket_hash = ?', ticketHash);
      const { state } = this.read();
      if (!entry || entry.expires_at < Date.now() || !state.players.some(player => player.id === entry.player_id)) throw fault('SESSION', 'Підключення застаріло. Спробуйте ще раз.', 401);
      const [client, server] = Object.values(new WebSocketPair());
      for (const old of this.ctx.getWebSockets()) {
        if (old.deserializeAttachment()?.playerId === entry.player_id) {
          this.send(old, { type: 'replaced' });
          old.close(4001, 'Інша вкладка');
        }
      }
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ playerId: entry.player_id, connectionId: crypto.randomUUID(), lastSeen: Date.now(), bucket: Date.now(), count: 0 });
      const next = recoverDisconnected(setConnection(state, entry.player_id, true), Date.now(), random);
      this.write(next);
      this.broadcast(next);
      await this.schedule();
      return new Response(null, { status: 101, webSocket: client });
    } catch (error) {
      return json({ code: error.code || 'SERVER', message: error.message || 'Не вдалося підключитися.' }, error.status || 400, request.headers.get('Origin') || '');
    }
  }

  send(socket, data) {
    try { if (socket.readyState === 1) socket.send(JSON.stringify(data)); } catch { /* Close handler recovers presence. */ }
  }

  broadcast(state) {
    for (const socket of this.ctx.getWebSockets()) {
      const id = socket.deserializeAttachment()?.playerId;
      if (state.players.some(player => player.id === id)) this.send(socket, { type: 'state', state: viewFor(state, id) });
      else {
        this.send(socket, { type: 'error', code: 'SESSION', message: 'Ви вийшли з кімнати.' });
        socket.close(4003, 'Гравець вийшов');
      }
    }
  }

  async webSocketMessage(socket, message) {
    let packet;
    try {
      if (typeof message !== 'string' || message.length > BODY_LIMIT) throw fault('INVALID', 'Некоректна дія.');
      packet = JSON.parse(message);
      const info = socket.deserializeAttachment();
      if (!info || socket.readyState !== 1) return;
      const now = Date.now();
      if (now - info.bucket > 1000) { info.bucket = now; info.count = 0; }
      info.count += 1;
      info.lastSeen = now;
      socket.serializeAttachment(info);
      if (info.count > 35) throw fault('RATE', 'Забагато дій. Зачекайте мить.', 429);
      const { state, lastActivity } = this.read();
      if (!state.players.some(player => player.id === info.playerId)) throw fault('SESSION', 'Ви вже вийшли з кімнати.', 401);
      if (packet.type === 'ping') {
        if (now - lastActivity > 60000) this.ctx.storage.sql.exec('UPDATE room SET last_activity = ? WHERE id = 1', now);
        this.send(socket, { type: 'pong' });
        await this.schedule();
        return;
      }
      if (packet.type !== 'action' || typeof packet.id !== 'string' || packet.id.length > 80 || !packet.action || typeof packet.action.type !== 'string' || packet.action.type === 'advance') throw fault('INVALID', 'Некоректна дія.');
      if (this.ctx.storage.sql.exec('SELECT action_id FROM receipts WHERE player_id = ? AND action_id = ?', info.playerId, packet.id).toArray().length) {
        this.send(socket, { type: 'ack', id: packet.id });
        return;
      }
      const next = applyAction(state, info.playerId, packet.action, random);
      this.ctx.storage.transactionSync(() => {
        this.write(next);
        this.ctx.storage.sql.exec('INSERT INTO receipts VALUES (?, ?, ?)', info.playerId, packet.id, now);
        this.ctx.storage.sql.exec('DELETE FROM receipts WHERE created_at < ?', now - 300000);
        const removed = state.players.filter(player => !next.players.some(item => item.id === player.id));
        for (const player of removed) {
          this.ctx.storage.sql.exec('DELETE FROM sessions WHERE player_id = ?', player.id);
          this.ctx.storage.sql.exec('DELETE FROM tickets WHERE player_id = ?', player.id);
        }
      });
      this.send(socket, { type: 'ack', id: packet.id });
      this.broadcast(next);
      await this.schedule();
    } catch (error) {
      this.send(socket, { type: 'error', id: packet?.id, code: error.code || 'INVALID', message: error.code ? error.message : 'Не вдалося виконати дію. Спробуйте ще раз.' });
    }
  }

  async webSocketClose(socket, code) {
    const normalCode = code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000;
    try { socket.close(normalCode, 'Підключення завершено'); } catch { /* Presence still needs cleanup after a transport error. */ }
    const playerId = socket.deserializeAttachment()?.playerId;
    if (!playerId || this.ctx.getWebSockets().some(other => other !== socket && other.readyState === 1 && other.deserializeAttachment()?.playerId === playerId)) return;
    try {
      const { state } = this.read();
      if (!state.players.some(player => player.id === playerId)) return;
      const next = setConnection(state, playerId, false);
      this.write(next, false);
      this.broadcast(next);
      await this.schedule();
    } catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
  }

  async webSocketError(socket) { await this.webSocketClose(socket, 1011); }

  async schedule() {
    let record;
    try { record = this.read(); } catch (error) { if (error.code === 'NOT_FOUND') return; throw error; }
    const { state, lastActivity } = record;
    const now = Date.now();
    const deadlines = [lastActivity + this.ttl()];
    if (state.phase === 'REVEAL') deadlines.push(state.round.revealAt + (state.round.revealed ? GAME_CONFIG.scoreDelayMs : 0));
    for (const player of state.players) {
      if (!player.connected && !player._recovered && typeof player.disconnectedAt === 'number') deadlines.push(player.disconnectedAt + GAME_CONFIG.presenceGraceMs);
    }
    for (const socket of this.ctx.getWebSockets()) if (socket.readyState === 1) deadlines.push((socket.deserializeAttachment()?.lastSeen || now) + HEARTBEAT_TIMEOUT);
    await this.ctx.storage.setAlarm(Math.max(now + 1, Math.min(...deadlines)));
  }

  async alarm() {
    const row = this.ctx.storage.sql.exec('SELECT last_activity FROM room WHERE id = 1').toArray()[0];
    if (!row) return;
    const now = Date.now();
    if (now - row.last_activity >= this.ttl()) {
      for (const socket of this.ctx.getWebSockets()) socket.close(4004, 'Час кімнати минув');
      // Delete room rows but retain schema; a later creation may safely reuse this short code.
      this.ctx.storage.transactionSync(() => {
        for (const table of ['room', 'sessions', 'tickets', 'receipts']) this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
      });
      return;
    }
    let { state } = this.read();
    for (const socket of this.ctx.getWebSockets()) {
      const info = socket.deserializeAttachment();
      if (socket.readyState === 1 && info && now - info.lastSeen >= HEARTBEAT_TIMEOUT) {
        socket.close(4000, 'Зв’язок перервано');
        if (state.players.some(player => player.id === info.playerId)) state = setConnection(state, info.playerId, false, now);
      }
    }
    state = recoverDisconnected(state, now, random);
    if (state.phase === 'REVEAL' && now >= state.round.revealAt) state = applyAction(state, null, { type: 'advance', now }, random);
    this.write(state, false);
    this.broadcast(state);
    this.ctx.storage.sql.exec('DELETE FROM tickets WHERE expires_at < ?', now);
    await this.schedule();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      if (url.pathname === '/') return Response.redirect(`${url.origin}/hvylia/`, 302);
      return env.ASSETS.fetch(request);
    }
    const origin = request.headers.get('Origin') || '';
    try {
      if (!originAllowed(origin, request, env)) throw fault('ORIGIN', 'Цей сайт не може підключитися до гри.', 403);
      if (request.method === 'OPTIONS') return json(null, 204, origin);
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, game: 'Довжина хвилі' }, 200, origin);
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        const { name } = await readJson(request);
        nickname(name);
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const code = roomCode();
          const created = await env.ROOMS.getByName(code, { locationHint: 'eeur' }).initialize(code, name);
          if (!created.collision) return json(created, 201, origin);
        }
        throw fault('BUSY', 'Не вдалося створити кімнату. Спробуйте ще раз.', 503);
      }
      const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/(join|resume|socket-ticket|socket)$/u);
      if (!match || !ROOM_RE.test(match[1])) throw fault('ROOM_CODE', 'Перевірте код кімнати: чотири латинські літери або цифри.', 400);
      const room = env.ROOMS.getByName(match[1], { locationHint: 'eeur' });
      if (match[2] === 'socket' && request.method === 'GET') return room.fetch(request);
      if (request.method !== 'POST') throw fault('INVALID', 'Некоректний запит.', 405);
      if (match[2] === 'join') {
        const { name } = await readJson(request);
        return json(await room.join(name), 200, origin);
      }
      if (match[2] === 'resume') return json(await room.resume(bearer(request)), 200, origin);
      if (match[2] === 'socket-ticket') return json(await room.socketTicket(bearer(request)), 200, origin);
      throw fault('INVALID', 'Некоректний запит.');
    } catch (error) {
      // Log only an error code; room secrets, session tokens and nicknames never enter logs.
      if (!error.code) console.error(JSON.stringify({ event: 'hvylia_error', code: 'SERVER' }));
      return json({ code: error.code || 'SERVER', message: error.code ? error.message : 'Сервер тимчасово недоступний. Спробуйте ще раз.' }, error.status || (error.code ? 400 : 503), origin);
    }
  }
};
