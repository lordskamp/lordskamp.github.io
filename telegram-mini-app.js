/*
 * Small Telegram WebApp adapter for the vanilla Unwordle game.
 * It deliberately keeps the game playable as a normal web page too.
 */
(() => {
    'use strict';

    const CLOUD_VALUE_LIMIT = 3900;
    const CLOUD_STORAGE_TIMEOUT_MS = 3000;
    const CLOUD_STORAGE_KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;
    let backHandler = null;

    function getApp() {
        const app = window.Telegram?.WebApp;
        if (!app || typeof app.ready !== 'function') return null;
        return app.platform && app.platform !== 'unknown' ? app : null;
    }

    function isAvailable() {
        return Boolean(getApp());
    }

    function updateTheme() {
        const app = getApp();
        if (!app) return;

        const themeColor = app.themeParams?.bg_color || app.themeParams?.secondary_bg_color;
        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor && metaThemeColor) metaThemeColor.content = themeColor;

        document.documentElement.dataset.telegramTheme = app.colorScheme || 'dark';
    }

    function updateViewport() {
        const app = getApp();
        if (!app) return;
        const root = document.documentElement;
        const stableHeight = Number(app.viewportStableHeight || app.viewportHeight || 0);
        if (stableHeight > 0) root.style.setProperty('--telegram-stable-height', `${stableHeight}px`);

        const safe = app.safeAreaInset || {};
        const contentSafe = app.contentSafeAreaInset || {};
        ['top', 'right', 'bottom', 'left'].forEach(side => {
            const safeValue = Number(safe[side]);
            const contentValue = Number(contentSafe[side]);
            if (Number.isFinite(safeValue)) root.style.setProperty(`--telegram-safe-${side}`, `${safeValue}px`);
            if (Number.isFinite(contentValue)) root.style.setProperty(`--telegram-content-safe-${side}`, `${contentValue}px`);
        });
    }

    function cloudStorage() {
        return getApp()?.CloudStorage || null;
    }

    function restoreCloudStorage(keys) {
        const storage = cloudStorage();
        const entries = Array.isArray(keys)
            ? keys.map(item => ({
                cloudKey: String(item?.cloudKey || item || '').trim(),
                localKey: String(item?.localKey || item?.cloudKey || item || '').trim()
            })).filter(item => item.cloudKey && item.localKey)
            : [];

        if (!storage) return Promise.resolve({ ok: false, reason: 'unavailable' });
        if (!entries.length || entries.some(item => !CLOUD_STORAGE_KEY_RE.test(item.cloudKey))) {
            return Promise.resolve({ ok: false, reason: 'invalid-key' });
        }

        return new Promise(resolve => {
            let settled = false;
            let timeoutId = null;

            const finish = result => {
                if (settled) return;
                settled = true;
                if (timeoutId) window.clearTimeout(timeoutId);
                resolve(result);
            };

            timeoutId = window.setTimeout(() => finish({ ok: false, reason: 'timeout' }), CLOUD_STORAGE_TIMEOUT_MS);

            try {
                storage.getItems(entries.map(item => item.cloudKey), (error, values) => {
                    if (error) {
                        finish({ ok: false, reason: 'request-failed' });
                        return;
                    }

                    entries.forEach(({ cloudKey, localKey }) => {
                        const value = values?.[cloudKey];
                        try {
                            if (typeof value === 'string' && value) {
                                window.localStorage.setItem(localKey, value);
                            } else {
                                window.localStorage.removeItem(localKey);
                            }
                        } catch (_) {
                            finish({ ok: false, reason: 'sync-failed' });
                        }
                    });
                    finish({ ok: true });
                });
            } catch (_) {
                finish({ ok: false, reason: 'request-failed' });
            }
        });
    }

    function setCloudValue(key, value) {
        const storage = cloudStorage();
        const serialized = String(value ?? '');
        if (!storage || serialized.length > CLOUD_VALUE_LIMIT) return;

        try {
            storage.setItem(key, serialized, () => {});
        } catch (_) {
            /* CloudStorage is a convenience layer, not a game requirement. */
        }
    }

    function removeCloudValue(key) {
        const storage = cloudStorage();
        if (!storage) return;

        try {
            storage.removeItem(key, () => {});
        } catch (_) {
            /* CloudStorage is a convenience layer, not a game requirement. */
        }
    }

    function haptic(kind = 'light') {
        const feedback = getApp()?.HapticFeedback;
        if (!feedback) return;

        try {
            if (kind === 'success' || kind === 'error' || kind === 'warning') {
                feedback.notificationOccurred(kind);
            } else if (kind === 'selection') {
                feedback.selectionChanged();
            } else {
                feedback.impactOccurred(kind);
            }
        } catch (_) {
            /* Haptics are not supported by every Telegram client. */
        }
    }

    function share(text, url) {
        const app = getApp();
        if (!app?.openTelegramLink) return false;

        try {
            // URLSearchParams serializes spaces as "+". Some Telegram clients show
            // those characters literally, so percent-encode both share parameters.
            // Telegram places the caption before the shared link in the compose field.
            const shareUrl = `https://t.me/share/url?text=${encodeURIComponent(String(text || '').trim())}&url=${encodeURIComponent(String(url || window.location.href).trim())}`;
            app.openTelegramLink(shareUrl);
            return true;
        } catch (_) {
            return false;
        }
    }

    function openInvoice(url) {
        const app = getApp();
        if (!app?.openInvoice || !url) return Promise.resolve('unavailable');

        return new Promise(resolve => {
            let settled = false;
            const finish = status => {
                if (settled) return;
                settled = true;
                resolve(String(status || 'failed'));
            };

            try {
                app.openInvoice(url, finish);
            } catch (_) {
                finish('failed');
            }
        });
    }

    function openLink(url) {
        const app = getApp();
        if (!app?.openLink || !url) return false;
        try {
            app.openLink(String(url));
            return true;
        } catch (_) {
            return false;
        }
    }

    function showConfirm(message) {
        const app = getApp();
        if (!app?.showConfirm) return Promise.resolve(window.confirm(String(message || 'Підтвердити дію?')));
        return new Promise(resolve => {
            try {
                app.showConfirm(String(message || 'Підтвердити дію?'), value => resolve(Boolean(value)));
            } catch (_) {
                resolve(window.confirm(String(message || 'Підтвердити дію?')));
            }
        });
    }

    function setBackHandler(handler) {
        const app = getApp();
        backHandler = typeof handler === 'function' ? handler : null;
        if (!app?.BackButton) return;

        try {
            app.BackButton.offClick(onBackClick);
            if (backHandler) {
                app.BackButton.onClick(onBackClick);
            }
            app.BackButton.hide();
        } catch (_) {
            /* BackButton is unavailable in older Telegram clients. */
        }
    }

    function setBackButtonVisible(isVisible) {
        const button = getApp()?.BackButton;
        if (!button || !backHandler) return;

        try {
            if (isVisible) button.show();
            else button.hide();
        } catch (_) {
            /* BackButton is unavailable in older Telegram clients. */
        }
    }

    function onBackClick() {
        backHandler?.();
    }

    function getPlayerName() {
        const user = getApp()?.initDataUnsafe?.user;
        if (!user) return '';
        return String(user.username || [user.first_name, user.last_name].filter(Boolean).join(' ') || '').trim();
    }

    function getInitData() {
        const app = getApp();
        return typeof app?.initData === 'string' ? app.initData : '';
    }

    function getStartParam() {
        const appValue = getApp()?.initDataUnsafe?.start_param;
        const urlValue = new URLSearchParams(window.location.search).get('tgWebAppStartParam');
        return String(appValue || urlValue || '').trim();
    }

    async function init({ cloudKeys = [] } = {}) {
        const app = getApp();
        if (!app) return { telegram: false, cloudStorage: { ok: false, reason: 'unavailable' } };

        document.documentElement.classList.add('telegram-mini-app');
        document.body.classList.add('telegram-mini-app');

        // Call ready before awaiting storage or the word list, so Telegram removes its loader promptly.
        try {
            app.ready();
            app.expand();
            app.setHeaderColor?.('bg_color');
            app.setBackgroundColor?.('bg_color');
        } catch (_) {
            /* The core game does not depend on optional Telegram capabilities. */
        }

        updateTheme();
        updateViewport();
        try {
            app.onEvent?.('themeChanged', updateTheme);
            app.onEvent?.('viewportChanged', updateViewport);
            app.onEvent?.('safeAreaChanged', updateViewport);
            app.onEvent?.('contentSafeAreaChanged', updateViewport);
        } catch (_) {
            /* Theme variables are still provided by Telegram when events are unavailable. */
        }

        return {
            telegram: true,
            cloudStorage: await restoreCloudStorage(cloudKeys)
        };
    }

    const adapter = {
        init,
        isAvailable,
        getInitData,
        getStartParam,
        getPlayerName,
        haptic,
        share,
        openLink,
        openInvoice,
        showConfirm,
        setBackHandler,
        setBackButtonVisible,
        setCloudValue,
        removeCloudValue
    };

    window.SiteTelegram = adapter;
    window.KobzaTelegram = adapter;
})();
