// Local integration fixture only. Production never imports this module.
// Seed invoices in isolated SQLite storage without contacting the Bot API.
import worker, { WaveRoom, WaveLeaderboardDO } from '../../api/hvylia-worker.js';
import { WaveAccountDO } from '../../api/hvylia-accounts.js';
import { WaveLoginDO } from '../../api/hvylia-login.js';
import { setConnection } from '../../api/hvylia-core.js';

export { WaveRoom, WaveLeaderboardDO, WaveLoginDO };

export class FeatureRoomDO extends WaveRoom {
  seedLegacyRound(phase, spectrumId = 'anime-removed-01') {
    const { state } = this.read();
    state.config.packId = 'anime';
    state._usedSpectra = [spectrumId];
    state.round.spectrum = { id: spectrumId, left: 'Вилучена стара картка', right: 'Інший старий полюс' };
    state.round.clue = 'Підказка до вилученої картки';
    state.round.bet = 'left';
    state.round.revealed = ['SCORE', 'GAME_OVER'].includes(phase);
    state.round.revealAt = Date.now() + 600000;
    state.round.result = state.round.revealed ? { activePoints: 2, opponentPoints: 1, correctSide: 'left', catchUp: false } : null;
    state.phase = phase;
    delete state.round.catalogUpdated;
    const before = structuredClone(state);
    this.write(state, false);
    const after = this.read().state;
    return { before, after, repeated: this.read().state };
  }
  clearAvatar(playerId) {
    const { state } = this.read();
    delete state.players.find(player => player.id === playerId).avatarUrl;
    state.revision += 1;
    this.write(state);
    this.broadcast(state);
    return { ok: true };
  }
  connectionStatus(playerId) {
    const { state } = this.read();
    const player = state.players.find(item => item.id === playerId);
    return { connected: player.connected, connectionId: player._connectionId, paused: state.paused,
      sockets: this.ctx.getWebSockets().map(socket => ({ ...socket.deserializeAttachment(), readyState: socket.readyState })) };
  }

  falsePresence(playerId) {
    const next = setConnection(this.read().state, playerId, false);
    this.write(next, false);
    this.broadcast(next);
    return this.connectionStatus(playerId);
  }

  async staleClose(playerId, connectionId) {
    await this.webSocketClose({ close() {}, deserializeAttachment() { return { playerId, connectionId }; }, readyState: 3 }, 1000);
    return this.connectionStatus(playerId);
  }

  async expiredOldSocket(playerId) {
    const [client, server] = Object.values(new globalThis.WebSocketPair());
    this.ctx.acceptWebSocket(server);
    client.accept();
    server.serializeAttachment({ playerId, connectionId: crypto.randomUUID(), lastSeen: Date.now() - 600000, bucket: Date.now(), count: 0 });
    const expiredSocketBefore = server.readyState;
    await this.alarm();
    const expiredSocketAfter = server.readyState;
    client.close();
    return { ...this.connectionStatus(playerId), expiredSocketBefore, expiredSocketAfter };
  }

  enqueueAndExpire(accountId, receipt) {
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO ranking_outbox VALUES (?, ?, ?)', receipt.matchId, String(accountId), JSON.stringify(receipt));
    this.ctx.storage.sql.exec('UPDATE room SET last_activity = 0 WHERE id = 1');
    return { ok: true };
  }

  async runAlarm() {
    await this.alarm();
    return this.testStatus();
  }

  async testStatus() {
    return {
      pending: this.ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM ranking_outbox').one().count,
      roomRows: this.ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM room').one().count,
      alarmAt: await this.ctx.storage.getAlarm()
    };
  }
}

export class FeatureLeaderboardDO extends WaveLeaderboardDO {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS feature_controls (id INTEGER PRIMARY KEY CHECK(id = 1), unavailable INTEGER NOT NULL)');
  }

  setUnavailable(value) {
    this.ctx.storage.sql.exec('INSERT INTO feature_controls VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET unavailable=excluded.unavailable', value ? 1 : 0);
    return { ok: true };
  }

  update(profile) {
    const flag = this.ctx.storage.sql.exec('SELECT unavailable FROM feature_controls WHERE id = 1').toArray()[0];
    if (flag?.unavailable) throw new Error('Fixture ranking index is temporarily unavailable');
    return super.update(profile);
  }
}

export class FeatureAccountDO extends WaveAccountDO {
  seedAvatar(userId) {
    this.setAvatarSource({ telegramId: userId });
    const version = this.ctx.storage.sql.exec('SELECT version FROM avatar_source WHERE id = 1').one().version;
    const bytes = Uint8Array.from([255, 216, 255, 224, 0, 0, 255, 217]);
    this.ctx.storage.sql.exec('INSERT INTO avatar_cache VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes, mime=excluded.mime, expires_at=excluded.expires_at, version=excluded.version', bytes.buffer, 'image/jpeg', Date.now() + 60000, version);
    return { ok: true };
  }
  seedInvoice(packId) {
    this.row();
    if (!['anime', 'games'].includes(packId)) throw new Error('A historical premium pack is required');
    const id = crypto.randomUUID();
    this.ctx.storage.sql.exec('INSERT INTO purchases (id, pack_id, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, packId, 150, 'XTR', 'pending', Date.now());
    return { id, payload: `hvylia:v1:${id}`, amount: 150, currency: 'XTR' };
  }

  testHistory() {
    return {
      matches: this.ctx.storage.sql.exec('SELECT id, won, points, pack_id FROM matches ORDER BY finished_at, id').toArray(),
      purchases: this.ctx.storage.sql.exec('SELECT id, pack_id, amount, currency, status FROM purchases ORDER BY created_at, id').toArray()
    };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__test/legacy-round' && request.method === 'POST') {
      const { code, phase, spectrumId } = await request.json();
      return Response.json(await env.ROOMS.getByName(code).seedLegacyRound(phase, spectrumId));
    }
    if (url.pathname === '/__test/seed' && request.method === 'POST') {
      const { userId, packId } = await request.json();
      return Response.json(await env.HVYLIA_ACCOUNTS.getByName(String(userId)).seedInvoice(packId));
    }
    if (url.pathname === '/__test/history' && request.method === 'POST') {
      const { userId } = await request.json();
      return Response.json(await env.HVYLIA_ACCOUNTS.getByName(String(userId)).testHistory());
    }
    if (url.pathname === '/__test/flush' && request.method === 'POST') {
      const { code } = await request.json();
      await env.ROOMS.getByName(code).flushRanking();
      return Response.json({ ok: true });
    }
    if (url.pathname === '/__test/outbox' && request.method === 'POST') {
      const { code, userId, receipt } = await request.json();
      return Response.json(await env.ROOMS.getByName(code).enqueueAndExpire(userId, receipt));
    }
    if (url.pathname === '/__test/unavailable' && request.method === 'POST') {
      const { value } = await request.json();
      return Response.json(await env.HVYLIA_LEADERBOARD.getByName('network-wins').setUnavailable(value));
    }
    if (url.pathname === '/__test/alarm' && request.method === 'POST') {
      const { code } = await request.json();
      return Response.json(await env.ROOMS.getByName(code).runAlarm());
    }
    if (url.pathname === '/__test/pending' && request.method === 'POST') {
      const { code } = await request.json();
      return Response.json(await env.ROOMS.getByName(code).testStatus());
    }
    if (url.pathname === '/__test/login/attach' && request.method === 'POST') {
      const { loginId, user } = await request.json();
      try { return Response.json(await env.HVYLIA_LOGINS.getByName(loginId).attachTelegram(user)); }
      catch (error) { return Response.json({ code: error.code }, { status: error.status || 400 }); }
    }
    if (url.pathname === '/__test/avatar/cache' && request.method === 'POST') {
      const { publicId, userId } = await request.json();
      return Response.json(await env.HVYLIA_ACCOUNTS.getByName(`avatar:${publicId}`).seedAvatar(userId));
    }
    if (url.pathname.startsWith('/__test/connection/') && request.method === 'POST') {
      const { code, playerId, connectionId } = await request.json();
      const room = env.ROOMS.getByName(code);
      const operation = url.pathname.split('/').at(-1);
      if (operation === 'status') return Response.json(await room.connectionStatus(playerId));
      if (operation === 'false') return Response.json(await room.falsePresence(playerId));
      if (operation === 'stale-close') return Response.json(await room.staleClose(playerId, connectionId));
      if (operation === 'expired') return Response.json(await room.expiredOldSocket(playerId));
      if (operation === 'no-avatar') return Response.json(await room.clearAvatar(playerId));
    }
    return worker.fetch(request, env, ctx);
  }
};
