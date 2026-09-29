/** Optional Telegram bridge. All calculator logic also works without this SDK. */
let activeApp = null;
let backHandler = null;

function getApp() {
  const app = globalThis.window?.Telegram?.WebApp;
  return app?.platform && app.platform !== 'unknown' && typeof app.ready === 'function'
    ? app
    : null;
}

function safely(callback) {
  try {
    callback();
    return true;
  } catch {
    // Older Telegram clients and unavailable native features must not stop the page.
    return false;
  }
}

function supports(app, version) {
  return typeof app?.isVersionAtLeast === 'function' && app.isVersionAtLeast(version);
}

function updateTheme() {
  const app = activeApp;
  const root = globalThis.document?.documentElement;
  if (!app || !root) return;
  root.dataset.telegram = 'true';
  root.dataset.telegramTheme = app.colorScheme === 'dark' ? 'dark' : 'light';
  root.style.setProperty('--tg-color-scheme', root.dataset.telegramTheme);

  for (const [key, value] of Object.entries(app.themeParams || {})) {
    if (/^[a-z_]+$/.test(key) && /^#[0-9a-f]{6}$/i.test(value)) {
      root.style.setProperty(`--tg-theme-${key.replaceAll('_', '-')}`, value);
    }
  }
}

function updateViewport() {
  const app = activeApp;
  const root = globalThis.document?.documentElement;
  if (!app || !root) return;

  for (const [property, value] of [
    ['--tg-viewport-height', app.viewportHeight],
    ['--tg-viewport-stable-height', app.viewportStableHeight]
  ]) {
    if (Number.isFinite(value) && value > 0) root.style.setProperty(property, `${value}px`);
  }

  for (const [prefix, insets] of [
    ['--tg-safe-area-inset', app.safeAreaInset],
    ['--tg-content-safe-area-inset', app.contentSafeAreaInset]
  ]) {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const value = insets?.[side];
      if (Number.isFinite(value) && value >= 0) root.style.setProperty(`${prefix}-${side}`, `${value}px`);
    }
  }
}

function handleBack() {
  backHandler?.();
}

function syncBackButton() {
  const app = activeApp;
  if (!app?.BackButton || !supports(app, '6.1')) return;
  if (backHandler) app.BackButton.show();
  else app.BackButton.hide();
}

/** Call after the first render. Returns false in a normal browser; safe to call again. */
export function initTelegram() {
  const app = getApp();
  if (!app) return false;
  if (activeApp === app) return true;
  activeApp = app;

  safely(updateTheme);
  safely(updateViewport);
  for (const event of ['themeChanged', 'viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged']) {
    const listener = event === 'themeChanged' ? updateTheme : updateViewport;
    safely(() => app.onEvent?.(event, listener));
  }
  safely(() => {
    if (supports(app, '6.1')) app.BackButton?.onClick(handleBack);
  });
  safely(syncBackButton);
  safely(() => app.ready());
  safely(() => app.expand?.());
  return true;
}

/** Register only while an internal view is open; pass null when returning to the calculator. */
export function setBackHandler(callback = null) {
  backHandler = typeof callback === 'function' ? callback : null;
  safely(syncBackButton);
}

/** 'selection' for a changed option; 'success', 'warning', 'error', or an impact style. */
export function haptic(kind = 'selection') {
  const app = activeApp || getApp();
  if (!app?.HapticFeedback) return false;
  return safely(() => {
    if (!supports(app, '6.1')) return;
    if (kind === 'selection') app.HapticFeedback.selectionChanged();
    else if (['success', 'warning', 'error'].includes(kind)) app.HapticFeedback.notificationOccurred(kind);
    else if (['light', 'medium', 'heavy', 'rigid', 'soft'].includes(kind)) app.HapticFeedback.impactOccurred(kind);
  });
}

/** Open a reference from a click handler, keeping the current calculator in place. */
export function openSource(value) {
  const browser = globalThis.window;
  const document = globalThis.document;
  if (!browser || !document) return false;
  let url;
  try {
    url = new URL(value, document.baseURI);
  } catch {
    return false;
  }
  if (!['https:', 'http:'].includes(url.protocol)) return false;
  const app = activeApp || getApp();
  if (typeof app?.openLink === 'function' && safely(() => app.openLink(url.href))) return true;
  return safely(() => {
    const link = document.createElement('a');
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.append(link);
    link.click();
    link.remove();
  });
}
