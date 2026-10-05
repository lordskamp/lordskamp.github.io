import { timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();
const AUTH_LIFETIME_SECONDS = 12 * 60 * 60;
const GUEST_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const SESSION_PURPOSE = 'hvylia-browser-v1';
const MAX_AVATAR_BYTES = 512 * 1024;

export function telegramPhotoUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    const host = url.hostname;
    if (!(host === 't.me' && url.pathname.startsWith('/i/userpic/')) && host !== 'telegram.org'
      && !/^cdn\d*\.(?:telesco\.pe|telegram\.org)$/u.test(host)) return null;
    return url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}

/** Metadata is trusted only after Mini App HMAC, browser HMAC or bot-webhook validation. */
export function telegramUser(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.id) || value.id <= 0 || value.id > 4503599627370495
    || typeof value.first_name !== 'string' || !value.first_name.trim() || value.first_name.length > 256
    || (value.last_name !== undefined && (typeof value.last_name !== 'string' || value.last_name.length > 256))
    || (value.username !== undefined && value.username !== '' && (typeof value.username !== 'string' || !/^[A-Za-z0-9_]{1,32}$/u.test(value.username))) || value.is_bot === true) return null;
  return { id: value.id, first_name: value.first_name,
    ...(value.last_name !== undefined ? { last_name: value.last_name } : {}),
    ...(value.username ? { username: value.username } : {}),
    ...(telegramPhotoUrl(value.photo_url) ? { photo_url: telegramPhotoUrl(value.photo_url) } : {}) };
}

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
  const user = value.kind === 'telegram' ? telegramUser(value) : null;
  return user ? { ...user, kind: 'telegram' } : null;
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
  if (typeof token !== 'string' || !token || token.length > 8192 || !Number.isFinite(now) || now < 0) return null;
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
    return telegramUser(JSON.parse(params.get('user') || 'null'));
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
      redirect: 'error',
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

async function rasterImage(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
  const type = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type)
    || Number(response.headers.get('Content-Length')) > MAX_AVATAR_BYTES || !response.body) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_AVATAR_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  // Reject active content even if an upstream responds with a misleading image MIME.
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!(type === 'image/jpeg' && jpeg || type === 'image/png' && png || type === 'image/webp' && webp)) return null;
  return { bytes, type };
}

/** Return only bounded raster bytes. Bot token, file paths and Telegram IDs never reach clients. */
export async function telegramAvatar(env, userId, photoUrl = null) {
  try {
    const source = telegramPhotoUrl(photoUrl);
    if (source) {
      try { const image = await rasterImage(source); if (image) return image; }
      catch { /* An unsupported/private CDN image can fall back to Bot API raster photos. */ }
    }
    if (!Number.isSafeInteger(userId) || userId <= 0 || userId > 4503599627370495) return null;
    const photos = await telegramCall(env, 'getUserProfilePhotos', { user_id: userId, limit: 1 });
    const sizes = Array.isArray(photos?.photos?.[0]) ? photos.photos[0] : [];
    const usable = sizes.filter(photo => typeof photo?.file_id === 'string' && /^[A-Za-z0-9_-]{1,512}$/u.test(photo.file_id)
      && Number.isSafeInteger(photo.width) && Number.isSafeInteger(photo.height)
      && photo.width > 0 && photo.height > 0 && (!photo.file_size || Number.isSafeInteger(photo.file_size) && photo.file_size <= MAX_AVATAR_BYTES));
    const photo = usable.filter(item => item.width >= 160).sort((a, b) => a.width - b.width)[0] || usable.sort((a, b) => b.width - a.width)[0];
    if (!photo) return null;
    const file = await telegramCall(env, 'getFile', { file_id: photo.file_id });
    if (typeof file?.file_path !== 'string' || !/^[A-Za-z0-9_/-]+\.(?:jpe?g|png|webp)$/iu.test(file.file_path)
      || file.file_path.split('/').some(part => !part || part === '.' || part === '..')
      || file.file_path.length > 512 || (file.file_size && (!Number.isSafeInteger(file.file_size) || file.file_size > MAX_AVATAR_BYTES))) return null;
    return await rasterImage(`https://api.telegram.org/file/bot${env.HVYLIA_BOT_TOKEN}/${file.file_path}`);
  } catch { return null; }
}
