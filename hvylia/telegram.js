// Signed launch data stays in memory and is verified by the server on each request.
let webApp = null;
let signedLaunchData = '';
let launchedFromTelegram = false;
let backHandler = null;

function supported(version) { return !webApp?.isVersionAtLeast || webApp.isVersionAtLeast(version); }

function updateInsets() {
  const root = document.documentElement;
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    const system = Math.max(0, Number(webApp?.safeAreaInset?.[edge]) || 0);
    const content = Math.max(0, Number(webApp?.contentSafeAreaInset?.[edge]) || 0);
    root.style.setProperty(`--mini-safe-${edge}`, `${system + content}px`);
  }
}

async function initialize() {
  const launch = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  const launched = launch.has('tgWebAppData') || query.has('tgWebAppData') || launch.has('tgWebAppPlatform');
  launchedFromTelegram = launched;
  if (!window.Telegram?.WebApp && launched) {
    await new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'https://telegram.org/js/telegram-web-app.js';
      const timer = window.setTimeout(resolve, 5000);
      const done = () => { window.clearTimeout(timer); resolve(); };
      script.addEventListener('load', done, { once: true });
      script.addEventListener('error', done, { once: true });
      document.head.append(script);
    });
  }
  webApp = window.Telegram?.WebApp || null;
  signedLaunchData = typeof webApp?.initData === 'string' ? webApp.initData : '';
  if (!webApp || !signedLaunchData) return;
  document.body.classList.add('telegram-mini-app');
  webApp.ready?.();
  webApp.expand?.();
  try {
    webApp.setHeaderColor?.('#f5f2ea');
    webApp.setBackgroundColor?.('#f5f2ea');
    if (supported('7.10')) webApp.setBottomBarColor?.('#f5f2ea');
  } catch { /* Older clients keep their own chrome colours. */ }
  updateInsets();
  webApp.onEvent?.('safeAreaChanged', updateInsets);
  webApp.onEvent?.('contentSafeAreaChanged', updateInsets);
  webApp.onEvent?.('viewportChanged', updateInsets);
  webApp.BackButton?.onClick(() => backHandler?.());
}

export const telegramReady = initialize();
export function telegramHeaders() {
  if (launchedFromTelegram && !signedLaunchData) throw { code: 'TELEGRAM_AUTH' };
  return signedLaunchData ? { 'X-Telegram-Init-Data': signedLaunchData } : {};
}
export function inTelegram() { return Boolean(webApp && signedLaunchData); }
export function setTelegramBack(handler) {
  backHandler = handler;
  if (!inTelegram() || !supported('6.1')) return;
  if (handler) webApp.BackButton?.show();
  else webApp.BackButton?.hide();
}
export function telegramRoomCode() {
  // A launch parameter selects a public room only; it never proves identity.
  const start = new URLSearchParams(signedLaunchData).get('start_param') || '';
  return /^room_[A-Z0-9]{4}$/u.test(start) ? start.slice(5) : '';
}
export function openTelegram(botUsername, start = 'hvylia') {
  const username = String(botUsername || '').replace(/^@/u, '');
  if (!/^[A-Za-z0-9_]{5,32}$/u.test(username)) return false;
  const url = `https://t.me/${username}?startapp=${encodeURIComponent(start)}`;
  if (inTelegram() && supported('6.1')) webApp.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
export async function openStarInvoice(invoiceLink) {
  await telegramReady;
  if (!inTelegram() || !supported('6.1') || !webApp.openInvoice) throw { code: 'TELEGRAM_REQUIRED' };
  const url = new URL(invoiceLink);
  if (url.protocol !== 'https:' || url.hostname !== 't.me') throw { code: 'INVOICE_INVALID' };
  return new Promise(resolve => webApp.openInvoice(url.href, resolve));
}
