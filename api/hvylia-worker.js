import { DurableObject } from 'cloudflare:workers';
import { createRoom, addPlayer, applyAction, viewFor, setConnection, recoverDisconnected, GAME_CONFIG } from './hvylia-core.js';
import { SPECTRA } from '../content/hvylia/spectra.js';
import { PACKS } from '../content/hvylia/packs.js';
import { verifyTelegramInitData, telegramCall, constantTimeEqual, createBrowserSession, verifyBrowserSession } from './hvylia-telegram.js';
export { WaveAccountDO, WaveLeaderboardDO } from './hvylia-accounts.js';
export { WaveLoginDO } from './hvylia-login.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/u;
const BODY_LIMIT = 2048;
const HEARTBEAT_TIMEOUT = 150000;
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
  if (name.length < 2 || name.length > GAME_CONFIG.maxNameLength || /[\p{Cc}\p{Cf}<>]/u.test(name)) {
    throw fault('INVALID', `Нікнейм має містити від 2 до ${GAME_CONFIG.maxNameLength} символів.`);
  }
  return name;
}

async function readJson(request, limit = BODY_LIMIT) {
  if (!request.body) throw fault('INVALID', 'Запит порожній.');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Telegram-Init-Data, X-Hvylia-Profile',
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

function deck() { return SPECTRA; }

const currentSpectra = new Map(SPECTRA.map(card => [card.id, card]));
const unscoredPhases = new Set(['PSYCHIC_VIEW', 'TEAM_GUESS', 'OPPONENT_BET', 'REVEAL']);

function migrateCatalogue(state) {
  let changed = false;
  if (state.config.packId !== 'standard') {
    state.config.packId = 'standard';
    changed = true;
  }
  const allowed = state._usedSpectra.filter(id => currentSpectra.has(id));
  if (allowed.length !== state._usedSpectra.length) {
    state._usedSpectra = allowed;
    changed = true;
  }
  const previous = state.round?.spectrum;
  const current = previous && currentSpectra.get(previous.id);
  if (previous && unscoredPhases.has(state.phase) && (!current || current.left !== previous.left || current.right !== previous.right)) {
    const unused = SPECTRA.filter(card => !state._usedSpectra.includes(card.id));
    const available = unused.length ? unused : SPECTRA;
    if (!unused.length) state._usedSpectra = [];
    const card = available[Math.floor(random() * available.length)];
    state._usedSpectra.push(card.id);
    state._roundSerial += 1;
    state.round = { id: `${state.code}-${state._roundSerial}`, number: state.round.number,
      activeTeam: state.round.activeTeam, psychicId: state.round.psychicId,
      spectrum: { id: card.id, left: card.left, right: card.right },
      target: Math.floor(random() * 1001) / 10, guess: 50, clue: '', bet: null,
      result: null, revealed: false, catalogUpdated: true };
    state.phase = 'PSYCHIC_VIEW';
    changed = true;
  }
  if (changed) { state.revision += 1; state.updatedAt = Date.now(); }
  return changed;
}

function account(env, id) { return env.HVYLIA_ACCOUNTS.getByName(String(id), { locationHint: 'eeur' }); }
function ranking(env) { return env.HVYLIA_LEADERBOARD.getByName('network-wins', { locationHint: 'eeur' }); }

function identityKey(user) { return user?.kind === 'guest' ? 'g:' + user.id : user ? String(user.id) : null; }
function authSecret(env) { return env.HVYLIA_AUTH_SECRET || env.HVYLIA_BOT_TOKEN; }
function absoluteAvatar(path, requestUrl) {
  return typeof path === 'string' && /^\/api\/hvylia\/avatar\/[a-f0-9-]{36}$/u.test(path) ? new URL(path, requestUrl).href : null;
}
async function telegramProfile(user, env, requestUrl, native = false) {
  const profile = await account(env, user.id).profile(user);
  try {
    await account(env, `avatar:${profile.publicId}`).setAvatarSource({ telegramId: user.id,
      ...(native || user.photo_url !== undefined ? { photoUrl: user.photo_url || null } : {}) });
  } catch { /* Optional picture metadata never blocks authentication. */ }
  if (profile.stats.played > 0) {
    try { await ranking(env).update(profile); } catch { /* A later refresh retries the public index. */ }
  }
  return { ...user, avatarUrl: absoluteAvatar(profile.avatarUrl, requestUrl) };
}
function randomHex(size = 24) { return Array.from(crypto.getRandomValues(new Uint8Array(size)), byte => byte.toString(16).padStart(2, '0')).join(''); }
async function identity(request, env, required = false) {
  const raw = request.headers.get('X-Telegram-Init-Data');
  const token = request.headers.get('X-Hvylia-Profile');
  let user = null;
  if (raw) user = await verifyTelegramInitData(raw, env.HVYLIA_BOT_TOKEN);
  else if (token) user = await verifyBrowserSession(token, authSecret(env));
  else if (!required) return null;
  if (!user) throw fault('TELEGRAM_AUTH', 'Увійдіть ще раз, щоб відновити свій профіль.', 401);
  if (required && user.kind === 'guest') throw fault('TELEGRAM_REQUIRED', 'Для покупки увійдіть через Telegram.', 401);
  if (user.kind !== 'guest') user = await telegramProfile(user, env, request.url, Boolean(raw));
  else await account(env, identityKey(user)).profile();
  return user;
}
async function accountPayload(user, env, requestUrl) {
  const profile = user ? await account(env, identityKey(user)).profile() : null;
  if (profile) profile.avatarUrl = absoluteAvatar(profile.avatarUrl, requestUrl);
  return {
    telegramAvailable: Boolean(env.HVYLIA_BOT_TOKEN && env.HVYLIA_BOT_USERNAME),
    botUsername: env.HVYLIA_BOT_USERNAME || '', paymentReady: paymentReady(env), profile,
    identityType: !user ? 'anonymous' : user.kind === 'guest' ? 'nickname' : 'telegram',
    packs: PACKS.map(pack => ({ ...pack, owned: pack.free || Boolean(profile?.ownedPacks.includes(pack.id)), available: true }))
  };
}

async function ownPack(env, accountId, packId) {
  if (!PACKS.some(pack => pack.id === packId)) throw fault('INVALID', 'Оберіть доступний пак карток.');
  if (packId === 'standard') return;
  if (!accountId || !(await account(env, accountId).profile()).ownedPacks.includes(packId)) {
    throw fault('PACK_LOCKED', 'Спершу придбайте цей пак за 150 ⭐ у Telegram.', 403);
  }
}

function paymentReady(env) {
  return Boolean(env.HVYLIA_BOT_TOKEN && env.HVYLIA_WEBHOOK_SECRET && env.HVYLIA_BOT_USERNAME && env.HVYLIA_PAYMENT_SUPPORT);
}

async function webhook(request, env) {
  const supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!env.HVYLIA_WEBHOOK_SECRET || !constantTimeEqual(supplied, env.HVYLIA_WEBHOOK_SECRET)) {
    throw fault('WEBHOOK_AUTH', 'Доступ заборонено.', 403);
  }
  const update = await readJson(request, 32768);
  if (update.pre_checkout_query) {
    const query = update.pre_checkout_query;
    const allowed = await account(env, query.from?.id || 'invalid').preCheckout(query);
    await telegramCall(env, 'answerPreCheckoutQuery', {
      pre_checkout_query_id: query.id, ok: allowed,
      ...(!allowed ? { error_message: 'Цей рахунок недійсний або пак уже придбано. Відкрийте гру та спробуйте знову.' } : {})
    });
  } else if (update.message?.successful_payment) {
    const message = update.message;
    const receipt = await account(env, message.from?.id || 'invalid').successfulPayment(message);
    if (receipt.ok && receipt.profile) await ranking(env).update(receipt.profile);
  } else if (update.message?.refunded_payment) {
    const message = update.message;
    await account(env, message.chat?.id || 'invalid').handleRefundedPayment(message);
  } else if (update.message?.chat?.type === 'private' && typeof update.message.text === 'string') {
    const message = update.message;
    const command = message.text.split(/\s/u)[0].split('@')[0];
    const loginId = message.text.split(/\s/u)[1]?.match(/^login_([a-f0-9]{48})$/u)?.[1];
    if (command === '/start' && loginId) {
      let result;
      try { result = await env.HVYLIA_LOGINS.getByName(loginId).attachTelegram(message.from); }
      catch { await telegramCall(env, 'sendMessage', { chat_id: message.chat.id, text: 'Це посилання входу вже минуло. Відкрийте новий вхід на сайті гри.' }); return { ok: true }; }
      await telegramCall(env, 'sendMessage', { chat_id: message.chat.id, text: 'Код входу до гри «Довжина хвилі»: ' + result.code + '\nВведіть його на сайті, де ви почали вхід. Код діє 5 хвилин. Не передавайте його іншим.' });
    } else if (command === '/paysupport') {
      await telegramCall(env, 'sendMessage', { chat_id: message.chat.id, text: `Підтримка оплат гри «Довжина хвилі»: ${env.HVYLIA_PAYMENT_SUPPORT || 'Зверніться до власника бота.'}` });
    } else if (command === '/start' || command === '/help') {
      const code = message.text.split(/\s/u)[1]?.match(/^room_([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4})$/u)?.[1];
      const appUrl = new URL(env.HVYLIA_APP_URL || `${env.SITE_ORIGIN}/hvylia/`);
      if (code) appUrl.searchParams.set('r', code);
      await telegramCall(env, 'sendMessage', {
        chat_id: message.chat.id,
        text: 'Довжина хвилі — командна гра про спільні асоціації. Створіть кімнату, запросіть друзів і ловіть одну хвилю! Тематичний пак купує лише ведучий, грати можуть усі в кімнаті.',
        reply_markup: { inline_keyboard: [[{ text: 'Грати', web_app: { url: appUrl.href } }]] }
      });
    }
  }
  return { ok: true };
}

export class WaveRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id = 1), state TEXT NOT NULL, last_activity INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS tickets (ticket_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS receipts (player_id TEXT NOT NULL, action_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(player_id, action_id))');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS ranking_outbox (match_id TEXT NOT NULL, account_id TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(match_id, account_id))');
  }

  read() {
    const row = this.ctx.storage.sql.exec('SELECT state, last_activity FROM room WHERE id = 1').toArray()[0];
    if (!row) throw fault('NOT_FOUND', 'Кімнати вже немає. Створіть нову.', 404);
    if (Date.now() - row.last_activity >= this.ttl()) throw fault('NOT_FOUND', 'Час цієї кімнати минув. Створіть нову.', 404);
    const state = JSON.parse(row.state);
    // A live card replacement restarts only the unscored turn. Completed rounds
    // remain historical snapshots; their points and receipts must not be changed.
    if (migrateCatalogue(state)) {
      this.write(state, false);
      this.broadcast(state);
    }
    return { state, lastActivity: row.last_activity };
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

  async initialize(code, rawName, user = null, packId = 'standard') {
    if (this.ctx.storage.sql.exec('SELECT id FROM room WHERE id = 1').toArray().length) return { collision: true };
    const player = { id: crypto.randomUUID(), name: nickname(rawName), connected: false, ...(user ? { _accountId: identityKey(user), avatarUrl: user.avatarUrl || null } : {}) };
    const token = `${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const tokenHash = await hash(token);
    // Another creation may have finished while digesting the token.
    if (this.ctx.storage.sql.exec('SELECT id FROM room WHERE id = 1').toArray().length) return { collision: true };
    const state = createRoom(code, player);
    state.config.packId = packId;
    state._packSponsor = user ? identityKey(user) : null;
    this.ctx.storage.transactionSync(() => {
      this.write(state);
      this.ctx.storage.sql.exec('INSERT INTO sessions VALUES (?, ?)', tokenHash, player.id);
    });
    await this.schedule();
    return { code, playerId: player.id, token, state: viewFor(state, player.id) };
  }

  async join(rawName, user = null) {
    const player = { id: crypto.randomUUID(), name: nickname(rawName), connected: false, ...(user ? { _accountId: identityKey(user), avatarUrl: user.avatarUrl || null } : {}) };
    const token = `${crypto.randomUUID()}.${crypto.randomUUID()}`;
    const tokenHash = await hash(token);
    const { state } = this.read();
    const existing = user && state.players.find(item => item._accountId === identityKey(user));
    if (existing) {
      const avatarChanged = (existing.avatarUrl || null) !== (user.avatarUrl || null);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec('INSERT INTO sessions VALUES (?, ?)', tokenHash, existing.id);
        if (avatarChanged) { existing.avatarUrl = user.avatarUrl || null; state.revision += 1; this.write(state); }
      });
      if (avatarChanged) this.broadcast(state);
      return { code: state.code, playerId: existing.id, token, state: viewFor(state, existing.id) };
    }
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

  async resume(token, user = null) {
    const { playerId } = await this.authenticate(token);
    const { state } = this.read();
    const player = state.players.find(item => item.id === playerId);
    let metadataChanged = false;
    if (user) {
      const id = identityKey(user);
      const upgradingGuest = player._accountId?.startsWith('g:') && user.kind !== 'guest';
      if (player._accountId && player._accountId !== id && !upgradingGuest) throw fault('SESSION', 'Ця кімната збережена для іншого профілю.', 403);
      if ((!player._accountId || upgradingGuest) && state.phase === 'LOBBY') {
        if (state.players.some(item => item.id !== playerId && item._accountId === id)) throw fault('PLAYER_EXISTS', 'Ви вже є в цій кімнаті.');
        player._accountId = id;
        metadataChanged = true;
      }
      if (player._accountId === id && (player.avatarUrl || null) !== (user.avatarUrl || null)) { player.avatarUrl = user.avatarUrl || null; metadataChanged = true; }
    }
    if (metadataChanged) { state.revision += 1; this.write(state); this.broadcast(state); }
    return { code: state.code, playerId, token, state: viewFor(state, playerId) };
  }

  async authorizePack(playerId, action) {
    const { state } = this.read();
    if (action.type === 'settings' && action.packId !== undefined) {
      if (state.hostId !== playerId || state.phase !== 'LOBBY') return;
      await ownPack(this.env, state.players.find(player => player.id === playerId)?._accountId, action.packId);
    } else if (action.type === 'start' && state.hostId === playerId && state.phase === 'LOBBY') {
      await ownPack(this.env, state._packSponsor, state.config.packId || 'standard');
      return { packId: state.config.packId || 'standard', sponsor: state._packSponsor };
    }
  }

  prepareMatch(next) {
    next._matchId = crypto.randomUUID();
    next._rankingQueued = false;
    const players = next.players.filter(player => player.connected && player.team !== null);
    const accounts = players.map(player => player._accountId).filter(Boolean);
    next.config.ranked = players.length >= 4 && accounts.length === players.length && new Set(accounts).size === players.length;
    next._ratedRoster = next.config.ranked ? players.map(player => ({ playerId: player.id, accountId: player._accountId, team: player.team, name: player.name })) : null;
  }

  preserveRoster(next) {
    if (next.config.ranked && next._ratedRoster?.some(member => !next.players.some(player => player.id === member.playerId && player.team === member.team))) {
      next.config.ranked = false;
      next._ratedRoster = null;
    }
  }

  queueRanking(state) {
    if (state.phase !== 'GAME_OVER' || !state.config.ranked || !state._matchId || !state._ratedRoster || state._rankingQueued) return;
    for (const member of state._ratedRoster) {
      const receipt = { matchId: state._matchId, won: member.team === state.winner, points: state.teams[member.team].score, packId: state.config.packId || 'standard', finishedAt: state.updatedAt, name: member.name };
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO ranking_outbox VALUES (?, ?, ?)', state._matchId, member.accountId, JSON.stringify(receipt));
    }
    state._rankingQueued = true;
  }

  async flushRanking() {
    const records = this.ctx.storage.sql.exec('SELECT * FROM ranking_outbox LIMIT 24').toArray();
    for (const row of records) {
      try {
        const profile = await account(this.env, row.account_id).recordMatch(JSON.parse(row.receipt));
        await ranking(this.env).update(profile);
        this.ctx.storage.sql.exec('DELETE FROM ranking_outbox WHERE match_id = ? AND account_id = ?', row.match_id, row.account_id);
      } catch {
        console.error(JSON.stringify({ event: 'hvylia_ranking_retry', code: 'RANKING' }));
        break;
      }
    }
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
      const connectionId = crypto.randomUUID();
      server.serializeAttachment({ playerId: entry.player_id, connectionId, lastSeen: Date.now(), bucket: Date.now(), count: 0 });
      const next = recoverDisconnected(setConnection(state, entry.player_id, true), Date.now(), random, deck(state));
      next.players.find(player => player.id === entry.player_id)._connectionId = connectionId;
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
      let { state, lastActivity } = this.read();
      const activePlayer = state.players.find(player => player.id === info.playerId);
      if (!activePlayer) throw fault('SESSION', 'Ви вже вийшли з кімнати.', 401);
      if (activePlayer._connectionId && activePlayer._connectionId !== info.connectionId) { this.send(socket, { type: 'replaced' }); socket.close(4001, 'Інша вкладка'); return; }
      if (!activePlayer.connected) { state = setConnection(state, info.playerId, true, now); this.write(state); this.broadcast(state); }
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
      const authorization = await this.authorizePack(info.playerId, packet.action);
      // Entitlement RPC may yield; apply the action to the latest committed room state.
      ({ state } = this.read());
      const latestPlayer = state.players.find(player => player.id === info.playerId);
      if (socket.readyState !== 1 || (latestPlayer?._connectionId && latestPlayer._connectionId !== info.connectionId)) return;
      if (latestPlayer && !latestPlayer.connected) state = setConnection(state, info.playerId, true, now);
      if (authorization && (authorization.packId !== (state.config.packId || 'standard') || authorization.sponsor !== state._packSponsor)) {
        throw fault('STALE', 'Пак кімнати змінився. Спробуйте почати матч ще раз.');
      }
      if (this.ctx.storage.sql.exec('SELECT action_id FROM receipts WHERE player_id = ? AND action_id = ?', info.playerId, packet.id).toArray().length) {
        this.send(socket, { type: 'ack', id: packet.id });
        return;
      }
      const next = applyAction(state, info.playerId, packet.action, random, deck(state));
      if (packet.action.type === 'settings' && packet.action.packId !== undefined) next._packSponsor = next.players.find(player => player.id === info.playerId)?._accountId || null;
      if (packet.action.type === 'start') this.prepareMatch(next);
      this.preserveRoster(next);
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
      await this.flushRanking();
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
      const player = state.players.find(item => item.id === playerId);
      if (!player || (player._connectionId && player._connectionId !== socket.deserializeAttachment()?.connectionId)) return;
      const next = setConnection(state, playerId, false);
      this.write(next, false);
      this.broadcast(next);
      await this.schedule();
    } catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
  }

  async webSocketError(socket) { await this.webSocketClose(socket, 1011); }

  async schedule() {
    let record;
    try { record = this.read(); } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
      if (this.ctx.storage.sql.exec('SELECT match_id FROM ranking_outbox LIMIT 1').toArray().length) await this.ctx.storage.setAlarm(Date.now() + 10000);
      return;
    }
    const { state, lastActivity } = record;
    const now = Date.now();
    const deadlines = [lastActivity + this.ttl()];
    if (this.ctx.storage.sql.exec('SELECT match_id FROM ranking_outbox LIMIT 1').toArray().length) deadlines.push(now + 10000);
    if (state.phase === 'REVEAL') deadlines.push(state.round.revealAt + (state.round.revealed ? GAME_CONFIG.scoreDelayMs : 0));
    for (const player of state.players) {
      if (!player.connected && !player._recovered && typeof player.disconnectedAt === 'number') deadlines.push(player.disconnectedAt + GAME_CONFIG.presenceGraceMs);
    }
    for (const socket of this.ctx.getWebSockets()) if (socket.readyState === 1) deadlines.push((socket.deserializeAttachment()?.lastSeen || now) + HEARTBEAT_TIMEOUT);
    await this.ctx.storage.setAlarm(Math.max(now + 1, Math.min(...deadlines)));
  }

  async alarm() {
    const row = this.ctx.storage.sql.exec('SELECT last_activity FROM room WHERE id = 1').toArray()[0];
    if (!row) {
      await this.flushRanking();
      await this.schedule();
      return;
    }
    const now = Date.now();
    if (now - row.last_activity >= this.ttl()) {
      await this.flushRanking();
      for (const socket of this.ctx.getWebSockets()) socket.close(4004, 'Час кімнати минув');
      // Delete room rows but retain schema; a later creation may safely reuse this short code.
      this.ctx.storage.transactionSync(() => {
        for (const table of ['room', 'sessions', 'tickets', 'receipts']) this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
      });
      await this.schedule();
      return;
    }
    let { state } = this.read();
    for (const socket of this.ctx.getWebSockets()) {
      const info = socket.deserializeAttachment();
      if (socket.readyState === 1 && info && now - info.lastSeen >= HEARTBEAT_TIMEOUT) {
        socket.close(4000, 'Зв’язок перервано');
        const player = state.players.find(item => item.id === info.playerId);
        const hasOther = this.ctx.getWebSockets().some(other => other !== socket && other.readyState === 1 && other.deserializeAttachment()?.playerId === info.playerId && now - (other.deserializeAttachment()?.lastSeen || 0) < HEARTBEAT_TIMEOUT);
        if (player && !hasOther && (!player._connectionId || player._connectionId === info.connectionId)) state = setConnection(state, info.playerId, false, now);
      }
    }
    state = recoverDisconnected(state, now, random, deck(state));
    if (state.phase === 'REVEAL' && now >= state.round.revealAt) state = applyAction(state, null, { type: 'advance', now }, random, deck(state));
    this.preserveRoster(state);
    this.ctx.storage.transactionSync(() => {
      this.queueRanking(state);
      this.write(state, false);
    });
    this.broadcast(state);
    this.ctx.storage.sql.exec('DELETE FROM tickets WHERE expires_at < ?', now);
    await this.flushRanking();
    await this.schedule();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/hvylia-core.js') return env.ASSETS.fetch(request);
    if (!url.pathname.startsWith('/api/')) {
      if (url.pathname === '/') return Response.redirect(`${url.origin}/hvylia/`, 302);
      return env.ASSETS.fetch(request);
    }
    const origin = request.headers.get('Origin') || '';
    try {
      if (!originAllowed(origin, request, env)) throw fault('ORIGIN', 'Цей сайт не може підключитися до гри.', 403);
      if (request.method === 'OPTIONS') return json(null, 204, origin);
      if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, game: 'Довжина хвилі' }, 200, origin);
      if (url.pathname === '/api/hvylia/telegram-webhook' && request.method === 'POST') return json(await webhook(request, env));
      const avatarId = url.pathname.match(/^\/api\/hvylia\/avatar\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u)?.[1];
      if (avatarId && request.method === 'GET') {
        const image = await account(env, `avatar:${avatarId}`).avatar();
        return new Response(image?.bytes || null, { status: image ? 200 : 404,
          headers: { 'Content-Type': image?.type || 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Access-Control-Allow-Origin': '*' } });
      }
      if (url.pathname === '/api/hvylia/leaderboard' && request.method === 'GET') {
        const leaders = await ranking(env).list(50);
        leaders.entries = leaders.entries.map(entry => ({ ...entry, avatarUrl: absoluteAvatar(entry.avatarUrl, request.url) }));
        return json(leaders, 200, origin);
      }
      if (url.pathname === '/api/hvylia/account' && request.method === 'GET') return json(await accountPayload(await identity(request, env), env, request.url), 200, origin);
      if (url.pathname === '/api/hvylia/auth/guest' && request.method === 'POST') {
        const { name: rawName } = await readJson(request);
        const name = nickname(rawName);
        const current = await identity(request, env);
        if (current && current.kind !== 'guest') return json({ ...(await accountPayload(current, env, request.url)), unchanged: true }, 200, origin);
        const user = { kind: 'guest', id: current?.id || crypto.randomUUID(), name };
        const profile = await account(env, identityKey(user)).guestProfile(user);
        if (profile.stats.played > 0) await ranking(env).update(profile);
        const session = await createBrowserSession(user, authSecret(env));
        return json({ ...session, profile, identityType: 'nickname' }, 200, origin);
      }
      if (url.pathname === '/api/hvylia/auth/telegram/start' && request.method === 'POST') {
        if (!env.HVYLIA_BOT_TOKEN || !env.HVYLIA_BOT_USERNAME || !env.HVYLIA_LOGINS) throw fault('TELEGRAM_UNAVAILABLE', 'Вхід стане доступним після підключення бота.', 503);
        const loginId = randomHex(), secret = randomHex();
        const started = await env.HVYLIA_LOGINS.getByName(loginId).begin({ secret });
        return json({ loginId, secret, url: 'https://t.me/' + env.HVYLIA_BOT_USERNAME + '?start=login_' + loginId, ...started }, 200, origin);
      }
      if (url.pathname === '/api/hvylia/auth/telegram/finish' && request.method === 'POST') {
        const { loginId, secret, code } = await readJson(request);
        if (!/^[a-f0-9]{48}$/u.test(loginId || '')) throw fault('LOGIN_INVALID', 'Почніть вхід ще раз.');
        const user = await env.HVYLIA_LOGINS.getByName(loginId).finish({ secret, code });
        await telegramProfile(user, env, request.url);
        const session = await createBrowserSession({ ...user, kind: 'telegram' }, authSecret(env));
        return json({ ...session, ...(await accountPayload({ ...user, kind: 'telegram' }, env, request.url)) }, 200, origin);
      }
      if (url.pathname === '/api/hvylia/invoice' && request.method === 'POST') {
        if (!paymentReady(env)) throw fault('PAYMENT_SETUP', 'Оплата стане доступною після підключення Telegram-бота.', 503);
        const user = await identity(request, env, true);
        const { packId } = await readJson(request);
        return json(await account(env, user.id).createInvoice(packId), 200, origin);
      }
      if (url.pathname === '/api/hvylia/admin/refund' && request.method === 'POST') {
        const token = (request.headers.get('Authorization') || '').replace(/^Bearer /u, '');
        if (!env.HVYLIA_ADMIN_TOKEN || !constantTimeEqual(token, env.HVYLIA_ADMIN_TOKEN)) throw fault('ADMIN', 'Доступ заборонено.', 403);
        const { telegramId, purchaseId } = await readJson(request);
        if (!/^[1-9]\d{0,15}$/u.test(String(telegramId))) throw fault('INVALID', 'Некоректний акаунт.');
        return json(await account(env, telegramId).refund(purchaseId), 200, origin);
      }
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        const { name, packId = 'standard' } = await readJson(request);
        const user = await identity(request, env);
        await ownPack(env, identityKey(user), packId);
        nickname(name);
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const code = roomCode();
          const created = await env.ROOMS.getByName(code, { locationHint: 'eeur' }).initialize(code, name, user, packId);
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
        return json(await room.join(name, await identity(request, env)), 200, origin);
      }
      if (match[2] === 'resume') return json(await room.resume(bearer(request), await identity(request, env)), 200, origin);
      if (match[2] === 'socket-ticket') return json(await room.socketTicket(bearer(request)), 200, origin);
      throw fault('INVALID', 'Некоректний запит.');
    } catch (error) {
      // Log only an error code; room secrets, session tokens and nicknames never enter logs.
      if (!error.code) console.error(JSON.stringify({ event: 'hvylia_error', code: 'SERVER' }));
      return json({ code: error.code || 'SERVER', message: error.code ? error.message : 'Сервер тимчасово недоступний. Спробуйте ще раз.' }, error.status || (error.code ? 400 : 503), origin);
    }
  }
};
