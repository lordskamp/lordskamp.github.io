import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTelegramInitData } from '../api/shyfr-api.js';

function hex(buffer) {
  return Buffer.from(buffer).toString('hex');
}

async function signInitData(token, values) {
  const params = new URLSearchParams(values);
  const data = Array.from(params.entries()).map(([key, value]) => `${key}=${value}`).sort().join('\n');
  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(token));
  const signingKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  params.set('hash', hex(await crypto.subtle.sign('HMAC', signingKey, encoder.encode(data))));
  return params.toString();
}

test('Telegram initData приймається лише з правильним підписом і свіжою датою', async () => {
  const token = 'test-token:never-a-production-secret';
  const nowSeconds = 1_800_000_000;
  const initData = await signInitData(token, {
    auth_date: String(nowSeconds - 10),
    query_id: 'query',
    user: JSON.stringify({ id: 123456, first_name: 'Тест' })
  });
  assert.equal((await validateTelegramInitData(initData, token, { nowSeconds })).ok, true);
  assert.equal((await validateTelegramInitData(initData, 'wrong-token', { nowSeconds })).reason, 'INVALID_HASH');
  assert.equal((await validateTelegramInitData(initData, token, { nowSeconds: nowSeconds + 90_000 })).reason, 'EXPIRED_INIT_DATA');
});
