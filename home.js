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
        } catch {
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

/* ==== Floating particles: one bounded canvas, no external engine ==== */
(() => {
    const container = document.getElementById('particles-container');
    if (!container) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarse = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    const fineHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const particles = [];
    const trail = Array.from({ length: 20 }, () => ({ life: 0 }));
    let trailIndex = 0;
    let pointer = null;
    let width = 1;
    let height = 1;
    let color = '#ffffff';
    let frame = 0;
    let lastTime = 0;
    let economical = false;

    function updateTheme() {
        color = getComputedStyle(document.documentElement).getPropertyValue('--particle-color').trim() || '#ffffff';
    }

    function resize() {
        width = Math.max(1, container.clientWidth);
        height = Math.max(1, container.clientHeight);
        const ratio = Math.min(window.devicePixelRatio || 1, economical || coarse ? 1 : 1.5);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        particles.forEach(p => { p.x %= width; p.y %= height; });
    }

    function setBudget() {
        economical = document.documentElement.classList.contains('performance-mode');
        resize();
        const count = economical ? (coarse ? 8 : 12) : (coarse ? 12 : 24);
        particles.length = Math.min(particles.length, count);
        while (particles.length < count) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 8 + Math.random() * 10;
            particles.push({ x: Math.random() * width, y: Math.random() * height,
                vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius: 2 + Math.random() * 2 });
        }
    }

    function draw(now) {
        frame = 0;
        if (document.hidden || motion.matches) return;
        frame = requestAnimationFrame(draw);
        const elapsed = now - lastTime;
        if (lastTime && elapsed < 1000 / (economical || coarse ? 20 : 30)) return;
        const dt = lastTime ? Math.min(elapsed / 1000, 0.1) : 0;
        lastTime = now;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        for (const p of particles) {
            p.x = (p.x + p.vx * dt + width) % width;
            p.y = (p.y + p.vy * dt + height) % height;
        }
        // At most 276 pairs; skip connecting lines in the smaller rendering budget.
        if (!economical) {
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const a = particles[i];
                    const b = particles[j];
                    const distance = Math.hypot(a.x - b.x, a.y - b.y);
                    if (distance >= 120) continue;
                    ctx.globalAlpha = (1 - distance / 120) * 0.45;
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                }
            }
        }
        ctx.globalAlpha = 0.72;
        for (const p of particles) {
            ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
        }
        if (pointer) {
            const p = trail[trailIndex];
            trailIndex = (trailIndex + 1) % trail.length;
            Object.assign(p, pointer, { life: 1, vx: (Math.random() - 0.5) * 45,
                vy: (Math.random() - 0.5) * 45, color: window.customCursorPos?.color || color });
            pointer = null;
        }
        for (const p of trail) {
            p.life = Math.max(0, p.life - dt);
            if (!p.life) continue;
            p.x += p.vx * dt; p.y += p.vy * dt;
            ctx.globalAlpha = p.life * 0.6;
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function syncMotion() {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        lastTime = 0;
        pointer = null;
        trail.forEach(p => { p.life = 0; });
        if (motion.matches) ctx.clearRect(0, 0, width, height);
        if (!document.hidden && !motion.matches) frame = requestAnimationFrame(draw);
    }

    if (fineHover) {
        document.addEventListener(window.PointerEvent ? 'pointermove' : 'mousemove', event => {
            if (document.hidden || motion.matches || (event.pointerType && event.pointerType !== 'mouse')) return;
            pointer = { x: event.clientX, y: event.clientY };
        }, { passive: true });
    }
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('lordskamp:themechange', updateTheme);
    window.addEventListener('lordskamp:performancemode', setBudget);
    document.addEventListener('visibilitychange', syncMotion);
    motion.addEventListener('change', syncMotion);
    updateTheme();
    setBudget();
    syncMotion();
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

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Rotate one hovered block at a time, keeping its Glisse material attached.
    const elements = document.querySelectorAll('#profileImg, .island:not(.no-parallax)');
    if (!elements.length) return;

    const moveEvent = window.PointerEvent ? 'pointermove' : 'mousemove';
    const enterEvent = window.PointerEvent ? 'pointerenter' : 'mouseenter';
    const leaveEvent = window.PointerEvent ? 'pointerleave' : 'mouseleave';
    const LEAVE_TOLERANCE_PX = 14;
    let activeTiltReset = null;
    const resetActiveTilt = () => activeTiltReset?.();
    window.addEventListener('blur', resetActiveTilt);
    window.addEventListener('resize', resetActiveTilt, { passive: true });
    window.addEventListener('scroll', resetActiveTilt, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) resetActiveTilt(); });
    motion.addEventListener('change', () => { if (motion.matches) resetActiveTilt(); });

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

            const maxAngle = el.id === 'profileImg' ? 9 : 4;
            const rx = -dy * maxAngle;
            const ry = dx * maxAngle;
            el.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-3px)`;
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

        el.addEventListener(enterEvent, (e) => {
            if (motion.matches || document.hidden) return;
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

        // Ignore false leaves caused by transformed hit-testing at sharp corners.
        el.addEventListener(leaveEvent, (e) => {
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
