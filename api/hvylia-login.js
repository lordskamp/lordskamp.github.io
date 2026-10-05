import { DurableObject } from 'cloudflare:workers';
import { constantTimeEqual } from './hvylia-telegram.js';

const LIFETIME = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SECRET = /^[a-f0-9]{48}$/u;
const encoder = new TextEncoder();

function fault(code, message, status = 401) {
  throw Object.assign(new Error(message), { code, status });
}

async function hash(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function verifiedUser(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 || value.id > 4503599627370495 || value.is_bot === true
    || typeof value.first_name !== 'string' || !value.first_name.trim() || value.first_name.length > 256
    || (value.last_name !== undefined && (typeof value.last_name !== 'string' || value.last_name.length > 256))
    || (value.username !== undefined && (typeof value.username !== 'string' || value.username.length > 64))) {
    fault('LOGIN_USER', 'Не вдалося підтвердити Telegram-профіль.');
  }
  return { id: value.id, first_name: value.first_name,
    ...(value.last_name !== undefined ? { last_name: value.last_name } : {}),
    ...(value.username !== undefined ? { username: value.username } : {}) };
}

function randomCode() {
  const bytes = new Uint32Array(1);
  const ceiling = Math.floor(0x100000000 / 1000000) * 1000000;
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= ceiling);
  return String(bytes[0] % 1000000).padStart(6, '0');
}

/** Browser-bound, single-use login challenge. Only the trusted bot webhook attaches a user. */
export class WaveLoginDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS login (id INTEGER PRIMARY KEY CHECK(id = 1), secret_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, user TEXT, code_hash TEXT, attempts INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0)');
  }

  row() {
    const row = this.ctx.storage.sql.exec('SELECT * FROM login WHERE id = 1').toArray()[0];
    if (!row || row.expires_at <= Date.now()) fault('LOGIN_EXPIRED', 'Код входу застарів. Почніть вхід ще раз.');
    if (row.consumed) fault('LOGIN_USED', 'Цей код уже використано. Почніть вхід ще раз.');
    if (row.attempts >= MAX_ATTEMPTS) fault('LOGIN_LOCKED', 'Забагато невірних кодів. Почніть вхід ще раз.', 429);
    return row;
  }

  async begin({ secret } = {}) {
    if (typeof secret !== 'string' || !SECRET.test(secret)) fault('LOGIN_SECRET', 'Не вдалося почати вхід.');
    const secretHash = await hash(`hvylia-login-browser-v1\n${secret}`);
    const expiresAt = Date.now() + LIFETIME;
    this.ctx.storage.transactionSync(() => {
      if (this.ctx.storage.sql.exec('SELECT id FROM login WHERE id = 1').toArray().length) fault('LOGIN_EXISTS', 'Цей запит входу вже створено.', 409);
      this.ctx.storage.sql.exec('INSERT INTO login (id, secret_hash, expires_at) VALUES (1, ?, ?)', secretHash, expiresAt);
    });
    await this.ctx.storage.setAlarm(expiresAt);
    return { expiresAt };
  }

  async attachTelegram(value) {
    const user = verifiedUser(value);
    const current = this.row();
    if (current.user && JSON.parse(current.user).id !== user.id) fault('LOGIN_OWNER', 'Цей запит входу вже підтверджено іншим профілем.');
    let code;
    let codeHash;
    do {
      code = randomCode();
      codeHash = await hash(`hvylia-login-code-v1\n${current.secret_hash}\n${code}`);
    } while (constantTimeEqual(current.code_hash, codeHash));
    return this.ctx.storage.transactionSync(() => {
      // Re-read after cryptographic awaits: a concurrent webhook or finish may have won.
      const latest = this.row();
      if (latest.user && JSON.parse(latest.user).id !== user.id) fault('LOGIN_OWNER', 'Цей запит входу вже підтверджено іншим профілем.');
      this.ctx.storage.sql.exec('UPDATE login SET user = ?, code_hash = ? WHERE id = 1', JSON.stringify(user), codeHash);
      return { code, expiresAt: latest.expires_at };
    });
  }

  async finish({ secret, code } = {}) {
    if (typeof secret !== 'string' || !SECRET.test(secret)) fault('LOGIN_SECRET', 'Не вдалося підтвердити цей запит входу.');
    const secretHash = await hash(`hvylia-login-browser-v1\n${secret}`);
    const current = this.row();
    if (!constantTimeEqual(current.secret_hash, secretHash)) fault('LOGIN_SECRET', 'Не вдалося підтвердити цей запит входу.');
    if (!current.user || !current.code_hash) fault('LOGIN_PENDING', 'Спершу відкрийте бота й отримайте код.');
    const codeHash = typeof code === 'string' && /^\d{6}$/u.test(code)
      ? await hash(`hvylia-login-code-v1\n${secretHash}\n${code}`) : '';
    // Do not throw inside the failed-attempt transaction: its counter must commit.
    const result = this.ctx.storage.transactionSync(() => {
      const latest = this.row();
      if (!constantTimeEqual(latest.secret_hash, secretHash)) fault('LOGIN_SECRET', 'Не вдалося підтвердити цей запит входу.');
      if (!latest.user || !latest.code_hash) fault('LOGIN_PENDING', 'Спершу відкрийте бота й отримайте код.');
      if (!constantTimeEqual(latest.code_hash, codeHash)) {
        this.ctx.storage.sql.exec('UPDATE login SET attempts = attempts + 1 WHERE id = 1');
        return { invalid: true, locked: latest.attempts + 1 >= MAX_ATTEMPTS };
      }
      this.ctx.storage.sql.exec('UPDATE login SET consumed = 1, code_hash = NULL WHERE id = 1');
      return { user: JSON.parse(latest.user) };
    });
    if (result.locked) fault('LOGIN_LOCKED', 'Забагато невірних кодів. Почніть вхід ще раз.', 429);
    if (result.invalid) fault('LOGIN_CODE', 'Невірний код. Перевірте повідомлення від бота.');
    return result.user;
  }

  async alarm() {
    const row = this.ctx.storage.sql.exec('SELECT expires_at FROM login WHERE id = 1').toArray()[0];
    if (!row) return;
    if (row.expires_at > Date.now()) await this.ctx.storage.setAlarm(row.expires_at);
    else this.ctx.storage.sql.exec('DELETE FROM login');
  }
}
