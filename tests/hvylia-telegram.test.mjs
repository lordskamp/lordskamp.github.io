import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { constantTimeEqual, telegramCall, verifyTelegramInitData } from '../api/hvylia-telegram.js';

const TOKEN = '123456:local_test_bot_token';
const NOW = Date.UTC(2026, 9, 4, 10, 0, 0);
const USER = { id: 123456789, first_name: 'Соломія', last_name: 'Гончар', username: 'solomiia' };

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

test('secret comparison handles Unicode bytes, different lengths and absent configuration', () => {
  assert.equal(constantTimeEqual('таємний ключ', 'таємний ключ'), true);
  assert.equal(constantTimeEqual('secret-one', 'secret-two'), false);
  assert.equal(constantTimeEqual('a', 'aa'), false);
  assert.equal(constantTimeEqual(undefined, undefined), false);
  assert.equal(constantTimeEqual('', ''), false);
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
