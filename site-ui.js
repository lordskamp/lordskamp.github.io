(() => {
    'use strict';

    function normalizeCleanUrl() {
        if (!window.history || typeof window.history.replaceState !== 'function') return;

        const { pathname, search, hash } = window.location;
        let cleanPath = pathname;

        if (/\/index\.html$/i.test(cleanPath)) {
            cleanPath = cleanPath.replace(/index\.html$/i, '') || '/';
        } else if (/\.html$/i.test(cleanPath)) {
            cleanPath = cleanPath.replace(/\.html$/i, '');
        }

        if (cleanPath !== pathname) {
            window.history.replaceState(null, document.title, `${cleanPath}${search}${hash}`);
        }
    }

    normalizeCleanUrl();

    const STORAGE = {
        theme: 'lordskamp:theme',
        language: 'lordskamp:language'
    };
    const LANGS = ['uk', 'en'];
    const THEMES = ['light', 'dark'];
    const labels = {
        uk: {
            back: 'Про мене',
            author: 'Про автора',
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
            back: 'About me',
            author: 'Про автора',
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
        KobzaReverse: '#72bf6a',
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

    const PERFORMANCE_SESSION_KEY = 'lordskamp:performance-mode';

    function isPerformanceMode() {
        return document.documentElement.classList.contains('performance-mode');
    }

    function enablePerformanceMode(reason) {
        if (isPerformanceMode()) return;

        document.documentElement.classList.add('performance-mode');
        try {
            window.sessionStorage.setItem(PERFORMANCE_SESSION_KEY, '1');
        } catch (_) {
            /* Storage can be unavailable in private browsing. */
        }
        dispatch('lordskamp:performancemode', { enabled: true, reason });
    }

    function initPerformanceMode() {
        try {
            if (window.sessionStorage.getItem(PERFORMANCE_SESSION_KEY) === '1') {
                enablePerformanceMode('session');
                return;
            }
        } catch (_) {
            /* Storage can be unavailable in private browsing. */
        }

        if (typeof window.requestAnimationFrame !== 'function') return;

        const measureFrameRate = () => {
            if (document.hidden || isPerformanceMode()) return;

            const startedAt = performance.now();
            let previousFrame = startedAt;
            let frameCount = 0;
            let slowFrameCount = 0;

            const sample = now => {
                const frameTime = now - previousFrame;
                previousFrame = now;
                if (frameCount > 0 && frameTime > 34) slowFrameCount += 1;
                frameCount += 1;

                if (now - startedAt < 1600) {
                    window.requestAnimationFrame(sample);
                    return;
                }

                // Fewer than 40 frames in 1.6 s, or a sustained rate below ~30 FPS,
                // means expensive visual effects are more harmful than helpful.
                if (frameCount < 40 || (frameCount > 1 && slowFrameCount / (frameCount - 1) > 0.72)) {
                    enablePerformanceMode('slow-frame-rate');
                }
            };

            window.requestAnimationFrame(sample);
        };

        if (document.readyState === 'complete') {
            window.setTimeout(measureFrameRate, 700);
        } else {
            window.addEventListener('load', () => window.setTimeout(measureFrameRate, 700), { once: true });
        }
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

        const forcedLanguage = mount.dataset.forceLanguage;
        if (LANGS.includes(forcedLanguage)) state.language = forcedLanguage;

        const page = mount.dataset.sitePage || (location.pathname.includes('portfolio') ? 'portfolio' : 'home');
        document.body.classList.add('has-site-header', `site-page-${page}`);

        const isBackPage = page === 'portfolio' || page === 'unwordle' || page === 'shyfr';
        const primary = isBackPage
            ? `<a class="site-header__back" id="backBtn" href="/" data-brand="Portfolio">
                    <i class="fas fa-arrow-left" aria-hidden="true"></i>
                    <span data-ui-i18n="${page === 'unwordle' ? 'author' : 'back'}">${page === 'unwordle' ? 'Про автора' : 'Back'}</span>
               </a>`
            : `<button class="site-header__brand" id="brandProfileBtn" type="button" data-brand="Lordskamp" aria-haspopup="dialog" aria-controls="lordskampCardModal" aria-label="Lordskamp">
                    <i class="fas fa-palette" aria-hidden="true"></i>
                    <span data-ui-i18n="brand">Lordskamp</span>
               </button>`;

        const actions = page === 'unwordle' || page === 'shyfr'
            ? `<button class="site-control site-control--theme" id="themeBtn" type="button" data-brand="Theme"></button>`
            : `<button class="site-control site-control--language" id="langBtn" type="button" data-brand="Language">
                    <i class="fas fa-globe" aria-hidden="true"></i>
                    <span class="site-lang-options" aria-hidden="true">
                        <span class="site-lang-option" data-lang-option="uk">Укр</span>
                        <span class="site-lang-divider">/</span>
                        <span class="site-lang-option" data-lang-option="en">Eng</span>
                    </span>
                </button>
                <button class="site-control site-control--theme" id="themeBtn" type="button" data-brand="Theme"></button>`;

        mount.innerHTML = `
            <header class="site-header site-header--${escapeHtml(page)}">
                <div class="site-header__inner">
                    <div class="site-header__primary">${primary}</div>
                    <div class="site-header__actions">${actions}</div>
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
                        <a class="profile-card-action" href="/portfolio" data-brand="Portfolio">
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
        if (window.matchMedia('(max-width: 768px), (hover: none), (pointer: coarse)').matches) {
            document.body.classList.remove('custom-cursor-active');
            window.customCursorPos = { x: 0, y: 0, color: null };
            return;
        }

        window.customCursorPos = window.customCursorPos || { x: 0, y: 0, color: null };

        const cursor = document.getElementById('customCursor') || document.createElement('div');
        if (cursor.dataset.siteUiReady) return;
        cursor.id = 'customCursor';
        cursor.classList.add('custom-cursor');
        document.body.appendChild(cursor);
        cursor.dataset.siteUiReady = 'true';

        const selector = [
            'a',
            'button',
            'input',
            'textarea',
            'select',
            '[role="button"]',
            '.link-item',
            '.social-icon',
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
        let hasMoved = false;
        let cursorFrame = 0;
        let pendingX = 0;
        let pendingY = 0;

        function moveCursor(x, y) {
            cursor.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
            window.customCursorPos.x = x;
            window.customCursorPos.y = y;
        }

        function resetBrand() {
            cursor.style.backgroundColor = '';
            cursor.style.borderColor = '';
            cursor.style.boxShadow = '';
            window.customCursorPos.color = null;
        }

        function applyBrandColor(color) {
            window.customCursorPos.color = color;
            cursor.style.backgroundColor = color === '#ffffff' ? 'rgba(255, 255, 255, 0.32)' : hexToRgba(color, 0.32);
            cursor.style.boxShadow = color === '#ffffff'
                ? '0 0 18px rgba(255,255,255,0.62), 0 0 38px rgba(255,255,255,0.28)'
                : `0 0 20px ${hexToRgba(color, 0.62)}, 0 0 42px ${hexToRgba(color, 0.28)}`;
        }

        function updateCursorTarget(x, y) {
            const target = document.elementFromPoint(x, y);
            if (!target || !target.closest) {
                cursor.classList.remove('cursor-hover');
                resetBrand();
                return;
            }

            const match = target.closest(selector);
            cursor.classList.toggle('cursor-hover', Boolean(match));

            if (!match) {
                resetBrand();
                return;
            }

            const brand = target.closest('[data-brand]')?.dataset?.brand || match.getAttribute('title');
            const color = brandColors[brand];
            if (!color) {
                resetBrand();
                return;
            }
            applyBrandColor(color);
        }

        function paintCursor() {
            cursorFrame = 0;
            moveCursor(pendingX, pendingY);
            updateCursorTarget(pendingX, pendingY);
        }

        document.addEventListener(moveEvent, e => {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            pendingX = e.clientX;
            pendingY = e.clientY;
            if (!cursorFrame) cursorFrame = window.requestAnimationFrame(paintCursor);
            if (!hasMoved) {
                hasMoved = true;
                document.body.classList.add('custom-cursor-active');
                cursor.style.opacity = '1';
            }
        }, { passive: true });

        document.addEventListener('mousedown', () => cursor.classList.add('cursor-click'));
        document.addEventListener('mouseup', () => cursor.classList.remove('cursor-click'));
        document.addEventListener('mouseleave', () => { cursor.style.opacity = '0'; });
        document.addEventListener('mouseenter', () => { if (hasMoved) cursor.style.opacity = '1'; });
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
            poster.src = getImagePreviewSrc(previewSrc);
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

    function getImagePreviewSrc(src) {
        const value = String(src || '');
        if (!/^portfolio\//.test(value) || !/\.(png|jpe?g)$/i.test(value)) return value;
        return value.replace(/^portfolio\//, 'portfolio/thumbs/') + '.webp';
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
        initPerformanceMode();
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
        isPerformanceMode,
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
