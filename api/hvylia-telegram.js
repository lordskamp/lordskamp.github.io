import { timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();
const AUTH_LIFETIME_SECONDS = 12 * 60 * 60;
const GUEST_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const SESSION_PURPOSE = 'hvylia-browser-v1';

function telegramFault(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

export function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const first = encoder.encode(left);
  const second = encoder.encode(right);
  return first.byteLength === second.byteLength && timingSafeEqual(first, second);
}

function browserIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kind === 'guest') {
    if (typeof value.id !== 'string' || !UUID.test(value.id) || typeof value.name !== 'string') return null;
    const name = value.name.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/gu, ' ').trim();
    if (!name || Array.from(name).length > 64) return null;
    return { kind: 'guest', id: value.id.toLowerCase(), name };
  }
  if (value.kind !== 'telegram' || !Number.isSafeInteger(value.id) || value.id <= 0 || value.id > 4503599627370495
    || typeof value.first_name !== 'string' || !value.first_name.trim() || value.first_name.length > 256
    || (value.last_name !== undefined && (typeof value.last_name !== 'string' || value.last_name.length > 256))
    || (value.username !== undefined && (typeof value.username !== 'string' || value.username.length > 64)) || value.is_bot === true) return null;
  return { kind: 'telegram', id: value.id, first_name: value.first_name,
    ...(value.last_name !== undefined ? { last_name: value.last_name } : {}),
    ...(value.username !== undefined ? { username: value.username } : {}) };
}

function base64url(bytes) {
  return globalThis.btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function decodeBase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid encoding');
  const raw = globalThis.atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - value.length % 4) % 4));
  const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
  if (base64url(bytes) !== value) throw new Error('Noncanonical encoding');
  return bytes;
}

async function browserSigningKey(secret, usage) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 1024) throw telegramFault('AUTH_SETUP', 'Вхід ще не налаштовано.', 503);
  return crypto.subtle.importKey('raw', encoder.encode(`${SESSION_PURPOSE}\n${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** Server-issued identity credentials; nickname alone never recovers somebody else's stats. */
export async function createBrowserSession(identity, secret, now = Date.now()) {
  const normalized = browserIdentity(identity);
  if (!normalized || !Number.isFinite(now) || now < 0) throw telegramFault('AUTH', 'Не вдалося підтвердити профіль.', 401);
  const issued = Math.floor(now / 1000);
  const expires = issued + (normalized.kind === 'guest' ? GUEST_LIFETIME_SECONDS : AUTH_LIFETIME_SECONDS);
  const payload = base64url(encoder.encode(JSON.stringify({ purpose: SESSION_PURPOSE, iat: issued, exp: expires, identity: normalized })));
  const key = await browserSigningKey(secret, 'sign');
  const signature = base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
  return { token: `${payload}.${signature}`, expiresAt: expires * 1000 };
}

/** Expiry, signature and bounded identity shape are checked before exposing an account. */
export async function verifyBrowserSession(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !token || token.length > 4096 || !Number.isFinite(now) || now < 0) return null;
  try {
    const segments = token.split('.');
    if (segments.length !== 2) return null;
    const [payload, signature] = segments;
    const signatureBytes = decodeBase64url(signature);
    if (signatureBytes.byteLength !== 32) return null;
    const key = await browserSigningKey(secret, 'verify');
    if (!await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(payload))) return null;
    const claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64url(payload)));
    const identity = browserIdentity(claims.identity);
    const seconds = Math.floor(now / 1000);
    if (!identity || claims.purpose !== SESSION_PURPOSE || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
      || claims.iat < 0 || claims.iat > seconds + 60 || claims.exp <= seconds
      || claims.exp - claims.iat !== (identity.kind === 'guest' ? GUEST_LIFETIME_SECONDS : AUTH_LIFETIME_SECONDS)) return null;
    return identity;
  } catch { return null; }
}

/** Verify Telegram's Mini App HMAC, including every signed field except hash. */
export async function verifyTelegramInitData(raw, token, now = Date.now()) {
  if (typeof raw !== 'string' || !raw || raw.length > 16384 || typeof token !== 'string' || !token || !Number.isFinite(now)) return null;
  try {
    const params = new URLSearchParams(raw);
    const seen = new Set();
    for (const [key] of params) {
      if (seen.has(key)) return null;
      seen.add(key);
    }
    const hash = params.get('hash');
    if (!/^[a-f0-9]{64}$/iu.test(hash || '')) return null;
    const authDate = params.get('auth_date');
    if (!/^\d{1,12}$/u.test(authDate || '')) return null;
    const timestamp = Number(authDate);
    const seconds = Math.floor(now / 1000);
    if (timestamp > seconds + 60 || seconds - timestamp > AUTH_LIFETIME_SECONDS) return null;
    const check = [...params.entries()]
      .filter(([key]) => key !== 'hash')
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, value]) => `${key}=${value}`).join('\n');
    const baseKey = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const secret = await crypto.subtle.sign('HMAC', baseKey, encoder.encode(token));
    const signingKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const signature = new Uint8Array(hash.match(/../gu).map(byte => Number.parseInt(byte, 16)));
    // Native cryptographic verification avoids a data-dependent JavaScript string comparison.
    if (!await crypto.subtle.verify('HMAC', signingKey, signature, encoder.encode(check))) return null;
    const user = JSON.parse(params.get('user') || 'null');
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.id > 4503599627370495
      || typeof user.first_name !== 'string' || !user.first_name.trim() || user.first_name.length > 256
      || (user.last_name !== undefined && typeof user.last_name !== 'string') || user.is_bot === true) return null;
    return user;
  } catch { return null; }
}

/** Bot API errors never expose the request URL, bot token, payload or upstream description. */
export async function telegramCall(env, method, params) {
  const token = env?.HVYLIA_BOT_TOKEN;
  if (typeof token !== 'string' || !/^\d+:[A-Za-z0-9_-]+$/u.test(token)) {
    throw telegramFault('TELEGRAM_SETUP', 'Telegram-бот ще не підключено.', 503);
  }
  if (typeof method !== 'string' || !/^[A-Za-z]+$/u.test(method)) throw telegramFault('TELEGRAM_METHOD', 'Некоректний запит до Telegram.');
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(8000)
    });
    const data = await response.json();
    if (!response.ok || data?.ok !== true) throw new Error('Bot API failure');
    return data.result;
  } catch {
    throw telegramFault('TELEGRAM_UNAVAILABLE', 'Telegram зараз недоступний. Спробуйте ще раз.', 503);
  }
}
