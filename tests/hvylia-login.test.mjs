import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const source = (await readFile(new URL('../api/hvylia-login.js', import.meta.url), 'utf8'))
  .replace("import { DurableObject } from 'cloudflare:workers';", 'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }')
  .replace("'./hvylia-telegram.js'", JSON.stringify(new URL('../api/hvylia-telegram.js', import.meta.url).href));
const { WaveLoginDO } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const SECRET = 'ab'.repeat(24);
const USER = { id: 10101010, first_name: 'Олена', last_name: 'Коваль', username: 'olena' };

function challenge(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const storage = {
    sql: { exec(sql, ...args) { const rows = db.prepare(sql).all(...args); return { toArray: () => rows }; } },
    transactionSync(callback) {
      db.exec('BEGIN');
      try { const result = callback(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async setAlarm(time) { storage.alarm = time; }
  };
  return new WaveLoginDO({ storage }, {});
}

test('a login challenge stores only hashes and consumes the bot-only code exactly once', async t => {
  const instance = challenge(t);
  const begin = await instance.begin({ secret: SECRET });
  assert.ok(begin.expiresAt > Date.now() + 299000);
  assert.equal(instance.ctx.storage.alarm, begin.expiresAt);
  const pending = instance.ctx.storage.sql.exec('SELECT * FROM login').toArray()[0];
  assert.equal(JSON.stringify(pending).includes(SECRET), false);
  await assert.rejects(instance.finish({ secret: SECRET, code: '123456' }), error => error.code === 'LOGIN_PENDING');
  const attached = await instance.attachTelegram({ ...USER, photo_url: 'unused', is_bot: false });
  assert.match(attached.code, /^\d{6}$/u);
  assert.equal(attached.expiresAt, begin.expiresAt);
  const stored = instance.ctx.storage.sql.exec('SELECT * FROM login').toArray()[0];
  assert.equal(Object.values(stored).includes(attached.code), false);
  assert.deepEqual(await instance.finish({ secret: SECRET, code: attached.code }), USER);
  await assert.rejects(instance.finish({ secret: SECRET, code: attached.code }), error => error.code === 'LOGIN_USED');
  await assert.rejects(instance.attachTelegram(USER), error => error.code === 'LOGIN_USED');
});

test('a leaked public challenge cannot complete login without both the browser secret and bot code', async t => {
  const instance = challenge(t);
  await instance.begin({ secret: SECRET });
  const attached = await instance.attachTelegram(USER);
  for (let index = 0; index < 8; index++) {
    await assert.rejects(instance.finish({ secret: 'cd'.repeat(24), code: attached.code }), error => error.code === 'LOGIN_SECRET');
  }
  assert.equal(instance.ctx.storage.sql.exec('SELECT attempts FROM login').toArray()[0].attempts, 0);
  assert.deepEqual(await instance.finish({ secret: SECRET, code: attached.code }), USER);
});

test('a different Telegram identity cannot replace the owner and a resend invalidates the previous code', async t => {
  const instance = challenge(t);
  await instance.begin({ secret: SECRET });
  const first = await instance.attachTelegram(USER);
  await assert.rejects(instance.attachTelegram({ ...USER, id: USER.id + 1 }), error => error.code === 'LOGIN_OWNER');
  const resent = await instance.attachTelegram(USER);
  assert.notEqual(resent.code, first.code);
  await assert.rejects(instance.finish({ secret: SECRET, code: first.code }), error => error.code === 'LOGIN_CODE');
  assert.deepEqual(await instance.finish({ secret: SECRET, code: resent.code }), USER);
});

test('five bad codes lock the challenge and neither resending nor valid codes reset the limit', async t => {
  const instance = challenge(t);
  await instance.begin({ secret: SECRET });
  const attached = await instance.attachTelegram(USER);
  for (let index = 0; index < 5; index++) {
    await assert.rejects(instance.finish({ secret: SECRET, code: 'not-a-code' }), error => error.code === (index === 4 ? 'LOGIN_LOCKED' : 'LOGIN_CODE'));
    if (index === 1) await instance.attachTelegram(USER);
  }
  assert.equal(instance.ctx.storage.sql.exec('SELECT attempts FROM login').toArray()[0].attempts, 5);
  await assert.rejects(instance.attachTelegram(USER), error => error.code === 'LOGIN_LOCKED');
  await assert.rejects(instance.finish({ secret: SECRET, code: attached.code }), error => error.code === 'LOGIN_LOCKED' && error.status === 429);
});

test('concurrent finishes commit one login and concurrent different bot owners bind only one identity', async t => {
  const instance = challenge(t);
  await instance.begin({ secret: SECRET });
  const owners = await Promise.allSettled([instance.attachTelegram(USER), instance.attachTelegram({ ...USER, id: USER.id + 1 })]);
  assert.equal(owners.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(owners.find(result => result.status === 'rejected').reason.code, 'LOGIN_OWNER');
  const attached = owners.find(result => result.status === 'fulfilled').value;
  const results = await Promise.allSettled([instance.finish({ secret: SECRET, code: attached.code }), instance.finish({ secret: SECRET, code: attached.code })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'LOGIN_USED');
});

test('expiry is checked on every operation and the alarm clears expired private data', async t => {
  const instance = challenge(t);
  const original = Date.now;
  t.after(() => { Date.now = original; });
  const initial = original();
  Date.now = () => initial;
  const begin = await instance.begin({ secret: SECRET });
  const attached = await instance.attachTelegram(USER);
  await instance.alarm();
  assert.equal(instance.ctx.storage.alarm, begin.expiresAt);
  Date.now = () => begin.expiresAt;
  await assert.rejects(instance.finish({ secret: SECRET, code: attached.code }), error => error.code === 'LOGIN_EXPIRED');
  await assert.rejects(instance.attachTelegram(USER), error => error.code === 'LOGIN_EXPIRED');
  await instance.alarm();
  assert.deepEqual(instance.ctx.storage.sql.exec('SELECT * FROM login').toArray(), []);
});

test('challenge initialization and attached user validation reject malformed credentials and bot users', async t => {
  const instance = challenge(t);
  for (const secret of [undefined, '', 'x'.repeat(48), 'ab'.repeat(23)]) await assert.rejects(instance.begin({ secret }), error => error.code === 'LOGIN_SECRET');
  await instance.begin({ secret: SECRET });
  await assert.rejects(instance.begin({ secret: SECRET }), error => error.code === 'LOGIN_EXISTS');
  for (const user of [null, { ...USER, id: '1010' }, { ...USER, is_bot: true }, { ...USER, first_name: '' }, { ...USER, last_name: 123 }]) {
    await assert.rejects(instance.attachTelegram(user), error => error.code === 'LOGIN_USER');
  }
});
