import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { constantTimeEqual, createBrowserSession, telegramCall, verifyBrowserSession, verifyTelegramInitData } from '../api/hvylia-telegram.js';

const TOKEN = '123456:local_test_bot_token';
const NOW = Date.UTC(2026, 9, 4, 10, 0, 0);
const USER = { id: 123456789, first_name: 'Соломія', last_name: 'Гончар', username: 'solomiia' };
const SESSION_SECRET = 'test_session_secret_32_bytes_minimum';

function signed(fields = {}, token = TOKEN) {
  const params = new URLSearchParams({ auth_date: String(NOW / 1000), user: JSON.stringify(USER), query_id: 'test-query', ...fields });
  const check = [...params.entries()].sort(([left], [right]) => left < right ? -1 : 1).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

test('Mini App verification accepts independently signed Unicode data and includes Telegram signature in HMAC', async () => {
  assert.deepEqual(await verifyTelegramInitData(signed({ signature: 'ed25519_signature_field' }), TOKEN, NOW), USER);
  const reordered = new URLSearchParams([...new URLSearchParams(signed()).entries()].reverse());
  assert.deepEqual(await verifyTelegramInitData(reordered.toString(), TOKEN, NOW), USER);
});

test('Mini App verification rejects forged identity, wrong bot, changed signature and duplicate parameters', async () => {
  const forged = new URLSearchParams(signed());
  forged.set('user', JSON.stringify({ ...USER, id: 999999999 }));
  assert.equal(await verifyTelegramInitData(forged.toString(), TOKEN, NOW), null);
  assert.equal(await verifyTelegramInitData(signed(), `${TOKEN}_different`, NOW), null);
  const changed = new URLSearchParams(signed({ signature: 'original' }));
  changed.set('signature', 'forged');
  assert.equal(await verifyTelegramInitData(changed.toString(), TOKEN, NOW), null);
  for (const field of ['user', 'auth_date', 'hash', 'signature']) {
    const duplicate = `${signed({ signature: 'test' })}&${field}=duplicate`;
    assert.equal(await verifyTelegramInitData(duplicate, TOKEN, NOW), null);
  }
});

test('Mini App timestamps allow exactly twelve hours and sixty seconds of clock skew', async () => {
  const seconds = NOW / 1000;
  assert.ok(await verifyTelegramInitData(signed({ auth_date: String(seconds - 43200) }), TOKEN, NOW));
  assert.equal(await verifyTelegramInitData(signed({ auth_date: String(seconds - 43201) }), TOKEN, NOW), null);
  assert.ok(await verifyTelegramInitData(signed({ auth_date: String(seconds + 60) }), TOKEN, NOW));
  assert.equal(await verifyTelegramInitData(signed({ auth_date: String(seconds + 61) }), TOKEN, NOW), null);
  for (const date of ['NaN', '-1', '1e12', '', '123.5']) assert.equal(await verifyTelegramInitData(signed({ auth_date: date }), TOKEN, NOW), null);
});

test('Mini App verification rejects missing fields, malformed JSON, bot users and unsafe IDs', async () => {
  for (const user of [null, [], {}, { ...USER, id: '123' }, { ...USER, id: -1 }, { ...USER, id: 4503599627370496 }, { ...USER, is_bot: true }, { ...USER, first_name: '' }]) {
    assert.equal(await verifyTelegramInitData(signed({ user: JSON.stringify(user) }), TOKEN, NOW), null);
  }
  assert.equal(await verifyTelegramInitData(signed({ user: '{bad JSON' }), TOKEN, NOW), null);
  assert.equal(await verifyTelegramInitData('hash=123', TOKEN, NOW), null);
  assert.equal(await verifyTelegramInitData('x'.repeat(16385), TOKEN, NOW), null);
  assert.equal(await verifyTelegramInitData(signed(), '', NOW), null);
});

test('signed profile photo metadata is optional, allowlisted and tamper protected without making photo failures reject login', async () => {
  const photo = 'https://t.me/i/userpic/320/signed-photo.jpg';
  const user = { ...USER, username: '_123_name', photo_url: photo };
  const raw = signed({ user: JSON.stringify(user) });
  assert.deepEqual(await verifyTelegramInitData(raw, TOKEN, NOW), user);
  const changed = new URLSearchParams(raw);
  changed.set('user', JSON.stringify({ ...user, photo_url: 'https://evil.example/avatar.jpg' }));
  assert.equal(await verifyTelegramInitData(changed.toString(), TOKEN, NOW), null);
  for (const photo_url of ['https://future-cdn.telegram-cdn.org/photo.jpg', 'https://127.0.0.1/private', 'data:text/html,<script/>', null, 123]) {
    const safe = await verifyTelegramInitData(signed({ user: JSON.stringify({ ...user, photo_url }) }), TOKEN, NOW);
    assert.deepEqual(safe, { ...USER, username: '_123_name' });
  }
  const session = await createBrowserSession({ ...user, kind: 'telegram' }, SESSION_SECRET, NOW);
  assert.deepEqual(await verifyBrowserSession(session.token, SESSION_SECRET, NOW), { ...user, kind: 'telegram' });
  for (const username of ['spaces not allowed', '<script>', 'a'.repeat(33), 'юзер']) {
    assert.equal(await verifyTelegramInitData(signed({ user: JSON.stringify({ ...USER, username }) }), TOKEN, NOW), null);
  }
  assert.deepEqual(await verifyTelegramInitData(signed({ user: JSON.stringify({ ...USER, username: '', photo_url: '' }) }), TOKEN, NOW), { id: USER.id, first_name: USER.first_name, last_name: USER.last_name });
});

test('secret comparison handles Unicode bytes, different lengths and absent configuration', () => {
  assert.equal(constantTimeEqual('таємний ключ', 'таємний ключ'), true);
  assert.equal(constantTimeEqual('secret-one', 'secret-two'), false);
  assert.equal(constantTimeEqual('a', 'aa'), false);
  assert.equal(constantTimeEqual(undefined, undefined), false);
  assert.equal(constantTimeEqual('', ''), false);
});

test('signed browser credentials keep Telegram identity for twelve hours and guest identity for return visits', async () => {
  const telegram = { ...USER, kind: 'telegram' };
  const session = await createBrowserSession(telegram, SESSION_SECRET, NOW);
  assert.equal(session.expiresAt, NOW + 43200000);
  assert.deepEqual(await verifyBrowserSession(session.token, SESSION_SECRET, NOW), telegram);
  assert.deepEqual(await verifyBrowserSession(session.token, SESSION_SECRET, session.expiresAt - 1), telegram);
  assert.equal(await verifyBrowserSession(session.token, SESSION_SECRET, session.expiresAt), null);
  const guest = { kind: 'guest', id: '00000000-0000-4000-8000-000000000001', name: '  Мій\u200b   нік  ' };
  const anonymous = await createBrowserSession(guest, SESSION_SECRET, NOW);
  assert.equal(anonymous.expiresAt, NOW + 365 * 86400000);
  assert.deepEqual(await verifyBrowserSession(anonymous.token, SESSION_SECRET, NOW + 30 * 86400000), { ...guest, name: 'Мій нік' });
  assert.equal(await verifyBrowserSession(anonymous.token, SESSION_SECRET, anonymous.expiresAt), null);
});

test('browser credentials accept server-issued bounded photo metadata with long Unicode names', async () => {
  const prefix = 'https://t.me/i/userpic/320/';
  const identity = { ...USER, kind: 'telegram', first_name: 'І'.repeat(256), last_name: 'Ї'.repeat(256), photo_url: prefix + 'a'.repeat(2048 - prefix.length) };
  const session = await createBrowserSession(identity, SESSION_SECRET, NOW);
  assert.ok(session.token.length > 4096);
  assert.deepEqual(await verifyBrowserSession(session.token, SESSION_SECRET, NOW), identity);
});

test('browser credentials reject tampered identity, signatures, other secrets and malformed tokens', async () => {
  const session = await createBrowserSession({ ...USER, kind: 'telegram' }, SESSION_SECRET, NOW);
  const [payload, signature] = session.token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  claims.identity.id += 1;
  const forged = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
  assert.equal(await verifyBrowserSession(forged, SESSION_SECRET, NOW), null);
  assert.equal(await verifyBrowserSession(session.token, `${SESSION_SECRET}_different`, NOW), null);
  for (const token of [null, '', 'x'.repeat(4097), `${payload}.invalid`, `${payload}.${signature}.extra`, `${payload}=.${signature}`, `${payload}.${signature}=`, `${payload}.${signature.slice(0, -1)}`]) {
    assert.equal(await verifyBrowserSession(token, SESSION_SECRET, NOW), null);
  }
  assert.equal(await verifyBrowserSession(session.token, SESSION_SECRET, NOW - 61000), null);
  assert.equal(await verifyBrowserSession(session.token, '', NOW), null);
});

test('session creation rejects missing configuration, malformed identities and client stats', async () => {
  for (const identity of [null, {}, { ...USER }, { ...USER, kind: 'telegram', is_bot: true }, { ...USER, kind: 'telegram', id: -1 }, { kind: 'guest', id: 'not-a-uuid', name: 'Ім’я' }, { kind: 'guest', id: '00000000-0000-4000-8000-000000000001', name: '' }]) {
    await assert.rejects(createBrowserSession(identity, SESSION_SECRET, NOW), error => error.code === 'AUTH');
  }
  await assert.rejects(createBrowserSession({ ...USER, kind: 'telegram' }, 'too-short', NOW), error => error.code === 'AUTH_SETUP');
  const credential = await createBrowserSession({ ...USER, kind: 'telegram', stats: { wins: 999 }, ownedPacks: ['anime'] }, SESSION_SECRET, NOW);
  const identity = await verifyBrowserSession(credential.token, SESSION_SECRET, NOW);
  assert.equal(Object.hasOwn(identity, 'stats'), false);
  assert.equal(Object.hasOwn(identity, 'ownedPacks'), false);
});

test('Bot API helper uses a timeout and returns sanitized errors without leaking secrets', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
  };
  assert.equal(await telegramCall({ HVYLIA_BOT_TOKEN: TOKEN }, 'answerPreCheckoutQuery', { pre_checkout_query_id: 'checkout', ok: true }), true);
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(calls[0].options.body), { pre_checkout_query_id: 'checkout', ok: true });
  globalThis.fetch = async () => { throw new Error(`Request failed at https://api.telegram.org/bot${TOKEN}/method private-payload`); };
  await assert.rejects(telegramCall({ HVYLIA_BOT_TOKEN: TOKEN }, 'createInvoiceLink', {}), error => {
    assert.equal(error.code, 'TELEGRAM_UNAVAILABLE');
    assert.equal(error.message.includes(TOKEN), false);
    assert.equal(error.message.includes('private-payload'), false);
    return true;
  });
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, description: `${TOKEN} upstream error` }), { status: 400 });
  await assert.rejects(telegramCall({ HVYLIA_BOT_TOKEN: TOKEN }, 'createInvoiceLink', {}), error => error.code === 'TELEGRAM_UNAVAILABLE' && !error.message.includes(TOKEN));
  await assert.rejects(telegramCall({}, 'createInvoiceLink', {}), error => error.code === 'TELEGRAM_SETUP');
});
