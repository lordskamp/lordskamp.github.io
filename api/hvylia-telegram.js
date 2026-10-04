import { timingSafeEqual } from 'node:crypto';

const encoder = new TextEncoder();
const AUTH_LIFETIME_SECONDS = 12 * 60 * 60;

function telegramFault(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

export function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const first = encoder.encode(left);
  const second = encoder.encode(right);
  return first.byteLength === second.byteLength && timingSafeEqual(first, second);
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
