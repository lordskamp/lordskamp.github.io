'use strict';

(() => {

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations()
            .then((registrations) => Promise.all(registrations
                .filter((registration) => !new URL(registration.scope).pathname.endsWith('/shyfr/'))
                .map((registration) => registration.unregister())))
            .catch(() => { });
    }

    if ('caches' in window) {
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((key) => !key.startsWith('shyfr-offline-'))
                .map((key) => caches.delete(key))))
            .catch(() => { });
    }
})();

(() => {
    const supportsSVH = !!(window.CSS && CSS.supports && CSS.supports('height: 100svh'));
    let rafId = 0;

    const setHeights = () => {
        rafId = 0;
        const visualHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        if (!supportsSVH) {
            document.documentElement.style.setProperty('--app-height', `${Math.ceil(visualHeight)}px`);
        }
    };

    const scheduleHeights = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(setHeights);
    };

    setHeights();
    window.addEventListener('resize', scheduleHeights, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleHeights, { passive: true });
    }
    window.addEventListener('orientationchange', scheduleHeights, { passive: true });
})();

document.getElementById('emailBtn').addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();

    const email = 'lordskamp@yahoo.com';

    // Show notification
    function showNote() {
        const note = document.createElement('div');
        note.style.cssText = 'position:fixed;top:16px;right:16px;background:#16a34a;color:white;padding:8px 16px;border-radius:8px;z-index:99999;font-weight:500;';
        // Use translation function if available
        note.textContent = typeof t === 'function' ? t('copied') : '✔ Copied!';
        document.body.appendChild(note);
        setTimeout(function () { note.remove(); }, 2000);
    }

    // Fallback method for older browsers
    function fallbackCopy() {
        const textArea = document.createElement('textarea');
        textArea.value = email;
        textArea.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            showNote();
        } catch (err) {
            alert('Email: ' + email);
        }
        document.body.removeChild(textArea);
    }

    // Try modern Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(email)
            .then(showNote)
            .catch(fallbackCopy);
    } else {
        fallbackCopy();
    }
});

(() => {
    const particlesContainer = document.getElementById('particles-container');
    if (!particlesContainer || document.documentElement.classList.contains('performance-mode') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let particleEffectsEnabled = true;

    const isMobileExperience = window.matchMedia('(max-width: 768px), (hover: none), (pointer: coarse)').matches;
    const supportsFineHover = !isMobileExperience && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const AMBIENT_COUNT = isMobileExperience ? 10 : 20;
    const TRAIL_POOL_SIZE = 20;
    const TRAIL_DURATION_MS = 1500;
    const TRAIL_MAX_PER_SEC = 60; // smoother trail tracking

    const supportsWAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
    const moveEvent = window.PointerEvent ? 'pointermove' : 'mousemove';
    let trailOffsetX = 0;
    let trailOffsetY = 0;

    // Convert viewport pointer coords to particles container coords.
    // The container is intentionally shifted by --bg-overscan, so we cache that offset.
    function refreshTrailOffsets() {
        const rect = particlesContainer.getBoundingClientRect();
        trailOffsetX = -rect.left;
        trailOffsetY = -rect.top;
    }
    refreshTrailOffsets();
    window.addEventListener('resize', refreshTrailOffsets, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', refreshTrailOffsets, { passive: true });
    }

    function cancelAnimations(el) {
        const anims = el.getAnimations?.();
        if (anims && anims.length) anims.forEach(a => a.cancel());
    }

    /* ==== Ambient particles (pooled, compositor transform/opacity) ==== */
    const ambient = [];
    for (let i = 0; i < AMBIENT_COUNT; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = Math.random() * 3 + 1;
        p.style.width = `${size}px`;
        p.style.height = `${size}px`;
        particlesContainer.appendChild(p);
        ambient.push(p);
    }

    function animateAmbient(p) {
        if (!particleEffectsEnabled) return;
        const startX = Math.random() * 100;
        const startY = Math.random() * 100;
        const endX = startX + (Math.random() * 20 - 10);
        const endY = startY - Math.random() * 30;
        const duration = (Math.random() * 10 + 10) * 1000;
        const delay = Math.random() * 5000;
        const peakOpacity = Math.random() * 0.3 + 0.1;

        if (supportsWAAPI) {
            cancelAnimations(p);
            const anim = p.animate([
                { transform: `translate3d(${startX}vw, ${startY}vh, 0)`, opacity: 0 },
                { transform: `translate3d(${startX}vw, ${startY}vh, 0)`, opacity: peakOpacity, offset: 0.12 },
                { transform: `translate3d(${endX}vw, ${endY}vh, 0)`, opacity: 0 }
            ], { duration, delay, easing: 'linear', fill: 'forwards' });
            anim.onfinish = () => animateAmbient(p);
        } else {
            // Fallback: still avoid left/top + transition:all to reduce layout/recalc
            p.style.opacity = '0';
            p.style.transition = 'none';
            p.style.transform = `translate3d(${startX}vw, ${startY}vh, 0)`;
            setTimeout(() => {
                p.style.transition = `transform ${duration}ms linear, opacity ${duration}ms linear`;
                p.style.opacity = String(peakOpacity);
                p.style.transform = `translate3d(${endX}vw, ${endY}vh, 0)`;
                setTimeout(() => animateAmbient(p), duration);
            }, delay);
        }
    }

    ambient.forEach(animateAmbient);

    /* ==== Mouse trail particles (pool reuse, max 1 per frame) ==== */
    const trailPool = [];
    if (supportsFineHover) {
        for (let i = 0; i < TRAIL_POOL_SIZE; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            p.style.opacity = '0';
            particlesContainer.appendChild(p);
            trailPool.push(p);
        }
    }

    let trailIdx = 0;
    function spawnTrail(clientX, clientY) {
        if (!trailPool.length) return;
        const p = trailPool[trailIdx];
        trailIdx = (trailIdx + 1) % trailPool.length;

        const size = Math.random() * 4 + 2;
        p.style.width = `${size}px`;
        p.style.height = `${size}px`;

        // Update particle color based on cursor state
        const cursorColor = window.customCursorPos && window.customCursorPos.color;
        if (cursorColor) {
            p.style.backgroundColor = cursorColor;
            p.style.boxShadow = `0 0 10px ${cursorColor}`;
        } else {
            p.style.backgroundColor = '';
            p.style.boxShadow = '';
        }

        // Use exact pixel positions for precise cursor tracking
        const x = clientX + trailOffsetX;
        const y = clientY + trailOffsetY;
        // Random drift direction (particles move away from cursor)
        const driftX = (Math.random() - 0.5) * 80;
        const driftY = (Math.random() - 0.5) * 80;
        const endX = x + driftX;
        const endY = y + driftY;

        if (supportsWAAPI) {
            cancelAnimations(p);
            p.animate([
                { transform: `translate3d(${x}px, ${y}px, 0)`, opacity: 0.6 },
                { transform: `translate3d(${endX}px, ${endY}px, 0)`, opacity: 0 }
            ], { duration: TRAIL_DURATION_MS, easing: 'ease-out', fill: 'forwards' });
        } else {
            p.style.transition = 'none';
            p.style.opacity = '0.6';
            p.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            setTimeout(() => {
                p.style.transition = `transform ${TRAIL_DURATION_MS}ms ease-out, opacity ${TRAIL_DURATION_MS}ms ease-out`;
                p.style.opacity = '0';
                p.style.transform = `translate3d(${endX}px, ${endY}px, 0)`;
            }, 0);
        }
    }

    /* ==== Pointer work (coalesced to rAF) ==== */
    let lastX = innerWidth * 0.5;
    let lastY = innerHeight * 0.5;
    let rafPending = false;
    let lastTrailTime = 0;

    function tick() {
        rafPending = false;



        // Trail: cap to refresh-rate to keep effect but avoid runaway DOM work
        const now = performance.now();
        if (now - lastTrailTime >= (1000 / TRAIL_MAX_PER_SEC)) {
            // Use raw pointer coordinates for zero-lag trail placement.
            spawnTrail(lastX, lastY);
            lastTrailTime = now;
        }
    }

    function onMove(e) {
        if (!particleEffectsEnabled) return;
        // Keep original behavior: only react to mouse movement (not touch/pen)
        if (e.pointerType && e.pointerType !== 'mouse') return;
        lastX = e.clientX;
        lastY = e.clientY;
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(tick);
        }
    }

    if (supportsFineHover) {
        document.addEventListener(moveEvent, onMove, { passive: true });
    }

    // Pause/restart animations when tab is hidden/visible (saves CPU, no feature loss)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            ambient.forEach(cancelAnimations);
            trailPool.forEach(cancelAnimations);
        } else if (particleEffectsEnabled) {
            ambient.forEach(animateAmbient);
        }
    });

    window.addEventListener('lordskamp:performancemode', () => {
        particleEffectsEnabled = false;
        ambient.forEach(cancelAnimations);
        trailPool.forEach(cancelAnimations);
        particlesContainer.replaceChildren();
    }, { once: true });
})();

/* ==== i18n (Internationalization) ==== */
const translations = {
    uk: {

        social: "Соціальні мережі",
        socialMedia: "Соціальні мережі та спільнота",
        contentWork: "Роботи",
        steamProfile: "Steam Профіль",
        connectSupport: "Зв’язатись зі мною",
        emailLabel: "Email",
        telegram: "Telegram",
        email: "lordskamp@yahoo.com",
        instagramPortfolio: "Instagram",
        madeWith: 'Зроблено з допомогою ШІ',
        viewPortfolio: "ПЕРЕГЛЯНУТИ ПОРТФОЛІО",
        viewCV: "Переглянути резюме",
        creativeCV: "Креативне",
        cvMainTitle: "Відкрити ATS-Friendly резюме",
        cvAltTitle: "Відкрити ATS-Friendly резюме іншою мовою",
        cvCreativeTitle: "Відкрити креативне резюме",
        copyright: 'Форк <a href="https://github.com/iammuhammadnoumankhan/linktree" target="_blank" class="text-violet-400 transition-colors">цього репозиторію</a>',
        copied: "✔ Скопійовано!",
        tinder: "Тіндер",
        tiktok: "TikTok",
        linkedin: "LinkedIn",
        twitter: "Twitter (X)",
        instagram: "Instagram",
        threads: "Threads",
        facebook: "Facebook",
        discord: "Discord",
        medium: "Medium Blog",
        scholar: "Google Scholar",
        tagline1: "Досвід у графічному дизайні та брендингу",
        tagline2: "Моушн-графіка та анімація",
        tagline3: "Креативний візуальний сторітелінг",
        name: "ЮРІЙ ГОНЧАРЕНКО",
        role: "Графічний / Моушн-дизайнер",
        status: "У пошуку роботи",
        local: "Локалізація ігор",
        parallel: "Паралельний Всесвіт",
        unwordleProject: "Кобза-навпаки",
        shyfrProject: "Шифр",
        hvyliaProject: "Довжина хвилі",
        sideProjects: "Сторонні проєкти",
        companies: "Співпраця",
        wishlist: "Список бажань",
        awards: "Нагороди та досягнення",
        tiktokAward: "TikTok Effect House Challenge",
        tiktokStats: "Мільйони переглядів та тисячі підписників",
        metaAward: "Meta AR Hackathon",
        secondPlace: "2 місце",
        winnerBadge: "Фіналіст",
        threeTimes: "ТРИЧІ",
        audienceStats: "Аудиторія та охоплення",
        followers: "Підписники",
        likes: "Лайки",
        views: "Перегляди",
        live: "LIVE",
    },
    en: {

        social: "Social",
        socialMedia: "Social Media & Community",
        contentWork: "Work",
        steamProfile: "Steam Profile",
        connectSupport: "Contact Me",
        emailLabel: "Email",
        telegram: "Telegram",
        email: "lordskamp@yahoo.com",
        instagramPortfolio: "Instagram",
        madeWith: 'Made with AI',
        viewPortfolio: "VIEW PORTFOLIO",
        viewCV: "View CV",
        creativeCV: "Creative",
        cvMainTitle: "Open ATS-Friendly CV",
        cvAltTitle: "Open ATS-Friendly CV in the other language",
        cvCreativeTitle: "Open creative CV",
        copyright: 'Fork of <a href="https://github.com/iammuhammadnoumankhan/linktree" target="_blank" class="text-violet-400 transition-colors">this repository</a>',
        copied: "✔ Copied!",
        tinder: "Tinder",
        tiktok: "TikTok",
        linkedin: "LinkedIn",
        twitter: "Twitter (X)",
        instagram: "Instagram",
        threads: "Threads",
        facebook: "Facebook",
        discord: "Discord",
        medium: "Medium Blog",
        scholar: "Google Scholar",
        tagline1: "Graphic Design & Branding",
        tagline2: "Motion Graphics & Animation",
        tagline3: "Creative Visual Storytelling",
        name: "YURII HONCHARENKO",
        role: "Graphic / Motion Designer",
        status: "Looking for job",
        local: "Localization game",
        parallel: "Parallel University",
        unwordleProject: "Кобза-навпаки",
        shyfrProject: "Шифр",
        hvyliaProject: "Довжина хвилі",
        sideProjects: "Side Projects",
        companies: "Worked with",
        wishlist: "Wishlist",
        awards: "Awards & Achievements",
        tiktokAward: "TikTok Effect House Challenge",
        tiktokStats: "Millions of views and thousands of followers",
        metaAward: "Meta AR Hackathon",
        secondPlace: "2nd Place",
        winnerBadge: "Finalist",
        threeTimes: "3 Times",
        audienceStats: "Audience & Reach",
        followers: "Followers",
        likes: "Likes",
        views: "Views",
        live: "LIVE",
    }
};

let currentLang = 'en';
const cvFiles = {
    uk: {
        ats: 'CV_Honcharenko_ATS_UKR.pdf',
        creative: 'СV_Honcharenko_Creative_UKR.pdf'
    },
    en: {
        ats: 'CV_Honcharenko_ATS.pdf',
        creative: 'СV_Honcharenko_Creative_ENG.pdf'
    }
};

function detectLanguage() {
    if (window.LordskampUI) return window.LordskampUI.getLanguage();
    const lang = navigator.language || navigator.userLanguage;
    return lang.startsWith('uk') ? 'uk' : 'en';
}

function t(key) {
    return translations[currentLang][key] || translations['en'][key] || key;
}

function updatePageLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (['madeWith', 'copyright'].includes(key)) {
            el.innerHTML = t(key);
        } else {
            el.textContent = t(key);
        }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const label = t(key);
        el.title = label;
        el.setAttribute('aria-label', label);
    });

    const cvLinkMain = document.getElementById('cv-link-main');
    const cvLinkAlt = document.getElementById('cv-link-alt');
    const cvLinkCreative = document.getElementById('cv-link-creative');
    const altLangLabel = document.getElementById('alt-lang-label');

    if (cvLinkMain && cvLinkAlt && cvLinkCreative && altLangLabel) {
        const activeLang = currentLang === 'uk' ? 'uk' : 'en';
        const alternateLang = activeLang === 'uk' ? 'en' : 'uk';

        cvLinkMain.href = cvFiles[activeLang].ats;
        cvLinkAlt.href = cvFiles[alternateLang].ats;
        cvLinkCreative.href = cvFiles[activeLang].creative;
        altLangLabel.textContent = alternateLang === 'uk' ? 'UKR' : 'ENG';
    }

    if (window.updateSocialStats) {
        window.updateSocialStats();
    }
}

function setLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    updatePageLanguage();
}

// Initialize: use shared language state when available.
document.addEventListener('DOMContentLoaded', () => {
    setLanguage(detectLanguage());
    if (window.LordskampUI) {
        window.addEventListener('lordskamp:languagechange', (event) => {
            const nextLang = event.detail && event.detail.language;
            if (nextLang) setLanguage(nextLang);
        });
        return;
    }
    const langBtn = document.getElementById('langBtn');
    if (langBtn) {
        langBtn.addEventListener('click', () => {
            const newLang = currentLang === 'uk' ? 'en' : 'uk';
            setLanguage(newLang);
        });
    }
});

/* ==== Utilities ==== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ==== Ripple Click ==== */
$$('.link-item:not(.portfolio-cta)').forEach((btn) => {
    btn.addEventListener('click', (e) => {
        const span = document.createElement('span');
        const size = Math.max(btn.clientWidth, btn.clientHeight);
        const rect = btn.getBoundingClientRect();
        span.className = 'ripple';
        span.style.width = span.style.height = size + 'px';
        span.style.left = e.clientX - rect.left - size / 2 + 'px';
        span.style.top = e.clientY - rect.top - size / 2 + 'px';
        btn.appendChild(span);
        setTimeout(() => span.remove(), 600);
    });
});

/* ==== Auto-Typing Tagline ==== */
let idx = 0, pos = 0, forward = true;
const tagEl = $('p:nth-of-type(2)');
function type() {
    const taglines = [
        t('tagline1'),
        t('tagline2'),
        t('tagline3')
    ];
    if (forward) {
        tagEl.textContent = taglines[idx].slice(0, ++pos);
        if (pos === taglines[idx].length) { forward = false; setTimeout(type, 1500); return; }
    } else {
        tagEl.textContent = taglines[idx].slice(0, --pos) || '\u00A0';
        if (pos === 0) { forward = true; idx = (idx + 1) % taglines.length; setTimeout(type, 300); return; }
    }
    setTimeout(type, 60);
}
type();

/* ==== Respect Reduced Motion ==== */
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.style.setProperty('--anim-duration', '0.001ms');
}

(() => {
    if (window.matchMedia('(max-width: 768px), (hover: none), (pointer: coarse)').matches || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    // Keep the avatar tilt without moving nested glass surfaces in 3D.
    const elements = document.querySelectorAll('#profileImg');
    if (!elements.length) return;

    const moveEvent = window.PointerEvent ? 'pointermove' : 'mousemove';
    const LEAVE_TOLERANCE_PX = 14;
    let activeTiltReset = null;

    function isInsideRect(rect, x, y, tolerance = 0) {
        if (!rect) return false;
        return (
            x >= rect.left - tolerance &&
            x <= rect.right + tolerance &&
            y >= rect.top - tolerance &&
            y <= rect.bottom + tolerance
        );
    }

    elements.forEach((el) => {
        let raf = 0;
        let lastX = 0;
        let lastY = 0;
        let hovering = false;
        let baseRect = null;
        let trackingDocumentMove = false;

        function update() {
            raf = 0;
            if (!hovering || !baseRect) return;
            if (activeTiltReset !== resetTilt) return;

            const cx = baseRect.left + (baseRect.width / 2);
            const cy = baseRect.top + (baseRect.height / 2);
            const halfW = Math.max(baseRect.width / 2, 1);
            const halfH = Math.max(baseRect.height / 2, 1);

            // Calculate distance from center using non-transformed bounds.
            let dx = (lastX - cx) / halfW; // -1..1
            let dy = (lastY - cy) / halfH;

            // Clamp values to prevent extreme rotation.
            dx = Math.max(-1, Math.min(1, dx));
            dy = Math.max(-1, Math.min(1, dy));

            const rx = -dy * 9;
            const ry = dx * 9;
            el.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.02) translateY(-4px)`;
        }

        function stopTrackingDocumentMove() {
            if (!trackingDocumentMove) return;
            trackingDocumentMove = false;
            document.removeEventListener(moveEvent, onDocumentMove);
        }

        function resetTilt(options = {}) {
            const fast = !!options.fast;
            hovering = false;
            baseRect = null;
            stopTrackingDocumentMove();

            if (raf) {
                cancelAnimationFrame(raf);
                raf = 0;
            }

            // Smooth landing back to default state.
            el.style.transition = fast
                ? 'transform 0.18s ease-out'
                : 'transform 0.6s cubic-bezier(0.23, 1, 0.32, 1)';
            el.style.transform = '';
            el.style.zIndex = '';
            el.classList.remove('tilted');
            el.style.willChange = '';
            if (activeTiltReset === resetTilt) activeTiltReset = null;
        }

        function onDocumentMove(e) {
            if (!hovering) return;
            if (activeTiltReset !== resetTilt) return;
            if (e.pointerType && e.pointerType !== 'mouse') return;

            lastX = e.clientX;
            lastY = e.clientY;

            // Exit only after cursor leaves a tolerance area around original bounds.
            if (!isInsideRect(baseRect, lastX, lastY, LEAVE_TOLERANCE_PX)) {
                resetTilt();
                return;
            }

            if (!raf) raf = requestAnimationFrame(update);
        }

        el.addEventListener('pointerenter', (e) => {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            if (activeTiltReset && activeTiltReset !== resetTilt) {
                activeTiltReset({ fast: true });
            }
            activeTiltReset = resetTilt;

            hovering = true;
            baseRect = el.getBoundingClientRect();
            lastX = e.clientX;
            lastY = e.clientY;

            // Keep response smooth but stable.
            el.style.transition = 'transform 0.14s ease-out';
            el.style.zIndex = '20';
            el.classList.add('tilted');
            el.style.willChange = 'transform';

            if (!trackingDocumentMove) {
                trackingDocumentMove = true;
                document.addEventListener(moveEvent, onDocumentMove, { passive: true });
            }

            if (!raf) raf = requestAnimationFrame(update);
        }, { passive: true });

        el.addEventListener('pointermove', (e) => {
            if (!hovering) return;
            if (activeTiltReset !== resetTilt) return;
            if (e.pointerType && e.pointerType !== 'mouse') return;

            lastX = e.clientX;
            lastY = e.clientY;
            if (!raf) raf = requestAnimationFrame(update);
        }, { passive: true });

        // Ignore false leaves caused by transformed hit-testing at sharp corners.
        el.addEventListener('pointerleave', (e) => {
            const exitX = typeof e.clientX === 'number' ? e.clientX : lastX;
            const exitY = typeof e.clientY === 'number' ? e.clientY : lastY;
            if (isInsideRect(baseRect, exitX, exitY, LEAVE_TOLERANCE_PX)) return;
            resetTilt();
        }, { passive: true });

        el.addEventListener('pointercancel', resetTilt, { passive: true });
    });
})();

/* ==== Profile Image Switcher ==== */
document.addEventListener('DOMContentLoaded', () => {
    const profileImg = document.getElementById('profileImg');
    const profileImages = ['profile00.jpeg', 'profile01.jpeg', 'profile02.jpeg'];
    let currentProfileIdx = 0;

    // Preload images to prevent flickering
    profileImages.forEach(src => {
        const img = new Image();
        img.src = src;
    });

    if (profileImg) {
        profileImg.addEventListener('click', (e) => {
            e.stopPropagation();
            currentProfileIdx = (currentProfileIdx + 1) % profileImages.length;
            profileImg.src = profileImages[currentProfileIdx];
        });
    }
});

(() => {
    const socialIcons = document.getElementById('social-icons');
    const wishlistPillRow = document.getElementById('wishlist-pill-row');
    const wishlistPill = document.getElementById('wishlist-pill');
    const profileHeadline = document.querySelector('.profile-headline');
    const profileSubline = document.querySelector('.profile-subline');
    const gridOverlay = document.querySelector('.grid-overlay');
    if (!socialIcons) return;

    function readRootNumber(varName, fallbackValue) {
        const parsed = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(varName));
        return Number.isFinite(parsed) ? parsed : fallbackValue;
    }

    function getGridSize() {
        return readRootNumber('--grid-size', 50);
    }

    function snapSocialIconsToGrid() {
        const gridSize = getGridSize();

        // Measure from the neutral state so offsets do not accumulate.
        socialIcons.style.setProperty('--social-grid-shift-x', '0px');
        socialIcons.style.setProperty('--social-grid-shift-y', '0px');
        profileHeadline?.style.setProperty('--profile-text-grid-shift-y', '0px');
        profileSubline?.style.setProperty('--profile-text-grid-shift-y', '0px');

        const rect = socialIcons.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const currentFirstCellCenterX = rect.left + (gridSize / 2);
        const currentRowCenterY = rect.top + (rect.height / 2);

        const gridRect = gridOverlay
            ? gridOverlay.getBoundingClientRect()
            : { left: 0, top: 0, width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
        const xPhase = gridRect.left + (gridRect.width / 2);
        const yPhase = gridRect.top + (gridRect.height / 2);

        const targetFirstCellCenterX = xPhase + (Math.round((currentFirstCellCenterX - xPhase) / gridSize) * gridSize);
        const targetRowCenterY = yPhase + (Math.round((currentRowCenterY - yPhase) / gridSize) * gridSize);

        const shiftX = targetFirstCellCenterX - currentFirstCellCenterX;
        const shiftY = targetRowCenterY - currentRowCenterY;

        socialIcons.style.setProperty('--social-grid-shift-x', `${shiftX.toFixed(2)}px`);
        socialIcons.style.setProperty('--social-grid-shift-y', `${shiftY.toFixed(2)}px`);

        if (profileHeadline && profileSubline) {
            const sublineRect = profileSubline.getBoundingClientRect();
            if (sublineRect.height > 0) {
                const snappedSocialTop = rect.top + shiftY;
                const targetSublineTop = snappedSocialTop - gridSize;
                const textShiftY = targetSublineTop - sublineRect.top;
                const value = `${textShiftY.toFixed(2)}px`;
                profileHeadline.style.setProperty('--profile-text-grid-shift-y', value);
                profileSubline.style.setProperty('--profile-text-grid-shift-y', value);
            }
        }

        if (wishlistPillRow && wishlistPill) {
            wishlistPillRow.style.setProperty('--wishlist-grid-shift-x', `${shiftX.toFixed(2)}px`);
            const socialHeight = rect.height;
            const wishlistHeight = wishlistPill.getBoundingClientRect().height;
            if (wishlistHeight > 0) {
                const centerGap = gridSize - ((socialHeight + wishlistHeight) / 2);
                wishlistPillRow.style.setProperty('--wishlist-grid-gap', `${centerGap.toFixed(2)}px`);
            }
        }
    }

    function scheduleSnap() {
        requestAnimationFrame(() => requestAnimationFrame(snapSocialIconsToGrid));
    }

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(scheduleSnap).catch(() => { });
    }

    window.addEventListener('load', scheduleSnap, { passive: true });
    window.addEventListener('orientationchange', scheduleSnap, { passive: true });

    const langBtn = document.getElementById('langBtn');
    if (langBtn) {
        langBtn.addEventListener('click', () => {
            setTimeout(scheduleSnap, 0);
        });
    }
    window.addEventListener('lordskamp:languagechange', () => {
        setTimeout(scheduleSnap, 0);
    });

    snapSocialIconsToGrid();
    setTimeout(scheduleSnap, 350);
})();

(() => {
    const statsConfig = {
        followers: { id: 'stat-followers', base: 69100, display: (v) => formatStatNumber(v / 1000) + 'K' },
        likes: { id: 'stat-likes', base: 1000000, display: (v) => formatStatNumber(v / 1000000) + 'M' },
        views: { id: 'stat-views', base: 3000000, display: (v) => formatStatNumber(v / 1000000) + 'M' }
    };

    function formatStatNumber(value) {
        const formatted = value.toFixed(1);
        return currentLang === 'uk' ? formatted.replace('.', ',') : formatted;
    }

    function updateStats() {
        Object.keys(statsConfig).forEach(key => {
            const conf = statsConfig[key];
            const el = document.getElementById(conf.id);
            if (!el) return;
            el.textContent = conf.display(conf.base);
        });
    }

    window.updateSocialStats = updateStats;

    updateStats();
})();

// Disable image dragging globally
document.addEventListener('dragstart', (e) => {
    if (e.target.tagName === 'IMG') e.preventDefault();
}, false);
