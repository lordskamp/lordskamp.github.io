import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { telegramAvatar, telegramPhotoUrl } from '../api/hvylia-telegram.js';

const source = (await readFile(new URL('../api/hvylia-accounts.js', import.meta.url), 'utf8'))
  .replace("import { DurableObject } from 'cloudflare:workers';", 'class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }')
  .replace("'./hvylia-telegram.js'", JSON.stringify(new URL('../api/hvylia-telegram.js', import.meta.url).href))
  .replace("'../content/hvylia/packs.js'", JSON.stringify(new URL('../content/hvylia/packs.js', import.meta.url).href));
const { WaveAccountDO, WaveLeaderboardDO } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const TOKEN = '123456:local_avatar_test_only';
const USER = { id: 10101010, first_name: 'Олена', last_name: 'Коваль' };
const PHOTO = 'https://t.me/i/userpic/320/test-photo.jpg';
const JPEG = Uint8Array.from([255, 216, 255, 224, 0, 0, 255, 217]);

function state(t, prepare) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  if (prepare) prepare(db);
  return { storage: {
    sql: { exec(sql, ...args) { const rows = db.prepare(sql).all(...args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value)); return { toArray: () => rows, one: () => rows[0] }; } },
    transactionSync(callback) { db.exec('BEGIN'); try { const result = callback(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  } };
}

const originalFetches = new WeakMap();
function fetchMock(t, handler) {
  if (!originalFetches.has(t)) {
    originalFetches.set(t, globalThis.fetch);
    t.after(() => { globalThis.fetch = originalFetches.get(t); originalFetches.delete(t); });
  }
  globalThis.fetch = handler;
}

function bot(result) { return Response.json({ ok: true, result }); }
function image(bytes = JPEG, type = 'image/jpeg') { return new Response(bytes, { headers: { 'Content-Type': type } }); }

test('avatar CDN allowlist rejects local URLs, credential tricks, suffix domains and non-HTTPS schemes', () => {
  assert.equal(telegramPhotoUrl(PHOTO), PHOTO);
  assert.equal(telegramPhotoUrl('https://cdn4.telesco.pe/file/abc.jpg'), 'https://cdn4.telesco.pe/file/abc.jpg');
  for (const value of ['https://127.0.0.1/x', 'http://t.me/i/userpic/a.jpg', 'https://t.me.evil.example/i/userpic/x', 'https://cdn4.telesco.pe.evil.example/x', 'https://user:password@t.me/i/userpic/x', 'https://t.me:8443/i/userpic/x', 'https://t.me/i/userpic/x#fragment', 'https://t.me/other-path', 'data:image/png;base64,abc', null]) {
    assert.equal(telegramPhotoUrl(value), null);
  }
});

test('signed CDN raster photos return bounded bytes without calling Bot API or following redirects', async t => {
  let calls = 0;
  fetchMock(t, async (url, options) => {
    calls += 1;
    assert.equal(url, PHOTO);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return image();
  });
  assert.deepEqual(await telegramAvatar({ HVYLIA_BOT_TOKEN: TOKEN }, USER.id, PHOTO), { bytes: JPEG, type: 'image/jpeg' });
  assert.equal(calls, 1);
});

test('missing or SVG photos fall back to a server-only Bot API file and never return its token or path', async t => {
  const calls = [];
  fetchMock(t, async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    if (url === PHOTO) return image('<svg><script>bad()</script></svg>', 'image/svg+xml');
    if (url.endsWith('/getUserProfilePhotos')) {
      assert.deepEqual(JSON.parse(options.body), { user_id: USER.id, limit: 1 });
      return bot({ total_count: 1, photos: [[{ file_id: 'small_photo', width: 80, height: 80 }, { file_id: 'avatar_photo', width: 320, height: 320, file_size: 8 }]] });
    }
    if (url.endsWith('/getFile')) {
      assert.deepEqual(JSON.parse(options.body), { file_id: 'avatar_photo' });
      return bot({ file_path: 'photos/avatar_1.jpg', file_size: 8 });
    }
    assert.equal(url, `https://api.telegram.org/file/bot${TOKEN}/photos/avatar_1.jpg`);
    return image();
  });
  const result = await telegramAvatar({ HVYLIA_BOT_TOKEN: TOKEN }, USER.id, PHOTO);
  assert.equal(result.type, 'image/jpeg');
  assert.deepEqual(result.bytes, JPEG);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(JSON.stringify(result).includes('avatar_1.jpg'), false);
  assert.equal(calls.length, 4);
});

test('avatar downloads reject MIME spoofing, HTML, oversize bodies and unsafe file paths', async t => {
  for (const invalid of [image('<svg/>', 'image/jpeg'), image('html', 'text/html'), image(new Uint8Array(512 * 1024 + 1))]) {
    fetchMock(t, async url => url === PHOTO ? invalid : bot({ total_count: 0, photos: [] }));
    assert.equal(await telegramAvatar({ HVYLIA_BOT_TOKEN: TOKEN }, USER.id, PHOTO), null);
  }
  let fileFetches = 0;
  fetchMock(t, async url => {
    if (url.endsWith('/getUserProfilePhotos')) return bot({ photos: [[{ file_id: 'safe', width: 320, height: 320 }]] });
    if (url.endsWith('/getFile')) return bot({ file_path: '../../botToken/private.jpg' });
    fileFetches += 1;
    return image();
  });
  assert.equal(await telegramAvatar({ HVYLIA_BOT_TOKEN: TOKEN }, USER.id), null);
  assert.equal(fileFetches, 0);
});

test('avatar cache coalesces concurrent requests, expires missing photos, and invalidates changed signed sources', async t => {
  const account = new WaveAccountDO(state(t), { HVYLIA_BOT_TOKEN: TOKEN });
  account.setAvatarSource({ telegramId: USER.id, photoUrl: PHOTO });
  let calls = 0;
  let release;
  fetchMock(t, async () => { calls += 1; return new Promise(resolve => { release = resolve; }); });
  const first = account.avatar();
  const second = account.avatar();
  release(image());
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
  assert.deepEqual(await account.avatar(), { bytes: JPEG.buffer, type: 'image/jpeg' });
  assert.equal(calls, 1);
  assert.throws(() => account.setAvatarSource({ telegramId: USER.id + 1 }), error => error.code === 'AVATAR');
  account.setAvatarSource({ telegramId: USER.id, photoUrl: null });
  fetchMock(t, async () => { calls += 1; return bot({ total_count: 0, photos: [] }); });
  assert.equal(await account.avatar(), null);
  assert.equal(await account.avatar(), null);
  assert.equal(calls, 2);
  account.ctx.storage.sql.exec('UPDATE avatar_cache SET expires_at = 0');
  assert.equal(await account.avatar(), null);
  assert.equal(calls, 3);
});

test('an avatar source change during a download never commits stale bytes', async t => {
  const account = new WaveAccountDO(state(t), { HVYLIA_BOT_TOKEN: TOKEN });
  account.setAvatarSource({ telegramId: USER.id, photoUrl: PHOTO });
  let release;
  fetchMock(t, async () => new Promise(resolve => { release = resolve; }));
  const loading = account.avatar();
  account.setAvatarSource({ telegramId: USER.id, photoUrl: 'https://t.me/i/userpic/320/new.jpg' });
  release(image());
  assert.equal(await loading, null);
  assert.equal(account.ctx.storage.sql.exec('SELECT * FROM avatar_cache').toArray().length, 0);
});

test('existing profile and ranking schemas migrate without changing identities or recorded wins', t => {
  const publicId = '00000000-0000-4000-8000-000000000001';
  const oldState = state(t, db => {
    db.exec('CREATE TABLE profile (id INTEGER PRIMARY KEY, telegram_id TEXT UNIQUE NOT NULL, public_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, played INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1)');
    db.prepare('INSERT INTO profile VALUES (1, ?, ?, ?, 3, 2, 5, 48, 9)').run(String(USER.id), publicId, 'Старе ім’я');
  });
  const account = new WaveAccountDO(oldState, {});
  const migrated = account.profile({ ...USER, username: '123_olena' });
  assert.equal(migrated.name, '@123_olena');
  assert.equal(migrated.publicId, publicId);
  assert.deepEqual(migrated.stats, { wins: 3, losses: 2, played: 5, points: 48 });
  assert.equal(migrated.avatarUrl, `/api/hvylia/avatar/${publicId}`);
  assert.equal(account.profile({ ...USER, username: '123_olena' }).revision, migrated.revision);
  const oldRanking = state(t, db => {
    db.exec('CREATE TABLE rankings (public_id TEXT PRIMARY KEY, name TEXT NOT NULL, wins INTEGER NOT NULL, losses INTEGER NOT NULL, played INTEGER NOT NULL, points INTEGER NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
    db.prepare('INSERT INTO rankings VALUES (?, ?, 3, 2, 5, 48, 9, 1)').run(publicId, 'Старе ім’я');
  });
  const leaderboard = new WaveLeaderboardDO(oldRanking, {});
  leaderboard.update(migrated);
  assert.deepEqual(leaderboard.list().entries[0], { rank: 1, publicId, name: '@123_olena', avatarUrl: migrated.avatarUrl, wins: 3, losses: 2, played: 5, points: 48 });
  const fallback = account.profile(USER);
  assert.equal(fallback.name, 'Олена Коваль');
  assert.deepEqual(fallback.stats, migrated.stats);
});
