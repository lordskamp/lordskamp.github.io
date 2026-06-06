/* ═══════════════════════════════════════════════════════
   Portfolio App — Lordskamp
   ═══════════════════════════════════════════════════════ */

(() => {
    'use strict';

    /* ── i18n ── */
    const i18n = {
        uk: {
            back: "Назад", heroTitle: "ПОРТФОЛІО",
            heroSub: "Добірка проєктів з брендингу, моушн-дизайну та креативних робіт.",
            tabAll: "Усе", tabCases: "Кейси", tabLogos: "Лого", tabPosters: "Постери", tabMotion: "Моушн",
            sourceLabel: "ВИХІДНИЙ ФАЙЛ", projectLabel: "ДИЗАЙН-ПРОЄКТ", realLabel: "РЕАЛЬНЕ ФОТО",
            zoomHint: "Наведіть для зуму", clickToShuffle: "Натисніть, щоб змінити",
            secCases: "Кейси", secLogos: "Логотипи", secPosters: "Постери", secMotion: "Моушн-графіка",
            stickers: "Наліпки", animStickers: "Анімовані наліпки", igPosts: "Пости Instagram",
            igStories: "Сторіс Instagram", volunteer: "Волонтерські збори",
            openTelegram: "Відкрити в Telegram",
        },
        en: {
            back: "Back", heroTitle: "PORTFOLIO",
            heroSub: "A curated selection of branding, motion design, and creative projects.",
            tabAll: "All", tabCases: "Cases", tabLogos: "Logos", tabPosters: "Posters", tabMotion: "Motion",
            sourceLabel: "SOURCE FILE", projectLabel: "DESIGN PROJECT", realLabel: "REAL PHOTO",
            zoomHint: "Hover to zoom", clickToShuffle: "Click to change",
            secCases: "Cases", secLogos: "Logos", secPosters: "Posters", secMotion: "Motion Graphics",
            stickers: "Stickers", animStickers: "Animated Stickers", igPosts: "Instagram Posts",
            igStories: "Instagram Stories", volunteer: "Volunteer Fundraisers",
            openTelegram: "Open in Telegram",
        }
    };
    let lang = window.LordskampUI
        ? window.LordskampUI.getLanguage()
        : ((navigator.language || '').startsWith('uk') ? 'uk' : 'en');
    const t = k => (i18n[lang] && i18n[lang][k]) || (i18n.en[k]) || k;

    function applyI18n() {
        document.documentElement.lang = lang;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = t(el.dataset.i18n);
        });
    }

    /* ── Theme ── */
    const root = document.documentElement;
    let isLight = window.LordskampUI
        ? window.LordskampUI.getTheme() === 'light'
        : !window.matchMedia('(prefers-color-scheme: dark)').matches;

    function updateTheme() {
        if (window.LordskampUI) return;
        root.classList.toggle('light-theme', isLight);
        const btn = document.getElementById('themeBtn');
        if (btn) btn.innerHTML = `<i class="fas ${isLight ? 'fa-moon' : 'fa-sun'}"></i>`;
        // Re-apply mono logo filters
        document.querySelectorAll('.logo-mono').forEach(el => {
            // CSS handles this via :root.light-theme
        });
    }

    /* ── Data Model ── */
    const CASES = [
        {
            id: 'zaxid2019', name: 'Zaxidfest 2019', icon: 'fa-music',
            path: 'portfolio/Cases/1. Zaxidfest2019',
            source: 'Source.png',
            subs: [
                { name: 'Main Stage', dir: '1. Main_Stage', project: 'Main_Project.png', real: ['Main_RealPhoto_1.jpg', 'Main_RealPhoto_3.jpg', 'Main_RealPhoto_4.jpg', 'Main_RealPhoto_5.jpg', 'Main_RealPhoto_6.jpg', 'Main_RealPhoto_7.jpg', 'Main_RealPhoto_8.jpg', 'Main_RealPhoto_9.jpg'] },
                { name: 'Rock Stage', dir: '2. Rock_Stage', project: 'Rock_Project.png', real: ['Rock_RealPhoto_1.jpg', 'Rock_RealPhoto_2.jpg'] },
                { name: 'Love Stage', dir: '3. Love_Stage', project: 'Love_Project.png', real: ['Love_RealPhoto_1.jpg', 'Love_RealPhoto_2.jpg'] },
                { name: 'Entry Banner', dir: '4. Entry_Banner', project: 'Entry_Project.png', real: ['Entry_RealPhoto.jpg', 'Entry_RealPhoto_2.jpg'] },
                { name: 'T-Shirt', dir: '5.TShirt', project: 'TShirt_Project.png', real: ['TShirt_RealPhoto_1.jpg', 'TShirt_RealPhoto_2.jpg'] },
            ],
            stickers: { dir: '6. Telegram_StaticStickers', files: ['0.png', '1.png', '2.png', '3.png', '5.png', '6.png', '7.png', '8.png', '9.png'] }
        },
        {
            id: 'zaxid2020_21', name: 'Zaxidfest 2020 → 2021', icon: 'fa-music',
            isMergedZaxid: true,
            path2020: 'portfolio/Cases/2. Zaxidfest2020',
            path: 'portfolio/Cases/3. Zaxidfest2021',
            sources: [
                { path: 'portfolio/Cases/2. Zaxidfest2020/Source.png', label: '2020' },
                { path: 'portfolio/Cases/3. Zaxidfest2021/Source.png', label: '2021' },
                { path: 'portfolio/Cases/3. Zaxidfest2021/Map.jpg', label: null },
            ],
            lottieStickers: { path: 'portfolio/Cases/2. Zaxidfest2020', dir: 'Telegram_AnimatedStickers(Lottie format)', files: ['0.json', '1.json', '2.json', '3.json', '4.json', '5.json'] },
            igGrid: {
                dir: 'Instagram_Post',
                files: Array.from({ length: 72 }, (_, i) => `2 (${i + 1}).jpg`)
            },
            igAnimPosts: {
                dir: 'Instagram_Post',
                videos: Array.from({ length: 9 }, (_, i) => `1 (${i + 1}).mp4`)
            },
            igAnimStories: {
                dir: 'Instagram_Stories',
                videos: Array.from({ length: 13 }, (_, i) => `1 (${i + 1}).mp4`)
            }
        },
        {
            id: 'respublika', name: 'RespublicaFest 2021', icon: 'fa-music',
            path: 'portfolio/Cases/4. RespublicaFest2021',
            igGrid: { dir: 'IG_Static_Post', files: Array.from({ length: 22 }, (_, i) => String(i + 1).padStart(2, '0') + '.jpg').concat(['89.jpg', '90.jpg', '91.jpg', '92.jpg', '93.jpg', '94.jpg', '95.jpg', '96.jpg', '97.jpg', '99.jpg']) }
        },
        {
            id: 'blockchain', name: 'BlockchainInUa', icon: 'fa-link',
            path: 'portfolio/Cases/5. BlockchainInUa',
            igGrid: { dir: 'IG_Static_Post', files: ['2POSTPONING_1080x1080.jpg', '5000m_1080x1080.jpg', 'Alex Shevchenko.jpg', 'BlockchainUA 2022 3D map 1st floor.jpg', 'BlockchainUA 2022 3D map 3rd floor.jpg', 'CD_1080x1080.png', 'EN_1080.png', 'Illia_Polosukhin.jpg', 'Last Call_1080x1080.png', 'NEAR on White_1080x1080.jpg', 'NEAR_1000x1000-100.jpg', 'NEAR_1080x1080.jpg', 'NEWS_1000x1000-100.jpg', 'POSTPONING_1080x1080.jpg', 'QM_1080x1080.png', 'REG_1000x1000-100.jpg', 'UA_1080.png', 'WB_1080x1080.png', 'forklog_1080x1080.jpg'] }
        },
        {
            id: 'areffect', name: 'AR Effects', icon: 'fa-vr-cardboard',
            path: 'portfolio/Cases/7. AR-Effect',
            arVideos: ['01.mp4', '02.mp4', '3.MOV', '4.MOV', '5.mp4', '6.MOV', '7.mp4', '8.mp4', '9.mp4']
        },
        {
            id: 'volunteer', name: 'Волонтерські збори', titleKey: 'volunteer', icon: 'fa-heart', isVolunteer: true,
            path: 'portfolio/Cases/9. Волонтерські збори',
            folders: [
                { name: '#1', dir: '1', files: ['01.jpg', '02.jpg', '03.jpg', '04.jpg', '05.jpg', '06.jpg', '07.jpg', '08.jpg', '09.jpg', '10.jpg', '11.jpg', '12.jpg', '13.JPG', '14.JPG', '15.jpg', '16.jpg'] },
                { name: '#2', dir: '2', files: ['01.jpg', '02.png', '03.jpg', '04.jpg', '05.png', '06.jpg', '07.jpg', '08.png'] },
                { name: '#3', dir: '3', files: ['01.jpg'] },
                { name: '#4', dir: '4', files: ['01.jpg'] },
                { name: '#5', dir: '5', files: ['01.jpg'] },
                { name: '#6', dir: '6', files: ['01.jpg'] },
            ]
        },
        {
            id: 'igcarousels', name: 'Instagram Carousels', icon: 'fa-images',
            path: 'portfolio/Cases/8. Instagram carousels',
            carouselFolders: [
                { name: '#1', dir: '1', files: ['01.jpg', '02.jpg', '03.jpg', '04.jpg', '05.jpg', '06.jpg'] },
                { name: '#2', dir: '2', files: ['01.jpg', '02.jpg', '03.jpg', '04.jpg', '05.jpg', '06.jpg', '07.jpg', '08.jpg'] },
                { name: '#3', dir: '3', files: ['01.jpg', '02.jpg', '03.jpg'] },
            ]
        }
    ];

    const LOGOS = [
        { file: '01.svg', grid: '01(grid).svg' },
        { file: '02(color).svg' }, { file: '03.svg' }, { file: '04.svg' }, { file: '05(color).svg' },
        { file: '06.svg' }, { file: '07.svg' }, { file: '08(color).svg' }, { file: '09(color).svg' },
        { file: '10.svg' }, { file: '11.svg' }, { file: '12(color).svg' }, { file: '13.svg' },
        { file: '14.svg', lottie: '14(Lottie).json' }, { file: '15(color).svg' }, { file: '16(color).svg' },
        { file: '17.svg' }, { file: '18(color).svg' }, { file: '19.svg' },
        { file: '50.svg' }, { file: '51(color).svg' },
    ];

    const POSTERS = [
        'Poster (0).jpg', 'Poster (1).jpg', 'Poster (2).jpg', 'Poster (4).jpg', 'Poster (5).jpg',
        'Poster (6).jpg', 'Poster (7).jpg', 'Poster (8).jpg', 'Poster (9).jpg', 'Poster (10).jpg',
        'Poster (11).jpg', 'Poster (12).jpg', 'Poster (13).jpg', 'Poster (14).jpg', 'Poster (15).jpg',
        'Poster (16).jpg', 'Poster (17).jpg', 'Poster (18).jpg', 'Poster (19).jpg', 'Poster (20).jpg',
        'Poster (21).jpg', 'Poster (23).jpg', 'Poster (26).jpg', 'Poster (28).jpg', 'Poster (29).jpg',
        'Poster (30).jpg', 'Poster (31).jpg', 'Poster (32).jpg', 'Poster (33).jpg', 'Poster (34).jpg',
        'Poster (38).jpg', 'Poster (39).jpg'
    ];

    // Sort posters numerically
    function posterNum(name) {
        const m = name.match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
    }
    POSTERS.sort((a, b) => posterNum(a) - posterNum(b));

    const MOTION = {
        path: 'portfolio/Cases/MotionGraphic(Lottie)',
        videos: ['01.mp4', '02.mp4', '03.mp4', '04.mp4', '05.mp4', '06.mp4', '07.mp4', '08.mp4', '09.mp4', 'Latexfauna.mp4', 'Sadsvit.mp4'],
        lottie: ['LogoAnim/01.json', 'LogoAnim/02.json'],
        logoVideo: 'LogoAnim/03.mp4'
    };

    const TELEGRAM_STICKER_LINKS = {
        static: 'https://t.me/addstickers/ZXDFest',
        animated: 'https://t.me/addstickers/Zaxidfest2020'
    };

    /* ── Lightbox ── */
    const lightbox = document.getElementById('lightbox');
    const lightboxContent = document.getElementById('lightboxContent');
    const lightboxClose = document.getElementById('lightboxClose');
    let activeLightboxAnimation = null;
    let activeLightboxCleanup = null;
    let lightboxClearTimer = 0;
    const volunteerStates = new Map();
    const VOLUNTEER_FADE_MS = 250;

    function clearLightboxContent() {
        if (activeLightboxAnimation) {
            activeLightboxAnimation.destroy();
            activeLightboxAnimation = null;
        }
        if (activeLightboxCleanup) {
            activeLightboxCleanup();
            activeLightboxCleanup = null;
        }
        lightboxContent.innerHTML = '';
        lightboxContent.removeAttribute('data-media-type');
        lightbox.removeAttribute('data-media-type');
    }

    function openLightbox(src, type = 'image', items = null, options = {}) {
        if (!lightbox || !lightboxContent || (!src && !(items && items.length) && type !== 'volunteer')) return;

        window.clearTimeout(lightboxClearTimer);
        clearLightboxContent();
        lightbox.dataset.mediaType = type;
        lightboxContent.dataset.mediaType = type;

        if (type === 'video') {
            const v = document.createElement('video');
            v.src = src;
            v.controls = true;
            v.autoplay = true;
            v.playsInline = true;
            lightboxContent.appendChild(v);
        } else if (type === 'lottie') {
            const lottieFrame = el('div', 'lightbox-lottie');
            lightboxContent.appendChild(lottieFrame);
            if (typeof lottie !== 'undefined') {
                activeLightboxAnimation = lottie.loadAnimation({
                    container: lottieFrame,
                    renderer: 'svg',
                    loop: true,
                    autoplay: true,
                    path: encodeURI(src),
                    rendererSettings: {
                        progressiveLoad: true,
                        preserveAspectRatio: 'xMidYMid meet'
                    }
                });
            }
        } else if (type === 'logo') {
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            img.className = 'lightbox-logo';
            if (!String(src).includes('(color)')) img.classList.add('logo-mono');
            lightboxContent.appendChild(img);
        } else if (type === 'carousel') {
            const carouselItems = (Array.isArray(items) && items.length) ? items : [src];
            const strip = el('div', 'lightbox-carousel-strip');
            strip.style.setProperty('--carousel-count', carouselItems.length);
            carouselItems.forEach(itemSrc => {
                const img = document.createElement('img');
                img.src = itemSrc;
                img.alt = '';
                img.loading = 'eager';
                if (itemSrc === src) img.dataset.current = 'true';
                strip.appendChild(img);
            });
            lightboxContent.appendChild(strip);
        } else if (type === 'volunteer') {
            const state = volunteerStates.get(options.volunteerKey);
            if (state) {
                lightboxContent.appendChild(makeVolunteerLightbox(state));
            } else if (src) {
                const img = document.createElement('img');
                img.src = src; img.alt = '';
                lightboxContent.appendChild(img);
            }
        } else {
            const img = document.createElement('img');
            img.src = src; img.alt = '';
            lightboxContent.appendChild(img);
        }

        lightbox.classList.add('active');
        lightbox.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        if (!lightbox || !lightboxContent) return;
        lightbox.classList.remove('active');
        lightbox.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        lightboxClearTimer = window.setTimeout(clearLightboxContent, 300);
    }

    function makeMediaOpenable(target, src, type = 'image', options = {}) {
        if (!target || !src) return target;

        target.dataset.lightboxSrc = src;
        target.dataset.lightboxType = type;
        if (Array.isArray(options.items) && options.items.length) {
            target.dataset.lightboxItems = JSON.stringify(options.items);
        }
        if (options.volunteerKey) {
            target.dataset.lightboxVolunteerKey = options.volunteerKey;
        }
        target.classList.add('lightbox-trigger');

        if (!target.hasAttribute('tabindex')) target.tabIndex = 0;
        if (!target.hasAttribute('role')) target.setAttribute('role', 'button');

        const openFromTarget = event => {
            if (options.shouldOpen && !options.shouldOpen(event, target)) return;
            event.preventDefault();
            event.stopPropagation();
            let items = null;
            if (target.dataset.lightboxItems) {
                try {
                    const parsed = JSON.parse(target.dataset.lightboxItems);
                    if (Array.isArray(parsed)) items = parsed;
                } catch (_) {
                    items = null;
                }
            }
            const lightboxOptions = {};
            if (target.dataset.lightboxVolunteerKey) {
                lightboxOptions.volunteerKey = target.dataset.lightboxVolunteerKey;
            }
            openLightbox(target.dataset.lightboxSrc, target.dataset.lightboxType || type, items, lightboxOptions);
        };

        target.addEventListener('click', openFromTarget);
        target.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            openFromTarget(event);
        });

        return target;
    }

    function makeTelegramStickerLink(url) {
        const link = el('a', 'telegram-sticker-link');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.innerHTML = '<i class="fab fa-telegram-plane" aria-hidden="true"></i>';
        const label = el('span', '', t('openTelegram'));
        label.dataset.i18n = 'openTelegram';
        link.appendChild(label);
        return link;
    }

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
    lightboxContent.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

    /* ── Build Helpers ── */
    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html) e.innerHTML = html;
        return e;
    }

    function getVolunteerState(caseItem, folder) {
        const key = `${caseItem.id}:${folder.dir}`;
        if (volunteerStates.has(key)) return volunteerStates.get(key);

        const sources = folder.files.map(file => `${caseItem.path}/${folder.dir}/${file}`);
        let currentIdx = 0;
        let remainingIdx = [];
        const listeners = new Set();

        const currentSrc = () => sources[currentIdx] || '';
        const refillQueue = () => {
            remainingIdx = sources
                .map((_, idx) => idx)
                .filter(idx => idx !== currentIdx);

            for (let i = remainingIdx.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [remainingIdx[i], remainingIdx[j]] = [remainingIdx[j], remainingIdx[i]];
            }
        };
        const notify = () => {
            const src = currentSrc();
            listeners.forEach(listener => listener(src, { immediate: false }));
        };

        refillQueue();

        const state = {
            key,
            sources,
            hasAlternatives: sources.length > 1,
            getCurrentSrc: currentSrc,
            shuffle() {
                if (sources.length < 2) return;
                if (!remainingIdx.length) refillQueue();
                currentIdx = remainingIdx.pop();
                notify();
            },
            subscribe(listener) {
                listeners.add(listener);
                listener(currentSrc(), { immediate: true });
                return () => listeners.delete(listener);
            }
        };

        volunteerStates.set(key, state);
        return state;
    }

    function makeVolunteerCard(state, options = {}) {
        const card = el('div', `volunteer-card${options.inLightbox ? ' volunteer-card--lightbox' : ''}`);
        const img = document.createElement('img');
        img.alt = '';
        img.loading = options.inLightbox ? 'eager' : 'lazy';
        img.decoding = 'async';
        img.style.cssText = options.inLightbox
            ? 'display:block;margin:0;'
            : 'width:100%;display:block;margin:0;';
        card.dataset.volunteerKey = state.key;
        card.appendChild(img);

        let fadeTimer = 0;
        const syncImage = (nextSrc, meta = {}) => {
            window.clearTimeout(fadeTimer);
            card.dataset.lightboxSrc = nextSrc;

            if (meta.immediate || img.src.endsWith(encodeURI(nextSrc))) {
                img.src = nextSrc;
                img.style.opacity = '1';
                return;
            }

            img.style.opacity = '0';
            fadeTimer = window.setTimeout(() => {
                img.src = nextSrc;
                img.style.opacity = '1';
            }, VOLUNTEER_FADE_MS);
        };
        const unsubscribe = state.subscribe(syncImage);

        if (state.hasAlternatives) {
            const hint = el('button', 'volunteer-tap-hint');
            hint.type = 'button';
            hint.setAttribute('aria-label', t('clickToShuffle'));
            hint.appendChild(el('i', 'fas fa-random'));
            hint.appendChild(document.createTextNode(' '));
            const hintText = el('span', '', t('clickToShuffle'));
            hintText.dataset.i18n = 'clickToShuffle';
            hint.appendChild(hintText);
            hint.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                state.shuffle();
            });
            card.appendChild(hint);
        }

        if (!options.inLightbox) {
            makeMediaOpenable(card, state.getCurrentSrc(), 'volunteer', {
                volunteerKey: state.key
            });
        }

        return {
            card,
            cleanup() {
                window.clearTimeout(fadeTimer);
                unsubscribe();
            }
        };
    }

    function makeVolunteerLightbox(state) {
        const frame = el('div', 'lightbox-volunteer-frame');
        const view = makeVolunteerCard(state, { inLightbox: true });
        activeLightboxCleanup = view.cleanup;
        frame.appendChild(view.card);
        return frame;
    }

    function makeSectionBlock(title, icon, i18nKey) {
        const island = el('section', 'island fade-up');
        const heading = el('h2', 'section-title');
        heading.appendChild(el('i', `fas ${icon}`));
        const titleEl = el('span', '', title);
        if (i18nKey) titleEl.dataset.i18n = i18nKey;
        heading.appendChild(titleEl);
        const shell = el('div', 'section-content-shell');
        island.appendChild(heading);
        island.appendChild(shell);
        return { island, shell };
    }

    function makeImgWrap(src, extraClass, badge) {
        const w = el('div', 'img-wrap ' + (extraClass || ''));
        if (badge) {
            const b = el('span', badge.cls, badge.text);
            if (badge.key) b.dataset.i18n = badge.key;
            w.appendChild(b);
        }
        const img = document.createElement('img');
        img.src = src; img.alt = ''; img.loading = 'lazy';
        w.appendChild(img);
        return makeMediaOpenable(w, src);
    }

    function setupHorizontalStoriesScroller(scroller) {
        if (!scroller) return;

        scroller.style.touchAction = 'pan-x';
        scroller.style.WebkitOverflowScrolling = 'touch';
        scroller.style.overscrollBehaviorX = 'contain';
        scroller.style.cursor = 'grab';

        // Make vertical wheel move the horizontal track if there is room to scroll.
        scroller.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

            const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
            if (maxScrollLeft <= 0) return;

            const atStart = scroller.scrollLeft <= 0;
            const atEnd = scroller.scrollLeft >= maxScrollLeft - 1;
            const movingRight = e.deltaY > 0;
            const canScroll = (movingRight && !atEnd) || (!movingRight && !atStart);
            if (!canScroll) return;

            e.preventDefault();
            scroller.scrollLeft += e.deltaY;
        }, { passive: false });

        let isDragging = false;
        let startX = 0;
        let startScrollLeft = 0;
        let blockNextClick = false;

        scroller.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isDragging = true;
            blockNextClick = false;
            startX = e.pageX;
            startScrollLeft = scroller.scrollLeft;
            scroller.style.scrollSnapType = 'none';
            scroller.style.cursor = 'grabbing';
        });

        scroller.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const walk = e.pageX - startX;
            if (Math.abs(walk) > 5) blockNextClick = true;
            scroller.scrollLeft = startScrollLeft - walk;
            e.preventDefault();
        });

        const stopDragging = () => {
            if (!isDragging) return;
            isDragging = false;
            scroller.style.scrollSnapType = 'x mandatory';
            scroller.style.cursor = 'grab';
        };

        scroller.addEventListener('mouseleave', stopDragging);
        scroller.addEventListener('mouseup', stopDragging);

        scroller.addEventListener('click', (e) => {
            if (!blockNextClick) return;
            e.preventDefault();
            e.stopPropagation();
            blockNextClick = false;
        }, true);
    }

    /* ── Project Image (static wrap) ── */
    function makeProjectZoom(src, extraClass = '') {
        const w = el('div', `img-wrap project-media${extraClass ? ` ${extraClass}` : ''}`);
        const badge = el('span', 'source-badge', t('projectLabel'));
        badge.dataset.i18n = 'projectLabel';
        badge.style.background = 'rgba(72,0,255,.85)';
        w.appendChild(badge);
        const img = document.createElement('img');
        img.src = src; img.alt = ''; img.loading = 'lazy';
        w.appendChild(img);
        return makeMediaOpenable(w, src);
    }

    function makeLazyVideo(src, options = {}) {
        if (window.LordskampUI && window.LordskampUI.createLazyVideoCard) {
            return window.LordskampUI.createLazyVideoCard(src, options);
        }

        const vi = el('div', `${options.className || 'video-item'} lazy-video-card`);
        vi.dataset.videoSrc = src;
        vi.tabIndex = 0;
        if (options.aspectRatio) vi.style.aspectRatio = options.aspectRatio;
        if (options.style) vi.style.cssText += options.style;
        const preview = el('div', 'lazy-video-preview');
        const poster = document.createElement('img');
        poster.className = 'lazy-video-poster';
        poster.src = options.previewSrc || getVideoPreviewSrc(src);
        poster.alt = '';
        poster.loading = 'lazy';
        poster.decoding = 'async';
        if (options.autoRatio) {
            poster.addEventListener('load', () => {
                if (poster.naturalWidth && poster.naturalHeight) {
                    vi.style.aspectRatio = `${poster.naturalWidth}/${poster.naturalHeight}`;
                }
            }, { once: true });
        }
        preview.appendChild(poster);
        preview.appendChild(el('span', 'lazy-video-play', '<i class="fas fa-play"></i>'));
        vi.appendChild(preview);
        let video = null;
        const play = () => {
            if (!video) {
                video = document.createElement('video');
                video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'none';
                video.src = src;
                video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                if (options.autoRatio) {
                    video.addEventListener('loadedmetadata', () => {
                        const w = video.videoWidth, h = video.videoHeight;
                        if (w && h) vi.style.aspectRatio = `${w}/${h}`;
                    });
                }
                vi.appendChild(video);
            }
            vi.classList.add('is-playing');
            video.play().catch(() => vi.classList.remove('is-playing'));
        };
        const stop = () => {
            if (!video) return;
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.remove();
            video = null;
            vi.classList.remove('is-playing');
        };
        vi.addEventListener('pointerenter', play, { passive: true });
        vi.addEventListener('pointerleave', stop, { passive: true });
        vi.addEventListener('mouseenter', play, { passive: true });
        vi.addEventListener('mouseleave', stop, { passive: true });
        vi.addEventListener('focusin', play, { passive: true });
        vi.addEventListener('focusout', stop, { passive: true });
        return vi;
    }

    function getVideoPreviewSrc(src) {
        return String(src || '').replace(/\.(mp4|mov)$/i, '.jpg');
    }

    /* ── Build CASES Section ── */
    function buildCases() {
        const sec = document.getElementById('sec-cases');
        sec.innerHTML = '';
        const casesGrid = el('div', 'cases-grid');

        CASES.forEach(c => {
            const isZaxidMergedLayout = c.id === 'zaxid2020_21';
            const zaxidSource2020 = (isZaxidMergedLayout && c.sources)
                ? c.sources.find(s => s.label === '2020')
                : null;
            const zaxidSource2021 = (isZaxidMergedLayout && c.sources)
                ? c.sources.find(s => s.label === '2021')
                : null;
            const caseTitle = c.titleKey ? t(c.titleKey) : c.name;
            const caseSection = makeSectionBlock(caseTitle, c.icon || 'fa-briefcase', c.titleKey);
            if (c.id === 'igcarousels') {
                caseSection.island.classList.add('case-span-2');
            }

            const body = el('div', 'case-body');
            body.style.padding = '0';

            // Source image(s)
            if (c.source) {
                body.appendChild(makeImgWrap(`${c.path}/${c.source}`, '', { cls: 'source-badge', text: t('sourceLabel'), key: 'sourceLabel' }));
            }

            if (zaxidSource2020) {
                body.appendChild(makeImgWrap(zaxidSource2020.path, '', { cls: 'source-badge', text: '2020' }));
            }

            // Merged Zaxid 2020→2021 sources (tell the reuse story visually)
            if (c.isMergedZaxid && c.sources && !isZaxidMergedLayout) {
                const srcRow = el('div', '');
                srcRow.style.cssText = 'display:grid;gap:var(--inner-gap);grid-template-columns:1fr 1fr;';
                c.sources.forEach(s => {
                    const badge = s.label ? { cls: 'source-badge', text: s.label } : null;
                    srcRow.appendChild(makeImgWrap(s.path, '', badge));
                });
                body.appendChild(srcRow);
            }

            // Sub-cases (Project + Real photos)
            if (c.subs) {
                const renderSubCase = (target, sub) => {
                    const subTitle = el('div', '', '');
                    subTitle.style.cssText = 'font-size:.75rem;font-weight:700;color:var(--text-muted);margin:.75rem 0 .4rem;text-transform:uppercase;letter-spacing:.06em;';
                    subTitle.textContent = sub.name;
                    target.appendChild(subTitle);

                    // Project with zoom
                    const projectClass = (c.id === 'zaxid2019' && sub.name === 'Main Stage') ? 'main-stage-project' : '';
                    target.appendChild(makeProjectZoom(`${c.path}/${sub.dir}/${sub.project}`, projectClass));

                    // Real photos
                    if (sub.real && sub.real.length) {
                        const realRow = el('div', 'real-photos-row');
                        realRow.style.marginTop = '.5rem';
                        sub.real.forEach(r => {
                            realRow.appendChild(makeImgWrap(`${c.path}/${sub.dir}/${r}`, 'real-photo-wrap', { cls: 'real-label', text: '<i class="fas fa-camera"></i>' }));
                        });
                        target.appendChild(realRow);
                    }
                };

                if (c.id === 'zaxid2019') {
                    const pairDefs = [
                        ['Rock Stage', 'Love Stage'],
                        ['Entry Banner', 'T-Shirt']
                    ];
                    const pairMap = new Map(pairDefs.map(([left, right]) => [
                        left,
                        [c.subs.find(s => s.name === left), c.subs.find(s => s.name === right)]
                    ]));
                    const pairRightNames = new Set();
                    pairMap.forEach(pair => {
                        if (pair[0] && pair[1]) {
                            pairRightNames.add(pair[1].name);
                        }
                    });
                    const rendered = new Set();

                    c.subs.forEach(sub => {
                        const pair = pairMap.get(sub.name);
                        if (pair && pair[0] && pair[1]) {
                            const stagesRow = el('div', 'zaxid-stage-row');
                            stagesRow.style.cssText = 'display:grid;gap:var(--inner-gap);grid-template-columns:1fr 1fr;';

                            pair.forEach(stage => {
                                const col = el('div', 'zaxid-stage-col');
                                renderSubCase(col, stage);
                                stagesRow.appendChild(col);
                                rendered.add(stage.name);
                            });

                            body.appendChild(stagesRow);
                            return;
                        }

                        if (rendered.has(sub.name) || pairRightNames.has(sub.name)) {
                            return;
                        }

                        renderSubCase(body, sub);
                        rendered.add(sub.name);
                    });
                } else {
                    c.subs.forEach(sub => renderSubCase(body, sub));
                }
            }

            // Static stickers
            if (c.stickers) {
                const container = el('div', 'img-wrap');
                const badge = el('span', 'source-badge', t('stickers'));
                badge.dataset.i18n = 'stickers';
                container.appendChild(badge);

                const sg = el('div', 'stickers-grid');
                sg.style.paddingTop = '2rem'; // Space for badge
                c.stickers.files.forEach(f => {
                    const si = el('div', 'sticker-item');
                    const img = document.createElement('img');
                    img.src = `${c.path}/${c.stickers.dir}/${f}`; img.alt = ''; img.loading = 'lazy';
                    si.appendChild(img);
                    sg.appendChild(makeMediaOpenable(si, img.src));
                });
                container.appendChild(sg);
                container.appendChild(makeTelegramStickerLink(TELEGRAM_STICKER_LINKS.static));
                body.appendChild(container);
            }

            // Lottie stickers
            if (c.lottieStickers) {
                const container = el('div', 'img-wrap');
                const badgeKey = isZaxidMergedLayout ? 'stickers' : 'animStickers';
                const badgeText = t(badgeKey);
                const badge = el('span', 'source-badge', badgeText);
                badge.dataset.i18n = badgeKey;
                container.appendChild(badge);

                const lg = el('div', 'stickers-grid');
                lg.style.paddingTop = '2rem'; // Space for badge
                const lottiePath = c.lottieStickers.path || c.path;
                c.lottieStickers.files.forEach(f => {
                    const li = el('div', 'lottie-item');
                    const src = `${lottiePath}/${c.lottieStickers.dir}/${f}`;
                    li.dataset.lottieSrc = src;
                    lg.appendChild(makeMediaOpenable(li, src, 'lottie'));
                });
                container.appendChild(lg);
                container.appendChild(makeTelegramStickerLink(TELEGRAM_STICKER_LINKS.animated));
                body.appendChild(container);
            }

            if (zaxidSource2021) {
                body.appendChild(makeImgWrap(zaxidSource2021.path, '', { cls: 'source-badge', text: '2021' }));
            }

            // IG Static posts (3x3 grid preview, scrollable) — no label
            if (c.igGrid && !isZaxidMergedLayout) {
                const igg = el('div', 'ig-grid hide-scroll');
                igg.style.cssText = 'aspect-ratio: 1; overflow-y: auto; grid-auto-rows: calc((100% - (var(--inner-gap) * 2)) / 3);';
                
                c.igGrid.files.forEach(f => {
                    const gi = el('div', 'ig-grid-item');
                    const img = document.createElement('img');
                    img.src = `${c.path}/${c.igGrid.dir}/${f}`; img.alt = ''; img.loading = 'lazy';
                    gi.appendChild(img);
                    igg.appendChild(makeMediaOpenable(gi, img.src));
                });
                body.appendChild(igg);
            }

            // IG Static Stories (horizontal scrollable) — no label
            if (c.igStaticStories) {
                const isg = el('div', 'hide-scroll');
                isg.style.cssText = 'display: flex; gap: var(--inner-gap); overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory;';
                setupHorizontalStoriesScroller(isg);
                
                c.igStaticStories.files.forEach(f => {
                    const gi = el('div', '');
                    gi.style.cssText = 'flex: 0 0 calc((100% - (var(--inner-gap) * 2)) / 3); aspect-ratio: 9/16; scroll-snap-align: start; border-radius: 12px; overflow: hidden; position: relative;';
                    const img = document.createElement('img');
                    img.src = `${c.path}/${c.igStaticStories.dir}/${f}`; img.alt = ''; img.loading = 'lazy';
                    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
                    gi.appendChild(img);
                    isg.appendChild(makeMediaOpenable(gi, img.src));
                });
                body.appendChild(isg);
            }

            // IG Anim posts (video) — no label
            if (c.igAnimPosts && !isZaxidMergedLayout) {
                const vg = el('div', 'ig-grid hide-scroll');
                vg.style.cssText = 'aspect-ratio: 1; overflow-y: auto; grid-auto-rows: calc((100% - (var(--inner-gap) * 2)) / 3);';
                c.igAnimPosts.videos.forEach(f => {
                    const src = `${c.path}/${c.igAnimPosts.dir}/${f}`;
                    const vi = makeLazyVideo(src, { className: 'ig-grid-item', aspectRatio: '1' });
                    vg.appendChild(makeMediaOpenable(vi, src, 'video'));
                });
                body.appendChild(vg);
            }

            // Zaxid 2020→2021: combined animated + static IG posts in one vertical scroll
            if (isZaxidMergedLayout && (c.igAnimPosts || c.igGrid)) {
                const igPostsMixed = el('div', 'ig-grid hide-scroll');
                igPostsMixed.style.cssText = 'aspect-ratio: 1; overflow-y: auto; grid-auto-rows: calc((100% - (var(--inner-gap) * 2)) / 3);';

                if (c.igAnimPosts) {
                    c.igAnimPosts.videos.forEach(f => {
                        const src = `${c.path}/${c.igAnimPosts.dir}/${f}`;
                        const vi = makeLazyVideo(src, { className: 'ig-grid-item', aspectRatio: '1' });
                        igPostsMixed.appendChild(makeMediaOpenable(vi, src, 'video'));
                    });
                }

                if (c.igGrid) {
                    c.igGrid.files.forEach(f => {
                        const gi = el('div', 'ig-grid-item');
                        const img = document.createElement('img');
                        img.src = `${c.path}/${c.igGrid.dir}/${f}`; img.alt = ''; img.loading = 'lazy';
                        gi.appendChild(img);
                        igPostsMixed.appendChild(makeMediaOpenable(gi, img.src));
                    });
                }

                body.appendChild(igPostsMixed);
            }

            // IG Anim stories (video horizontal scroll) — no label
            if (c.igAnimStories) {
                const asg = el('div', 'hide-scroll');
                asg.style.cssText = 'display: flex; gap: var(--inner-gap); overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory;';
                setupHorizontalStoriesScroller(asg);
                c.igAnimStories.videos.forEach(f => {
                    const src = `${c.path}/${c.igAnimStories.dir}/${f}`;
                    const vi = makeLazyVideo(src, {
                        className: '',
                        aspectRatio: '9/16',
                        style: 'flex: 0 0 calc((100% - (var(--inner-gap) * 2)) / 3); border-radius: 10px; overflow: hidden; scroll-snap-align: start; cursor: pointer; position: relative;'
                    });
                    asg.appendChild(makeMediaOpenable(vi, src, 'video'));
                });
                body.appendChild(asg);
            }

            // AR Effect videos — auto aspect ratio from actual content
            if (c.arVideos) {
                const vg = el('div', '');
                vg.style.cssText = 'display:grid;gap:var(--inner-gap);grid-template-columns:repeat(3,1fr);';
                c.arVideos.forEach(f => {
                    const src = `${c.path}/${f}`;
                    const vi = makeLazyVideo(src, {
                        className: 'video-item',
                        style: 'cursor:pointer;',
                        autoRatio: true
                    });
                    vg.appendChild(makeMediaOpenable(vi, src, 'video'));
                });
                body.appendChild(vg);
            }

            // Volunteer folders (click-to-shuffle)
            if (c.isVolunteer && c.folders) {
                const vGrid = el('div', 'volunteer-grid');
                c.folders.forEach(folder => {
                    const state = getVolunteerState(c, folder);
                    vGrid.appendChild(makeVolunteerCard(state).card);
                });
                body.appendChild(vGrid);
            }

            // IG Carousels — Horizontal-only scroll, like Instagram
            if (c.carouselFolders) {
                const cGrid = el('div', 'carousel-grid');
                c.carouselFolders.forEach(folder => {
                    const cWrapper = el('div', 'carousel-wrapper');
                    const carouselMask = el('div', 'carousel-mask');
                    const carousel = el('div', 'insta-carousel');
                    const carouselSources = folder.files.map(file => `${c.path}/${folder.dir}/${file}`);
                    
                    folder.files.forEach(f => {
                        const slide = el('div', 'carousel-slide');
                        const img = document.createElement('img');
                        img.src = `${c.path}/${folder.dir}/${f}`;
                        img.alt = ''; img.loading = 'lazy';
                        img.decoding = 'async';
                        img.style.cssText = 'width:100%;height:auto;display:block;border-radius:0;filter:none;box-shadow:none;';
                        img.draggable = false; // Disable native browser drag
                        
                        // Equalize heights by setting flex-grow based on aspect ratio
                        if (f === folder.files[0]) {
                            const tempImg = new Image();
                            tempImg.src = img.src;
                            tempImg.onload = () => {
                                const ar = tempImg.naturalWidth / tempImg.naturalHeight;
                                // In a flex row, setting flex: [aspect-ratio] ensures items have the same height
                                cWrapper.style.flex = `${ar} ${ar} 0px`;
                            };
                        }

                        let isDragging = false;
                        let startX = 0;
                        img.addEventListener('mousedown', e => { 
                            startX = e.pageX; 
                            isDragging = false;
                            e.preventDefault(); // Stop native ghost drag
                        });
                        img.addEventListener('mousemove', e => { if (Math.abs(e.pageX - startX) > 5) isDragging = true; });
                        makeMediaOpenable(img, img.src, 'carousel', {
                            shouldOpen: () => !isDragging,
                            items: carouselSources
                        });
                        
                        slide.appendChild(img);
                        carousel.appendChild(slide);
                    });
                    cWrapper.style.flex = '1'; // Default fallback until image loads
                    carouselMask.appendChild(carousel);
                    cWrapper.appendChild(carouselMask);

                    if (folder.files.length > 1) {
                        const dots = el('div', 'carousel-dots');
                        const dotEls = [];
                        folder.files.forEach((_, idx) => {
                            const dot = el('div', 'carousel-dot' + (idx === 0 ? ' active' : ''));
                            dots.appendChild(dot);
                            dotEls.push(dot);
                        });
                        cWrapper.appendChild(dots);

                        carousel.addEventListener('scroll', () => {
                            const idx = Math.round(carousel.scrollLeft / (carousel.offsetWidth || 1));
                            dotEls.forEach((dot, i) => dot.classList.toggle('active', i === idx));
                        }, { passive: true });
                    }

                    // Desktop Grab-to-scroll & Mouse wheel support
                    let isDown = false;
                    let startX;
                    let scrollLeft;

                    carousel.addEventListener('mousedown', (e) => {
                        isDown = true;
                        carousel.classList.add('active'); // CSS updates cursor
                        startX = e.pageX - carousel.offsetLeft;
                        scrollLeft = carousel.scrollLeft;
                        carousel.style.scrollSnapType = 'none';
                        carousel.style.scrollBehavior = 'auto';
                    });
                    carousel.addEventListener('mouseleave', () => { isDown = false; carousel.style.scrollSnapType = 'x mandatory'; });
                    carousel.addEventListener('mouseup', () => { isDown = false; carousel.style.scrollSnapType = 'x mandatory'; });
                    carousel.addEventListener('mousemove', (e) => {
                        if (!isDown) return;
                        e.preventDefault();
                        const x = e.pageX - carousel.offsetLeft;
                        const walk = (x - startX) * 2;
                        carousel.scrollLeft = scrollLeft - walk;
                    });
                    // Support vertical wheel to horizontal scroll (smooth and snap-friendly)
                    let wheelAccumulated = 0;
                    let targetIdx = null;
                    let wheelTimeout;

                    carousel.addEventListener('wheel', (e) => {
                        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                            e.preventDefault();
                            
                            const width = carousel.offsetWidth || 1;
                            
                            // If we don't have an active scroll target, start from visual
                            if (targetIdx === null) {
                                targetIdx = Math.round(carousel.scrollLeft / width);
                            }
                            
                            // Accumulate scroll intents (works for trackpad & mouse wheel)
                            wheelAccumulated += e.deltaY;
                            
                            // Threshold to jump a slide
                            if (Math.abs(wheelAccumulated) > 30) {
                                const dir = Math.sign(wheelAccumulated);
                                targetIdx += dir;
                                const maxIdx = folder.files.length - 1;
                                targetIdx = Math.max(0, Math.min(targetIdx, maxIdx));
                                
                                wheelAccumulated = 0; // reset for next notch
                                
                                // Smooth scroll natively without modifying snap CSS
                                carousel.scrollTo({ left: targetIdx * width, behavior: 'smooth' });
                            }
                            
                            // Debounce to clear the sequence after scrolling stops
                            clearTimeout(wheelTimeout);
                            wheelTimeout = setTimeout(() => {
                                targetIdx = null;
                                wheelAccumulated = 0;
                            }, 250);
                        }
                    }, { passive: false });
                    cGrid.appendChild(cWrapper);
                });
                body.appendChild(cGrid);
            }

            caseSection.shell.appendChild(body);
            casesGrid.appendChild(caseSection.island);
        });

        sec.appendChild(casesGrid);
    }

    /* ── Build LOGOS Section ── */
    function buildLogos() {
        const sec = document.getElementById('sec-logos');
        sec.innerHTML = '';
        const section = makeSectionBlock(t('secLogos'), 'fa-signature', 'secLogos');
        const grid = el('div', 'logos-bento');
        // Dynamic column count to ensure 3 rows on desktop (N/3)
        grid.style.setProperty('--logo-cols', Math.ceil(LOGOS.length / 3));
        LOGOS.forEach(logo => {
            const cell = el('div', 'logo-cell fade-up');
            const img = document.createElement('img');
            img.src = `portfolio/Logos/${logo.file}`; img.alt = ''; img.loading = 'lazy';
            const isColor = logo.file.includes('(color)');
            img.className = 'logo-svg' + (isColor ? '' : ' logo-mono');
            cell.appendChild(img);
            grid.appendChild(makeMediaOpenable(cell, img.src, 'logo'));
        });
        section.shell.appendChild(grid);
        sec.appendChild(section.island);
    }

    /* ── Build POSTERS Section (4-column grid, sorted numerically) ── */
    function buildPosters() {
        const sec = document.getElementById('sec-posters');
        sec.innerHTML = '';
        const section = makeSectionBlock(t('secPosters'), 'fa-images', 'secPosters');

        const grid = el('div', 'posters-grid');
        POSTERS.forEach(p => {
            const item = el('div', 'poster-item fade-up');
            const img = document.createElement('img');
            img.src = `portfolio/Posters/${p}`; img.alt = ''; img.loading = 'lazy';
            item.appendChild(img);
            grid.appendChild(makeMediaOpenable(item, img.src));
        });
        section.shell.appendChild(grid);
        sec.appendChild(section.island);
    }

    /* ── Build MOTION Section ── */
    function buildMotion() {
        const sec = document.getElementById('sec-motion');
        sec.innerHTML = '';
        const section = makeSectionBlock(t('secMotion'), 'fa-film', 'secMotion');

        const grid = el('div', 'motion-grid');

        // Lottie animations
        MOTION.lottie.forEach(f => {
            const item = el('div', 'lottie-item fade-up');
            item.style.aspectRatio = '1'; item.style.minHeight = '150px';
            const src = `${MOTION.path}/${f}`;
            item.dataset.lottieSrc = src;
            grid.appendChild(makeMediaOpenable(item, src, 'lottie'));
        });

        // Logo video
        if (MOTION.logoVideo) {
            const src = `${MOTION.path}/${MOTION.logoVideo}`;
            const vi = makeLazyVideo(src, {
                className: 'video-item fade-up',
                aspectRatio: '1',
                style: 'cursor:pointer;'
            });
            grid.appendChild(makeMediaOpenable(vi, src, 'video'));
        }

        // Motion videos — auto aspect ratio detection
        MOTION.videos.forEach(f => {
            const src = `${MOTION.path}/${f}`;
            const vi = makeLazyVideo(src, {
                className: 'video-item fade-up',
                style: 'cursor:pointer;',
                autoRatio: true
            });
            grid.appendChild(makeMediaOpenable(vi, src, 'video'));
        });

        section.shell.appendChild(grid);
        sec.appendChild(section.island);
    }

    /* ── Init Lottie animations (IntersectionObserver lazy-load) ── */
    function initLottie() {
        const items = document.querySelectorAll('[data-lottie-src]');
        if (typeof lottie === 'undefined') {
            items.forEach(el => el.classList.add('is-lottie-error'));
            return;
        }

        const loadItem = el => {
            const src = el.dataset.lottieSrc;
            if (!src || el.dataset.lottieLoaded) return;

            el.dataset.lottieLoaded = 'true';
            el.classList.add('is-lottie-loading');
            const animation = lottie.loadAnimation({
                container: el,
                renderer: 'svg',
                loop: true,
                autoplay: true,
                path: encodeURI(src),
                rendererSettings: {
                    progressiveLoad: true,
                    preserveAspectRatio: 'xMidYMid meet'
                }
            });

            animation.addEventListener('DOMLoaded', () => {
                el.classList.remove('is-lottie-loading', 'is-lottie-error');
                el.classList.add('is-lottie-ready');
            });
            animation.addEventListener('data_failed', () => {
                el.classList.remove('is-lottie-loading');
                el.classList.add('is-lottie-error');
            });
        };

        if (!('IntersectionObserver' in window)) {
            items.forEach(loadItem);
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                loadItem(entry.target);
                observer.unobserve(entry.target);
            });
        }, { rootMargin: '300px' });

        items.forEach(el => observer.observe(el));
    }

    /* ── Scroll-triggered fade-up ── */
    function initScrollAnimations() {
        const obs = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.animationPlayState = 'running';
                    obs.unobserve(entry.target);
                }
            });
        }, { rootMargin: '50px', threshold: 0.1 });

        document.querySelectorAll('.fade-up').forEach(el => {
            el.style.animationPlayState = 'paused';
            obs.observe(el);
        });
    }

    /* ── Category Filtering ── */
    function initFilters() {
        const tabs = document.querySelectorAll('.cat-tab');
        const sections = document.querySelectorAll('.portfolio-section');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const filter = tab.dataset.filter;
                sections.forEach(sec => {
                    if (filter === 'all' || sec.dataset.category === filter) {
                        sec.style.display = '';
                        sec.style.opacity = '0';
                        sec.style.transform = 'translateY(20px)';
                        requestAnimationFrame(() => {
                            sec.style.transition = 'opacity .5s, transform .5s';
                            sec.style.opacity = '1';
                            sec.style.transform = 'translateY(0)';
                        });
                    } else {
                        sec.style.display = 'none';
                    }
                });
            });
        });
    }

    /* ── Theme & Lang Buttons ── */
    function initControls() {
        if (window.LordskampUI) {
            lang = window.LordskampUI.getLanguage();
            window.addEventListener('lordskamp:languagechange', event => {
                const nextLang = event.detail && event.detail.language;
                if (!nextLang || nextLang === lang) return;
                lang = nextLang;
                applyI18n();
            });
            return;
        }

        updateTheme();
        document.getElementById('themeBtn')?.addEventListener('click', () => { isLight = !isLight; updateTheme(); });
        document.getElementById('langBtn')?.addEventListener('click', () => {
            lang = lang === 'uk' ? 'en' : 'uk';
            applyI18n();
        });
    }

    /* ── Boot ── */
    function init() {
        applyI18n();
        buildCases();
        buildLogos();
        buildPosters();
        buildMotion();
        initFilters();
        initControls();
        requestAnimationFrame(() => {
            initLottie();
            initScrollAnimations();
        });
    }

    /* ── Disable Image Dragging ── */
    function disableImgDrag() {
        document.addEventListener('dragstart', (e) => {
            if (e.target.tagName === 'IMG') e.preventDefault();
        }, false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { init(); disableImgDrag(); });
    } else {
        init();
        disableImgDrag();
    }
})();

