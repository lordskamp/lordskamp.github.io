/* ═══════════════════════════════════════════════════════
   Portfolio App — Lordskamp
   ═══════════════════════════════════════════════════════ */

(() => {
    'use strict';

    /* ── i18n ── */
    const i18n = {
        uk: {
            back: "Назад", heroTitle: "Моє портфоліо",
            heroSub: "Добірка проєктів з брендингу, моушн-дизайну та креативних робіт.",
            tabAll: "Усе", tabCases: "Кейси", tabLogos: "Лого", tabPosters: "Постери", tabMotion: "Моушн",
            sourceLabel: "ВИХІДНИЙ ФАЙЛ", projectLabel: "ДИЗАЙН-ПРОЄКТ", realLabel: "РЕАЛЬНЕ ФОТО",
            zoomHint: "Наведіть для зуму", clickToShuffle: "Натисніть, щоб змінити",
            secCases: "Кейси", secLogos: "Логотипи", secPosters: "Постери", secMotion: "Моушн-графіка",
            stickers: "Наліпки", animStickers: "Анімовані наліпки", igPosts: "Пости Instagram",
            igStories: "Сторіс Instagram", volunteer: "Волонтерські збори",
        },
        en: {
            back: "Back", heroTitle: "My Portfolio",
            heroSub: "A curated selection of branding, motion design, and creative projects.",
            tabAll: "All", tabCases: "Cases", tabLogos: "Logos", tabPosters: "Posters", tabMotion: "Motion",
            sourceLabel: "SOURCE FILE", projectLabel: "DESIGN PROJECT", realLabel: "REAL PHOTO",
            zoomHint: "Hover to zoom", clickToShuffle: "Click to change",
            secCases: "Cases", secLogos: "Logos", secPosters: "Posters", secMotion: "Motion Graphics",
            stickers: "Stickers", animStickers: "Animated Stickers", igPosts: "Instagram Posts",
            igStories: "Instagram Stories", volunteer: "Volunteer Fundraisers",
        }
    };
    let lang = (navigator.language || '').startsWith('uk') ? 'uk' : 'en';
    const t = k => (i18n[lang] && i18n[lang][k]) || (i18n.en[k]) || k;

    function applyI18n() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = t(el.dataset.i18n);
        });
    }

    /* ── Theme ── */
    const root = document.documentElement;
    let isLight = window.matchMedia('(prefers-color-scheme: dark)').matches ? false : true;

    function updateTheme() {
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

    /* ── Lightbox ── */
    const lightbox = document.getElementById('lightbox');
    const lightboxContent = document.getElementById('lightboxContent');
    const lightboxClose = document.getElementById('lightboxClose');

    function openLightbox(src, type = 'image') {
        lightboxContent.innerHTML = '';
        if (type === 'video') {
            const v = document.createElement('video');
            v.src = src; v.controls = true; v.autoplay = true; v.style.maxWidth = '92vw'; v.style.maxHeight = '92vh'; v.style.borderRadius = '8px';
            lightboxContent.appendChild(v);
        } else {
            const img = document.createElement('img');
            img.src = src; img.alt = '';
            lightboxContent.appendChild(img);
        }
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => { lightboxContent.innerHTML = ''; }, 300);
    }

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

    /* ── Build Helpers ── */
    function el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html) e.innerHTML = html;
        return e;
    }

    function makeSectionBlock(title, icon) {
        const island = el('section', 'island fade-up');
        const heading = el('h2', 'section-title');
        heading.innerHTML = `<i class="fas ${icon}"></i><span>${title}</span>`;
        const shell = el('div', 'section-content-shell');
        island.appendChild(heading);
        island.appendChild(shell);
        return { island, shell };
    }

    function makeImgWrap(src, extraClass, badge) {
        const w = el('div', 'img-wrap ' + (extraClass || ''));
        if (badge) {
            const b = el('span', badge.cls, badge.text);
            w.appendChild(b);
        }
        const img = document.createElement('img');
        img.src = src; img.alt = ''; img.loading = 'lazy';
        // Only IRL images can open in lightbox
        if (badge && badge.cls === 'real-label') {
            img.style.cursor = 'zoom-in';
            img.addEventListener('click', () => openLightbox(src));
        }
        w.appendChild(img);
        return w;
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
        badge.style.background = 'rgba(72,0,255,.85)';
        w.appendChild(badge);
        const img = document.createElement('img');
        img.src = src; img.alt = ''; img.loading = 'lazy';
        w.appendChild(img);
        return w;
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
            const caseSection = makeSectionBlock(caseTitle, c.icon || 'fa-briefcase');
            if (c.id === 'igcarousels') {
                caseSection.island.classList.add('case-span-2');
            }

            const body = el('div', 'case-body');
            body.style.padding = '0';

            // Source image(s)
            if (c.source) {
                body.appendChild(makeImgWrap(`${c.path}/${c.source}`, '', { cls: 'source-badge', text: t('sourceLabel') }));
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
                container.appendChild(badge);

                const sg = el('div', 'stickers-grid');
                sg.style.paddingTop = '2rem'; // Space for badge
                c.stickers.files.forEach(f => {
                    const si = el('div', 'sticker-item');
                    const img = document.createElement('img');
                    img.src = `${c.path}/${c.stickers.dir}/${f}`; img.alt = ''; img.loading = 'lazy';
                    si.appendChild(img);
                    sg.appendChild(si);
                });
                container.appendChild(sg);
                body.appendChild(container);
            }

            // Lottie stickers
            if (c.lottieStickers) {
                const container = el('div', 'img-wrap');
                const badgeText = isZaxidMergedLayout ? t('stickers') : t('animStickers');
                const badge = el('span', 'source-badge', badgeText);
                container.appendChild(badge);

                const lg = el('div', 'stickers-grid');
                lg.style.paddingTop = '2rem'; // Space for badge
                const lottiePath = c.lottieStickers.path || c.path;
                c.lottieStickers.files.forEach(f => {
                    const li = el('div', 'lottie-item');
                    li.dataset.lottieSrc = `${lottiePath}/${c.lottieStickers.dir}/${f}`;
                    lg.appendChild(li);
                });
                container.appendChild(lg);
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
                    igg.appendChild(gi);
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
                    isg.appendChild(gi);
                });
                body.appendChild(isg);
            }

            // IG Anim posts (video) — no label
            if (c.igAnimPosts && !isZaxidMergedLayout) {
                const vg = el('div', 'ig-grid hide-scroll');
                vg.style.cssText = 'aspect-ratio: 1; overflow-y: auto; grid-auto-rows: calc((100% - (var(--inner-gap) * 2)) / 3);';
                c.igAnimPosts.videos.forEach(f => {
                    const vi = el('div', 'ig-grid-item');
                    vi.style.cursor = 'pointer';
                    const video = document.createElement('video');
                    video.src = `${c.path}/${c.igAnimPosts.dir}/${f}`;
                    video.muted = true; video.loop = true; video.playsInline = true;
                    video.preload = 'metadata';
                    video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                    vi.addEventListener('mouseenter', () => video.play().catch(() => { }));
                    vi.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
                    vi.addEventListener('click', () => openLightbox(video.src, 'video'));
                    vi.appendChild(video);
                    vg.appendChild(vi);
                });
                body.appendChild(vg);
            }

            // Zaxid 2020→2021: combined animated + static IG posts in one vertical scroll
            if (isZaxidMergedLayout && (c.igAnimPosts || c.igGrid)) {
                const igPostsMixed = el('div', 'ig-grid hide-scroll');
                igPostsMixed.style.cssText = 'aspect-ratio: 1; overflow-y: auto; grid-auto-rows: calc((100% - (var(--inner-gap) * 2)) / 3);';

                if (c.igAnimPosts) {
                    c.igAnimPosts.videos.forEach(f => {
                        const vi = el('div', 'ig-grid-item');
                        vi.style.cursor = 'pointer';
                        const video = document.createElement('video');
                        video.src = `${c.path}/${c.igAnimPosts.dir}/${f}`;
                        video.muted = true; video.loop = true; video.playsInline = true;
                        video.preload = 'metadata';
                        video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                        vi.addEventListener('mouseenter', () => video.play().catch(() => { }));
                        vi.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
                        vi.addEventListener('click', () => openLightbox(video.src, 'video'));
                        vi.appendChild(video);
                        igPostsMixed.appendChild(vi);
                    });
                }

                if (c.igGrid) {
                    c.igGrid.files.forEach(f => {
                        const gi = el('div', 'ig-grid-item');
                        const img = document.createElement('img');
                        img.src = `${c.path}/${c.igGrid.dir}/${f}`; img.alt = ''; img.loading = 'lazy';
                        gi.appendChild(img);
                        igPostsMixed.appendChild(gi);
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
                    const vi = el('div', '');
                    vi.style.cssText = 'flex: 0 0 calc((100% - (var(--inner-gap) * 2)) / 3); aspect-ratio: 9/16; border-radius: 10px; overflow: hidden; scroll-snap-align: start; cursor: pointer; position: relative;';
                    const video = document.createElement('video');
                    video.src = `${c.path}/${c.igAnimStories.dir}/${f}`;
                    video.muted = true; video.loop = true; video.playsInline = true;
                    video.preload = 'metadata';
                    video.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
                    vi.addEventListener('mouseenter', () => video.play().catch(() => { }));
                    vi.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
                    vi.addEventListener('click', () => openLightbox(video.src, 'video'));
                    vi.appendChild(video);
                    asg.appendChild(vi);
                });
                body.appendChild(asg);
            }

            // AR Effect videos — auto aspect ratio from actual content
            if (c.arVideos) {
                const vg = el('div', '');
                vg.style.cssText = 'display:grid;gap:var(--inner-gap);grid-template-columns:repeat(3,1fr);';
                c.arVideos.forEach(f => {
                    const vi = el('div', 'video-item');
                    vi.style.cssText = 'cursor:pointer;';
                    const video = document.createElement('video');
                    video.src = `${c.path}/${f}`;
                    video.muted = true; video.loop = true; video.playsInline = true;
                    video.preload = 'metadata';
                    video.style.cssText = 'width:100%;display:block;';
                    // Auto-detect aspect ratio from video metadata
                    video.addEventListener('loadedmetadata', () => {
                        const w = video.videoWidth, h = video.videoHeight;
                        if (w && h) vi.style.aspectRatio = `${w}/${h}`;
                    });
                    vi.addEventListener('mouseenter', () => video.play().catch(() => { }));
                    vi.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
                    vi.addEventListener('click', () => openLightbox(video.src, 'video'));
                    vi.appendChild(video);
                    vg.appendChild(vi);
                });
                body.appendChild(vg);
            }

            // Volunteer folders (click-to-shuffle)
            if (c.isVolunteer && c.folders) {
                const vGrid = el('div', 'volunteer-grid');
                c.folders.forEach(folder => {
                    const vCard = el('div', 'volunteer-card');
                    const img = document.createElement('img');
                    img.src = `${c.path}/${folder.dir}/${folder.files[0]}`; img.alt = ''; img.loading = 'lazy';
                    img.style.cssText = 'width:100%;display:block;margin:0;';
                    vCard.appendChild(img);

                    if (folder.files.length > 1) {
                        const hint = el('div', 'volunteer-tap-hint', `<i class="fas fa-random"></i> ${t('clickToShuffle')}`);
                        vCard.appendChild(hint);
                        let currentIdx = 0;
                        let remainingIdx = [];

                        const refillQueue = () => {
                            remainingIdx = folder.files
                                .map((_, idx) => idx)
                                .filter(idx => idx !== currentIdx);
                            for (let i = remainingIdx.length - 1; i > 0; i--) {
                                const j = Math.floor(Math.random() * (i + 1));
                                [remainingIdx[i], remainingIdx[j]] = [remainingIdx[j], remainingIdx[i]];
                            }
                        };

                        refillQueue();
                        vCard.addEventListener('click', () => {
                            if (!remainingIdx.length) refillQueue();
                            currentIdx = remainingIdx.pop();
                            img.style.opacity = '0';
                            setTimeout(() => {
                                img.src = `${c.path}/${folder.dir}/${folder.files[currentIdx]}`;
                                img.style.opacity = '1';
                            }, 250);
                        });
                    }
                    vGrid.appendChild(vCard);
                });
                body.appendChild(vGrid);
            }

            // IG Carousels — Horizontal-only scroll, like Instagram
            if (c.carouselFolders) {
                const cGrid = el('div', 'carousel-grid');
                c.carouselFolders.forEach(folder => {
                    const cWrapper = el('div', 'carousel-wrapper');
                    const carousel = el('div', 'insta-carousel');
                    carousel.style.margin = '.5rem 0';
                    carousel.style.borderRadius = '12px';
                    
                    folder.files.forEach(f => {
                        const slide = el('div', 'carousel-slide img-wrap');
                        const img = document.createElement('img');
                        img.src = `${c.path}/${folder.dir}/${f}`;
                        img.alt = ''; img.loading = 'lazy';
                        img.style.cssText = 'width:100%; height:auto; display:block;';
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
                        img.addEventListener('click', e => { if (!isDragging) openLightbox(img.src); });
                        
                        slide.appendChild(img);
                        carousel.appendChild(slide);
                    });
                    cWrapper.style.flex = '1'; // Default fallback until image loads
                    cWrapper.appendChild(carousel);

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
        const section = makeSectionBlock(t('secLogos'), 'fa-signature');
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
            grid.appendChild(cell);
        });
        section.shell.appendChild(grid);
        sec.appendChild(section.island);
    }

    /* ── Build POSTERS Section (4-column grid, sorted numerically) ── */
    function buildPosters() {
        const sec = document.getElementById('sec-posters');
        sec.innerHTML = '';
        const section = makeSectionBlock(t('secPosters'), 'fa-images');

        const grid = el('div', 'posters-grid');
        POSTERS.forEach(p => {
            const item = el('div', 'poster-item fade-up');
            const img = document.createElement('img');
            img.src = `portfolio/Posters/${p}`; img.alt = ''; img.loading = 'lazy';
            item.appendChild(img);
            grid.appendChild(item);
        });
        section.shell.appendChild(grid);
        sec.appendChild(section.island);
    }

    /* ── Build MOTION Section ── */
    function buildMotion() {
        const sec = document.getElementById('sec-motion');
        sec.innerHTML = '';
        const section = makeSectionBlock(t('secMotion'), 'fa-film');

        const grid = el('div', 'motion-grid');

        // Lottie animations
        MOTION.lottie.forEach(f => {
            const item = el('div', 'lottie-item fade-up');
            item.style.aspectRatio = '1'; item.style.minHeight = '150px';
            item.dataset.lottieSrc = `${MOTION.path}/${f}`;
            grid.appendChild(item);
        });

        // Logo video
        if (MOTION.logoVideo) {
            const vi = el('div', 'video-item fade-up');
            vi.style.cssText = 'aspect-ratio:1;cursor:pointer;';
            const video = document.createElement('video');
            video.src = `${MOTION.path}/${MOTION.logoVideo}`;
            video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'metadata';
            video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
            vi.addEventListener('mouseenter', () => video.play().catch(() => { }));
            vi.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
            vi.addEventListener('click', () => openLightbox(video.src, 'video'));
            vi.appendChild(video);
            grid.appendChild(vi);
        }

        // Motion videos — auto aspect ratio detection
        MOTION.videos.forEach(f => {
            const vi = el('div', 'video-item fade-up');
            vi.style.cssText = 'cursor:pointer;';
            const video = document.createElement('video');
            video.src = `${MOTION.path}/${f}`;
            video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'metadata';
            video.style.cssText = 'width:100%;display:block;';
            video.addEventListener('loadedmetadata', () => {
                const w = video.videoWidth, h = video.videoHeight;
                if (w && h) vi.style.aspectRatio = `${w}/${h}`;
            });
            vi.addEventListener('mouseenter', () => video.play().catch(() => { }));
            vi.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
            vi.addEventListener('click', () => openLightbox(video.src, 'video'));
            vi.appendChild(video);
            grid.appendChild(vi);
        });

        section.shell.appendChild(grid);
        sec.appendChild(section.island);
    }

    /* ── Init Lottie animations (IntersectionObserver lazy-load) ── */
    function initLottie() {
        if (typeof lottie === 'undefined') return;
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const src = el.dataset.lottieSrc;
                    if (!src || el.dataset.lottieLoaded) return;
                    el.dataset.lottieLoaded = 'true';
                    lottie.loadAnimation({
                        container: el,
                        renderer: 'svg',
                        loop: true,
                        autoplay: true,
                        path: src
                    });
                    observer.unobserve(el);
                }
            });
        }, { rootMargin: '200px' });

        document.querySelectorAll('[data-lottie-src]').forEach(el => observer.observe(el));
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

    /* ── Custom Cursor (full implementation from index.html) ── */
    function initCursor() {
        const cursor = document.getElementById('customCursor');
        if (!cursor || window.matchMedia('(hover:none) and (pointer:coarse)').matches) return;

        // Expose position for particle trail
        window.customCursorPos = { x: 0, y: 0, color: null };

        // Smooth following with lerp
        let mouseX = 0, mouseY = 0, cursorX = 0, cursorY = 0;
        const LERP = 0.15;
        let rafId = null;

        function updateCursor() {
            cursorX += (mouseX - cursorX) * LERP;
            cursorY += (mouseY - cursorY) * LERP;
            cursor.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0) translate(-50%, -50%)`;
            window.customCursorPos.x = cursorX;
            window.customCursorPos.y = cursorY;
            rafId = requestAnimationFrame(updateCursor);
        }
        rafId = requestAnimationFrame(updateCursor);

        const brandColors = {
            'Behance': '#0057ff', 'Instagram-Portfolio': '#ff306c',
            'Resume': '#8b5cf6', 'Portfolio': '#8c3dc1'
        };

        document.addEventListener('pointermove', e => {
            if (e.pointerType && e.pointerType !== 'mouse') return;
            mouseX = e.clientX;
            mouseY = e.clientY;
        }, { passive: true });

        // Hover / click
        const sel = 'a,button,.island,.case-card,.logo-cell,.poster-item,.volunteer-card,.img-wrap,.ig-grid-item,.sticker-item,.lottie-item,.ctrl-btn,.cat-tab,.back-btn,video';

        document.addEventListener('mouseover', e => {
            if (!e.target.closest) return;
            const match = e.target.closest(sel);
            if (match) {
                cursor.classList.add('cursor-hover');
                // Brand color
                const brand = match.dataset?.brand || match.closest('[data-brand]')?.dataset?.brand;
                if (brand && brandColors[brand]) {
                    const c = brandColors[brand];
                    cursor.style.background = c;
                    cursor.style.boxShadow = `0 0 15px ${c}, 0 0 30px ${c}, 0 0 45px ${c}80`;
                    window.customCursorPos.color = c;
                }
            }
        }, { passive: true });

        document.addEventListener('mouseout', e => {
            if (!e.target.closest) return;
            const from = e.target.closest(sel);
            if (!from) return;
            const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(sel) : null;
            if (!to) {
                cursor.classList.remove('cursor-hover');
                cursor.style.background = '';
                cursor.style.boxShadow = '';
                window.customCursorPos.color = null;
            }
        }, { passive: true });

        document.addEventListener('mousedown', () => cursor.classList.add('cursor-click'));
        document.addEventListener('mouseup', () => cursor.classList.remove('cursor-click'));
        document.addEventListener('mouseleave', () => { cursor.style.opacity = '0'; });
        document.addEventListener('mouseenter', () => { cursor.style.opacity = '1'; });

        cursor.style.opacity = '0';
        document.addEventListener('pointermove', () => {
            document.body.classList.add('custom-cursor-active');
            cursor.style.opacity = '1';
        }, { once: true, passive: true });

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => { if (rafId) cancelAnimationFrame(rafId); });
    }

    /* ── Theme & Lang Buttons ── */
    function initControls() {
        updateTheme();
        document.getElementById('themeBtn')?.addEventListener('click', () => { isLight = !isLight; updateTheme(); });
        document.getElementById('langBtn')?.addEventListener('click', () => {
            lang = lang === 'uk' ? 'en' : 'uk';
            applyI18n();
            buildCases(); buildLogos(); buildPosters(); buildMotion();
            requestAnimationFrame(() => { initLottie(); initScrollAnimations(); });
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
        initCursor();
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

