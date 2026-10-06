import { DurableObject } from 'cloudflare:workers';
import { telegramCall, telegramUser, telegramPhotoUrl, telegramAvatar } from './hvylia-telegram.js';
import { getPack } from '../content/hvylia/packs.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const PAYLOAD = /^hvylia:v1:([a-f0-9-]{36})$/u;
const INVOICE_LIFETIME = 24 * 60 * 60 * 1000;

function fail(code, message, status = 400) {
  throw Object.assign(new Error(message), { code, status });
}

function telegramId(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 4503599627370495) fail('ACCOUNT', 'Не вдалося визначити Telegram-профіль.', 401);
  return String(value);
}

function displayName(value) {
  if (typeof value !== 'string') fail('ACCOUNT', 'Не вдалося прочитати ім’я.');
  const name = value.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/gu, ' ').trim();
  if (!name) fail('ACCOUNT', 'Вкажіть ім’я.');
  return Array.from(name).slice(0, 64).join('');
}

function product(packId) {
  const pack = getPack(packId);
  if (!pack || pack.free || !Number.isInteger(pack.priceStars) || pack.priceStars <= 0) fail('PACK', 'Такого платного набору немає.');
  return pack;
}

function purchaseId(payload) {
  const id = typeof payload === 'string' ? payload.match(PAYLOAD)?.[1] : null;
  return id && UUID.test(id) ? id : null;
}

function chargeId(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256 && !/[\p{Cc}\p{Cf}]/u.test(value);
}

/** One SQLite-backed account per authenticated identity; owner keys stay server-side. */
export class WaveAccountDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id = 1), telegram_id TEXT UNIQUE NOT NULL, public_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, played INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, pack_id TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, invoice_link TEXT, charge_id TEXT UNIQUE, refund_started INTEGER NOT NULL DEFAULT 0)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, won INTEGER NOT NULL, points INTEGER NOT NULL, pack_id TEXT NOT NULL, finished_at INTEGER NOT NULL)');
    const columns = this.ctx.storage.sql.exec('PRAGMA table_info(profile)').toArray();
    if (!columns.some(column => column.name === 'username')) this.ctx.storage.sql.exec('ALTER TABLE profile ADD COLUMN username TEXT');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS avatar_source (id INTEGER PRIMARY KEY CHECK(id = 1), telegram_id TEXT NOT NULL, photo_url TEXT, version INTEGER NOT NULL DEFAULT 1)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS avatar_cache (id INTEGER PRIMARY KEY CHECK(id = 1), bytes BLOB, mime TEXT, expires_at INTEGER NOT NULL, version INTEGER NOT NULL)');
  }

  row() {
    const row = this.ctx.storage.sql.exec('SELECT * FROM profile WHERE id = 1').toArray()[0];
    if (!row) fail('ACCOUNT', 'Спершу створіть профіль гравця.', 401);
    return row;
  }

  profile(user) {
    if (user !== undefined) {
      const signed = telegramUser(user);
      if (!signed) fail('ACCOUNT', 'Не вдалося підтвердити Telegram-профіль.', 401);
      const id = telegramId(signed.id);
      const name = displayName(signed.username ? `@${signed.username}` : [signed.first_name, signed.last_name].filter(Boolean).join(' '));
      const username = signed.username || null;
      const existing = this.ctx.storage.sql.exec('SELECT * FROM profile WHERE id = 1').toArray()[0];
      if (existing && existing.telegram_id !== id) fail('ACCOUNT', 'Цей Telegram-профіль не відповідає акаунту.', 401);
      if (!existing) {
        this.ctx.storage.sql.exec('INSERT INTO profile (id, telegram_id, public_id, name, username) VALUES (1, ?, ?, ?, ?)', id, crypto.randomUUID(), name, username);
      } else if (existing.name !== name || existing.username !== username) {
        this.ctx.storage.sql.exec('UPDATE profile SET name = ?, username = ?, revision = revision + 1 WHERE id = 1', name, username);
      }
    }
    const row = this.row();
    const ownedPacks = this.ctx.storage.sql.exec("SELECT DISTINCT pack_id FROM purchases WHERE status IN ('paid', 'refund_pending') ORDER BY pack_id").toArray().map(item => item.pack_id);
    const guest = row.telegram_id.startsWith('g:');
    return { publicId: row.public_id, kind: guest ? 'guest' : 'telegram', name: row.name,
      avatarUrl: guest ? null : `/api/hvylia/avatar/${row.public_id}`, ownedPacks,
      stats: { wins: row.wins, losses: row.losses, played: row.played, points: row.points }, revision: row.revision };
  }

  /** Called only by the trusted Worker on the private avatar:<publicId> DO. */
  setAvatarSource(source) {
    const owner = telegramId(source?.telegramId);
    if (source.photoUrl !== undefined && source.photoUrl !== null && !telegramPhotoUrl(source.photoUrl)) fail('AVATAR', 'Некоректне фото профілю.');
    const existing = this.ctx.storage.sql.exec('SELECT * FROM avatar_source WHERE id = 1').toArray()[0];
    if (existing && existing.telegram_id !== owner) fail('AVATAR', 'Фото не відповідає профілю.', 401);
    const photo = source.photoUrl === undefined ? existing?.photo_url || null : source.photoUrl === null ? null : telegramPhotoUrl(source.photoUrl);
    if (!existing) this.ctx.storage.sql.exec('INSERT INTO avatar_source (id, telegram_id, photo_url) VALUES (1, ?, ?)', owner, photo);
    else if (existing.photo_url !== photo) this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('UPDATE avatar_source SET photo_url = ?, version = version + 1 WHERE id = 1', photo);
      this.ctx.storage.sql.exec('DELETE FROM avatar_cache');
    });
    return { ok: true };
  }

  async avatar() {
    const source = this.ctx.storage.sql.exec('SELECT * FROM avatar_source WHERE id = 1').toArray()[0];
    if (!source) return null;
    const cached = this.ctx.storage.sql.exec('SELECT * FROM avatar_cache WHERE id = 1').toArray()[0];
    if (cached && cached.version === source.version && cached.expires_at > Date.now()) {
      return cached.bytes ? { bytes: new Uint8Array(cached.bytes).buffer, type: cached.mime } : null;
    }
    if (this.avatarLoading) return this.avatarLoading;
    const pending = (async () => {
      const image = await telegramAvatar(this.env, Number(source.telegram_id), source.photo_url);
      const latest = this.ctx.storage.sql.exec('SELECT version FROM avatar_source WHERE id = 1').toArray()[0];
      if (latest?.version !== source.version) return null;
      this.ctx.storage.sql.exec('INSERT INTO avatar_cache VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes, mime=excluded.mime, expires_at=excluded.expires_at, version=excluded.version', image?.bytes.buffer || null, image?.type || null, Date.now() + (image ? 15 * 60000 : 60000), source.version);
      return image ? { bytes: image.bytes.buffer, type: image.type } : null;
    })();
    this.avatarLoading = pending;
    try { return await pending; }
    finally { if (this.avatarLoading === pending) this.avatarLoading = null; }
  }

  guestProfile(user) {
    if (!user || typeof user.id !== 'string' || !UUID.test(user.id)) fail('ACCOUNT', 'Не вдалося визначити профіль гравця.', 401);
    const owner = `g:${user.id.toLowerCase()}`;
    const name = displayName(user.name);
    const existing = this.ctx.storage.sql.exec('SELECT * FROM profile WHERE id = 1').toArray()[0];
    // The Worker must verify the signed guest credential before routing to this owner's DO.
    if (existing && existing.telegram_id !== owner) fail('ACCOUNT', 'Цей профіль не відповідає акаунту.', 401);
    if (!existing) this.ctx.storage.sql.exec('INSERT INTO profile (id, telegram_id, public_id, name) VALUES (1, ?, ?, ?)', owner, crypto.randomUUID(), name);
    else if (existing.name !== name) this.ctx.storage.sql.exec('UPDATE profile SET name = ?, revision = revision + 1 WHERE id = 1', name);
    return this.profile();
  }

  async createInvoice(packId) {
    if (this.row().telegram_id.startsWith('g:')) fail('TELEGRAM_REQUIRED', 'Щоб придбати набір, увійдіть через Telegram.', 401);
    const pack = product(packId);
    const account = this.profile();
    if (account.ownedPacks.includes(packId)) fail('OWNED', 'Цей набір уже відкрито.', 409);
    if (!this.env.HVYLIA_BOT_TOKEN) fail('TELEGRAM_SETUP', 'Telegram-бот ще не підключено.', 503);
    const now = Date.now();
    const previous = this.ctx.storage.sql.exec("SELECT * FROM purchases WHERE pack_id = ? AND status = 'pending' AND created_at > ? ORDER BY created_at DESC LIMIT 1", packId, now - INVOICE_LIFETIME).toArray()[0];
    if (previous?.invoice_link) return { invoiceLink: previous.invoice_link, purchaseId: previous.id };
    if (previous && now - previous.created_at < 30000) fail('INVOICE_PENDING', 'Рахунок уже створюється. Зачекайте мить.', 409);
    const id = crypto.randomUUID();
    // The pending invoice is durable before external I/O; no concurrency gate spans fetch.
    this.ctx.storage.sql.exec('INSERT INTO purchases (id, pack_id, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, packId, pack.priceStars, 'XTR', 'pending', now);
    let link;
    try {
      link = await telegramCall(this.env, 'createInvoiceLink', {
        title: `Довжина хвилі · ${pack.title}`,
        description: `${pack.count} оригінальних українських спектрів. Набір «${pack.title}» відкривається назавжди для вашого Telegram-профілю.`,
        payload: `hvylia:v1:${id}`,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: pack.title, amount: pack.priceStars }]
      });
      const invoice = typeof link === 'string' ? new URL(link) : null;
      if (!invoice || invoice.protocol !== 'https:' || !['t.me', 'telegram.me'].includes(invoice.hostname)) fail('TELEGRAM_UNAVAILABLE', 'Telegram не повернув рахунок.', 503);
    } catch (error) {
      this.ctx.storage.sql.exec("UPDATE purchases SET status = 'failed' WHERE id = ? AND status = 'pending'", id);
      throw error;
    }
    this.ctx.storage.sql.exec('UPDATE purchases SET invoice_link = ? WHERE id = ?', link, id);
    return { invoiceLink: link, purchaseId: id };
  }

  preCheckout(query) {
    try {
      const row = this.row();
      const id = purchaseId(query?.invoice_payload);
      if (!id || telegramId(query?.from?.id) !== row.telegram_id) return false;
      const purchase = this.ctx.storage.sql.exec('SELECT * FROM purchases WHERE id = ?', id).toArray()[0];
      return !!purchase && purchase.status === 'pending' && Date.now() - purchase.created_at <= INVOICE_LIFETIME
        && query.currency === purchase.currency && query.currency === 'XTR'
        && query.total_amount === purchase.amount && query.total_amount === product(purchase.pack_id).priceStars
        && !this.profile().ownedPacks.includes(purchase.pack_id);
    } catch { return false; }
  }

  successfulPayment(message) {
    const payment = message?.successful_payment;
    const account = this.row();
    const id = purchaseId(payment?.invoice_payload);
    if (!id || telegramId(message?.from?.id) !== account.telegram_id || !chargeId(payment?.telegram_payment_charge_id)) fail('PAYMENT', 'Не вдалося підтвердити платіж.');
    return this.ctx.storage.transactionSync(() => {
      const purchase = this.ctx.storage.sql.exec('SELECT * FROM purchases WHERE id = ?', id).toArray()[0];
      // Reconcile deliveries against the durable invoice, even after its pack
      // leaves the live catalogue. New invoices/checkouts still require product().
      if (!purchase || payment.currency !== 'XTR' || payment.currency !== purchase.currency || !Number.isSafeInteger(purchase.amount) || purchase.amount <= 0 || payment.total_amount !== purchase.amount) fail('PAYMENT', 'Сума або набір у платежі не збігаються.');
      if (purchase.charge_id) {
        if (purchase.charge_id !== payment.telegram_payment_charge_id) fail('PAYMENT', 'Цей рахунок уже оплачено іншим платежем.');
        return { ok: true, duplicate: true, purchaseId: id, packId: purchase.pack_id, profile: this.profile() };
      }
      if (purchase.status !== 'pending') fail('PAYMENT', 'Цей рахунок більше не доступний.');
      if (this.ctx.storage.sql.exec('SELECT id FROM purchases WHERE charge_id = ?', payment.telegram_payment_charge_id).toArray().length) fail('PAYMENT', 'Цей платіж уже враховано.');
      this.ctx.storage.sql.exec("UPDATE purchases SET status = 'paid', charge_id = ? WHERE id = ?", payment.telegram_payment_charge_id, id);
      this.ctx.storage.sql.exec('UPDATE profile SET revision = revision + 1 WHERE id = 1');
      return { ok: true, duplicate: false, purchaseId: id, packId: purchase.pack_id, profile: this.profile() };
    });
  }

  applyRefund(id, expectedCharge) {
    return this.ctx.storage.transactionSync(() => {
      const purchase = this.ctx.storage.sql.exec('SELECT * FROM purchases WHERE id = ?', id).toArray()[0];
      if (!purchase || !purchase.charge_id || purchase.charge_id !== expectedCharge) fail('PAYMENT', 'Не вдалося знайти оплачений рахунок.');
      const duplicate = purchase.status === 'refunded';
      if (!duplicate) {
        this.ctx.storage.sql.exec("UPDATE purchases SET status = 'refunded' WHERE id = ?", id);
        this.ctx.storage.sql.exec('UPDATE profile SET revision = revision + 1 WHERE id = 1');
      }
      return { ok: true, duplicate, purchaseId: id, packId: purchase.pack_id, profile: this.profile() };
    });
  }

  handleRefundedPayment(message) {
    const payment = message?.refunded_payment;
    const row = this.row();
    const id = purchaseId(payment?.invoice_payload);
    // Refund service messages may be sent by the bot in the buyer's private chat.
    const owner = message?.chat?.type === 'private' ? message.chat.id : message?.from?.id;
    if (!id || telegramId(owner) !== row.telegram_id || !chargeId(payment?.telegram_payment_charge_id)) fail('PAYMENT', 'Не вдалося підтвердити повернення.');
    const purchase = this.ctx.storage.sql.exec('SELECT * FROM purchases WHERE id = ?', id).toArray()[0];
    if (!purchase || purchase.currency !== 'XTR' || payment.currency !== purchase.currency || !Number.isSafeInteger(purchase.amount) || purchase.amount <= 0 || payment.total_amount !== purchase.amount) fail('PAYMENT', 'Сума повернення не збігається.');
    return this.applyRefund(id, payment.telegram_payment_charge_id);
  }

  async refund(id) {
    if (typeof id !== 'string' || !UUID.test(id)) fail('PAYMENT', 'Некоректний номер покупки.');
    const account = this.row();
    const purchase = this.ctx.storage.sql.exec('SELECT * FROM purchases WHERE id = ?', id).toArray()[0];
    if (!purchase?.charge_id || !['paid', 'refund_pending', 'refunded'].includes(purchase.status)) fail('PAYMENT', 'Не вдалося знайти оплачений рахунок.');
    if (purchase.status === 'refunded') return this.applyRefund(id, purchase.charge_id);
    if (purchase.status === 'refund_pending' && Date.now() - purchase.refund_started < 30000) return { ok: false, pending: true, purchaseId: id, packId: purchase.pack_id, profile: this.profile() };
    this.ctx.storage.sql.exec("UPDATE purchases SET status = 'refund_pending', refund_started = ? WHERE id = ?", Date.now(), id);
    const result = await telegramCall(this.env, 'refundStarPayment', { user_id: Number(account.telegram_id), telegram_payment_charge_id: purchase.charge_id });
    if (result !== true) fail('TELEGRAM_UNAVAILABLE', 'Telegram не підтвердив повернення.', 503);
    return this.applyRefund(id, purchase.charge_id);
  }

  recordMatch(receipt) {
    this.row();
    if (!receipt || typeof receipt.matchId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/u.test(receipt.matchId)
      || typeof receipt.won !== 'boolean' || !Number.isSafeInteger(receipt.points) || receipt.points < 0 || receipt.points > 10000
      || !Number.isSafeInteger(receipt.finishedAt) || receipt.finishedAt < 0
      || !['standard', 'anime', 'games'].includes(receipt.packId)) fail('MATCH', 'Не вдалося записати результат матчу.');
    return this.ctx.storage.transactionSync(() => {
      if (this.ctx.storage.sql.exec('SELECT id FROM matches WHERE id = ?', receipt.matchId).toArray().length) return this.profile();
      const name = this.row().name;
      this.ctx.storage.sql.exec('INSERT INTO matches VALUES (?, ?, ?, ?, ?)', receipt.matchId, receipt.won ? 1 : 0, receipt.points, receipt.packId, receipt.finishedAt);
      this.ctx.storage.sql.exec('UPDATE profile SET wins = wins + ?, losses = losses + ?, played = played + 1, points = points + ?, name = ?, revision = revision + 1 WHERE id = 1', receipt.won ? 1 : 0, receipt.won ? 0 : 1, receipt.points, name);
      return this.profile();
    });
  }
}

/** The global index receives committed account snapshots and ignores older revisions. */
export class WaveLeaderboardDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS rankings (public_id TEXT PRIMARY KEY, name TEXT NOT NULL, wins INTEGER NOT NULL, losses INTEGER NOT NULL, played INTEGER NOT NULL, points INTEGER NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS ranking_order ON rankings (wins DESC, points DESC, played ASC, public_id ASC)');
    const columns = this.ctx.storage.sql.exec('PRAGMA table_info(rankings)').toArray();
    if (!columns.some(column => column.name === 'avatar_url')) this.ctx.storage.sql.exec('ALTER TABLE rankings ADD COLUMN avatar_url TEXT');
  }

  update(profile) {
    if (!profile || !UUID.test(profile.publicId || '') || !Number.isSafeInteger(profile.revision) || profile.revision < 1
      || !profile.stats || ['wins', 'losses', 'played', 'points'].some(key => !Number.isSafeInteger(profile.stats[key]) || profile.stats[key] < 0)
      || profile.stats.played !== profile.stats.wins + profile.stats.losses) fail('RANKING', 'Некоректний результат для рейтингу.');
    const name = displayName(profile.name);
    const avatar = profile.avatarUrl === `/api/hvylia/avatar/${profile.publicId}` ? profile.avatarUrl : null;
    const existing = this.ctx.storage.sql.exec('SELECT revision FROM rankings WHERE public_id = ?', profile.publicId).toArray()[0];
    if (existing && existing.revision > profile.revision) return { updated: false };
    if (existing && existing.revision === profile.revision) {
      // Backfill the optional avatar column on existing committed revisions.
      this.ctx.storage.sql.exec('UPDATE rankings SET avatar_url = ? WHERE public_id = ?', avatar, profile.publicId);
      return { updated: false };
    }
    this.ctx.storage.sql.exec('INSERT INTO rankings (public_id, name, wins, losses, played, points, revision, updated_at, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(public_id) DO UPDATE SET name=excluded.name, wins=excluded.wins, losses=excluded.losses, played=excluded.played, points=excluded.points, revision=excluded.revision, updated_at=excluded.updated_at, avatar_url=excluded.avatar_url', profile.publicId, name, profile.stats.wins, profile.stats.losses, profile.stats.played, profile.stats.points, profile.revision, Date.now(), avatar);
    return { updated: true };
  }

  list(limit = 50) {
    const count = Number.isSafeInteger(limit) ? Math.min(50, Math.max(1, limit)) : 50;
    const rows = this.ctx.storage.sql.exec('SELECT * FROM rankings WHERE played > 0 ORDER BY wins DESC, points DESC, played ASC, public_id ASC LIMIT ?', count).toArray();
    const latest = this.ctx.storage.sql.exec('SELECT MAX(updated_at) AS updated_at FROM rankings').one();
    return {
      entries: rows.map((row, index) => ({ rank: index + 1, publicId: row.public_id, name: row.name, avatarUrl: row.avatar_url || null, wins: row.wins, losses: row.losses, played: row.played, points: row.points })),
      updatedAt: latest.updated_at || 0
    };
  }
}
