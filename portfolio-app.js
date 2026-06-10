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
            sourceLabel: "ІЛЮСТРАЦІЯ ВІД ХУДОЖНИКА", projectLabel: "ДИЗАЙН-ПРОЄКТ", realLabel: "РЕАЛЬНЕ ФОТО",
            sourceNote: "Базова ілюстрація надана художником. Усі подальші дизайни, адаптації та розвиток дизайн-системи виконані мною.",
            sourceReworkLabel: "МІЙ РЕВОРК 2020 → 2021",
            sourceReworkNote: "Фестиваль 2020 скасували через COVID-19, тому для 2021 я зробив реворк ілюстрації 2020. Саме ця версія стала основою для подальших дизайнів та адаптацій.",
            zoomHint: "Наведіть для зуму", clickToShuffle: "Натисніть, щоб змінити",
            secCases: "Кейси", secLogos: "Логотипи", secPosters: "Постери", secMotion: "Моушн-графіка",
            stickers: "Наліпки", animStickers: "Анімовані наліпки", igPosts: "Пости Instagram",
            igStories: "Сторіс Instagram", volunteer: "Волонтерські збори",
            openTelegram: "Відкрити в Telegram",
            madeWith: 'Зроблено з допомогою ШІ',
            copyright: 'Форк <a href="https://github.com/iammuhammadnoumankhan/linktree" target="_blank" class="text-violet-400 transition-colors">цього репозиторію</a>',
        },
        en: {
            back: "Back", heroTitle: "PORTFOLIO",
            heroSub: "A curated selection of branding, motion design, and creative projects.",
            tabAll: "All", tabCases: "Cases", tabLogos: "Logos", tabPosters: "Posters", tabMotion: "Motion",
            sourceLabel: "ARTIST ILLUSTRATION", projectLabel: "DESIGN PROJECT", realLabel: "REAL PHOTO",
            sourceNote: "Base illustration provided by the artist. All subsequent designs, adaptations, and design-system development were done by me.",
            sourceReworkLabel: "MY REWORK 2020 → 2021",
            sourceReworkNote: "The 2020 festival was canceled due to COVID-19, so for 2021 I reworked the 2020 illustration. This version became the base for the subsequent designs and adaptations.",
            zoomHint: "Hover to zoom", clickToShuffle: "Click to change",
            secCases: "Cases", secLogos: "Logos", secPosters: "Posters", secMotion: "Motion Graphics",
            stickers: "Stickers", animStickers: "Animated Stickers", igPosts: "Instagram Posts",
            igStories: "Instagram Stories", volunteer: "Volunteer Fundraisers",
            openTelegram: "Open in Telegram",
            madeWith: 'Made with AI',
            copyright: 'Fork of <a href="https://github.com/iammuhammadnoumankhan/linktree" target="_blank" class="text-violet-400 transition-colors">this repository</a>',
        }
    };
    let lang = window.LordskampUI
        ? window.LordskampUI.getLanguage()
        : ((navigator.language || '').startsWith('uk') ? 'uk' : 'en');
    const t = k => (i18n[lang] && i18n[lang][k]) || (i18n.en[k]) || k;
    const deferredSectionBuilders = new Map();
    const builtSections = new Set();
    const runWhenIdle = window.requestIdleCallback
        ? callback => window.requestIdleCallback(callback, { timeout: 1800 })
        : callback => window.setTimeout(callback, 250);
    const lazyImageObserver = 'IntersectionObserver' in window
        ? new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                revealDeferredImage(entry.target);
                lazyImageObserver.unobserve(entry.target);
            });
        }, { rootMargin: '900px 0px', threshold: 0.01 })
        : null;

    function setImageSource(img, src, options = {}) {
        if (!img || !src) return img;
        const displaySrc = options.previewSrc || getImagePreviewSrc(src);
        img.alt = options.alt || '';
        img.loading = options.eager ? 'eager' : 'lazy';
        img.decoding = options.decoding || 'async';
        if (options.fetchPriority) {
            img.fetchPriority = options.fetchPriority;
        } else if (!options.eager) {
            img.fetchPriority = 'low';
        }
        img.src = displaySrc;
        return img;
    }

    function setDeferredImageSource(img, src, options = {}) {
        if (!img || !src) return img;
        const displaySrc = options.previewSrc || getImagePreviewSrc(src);
        img.alt = options.alt || '';
        img.loading = 'lazy';
        img.decoding = options.decoding || 'async';
        img.fetchPriority = options.fetchPriority || 'low';

        if (!lazyImageObserver || options.eager) {
            img.src = displaySrc;
            return img;
        }

        img.dataset.src = displaySrc;
        img.classList.add('lazy-media-pending');
        lazyImageObserver.observe(img);
        return img;
    }

    function revealDeferredImage(img) {
        const src = img && img.dataset && img.dataset.src;
        if (!src) return;
        img.src = src;
        delete img.dataset.src;
        img.classList.remove('lazy-media-pending');
    }

    function getImagePreviewSrc(src) {
        const value = String(src || '');
        if (!/^portfolio\//.test(value) || !/\.(png|jpe?g)$/i.test(value)) return value;
        return value.replace(/^portfolio\//, 'portfolio/thumbs/') + '.webp';
    }

    function applyI18n() {
        document.documentElement.lang = lang;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            const label = el.dataset.i18nLabel;
            const value = label ? `${t(key)} • ${label}` : t(key);
            if (el.classList.contains('project-icon-badge')) {
                el.setAttribute('aria-label', value);
                el.title = value;
                return;
            }
            if (key === 'madeWith' || key === 'copyright') {
                el.innerHTML = value;
            } else {
                el.textContent = value;
            }
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
                { name: 'Love Stage', dir: '3. Love_Stage', project: 'Love_Project.png', real: ['Love_RealPhoto_1.jpg'] },
                { name: 'Entry Banner', dir: '4. Entry_Banner', project: 'Entry_Project.png', real: ['Entry_RealPhoto.jpg'] },
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
                { path: 'portfolio/Cases/3. Zaxidfest2021/Source.png', label: '2021', badgeTextKey: 'sourceReworkLabel', noteKey: 'sourceReworkNote' },
            ],
            subs: [
                { name: 'Main Stage', dir: '1. Main_Stage', project: 'Main_Project.png', real: ['Main_RealPhoto_1.jpg', 'Main_RealPhoto_2.jpg', 'Main_RealPhoto_3.jpg', 'Main_RealPhoto_4.jpg', 'Main_RealPhoto_5.jpg', 'Main_RealPhoto_6.jpg', 'Main_RealPhoto_7.jpg', 'Main_RealPhoto_8.jpg'], realRowClass: 'main-stage-photos' },
                { name: 'Rock Stage', dir: '2. Rock_Stage', project: 'Rock_Project.png', real: ['Rock_RealPhoto_1.jpg', 'Rock_RealPhoto_2.jpg'], realRowClass: 'rock-project-photos' },
                { name: 'Love Stage', dir: '3. Love_Stage', project: 'Love_Projec1t.png', real: ['Love_RealPhoto_1.jpg'], realRowClass: 'love-project-photos' },
                { name: 'Entry Banner', dir: '4. Entry_Banner', project: 'Entry_Project.png', real: ['Entry_RealPhoto.jpg'], realRowClass: 'entry-project-photos' },
                { name: 'T-Shirt', dir: '5.TShirt', project: 'TShirt_Project.png', real: ['TShirt_RealPhoto_1.jpg', 'TShirt_RealPhoto_2.jpg'], realRowClass: 'tshirt-project-photos' },
                { name: 'Map', dir: '', project: 'Map_Project.jpg', real: ['Map_RealPhoto.jpg'], aspectRatio: '1544 / 976', realOverlay: true },
            ],
            stagePairs: [
                { names: ['Rock Stage', 'Love Stage'], columns: '2fr 1fr' },
                { names: ['Entry Banner', 'T-Shirt'], columns: '1fr 2fr' }
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
        { file: '01.svg' },
        { file: '02.svg' }, { file: '03.svg' }, { file: '04(color).svg' }, { file: '05.svg' },
        { file: '06.svg' }, { file: '07.svg' }, { file: '8.svg' }, { file: '09.svg' },
        { file: '10.svg' }, { file: '11(color).svg' }, { file: '12.svg' }, { file: '13.svg' },
        { file: '14.svg', lottie: '14(Lottie).json' }, { file: '15(color).svg' }, { file: '16(color).svg' },
        { file: '17(color).svg' }, { file: '18.svg' }, { file: '19(color).svg' },
        { file: '50(color).svg' }, { file: '51(color).svg' },
    ];

    const LOGO_VIEWBOX_PADDING = 0.08;
    const LOGO_BASE_SIZE = 76;
    const LOGO_MAX_SIZE = 92;
    const LOGO_ASPECT_BOOST_POWER = 0.34;
    let logoMeasureQueue = Promise.resolve();
    const logoMonoBySrc = new Map();

    function normalizeLogoSvgViewBox(svg, box) {
        const side = Math.max(box.width, box.height) * (1 + LOGO_VIEWBOX_PADDING * 2);
        const x = box.x + box.width / 2 - side / 2;
        const y = box.y + box.height / 2 - side / 2;

        svg.setAttribute('viewBox', `${x} ${y} ${side} ${side}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('width', '1');
        svg.setAttribute('height', '1');
    }

    function getBalancedLogoSize(box) {
        const longSide = Math.max(box.width, box.height);
        const shortSide = Math.min(box.width, box.height);
        if (shortSide <= 0) return LOGO_BASE_SIZE;

        const aspectSpread = longSide / shortSide;
        const aspectBoost = Math.pow(aspectSpread, LOGO_ASPECT_BOOST_POWER);
        return Math.min(LOGO_MAX_SIZE, LOGO_BASE_SIZE * aspectBoost);
    }

    function parseSvgColor(value) {
        if (!value) return null;
        const color = String(value).trim().toLowerCase();
        if (!color || color === 'none' || color === 'transparent' || color === 'currentcolor') return null;

        if (color === 'black') return [0, 0, 0];
        if (color === 'white') return [255, 255, 255];

        const hex = color.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
        if (hex) {
            let raw = hex[1];
            if (raw.length === 3 || raw.length === 4) {
                raw = raw.slice(0, 3).split('').map(ch => ch + ch).join('');
            } else {
                raw = raw.slice(0, 6);
            }
            return [
                parseInt(raw.slice(0, 2), 16),
                parseInt(raw.slice(2, 4), 16),
                parseInt(raw.slice(4, 6), 16)
            ];
        }

        const rgb = color.match(/^rgba?\(([^)]+)\)$/);
        if (rgb) {
            const parts = rgb[1].split(',').map(part => parseFloat(part));
            if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
                return parts.slice(0, 3).map(part => Math.max(0, Math.min(255, part)));
            }
        }

        return null;
    }

    function isNeutralColor(rgb) {
        const max = Math.max(...rgb);
        const min = Math.min(...rgb);
        return max - min <= 18;
    }

    function isMonochromeLogo(svgText, file) {
        if (file.includes('(color)')) return false;

        const colors = new Set();
        const colorMatches = svgText.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|\b(?:black|white|transparent|none|currentColor)\b/g) || [];
        colorMatches.forEach(match => colors.add(match));

        const hasHueColor = [...colors]
            .map(parseSvgColor)
            .filter(Boolean)
            .some(rgb => !isNeutralColor(rgb));

        return !hasHueColor;
    }

    function sanitizeLogoSvg(svg) {
        svg.querySelectorAll('script, foreignObject').forEach(node => node.remove());
        if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        return svg;
    }

    function measureLogoSvg(svg) {
        return new Promise(resolve => {
            const holder = document.createElement('div');
            holder.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;';
            document.body.appendChild(holder);
            holder.appendChild(svg);

            window.requestAnimationFrame(() => {
                let box = null;
                try {
                    box = svg.getBBox();
                } catch (_) {
                    box = null;
                }
                holder.remove();
                resolve(box && box.width > 0 && box.height > 0 ? box : null);
            });
        });
    }

    function queueLogoMeasurement(svg) {
        const result = logoMeasureQueue.then(() => measureLogoSvg(svg), () => measureLogoSvg(svg));
        logoMeasureQueue = result.catch(() => {});
        return result;
    }

    function setLogoObjectUrl(img, svg) {
        if (img.dataset.logoObjectUrl) {
            URL.revokeObjectURL(img.dataset.logoObjectUrl);
        }

        const serialized = new XMLSerializer().serializeToString(svg);
        const objectUrl = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml' }));
        img.dataset.logoObjectUrl = objectUrl;
        img.src = objectUrl;
        return objectUrl;
    }

    async function loadNormalizedLogoImg(logo, src, img) {
        try {
            const response = await fetch(encodeURI(src));
            if (!response.ok) throw new Error(`Logo not found: ${src}`);

            const svgText = await response.text();
            const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
            const svg = doc.querySelector('svg');
            if (!svg || doc.querySelector('parsererror')) throw new Error(`Invalid SVG: ${src}`);

            sanitizeLogoSvg(svg);
            const isMono = isMonochromeLogo(svgText, logo.file);
            const box = await queueLogoMeasurement(svg);

            if (box) {
                normalizeLogoSvgViewBox(svg, box);
                img.style.setProperty('--logo-size', `${getBalancedLogoSize(box).toFixed(1)}%`);
            }

            const normalizedSrc = setLogoObjectUrl(img, svg);
            img.classList.toggle('logo-mono', isMono);
            logo.isMono = isMono;
            logo.normalizedSrc = normalizedSrc;
            logoMonoBySrc.set(src, isMono);
            logoMonoBySrc.set(normalizedSrc, isMono);
        } catch (_) {
            img.classList.remove('logo-mono');
        }
    }

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

    const ZAXID_PROJECT_CLASSES = {
        'Main Stage': 'main-stage-project',
        'Rock Stage': 'rock-project',
        'Love Stage': 'love-project',
        'Entry Banner': 'entry-project',
        'T-Shirt': 'tshirt-project',
        'Map': 'map-project'
    };

    const ZAXID_REAL_ROW_CLASSES = {
        'Main Stage': 'main-stage-photos',
        'Rock Stage': 'rock-project-photos',
        'Love Stage': 'love-project-photos',
        'Entry Banner': 'entry-project-photos',
        'T-Shirt': 'tshirt-project-photos'
    };

    const DEFAULT_ZAXID_STAGE_PAIRS = [
        { names: ['Rock Stage', 'Love Stage'], columns: '2fr 1fr' },
        { names: ['Entry Banner', 'T-Shirt'], columns: '1fr 2fr' }
    ];

    function isZaxidCase(caseItem) {
        return caseItem && (caseItem.id === 'zaxid2019' || caseItem.id === 'zaxid2020_21');
    }

    function caseAssetPath(caseItem, sub, file) {
        return [caseItem.path, sub && sub.dir, file].filter(Boolean).join('/');
    }

    function getZaxidStagePairs(caseItem) {
        if (!isZaxidCase(caseItem)) return [];
        return caseItem.stagePairs || DEFAULT_ZAXID_STAGE_PAIRS;
    }

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
            const logoMeta = LOGOS.find(logo => `portfolio/Logos/${logo.file}` === src || logo.normalizedSrc === src);
            if (logoMonoBySrc.get(src) === true || (logoMeta && logoMeta.isMono === true)) {
                img.classList.add('logo-mono');
            }
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
            const displaySrc = options.inLightbox ? nextSrc : getImagePreviewSrc(nextSrc);

            if (meta.immediate || img.src.endsWith(encodeURI(displaySrc))) {
                img.src = displaySrc;
                img.style.opacity = '1';
                return;
            }

            img.style.opacity = '0';
            fadeTimer = window.setTimeout(() => {
                img.src = displaySrc;
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
            if (badge.label) b.dataset.i18nLabel = badge.label;
            w.appendChild(b);
        }
        const img = document.createElement('img');
        setImageSource(img, src);
        w.appendChild(img);
        return makeMediaOpenable(w, src);
    }

    function makeSourceCard(src, options = {}) {
        const card = el('div', 'source-card');
        const {
            label = '',
            badgeKey = 'sourceLabel',
            badgeTextKey = '',
            noteKey = 'sourceNote'
        } = options;
        const badgeKeyResolved = badgeTextKey || badgeKey;
        const badgeText = badgeTextKey
            ? t(badgeTextKey)
            : (label ? `${t(badgeKey)} • ${label}` : t(badgeKey));
        card.appendChild(makeImgWrap(src, '', {
            cls: 'source-badge source-origin-badge',
            text: badgeText,
            key: badgeKeyResolved,
            label: badgeTextKey ? '' : label
        }));
        const note = el('div', 'source-note', t(noteKey));
        note.dataset.i18n = noteKey;
        card.appendChild(note);
        return card;
    }

    function setupHorizontalStoriesScroller(scroller) {
        if (!scroller) return;

        scroller.style.touchAction = 'pan-x pan-y';
        scroller.style.WebkitOverflowScrolling = 'touch';
        scroller.style.overscrollBehaviorX = 'contain';
        scroller.style.cursor = 'grab';

        // Make vertical wheel move the horizontal track if there is room to scroll.
        scroller.addEventListener('wheel', (e) => {
            if (window.innerWidth <= 768) return;
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
    function makeProjectZoom(src, extraClass = '', options = {}) {
        const w = el('div', `img-wrap project-media${extraClass ? ` ${extraClass}` : ''}`);
        if (options.aspectRatio) w.style.aspectRatio = options.aspectRatio;
        const badge = el('span', 'source-badge project-icon-badge', '<i class="fas fa-pen-ruler" aria-hidden="true"></i>');
        badge.dataset.i18n = 'projectLabel';
        badge.setAttribute('aria-label', t('projectLabel'));
        badge.title = t('projectLabel');
        badge.style.background = 'rgba(72,0,255,.85)';
        w.appendChild(badge);
        const img = document.createElement('img');
        setImageSource(img, src);
        w.appendChild(img);
        return makeMediaOpenable(w, src);
    }

    function makeRealPhotoOverlay(src) {
        const overlay = el('div', 'map-real-photo-overlay');
        const img = document.createElement('img');
        setImageSource(img, src);
        overlay.appendChild(img);
        return makeMediaOpenable(overlay, src);
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
        setDeferredImageSource(poster, options.previewSrc || getVideoPreviewSrc(src));
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
            caseSection.island.classList.add(`case-${c.id}`);
            if (c.id === 'igcarousels') {
                caseSection.island.classList.add('case-span-2');
            }

            const body = el('div', 'case-body');
            body.style.padding = '0';
            let lottieStickersRendered = false;
            const appendLottieStickers = () => {
                if (!c.lottieStickers || lottieStickersRendered) return;

                const container = el('div', 'img-wrap');
                const badgeKey = 'animStickers';
                const badgeText = t(badgeKey);
                const badge = el('span', 'source-badge', badgeText);
                badge.dataset.i18n = badgeKey;
                container.appendChild(badge);

                const lg = el('div', 'stickers-grid lottie-stickers-grid');
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
                lottieStickersRendered = true;
            };

            // Source image(s)
            if (c.source) {
                body.appendChild(makeSourceCard(`${c.path}/${c.source}`));
            }

            if (zaxidSource2020) {
                body.appendChild(makeSourceCard(zaxidSource2020.path, zaxidSource2020));
                appendLottieStickers();
            }

            if (zaxidSource2021) {
                body.appendChild(makeSourceCard(zaxidSource2021.path, zaxidSource2021));
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
                    const subTitle = el('div', 'subcase-title', '');
                    subTitle.style.cssText = 'font-size:.75rem;font-weight:700;color:var(--text-muted);margin:.75rem 0 .4rem;text-transform:uppercase;letter-spacing:.06em;';
                    subTitle.textContent = sub.name;
                    target.appendChild(subTitle);

                    let projectClass = sub.projectClass || '';
                    let realRowClass = sub.realRowClass ? ` ${sub.realRowClass}` : '';
                    if (isZaxidCase(c)) {
                        projectClass = [projectClass, ZAXID_PROJECT_CLASSES[sub.name]].filter(Boolean).join(' ');
                        if (!realRowClass && ZAXID_REAL_ROW_CLASSES[sub.name]) {
                            realRowClass = ` ${ZAXID_REAL_ROW_CLASSES[sub.name]}`;
                        }
                    }

                    // Project with zoom
                    const projectNode = makeProjectZoom(caseAssetPath(c, sub, sub.project), projectClass, { aspectRatio: sub.aspectRatio });

                    if (sub.realOverlay && sub.real && sub.real.length) {
                        projectNode.classList.add('has-real-overlay');
                        projectNode.appendChild(makeRealPhotoOverlay(caseAssetPath(c, sub, sub.real[0])));
                        target.appendChild(projectNode);
                        return;
                    }

                    target.appendChild(projectNode);

                    // Real photos
                    if (sub.real && sub.real.length) {
                        const realRow = el('div', 'real-photos-row' + realRowClass);
                        realRow.style.marginTop = '.5rem';
                        sub.real.forEach(r => {
                            realRow.appendChild(makeImgWrap(caseAssetPath(c, sub, r), 'real-photo-wrap'));
                        });
                        target.appendChild(realRow);
                    }
                };

                const zaxidPairs = getZaxidStagePairs(c);
                if (zaxidPairs.length) {
                    const pairMap = new Map(zaxidPairs.map(pair => [
                        pair.names[0],
                        {
                            columns: pair.columns || '1fr 1fr',
                            subs: pair.names.map(name => c.subs.find(s => s.name === name))
                        }
                    ]));
                    const pairRightNames = new Set();
                    pairMap.forEach(pair => {
                        if (pair.subs[0] && pair.subs[1]) {
                            pairRightNames.add(pair.subs[1].name);
                        }
                    });
                    const rendered = new Set();

                    c.subs.forEach(sub => {
                        const pair = pairMap.get(sub.name);
                        if (pair && pair.subs[0] && pair.subs[1]) {
                            const stagesRow = el('div', 'zaxid-stage-row');
                            stagesRow.style.cssText = `display:grid;gap:var(--inner-gap);grid-template-columns:${pair.columns};`;

                            pair.subs.forEach(stage => {
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

                const sg = el('div', 'stickers-grid static-stickers-grid');
                sg.style.paddingTop = '2rem'; // Space for badge
                c.stickers.files.forEach(f => {
                    const si = el('div', 'sticker-item');
                    if (c.id === 'zaxid2019' && f === '3.png') {
                        si.classList.add('mobile-only-sticker');
                    }
                    if (c.id === 'zaxid2019' && f === '8.png') {
                        si.classList.add('mobile-hidden-sticker');
                    }
                    const img = document.createElement('img');
                    const src = `${c.path}/${c.stickers.dir}/${f}`;
                    setDeferredImageSource(img, src);
                    si.appendChild(img);
                    sg.appendChild(makeMediaOpenable(si, src));
                });
                container.appendChild(sg);
                container.appendChild(makeTelegramStickerLink(TELEGRAM_STICKER_LINKS.static));
                body.appendChild(container);
            }

            // Lottie stickers
            appendLottieStickers();
            // IG Static posts (3x3 grid preview, scrollable) — no label
            if (c.igGrid && !isZaxidMergedLayout) {
                const igg = el('div', 'ig-grid hide-scroll');
                igg.style.cssText = 'aspect-ratio: 1; overflow-y: auto; grid-auto-rows: calc((100% - (var(--inner-gap) * 2)) / 3);';
                
                c.igGrid.files.forEach(f => {
                    const gi = el('div', 'ig-grid-item');
                    const img = document.createElement('img');
                    const src = `${c.path}/${c.igGrid.dir}/${f}`;
                    setDeferredImageSource(img, src);
                    gi.appendChild(img);
                    igg.appendChild(makeMediaOpenable(gi, src));
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
                    const src = `${c.path}/${c.igStaticStories.dir}/${f}`;
                    setDeferredImageSource(img, src);
                    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
                    gi.appendChild(img);
                    isg.appendChild(makeMediaOpenable(gi, src));
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
                        const src = `${c.path}/${c.igGrid.dir}/${f}`;
                        setDeferredImageSource(img, src);
                        gi.appendChild(img);
                        igPostsMixed.appendChild(makeMediaOpenable(gi, src));
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
                    carousel.scrollLeft = 0;
                    
                    folder.files.forEach(f => {
                        const slide = el('div', 'carousel-slide');
                        const img = document.createElement('img');
                        const src = `${c.path}/${folder.dir}/${f}`;
                        setImageSource(img, src);
                        img.style.cssText = 'width:100%;height:auto;display:block;border-radius:0;filter:none;box-shadow:none;';
                        img.draggable = false; // Disable native browser drag
                        
                        // Equalize heights by setting flex-grow based on aspect ratio
                        if (f === folder.files[0]) {
                            img.addEventListener('load', () => {
                                const ar = img.naturalWidth / img.naturalHeight;
                                // In a flex row, setting flex: [aspect-ratio] ensures items have the same height
                                if (Number.isFinite(ar) && ar > 0) {
                                    cWrapper.style.flex = `${ar} ${ar} 0px`;
                                }
                            }, { once: true });
                        }

                        let isDragging = false;
                        let startX = 0;
                        img.addEventListener('mousedown', e => { 
                            startX = e.pageX; 
                            isDragging = false;
                            e.preventDefault(); // Stop native ghost drag
                        });
                        img.addEventListener('mousemove', e => { if (Math.abs(e.pageX - startX) > 5) isDragging = true; });
                        makeMediaOpenable(img, src, 'carousel', {
                            shouldOpen: () => !isDragging,
                            items: carouselSources
                        });
                        
                        slide.appendChild(img);
                        carousel.appendChild(slide);
                    });
                    cWrapper.style.flex = '1'; // Default fallback until image loads
                    carouselMask.appendChild(carousel);
                    cWrapper.appendChild(carouselMask);
                    requestAnimationFrame(() => {
                        carousel.scrollTo({ left: 0, behavior: 'auto' });
                    });

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
                        if (window.innerWidth <= 768) return;
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
            const src = `portfolio/Logos/${logo.file}`;
            img.className = 'logo-svg';
            img.addEventListener('load', () => loadNormalizedLogoImg(logo, src, img), { once: true });
            setDeferredImageSource(img, src);
            cell.appendChild(img);
            grid.appendChild(makeMediaOpenable(cell, src, 'logo'));
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
            const src = `portfolio/Posters/${p}`;
            setDeferredImageSource(img, src);
            item.appendChild(img);
            grid.appendChild(makeMediaOpenable(item, src));
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
            item.style.aspectRatio = '1';
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
    function initLottie(rootNode = document) {
        const items = rootNode.querySelectorAll('[data-lottie-src]');
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
    function initScrollAnimations(rootNode = document) {
        if (!('IntersectionObserver' in window)) {
            rootNode.querySelectorAll('.fade-up').forEach(el => {
                el.style.animationPlayState = 'running';
                el.dataset.scrollAnimationReady = 'true';
            });
            return;
        }

        const obs = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.animationPlayState = 'running';
                    entry.target.dataset.scrollAnimationReady = 'true';
                    obs.unobserve(entry.target);
                }
            });
        }, { rootMargin: '50px', threshold: 0.1 });

        rootNode.querySelectorAll('.fade-up').forEach(el => {
            if (el.dataset.scrollAnimationReady) return;
            el.dataset.scrollAnimationReady = 'observing';
            el.style.animationPlayState = 'paused';
            obs.observe(el);
        });
    }

    /* ── Category Filtering ── */
    function buildSectionOnce(id, builder) {
        if (!id || typeof builder !== 'function' || builtSections.has(id)) return;
        builder();
        builtSections.add(id);

        const section = document.getElementById(id);
        if (section) {
            requestAnimationFrame(() => {
                initLottie(section);
                initScrollAnimations(section);
            });
        }
    }

    function ensureFilterSections(filter) {
        if (filter === 'all') {
            deferredSectionBuilders.forEach((builder, id) => buildSectionOnce(id, builder));
            return;
        }

        const id = `sec-${filter}`;
        const builder = deferredSectionBuilders.get(id);
        if (builder) buildSectionOnce(id, builder);
    }

    function scheduleDeferredSections() {
        [
            ['sec-logos', 900],
            ['sec-posters', 1600],
            ['sec-motion', 2300]
        ].forEach(([id, delay]) => {
            const builder = deferredSectionBuilders.get(id);
            if (!builder) return;
            window.setTimeout(() => runWhenIdle(() => buildSectionOnce(id, builder)), delay);
        });
    }

    function initFilters() {
        const tabs = document.querySelectorAll('.cat-tab');
        const sections = document.querySelectorAll('.portfolio-section');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const filter = tab.dataset.filter;
                ensureFilterSections(filter);
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
        deferredSectionBuilders.set('sec-logos', buildLogos);
        deferredSectionBuilders.set('sec-posters', buildPosters);
        deferredSectionBuilders.set('sec-motion', buildMotion);
        buildSectionOnce('sec-cases', buildCases);
        initFilters();
        initControls();
        requestAnimationFrame(() => initScrollAnimations(document));
        scheduleDeferredSections();
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

