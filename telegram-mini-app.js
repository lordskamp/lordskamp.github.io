/*
 * Small Telegram WebApp adapter for the vanilla Unwordle game.
 * It deliberately keeps the game playable as a normal web page too.
 */
(() => {
    'use strict';

    const CLOUD_VALUE_LIMIT = 3900;
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

    function cloudStorage() {
        return getApp()?.CloudStorage || null;
    }

    function restoreCloudStorage(keys) {
        const storage = cloudStorage();
        if (!storage || !Array.isArray(keys) || !keys.length) return Promise.resolve({});

        return new Promise(resolve => {
            try {
                storage.getItems(keys, (error, values) => {
                    if (error || !values) {
                        resolve({});
                        return;
                    }

                    Object.entries(values).forEach(([key, value]) => {
                        if (typeof value !== 'string' || !value) return;
                        try {
                            window.localStorage.setItem(key, value);
                        } catch (_) {
                            /* The game still works if browser storage is unavailable. */
                        }
                    });
                    resolve(values);
                });
            } catch (_) {
                resolve({});
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
            const shareUrl = new URL('https://t.me/share/url');
            shareUrl.searchParams.set('url', url || window.location.href);
            shareUrl.searchParams.set('text', text || '');
            app.openTelegramLink(shareUrl.toString());
            return true;
        } catch (_) {
            return false;
        }
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
        if (!app) return false;

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
        try {
            app.onEvent?.('themeChanged', updateTheme);
        } catch (_) {
            /* Theme variables are still provided by Telegram when events are unavailable. */
        }

        await restoreCloudStorage(cloudKeys);
        return true;
    }

    window.KobzaTelegram = {
        init,
        isAvailable,
        getInitData,
        getStartParam,
        getPlayerName,
        haptic,
        share,
        setBackHandler,
        setBackButtonVisible,
        setCloudValue,
        removeCloudValue
    };
})();
