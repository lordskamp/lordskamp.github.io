// Local integration fixture only. Production never imports this module.
// Seed invoices in isolated SQLite storage without contacting the Bot API.
import worker, { WaveRoom, WaveLeaderboardDO } from '../../api/hvylia-worker.js';
import { WaveAccountDO } from '../../api/hvylia-accounts.js';
import { getPack } from '../../content/hvylia/packs.js';

export { WaveRoom, WaveLeaderboardDO };

export class FeatureRoomDO extends WaveRoom {
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
  seedInvoice(packId) {
    this.row();
    const pack = getPack(packId);
    if (!pack || pack.free) throw new Error('A premium pack is required');
    const id = crypto.randomUUID();
    this.ctx.storage.sql.exec('INSERT INTO purchases (id, pack_id, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, packId, pack.priceStars, 'XTR', 'pending', Date.now());
    return { id, payload: `hvylia:v1:${id}`, amount: pack.priceStars, currency: 'XTR' };
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
    return worker.fetch(request, env, ctx);
  }
};
