(() => {
    'use strict';

    const STORAGE = {
        theme: 'lordskamp:theme',
        language: 'lordskamp:language'
    };
    const LANGS = ['uk', 'en'];
    const THEMES = ['light', 'dark'];
    const labels = {
        uk: {
            back: 'Назад',
            brand: 'Lordskamp',
            language: 'Мова',
            themeLight: 'Світла тема',
            themeDark: 'Темна тема',
            profileKicker: 'Юрій Гончаренко',
            profileBio: 'Графічний / моушн-дизайнер. Брендинг, анімація, AR-ефекти та креативні AI-воркфлоу.',
            copyNick: 'Скопіювати нік',
            copied: 'Скопійовано!',
            openPortfolio: 'Портфоліо',
            close: 'Закрити'
        },
        en: {
            back: 'Back',
            brand: 'Lordskamp',
            language: 'Language',
            themeLight: 'Light theme',
            themeDark: 'Dark theme',
            profileKicker: 'Yurii Honcharenko',
            profileBio: 'Graphic / motion designer. Branding, animation, AR effects, and creative AI workflows.',
            copyNick: 'Copy nickname',
            copied: 'Copied!',
            openPortfolio: 'Portfolio',
            close: 'Close'
        }
    };
    const brandColors = {
        Instagram: '#E1306C',
        TikTok: '#ffffff',
        Facebook: '#1877F2',
        Telegram: '#24A1DE',
        LinkedIn: '#0077b5',
        Steam: '#66c0f4',
        Tinder: '#fe3c72',
        YouTube: '#FF0000',
        WhatsApp: '#25D366',
        Viber: '#7360f2',
        Email: '#4ade80',
        Language: '#06b6d4',
        Wishlist: '#a78bfa',
        Meta: '#0668E1',
        Theme: '#fbbf24',
        Threads: '#ffffff',
        Behance: '#0057ff',
        'Instagram-Portfolio': '#ff306c',
        Resume: '#8b5cf6',
        Portfolio: '#8c3dc1',
        Lordskamp: '#8c3dc1'
    };

    function safeGet(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (_) {
            return null;
        }
    }

    function safeSet(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (_) {
            /* Storage can be unavailable in private browsing. */
        }
    }

    function getPreferredTheme() {
        const stored = safeGet(STORAGE.theme);
        if (THEMES.includes(stored)) return stored;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function getPreferredLanguage() {
        const stored = safeGet(STORAGE.language);
        if (LANGS.includes(stored)) return stored;
        return (navigator.language || '').toLowerCase().startsWith('uk') ? 'uk' : 'en';
    }

    const state = {
        theme: getPreferredTheme(),
        language: getPreferredLanguage()
    };

    function t(key) {
        return (labels[state.language] && labels[state.language][key]) || labels.en[key] || key;
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function dispatch(name, detail) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    }

    function applyTheme({ emit = false } = {}) {
        const isLight = state.theme === 'light';
        document.documentElement.classList.toggle('light-theme', isLight);
        if (document.body) document.body.classList.toggle('text-white', !isLight);

        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', isLight ? '#f2f4f7' : '#8c3dc1');

        const btn = document.getElementById('themeBtn');
        if (btn) {
            btn.innerHTML = `<i class="fas ${isLight ? 'fa-moon' : 'fa-sun'}"></i>`;
            btn.dataset.theme = state.theme;
            updateThemeButtonLabel();
        }

        if (emit) dispatch('lordskamp:themechange', { theme: state.theme, isLight });
    }

    function updateThemeButtonLabel() {
        const btn = document.getElementById('themeBtn');
        if (!btn) return;
        const isLight = state.theme === 'light';
        const nextLabel = isLight ? t('themeDark') : t('themeLight');
        btn.title = nextLabel;
        btn.setAttribute('aria-label', nextLabel);
    }

    function applyLanguage({ emit = false } = {}) {
        document.documentElement.lang = state.language;

        document.querySelectorAll('[data-ui-i18n]').forEach(el => {
            el.textContent = t(el.dataset.uiI18n);
        });

        const btn = document.getElementById('langBtn');
        if (btn) {
            btn.dataset.language = state.language;
            btn.title = t('language');
            btn.setAttribute('aria-label', t('language'));
        }

        document.querySelectorAll('[data-profile-close]').forEach(el => {
            el.setAttribute('aria-label', t('close'));
        });

        const copyNick = document.getElementById('copyLordskampNick');
        if (copyNick) copyNick.dataset.feedback = t('copied');

        if (emit) dispatch('lordskamp:languagechange', { language: state.language });
    }

    function setTheme(theme, options = {}) {
        if (!THEMES.includes(theme) || theme === state.theme) return;
        state.theme = theme;
        if (options.persist !== false) safeSet(STORAGE.theme, theme);
        applyTheme({ emit: options.emit !== false });
    }

    function toggleTheme() {
        setTheme(state.theme === 'light' ? 'dark' : 'light');
    }

    function setLanguage(language, options = {}) {
        if (!LANGS.includes(language) || language === state.language) return;
        state.language = language;
        if (options.persist !== false) safeSet(STORAGE.language, language);
        applyLanguage({ emit: options.emit !== false });
        updateThemeButtonLabel();
    }

    function toggleLanguage() {
        setLanguage(state.language === 'uk' ? 'en' : 'uk');
    }

    function renderHeader() {
        const mount = document.getElementById('siteHeaderMount');
        if (!mount || mount.dataset.siteUiReady) return;

        const page = mount.dataset.sitePage || (location.pathname.includes('portfolio') ? 'portfolio' : 'home');
        document.body.classList.add('has-site-header', `site-page-${page}`);

        const primary = page === 'portfolio'
            ? `<a class="site-header__back" id="backBtn" href="index.html" data-brand="Portfolio">
                    <i class="fas fa-arrow-left" aria-hidden="true"></i>
                    <span data-ui-i18n="back">Back</span>
               </a>`
            : `<button class="site-header__brand" id="brandProfileBtn" type="button" data-brand="Lordskamp" aria-haspopup="dialog" aria-controls="lordskampCardModal" aria-label="Lordskamp">
                    <i class="fas fa-palette" aria-hidden="true"></i>
                    <span data-ui-i18n="brand">Lordskamp</span>
               </button>`;

        mount.innerHTML = `
            <header class="site-header site-header--${escapeHtml(page)}">
                <div class="site-header__inner">
                    <div class="site-header__primary">${primary}</div>
                    <div class="site-header__actions">
                        <button class="site-control site-control--language" id="langBtn" type="button" data-brand="Language">
                            <i class="fas fa-globe" aria-hidden="true"></i>
                            <span class="site-lang-options" aria-hidden="true">
                                <span class="site-lang-option" data-lang-option="uk">Укр</span>
                                <span class="site-lang-divider">/</span>
                                <span class="site-lang-option" data-lang-option="en">Eng</span>
                            </span>
                        </button>
                        <button class="site-control site-control--theme" id="themeBtn" type="button" data-brand="Theme"></button>
                    </div>
                </div>
            </header>
        `;

        document.getElementById('langBtn')?.addEventListener('click', toggleLanguage);
        document.getElementById('themeBtn')?.addEventListener('click', toggleTheme);
        if (page === 'home') setupProfileCard();
        mount.dataset.siteUiReady = 'true';
        applyLanguage();
        applyTheme();
    }

    function setupProfileCard() {
        const trigger = document.getElementById('brandProfileBtn');
        if (!trigger) return;

        let modal = document.getElementById('lordskampCardModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'lordskampCardModal';
            modal.className = 'profile-card-modal';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'lordskampCardTitle');
            modal.setAttribute('aria-hidden', 'true');
            modal.innerHTML = `
                <div class="profile-card-modal__backdrop" data-profile-close></div>
                <div class="profile-card-modal__panel" tabindex="-1">
                    <button class="profile-card-modal__close" type="button" data-profile-close aria-label="Close">
                        <i class="fas fa-times" aria-hidden="true"></i>
                    </button>
                    <div class="profile-card-modal__identity">
                        <img src="profile00.jpeg" alt="" loading="lazy">
                        <div>
                            <p class="profile-card-modal__kicker" data-ui-i18n="profileKicker">Yurii Honcharenko</p>
                            <h2 id="lordskampCardTitle">Lordskamp</h2>
                            <p>@lordskamp</p>
                        </div>
                    </div>
                    <p class="profile-card-modal__bio" data-ui-i18n="profileBio">Graphic / motion designer. Branding, animation, AR effects, and creative AI workflows.</p>
                    <div class="profile-card-modal__actions">
                        <button class="profile-card-action profile-card-action--copy" id="copyLordskampNick" type="button" data-feedback="Copied!">
                            <i class="fas fa-copy" aria-hidden="true"></i>
                            <span data-ui-i18n="copyNick">Copy nickname</span>
                        </button>
                        <a class="profile-card-action" href="portfolio.html" data-brand="Portfolio">
                            <i class="fas fa-palette" aria-hidden="true"></i>
                            <span data-ui-i18n="openPortfolio">Portfolio</span>
                        </a>
                        <a class="profile-card-action" href="https://www.instagram.com/lordskamp/" target="_blank" rel="noopener" data-brand="Instagram">
                            <i class="fab fa-instagram" aria-hidden="true"></i>
                            <span>Instagram</span>
                        </a>
                        <a class="profile-card-action" href="mailto:lordskamp@yahoo.com" data-brand="Email">
                            <i class="fas fa-envelope" aria-hidden="true"></i>
                            <span>Email</span>
                        </a>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        if (trigger.dataset.profileCardReady) return;
        trigger.dataset.profileCardReady = 'true';

        const panel = modal.querySelector('.profile-card-modal__panel');
        const closeControls = modal.querySelectorAll('[data-profile-close]');
        const copyButton = modal.querySelector('#copyLordskampNick');
        let lastActive = null;

        function openModal() {
            lastActive = document.activeElement;
            modal.classList.add('is-open');
            modal.setAttribute('aria-hidden', 'false');
            document.body.classList.add('profile-card-open');
            requestAnimationFrame(() => panel?.focus({ preventScroll: true }));
        }

        function closeModal() {
            modal.classList.remove('is-open');
            modal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('profile-card-open');
            if (lastActive && typeof lastActive.focus === 'function') {
                lastActive.focus({ preventScroll: true });
            }
        }

        function fallbackCopy(value) {
            const textArea = document.createElement('textarea');
            textArea.value = value;
            textArea.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0;';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                document.execCommand('copy');
                return true;
            } catch (_) {
                return false;
            } finally {
                textArea.remove();
            }
        }

        function showCopiedFeedback() {
            if (!copyButton) return;
            copyButton.dataset.feedback = t('copied');
            copyButton.classList.add('is-copied');
            window.setTimeout(() => copyButton.classList.remove('is-copied'), 1600);
        }

        trigger.addEventListener('click', openModal);
        closeControls.forEach(control => control.addEventListener('click', closeModal));
        copyButton?.addEventListener('click', async () => {
            const nick = '@lordskamp';
            let copied = false;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(nick);
                    copied = true;
                } catch (_) {
                    copied = false;
                }
            }
            if (!copied) copied = fallbackCopy(nick);
            showCopiedFeedback();
        });

        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeModal();
        });
    }

    function hexToRgba(hex, alpha) {
        if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function initCursor() {
        if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;

        const cursor = document.getElementById('customCursor') || document.createElement('div');
        if (cursor.dataset.siteUiReady) return;
        cursor.id = 'customCursor';
        cursor.classList.add('custom-cursor');
        document.body.appendChild(cursor);
        cursor.dataset.siteUiReady = 'true';

        window.customCursorPos = window.customCursorPos || { x: 0, y: 0, color: null };

        const selector = [
            'a',
            'button',
            'input',
            'textarea',
            'select',
            '[role="button"]',
            '.link-item',
            '.social-icon',
            '.island',
            '.case-card',
            '.logo-cell',
            '.poster-item',
            '.volunteer-card',
            '.img-wrap',
            '.ig-grid-item',
            '.sticker-item',
            '.lottie-item',
            '.ctrl-btn',
            '.cat-tab',
            '.back-btn',
            '.lazy-video-card',
            '.video-item'
        ].join(',');
        const moveEvent = window.PointerEvent ? 'pointermove' : 'mousemove';
        let mouseX = 0;
        let mouseY = 0;
        let cursorX = 0;
        let cursorY = 0;
        let rafId = 0;
        let hasMoved = false;
        const lerp = 0.18;

        function tick() {
            cursorX += (mouseX - cursorX) * lerp;
            cursorY += (mouseY - cursorY) * lerp;
            cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) translate(-50%, -50%)`;
            window.customCursorPos.x = cursorX;
            window.customCursorPos.y = cursorY;
            rafId = requestAnimationFrame(tick);
        }

        function resetBrand() {
            cursor.style.backgroundColor = '';
            cursor.style.borderColor = '';
            cursor.style.boxShadow = '';
            window.customCursorPos.color = null;
        }

        document.addEventListener(moveEvent, e => {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            mouseX = e.clientX;
            mouseY = e.clientY;
            if (!hasMoved) {
                hasMoved = true;
                document.body.classList.add('custom-cursor-active');
                cursor.style.opacity = '1';
                rafId = requestAnimationFrame(tick);
            }
        }, { passive: true });

        document.addEventListener('mouseover', e => {
            if (!e.target.closest) return;
            const match = e.target.closest(selector);
            if (!match) return;
            cursor.classList.add('cursor-hover');

            const brand = match.dataset?.brand || match.closest('[data-brand]')?.dataset?.brand || match.getAttribute('title');
            const color = brandColors[brand];
            if (!color) return;
            window.customCursorPos.color = color;
            cursor.style.backgroundColor = color === '#ffffff' ? 'rgba(255, 255, 255, 0.32)' : hexToRgba(color, 0.32);
            cursor.style.boxShadow = color === '#ffffff'
                ? '0 0 18px rgba(255,255,255,0.62), 0 0 38px rgba(255,255,255,0.28)'
                : `0 0 20px ${hexToRgba(color, 0.62)}, 0 0 42px ${hexToRgba(color, 0.28)}`;
        }, { passive: true });

        document.addEventListener('mouseout', e => {
            if (!e.target.closest) return;
            const from = e.target.closest(selector);
            if (!from) return;
            const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(selector) : null;
            if (to) return;
            cursor.classList.remove('cursor-hover');
            resetBrand();
        }, { passive: true });

        document.addEventListener('mousedown', () => cursor.classList.add('cursor-click'));
        document.addEventListener('mouseup', () => cursor.classList.remove('cursor-click'));
        document.addEventListener('mouseleave', () => { cursor.style.opacity = '0'; });
        document.addEventListener('mouseenter', () => { if (hasMoved) cursor.style.opacity = '1'; });
        window.addEventListener('beforeunload', () => { if (rafId) cancelAnimationFrame(rafId); });
    }

    function createLazyVideoCard(src, options = {}) {
        const card = document.createElement(options.tag || 'div');
        const classes = new Set(String(options.className || '').split(/\s+/).filter(Boolean));
        classes.add('lazy-video-card');
        card.className = Array.from(classes).join(' ');
        card.dataset.videoSrc = src;
        card.dataset.objectFit = options.objectFit || 'cover';
        card.tabIndex = 0;
        if (options.autoRatio) card.dataset.autoRatio = 'true';
        if (options.aspectRatio) card.style.aspectRatio = options.aspectRatio;
        if (options.style) card.style.cssText += options.style;

        const preview = document.createElement('div');
        preview.className = 'lazy-video-preview';
        const previewSrc = options.previewSrc || getVideoPreviewSrc(src);
        if (previewSrc) {
            const poster = document.createElement('img');
            poster.className = 'lazy-video-poster';
            poster.src = previewSrc;
            poster.alt = '';
            poster.loading = 'lazy';
            poster.decoding = 'async';
            if (options.autoRatio) {
                poster.addEventListener('load', () => {
                    if (poster.naturalWidth && poster.naturalHeight) {
                        card.style.aspectRatio = `${poster.naturalWidth}/${poster.naturalHeight}`;
                    }
                }, { once: true });
            }
            preview.appendChild(poster);
        }

        const play = document.createElement('span');
        play.className = 'lazy-video-play';
        play.innerHTML = '<i class="fas fa-play" aria-hidden="true"></i>';
        preview.appendChild(play);
        card.appendChild(preview);
        hydrateLazyVideo(card);
        return card;
    }

    function getVideoPreviewSrc(src) {
        return String(src || '').replace(/\.(mp4|mov)$/i, '.jpg');
    }

    function hydrateLazyVideo(card) {
        if (!card || card.dataset.lazyVideoReady) return;
        const src = card.dataset.videoSrc;
        if (!src) return;

        let video = null;

        function loadAndPlay() {
            if (!video) {
                video = document.createElement('video');
                video.className = 'lazy-video-player';
                video.muted = true;
                video.loop = true;
                video.playsInline = true;
                video.autoplay = true;
                video.preload = 'metadata';
                video.src = src;
                video.style.objectFit = card.dataset.objectFit || 'cover';
                video.addEventListener('loadeddata', () => {
                    card.classList.remove('is-loading');
                    card.classList.add('is-loaded');
                }, { once: true });
                video.addEventListener('loadedmetadata', () => {
                    if (card.dataset.autoRatio !== 'true') return;
                    const w = video.videoWidth;
                    const h = video.videoHeight;
                    if (w && h) card.style.aspectRatio = `${w}/${h}`;
                });
                card.appendChild(video);
            }

            card.classList.add('is-loading', 'is-playing');
            video.play().catch(() => {
                card.classList.remove('is-loading', 'is-playing');
            });
        }

        function stopAndUnload() {
            if (video) {
                video.pause();
                video.removeAttribute('src');
                video.load();
                video.remove();
                video = null;
            }
            card.classList.remove('is-loading', 'is-loaded', 'is-playing');
        }

        card.addEventListener('pointerenter', loadAndPlay, { passive: true });
        card.addEventListener('pointerleave', stopAndUnload, { passive: true });
        card.addEventListener('mouseenter', loadAndPlay, { passive: true });
        card.addEventListener('mouseleave', stopAndUnload, { passive: true });
        card.addEventListener('focusin', loadAndPlay, { passive: true });
        card.addEventListener('focusout', stopAndUnload, { passive: true });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stopAndUnload();
        });
        card.dataset.lazyVideoReady = 'true';
    }

    function initLazyVideos(root = document) {
        root.querySelectorAll('.lazy-video-card[data-video-src]').forEach(hydrateLazyVideo);
    }

    function init() {
        renderHeader();
        applyLanguage();
        applyTheme();
        initCursor();
        initLazyVideos();
    }

    window.LordskampUI = {
        getTheme: () => state.theme,
        setTheme,
        toggleTheme,
        getLanguage: () => state.language,
        setLanguage,
        toggleLanguage,
        createLazyVideoCard,
        hydrateLazyVideo,
        initLazyVideos,
        init
    };

    applyTheme();
    document.documentElement.lang = state.language;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
