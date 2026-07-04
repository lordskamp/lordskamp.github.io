(() => {
    'use strict';

    const WORD_LENGTH = 5;
    const DICTIONARY_URL = 'data/kobza-words.txt?v=20260703-variety';
    const LEADERBOARD_KEY = 'lordskamp:kobza-navpaky:leaderboard:v2';
    const DAILY_STATE_KEY = 'lordskamp:kobza-navpaky:daily-state:v1';
    const REMOTE_LEADERBOARD_ENDPOINT = getLeaderboardEndpoint();
    const REMOTE_LEADERBOARD_TIMEOUT_MS = 7000;
    const MIN_DICTIONARY_WORDS = 500;
    const RECENT_TARGET_LIMIT = 240;
    const DAILY_TARGET_ATTEMPT_LIMIT = 240;
    const UNLIMITED_TARGET_ATTEMPT_LIMIT = 480;
    const VARIETY_RE = /^\d{8,18}$/;
    const SHARE_FEEDBACK_MS = 1800;
    const UA_WORD_RE = /^[а-щьюяєіїґ]{5}$/u;
    const UA_LETTER_RE = /^[а-щьюяєіїґ]$/u;
    const DIFFICULTIES = {
        easy: { clueRows: 2, label: 'Легка' },
        normal: { clueRows: 3, label: 'Звичайна' },
        hard: { clueRows: 5, label: 'Складна' }
    };
    const MODES = {
        daily: 'Щоденна',
        unlimited: 'Нескінченна'
    };
    const SCORE_RANGES = {
        2: [
            { min: 1, max: 2 },
            { min: 3, max: 5 }
        ],
        3: [
            { min: 1, max: 2 },
            { min: 2, max: 3 },
            { min: 4, max: 6 }
        ],
        5: [
            { min: 0, max: 2, allowBlank: true },
            { min: 0, max: 3, allowBlank: true },
            { min: 1, max: 5 },
            { min: 2, max: 7 },
            { min: 3, max: 8 }
        ]
    };
    const MATCH_COUNT_RANGES = {
        easy: [
            { min: 120 },
            { min: 30 }
        ],
        normal: [
            { min: 80 },
            { min: 30 },
            { min: 30 }
        ],
        hard: [
            { min: 80 },
            { min: 30 },
            { min: 30 },
            { min: 30 },
            { min: 30 }
        ]
    };
    const STATE_NAMES = ['absent', 'present', 'correct'];
    const STATE_PRIORITY = { absent: 1, present: 2, correct: 3 };
    const KEYBOARD_ROWS = [
        ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ї'],
        ['ф', 'і', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'є'],
        ['ґ', 'я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', 'backspace']
    ];
    const LATIN_TO_UA = new Map(Object.entries({
        q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
        '[': 'х', ']': 'ї', a: 'ф', s: 'і', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о',
        k: 'л', l: 'д', ';': 'ж', "'": 'є', '`': 'ґ', z: 'я', x: 'ч', c: 'с', v: 'м',
        b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю'
    }));
    const FALLBACK_WORDS = [
        'аркуш', 'весна', 'гроза', 'доказ', 'життя', 'зміна', 'книга', 'нація',
        'пісня', 'радіо', 'слово', 'трава', 'хмара', 'човен', 'школа', 'ягода',
        'пошта', 'берег', 'думка', 'загін', 'місто', 'океан', 'свято'
    ];

    const els = {};
    const state = {
        words: [],
        wordSet: new Set(),
        mode: 'daily',
        difficulty: 'normal',
        target: '',
        rows: [],
        activeRow: 0,
        activeCol: 0,
        locked: false,
        revealed: false,
        invalidRow: null,
        puzzleNumber: 0,
        startedAt: 0,
        solvedRecorded: false,
        dailyRecord: null,
        pendingDailyEntry: null,
        pendingUnlimitedEntry: null,
        lastUnlimitedEntry: null,
        dailyRankLoading: false,
        dailyRankRequested: false,
        varietyId: '',
        helpSlide: 0,
        activeModal: null,
        nameDialogKind: 'daily',
        dictionaryFallback: false,
        recentTargets: []
    };

    const HELP_SLIDES = [
        {
            title: 'Як грати',
            body: () => `
                <p>Мета гри — заповнити сітку правильними літерами.</p>
                <p>Приклад стартової сітки:</p>
                ${renderHelpGrid([
                    blankRow(),
                    patternRow('ВАГОН', '01010'),
                    wordRow('КОБЗА', 'correct')
                ])}
                <em>Якщо ти знаєш Wordle: тут ми відновлюємо слова за фінальним словом і кольорами плиток.</em>
            `
        },
        {
            title: 'Кольори плиток',
            body: () => `
                <p>Колір кожної плитки показує її зв’язок із фінальним словом у нижньому рядку:</p>
                ${renderColorRule('correct', 'Літера точно збігається з фінальним словом.')}
                ${renderColorRule('present', 'Літера є у фінальному слові, але в іншій позиції.')}
                ${renderColorRule('absent', 'Літери немає у фінальному слові.')}
                <p>Якщо літера повторюється, зафарбовується лише потрібна кількість плиток: спочатку точні збіги, потім збіги не на своїх місцях.</p>
            `
        },
        {
            title: 'Дійсні слова',
            body: () => `
                <p>Кожен заповнений рядок має бути дійсним українським словом.</p>
                <div class="help-label">Добре:</div>
                ${renderHelpGrid([[
                    ...patternRow('ДОБРА', '02202')
                ]])}
                <div class="help-label">Погано:</div>
                ${renderHelpGrid([[
                    cell('absent', 'Ф'), cell('correct', 'Ж'), cell('absent', 'Ґ'), cell('absent', 'Ї'), cell('absent', 'Є')
                ]])}
            `
        },
        {
            title: 'Зверху вниз',
            body: () => `
                <p>Коли рядок прийнято, гра автоматично переходить до наступного.</p>
                ${renderHelpGrid([
                    patternRow('ВАГОН', '01010'),
                    patternRow('ДОБРА', '02202'),
                    wordRow('КОБЗА', 'correct')
                ])}
                <p>Кожен рядок перевіряється і як слово, і як точна відповідність кольорам відносно фінального слова.</p>
            `
        },
        {
            title: 'Помилки',
            body: () => `
                <p>Якщо слово не підходить, рядок здригнеться, а над пазлом з’явиться причина.</p>
                ${renderHelpGrid([
                    helpRow(patternRow('ВАГОН', '01010'), { accepted: true }),
                    helpRow(patternRow('ДОБРА', '20001'), { invalid: true }),
                    wordRow('КОБЗА', 'correct')
                ])}
                <p class="help-error-reason">Слово не відповідає кольорам рядка.</p>
                <p>Виправ рядок: щойно він знову матиме 5 літер, гра перевірить слово автоматично.</p>
            `
        },
        {
            title: 'Гарної гри!',
            body: () => `
                <p class="help-centered">Бажаю приємної гри.</p>
                ${renderHelpGrid([
                    patternRow('ВАГОН', '01010'),
                    patternRow('ДОБРА', '02202'),
                    wordRow('КОБЗА', 'correct')
                ])}
            `
        }
    ];

    function cell(stateName, letter = '') {
        return { state: stateName, letter };
    }

    function blankRow() {
        return Array.from({ length: WORD_LENGTH }, () => cell('absent'));
    }

    function wordRow(word, stateName) {
        return Array.from(word).map(letter => cell(stateName, letter));
    }

    function patternRow(word, patternKey) {
        return Array.from(word).map((letter, index) => cell(tileStateName(Number(patternKey[index])), letter));
    }

    function helpRow(cells, options = {}) {
        return { cells, ...options };
    }

    function renderHelpGrid(rows) {
        return `<div class="help-example">${rows.map(row => (
            `<div class="help-example-row-wrap${row.accepted ? ' is-accepted' : ''}${row.invalid ? ' is-invalid' : ''}">
                <div class="help-example-row">${(row.cells || row).map(item => (
                `<span class="help-tile" data-state="${item.state}">${escapeHtml(item.letter)}</span>`
            )).join('')}</div>
                <span class="help-row-check"${row.accepted ? ' aria-label="Рядок прийнято"' : ' aria-hidden="true"'}>✓</span>
            </div>`
        )).join('')}</div>`;
    }

    function renderColorRule(stateName, text) {
        return `
            <div class="color-rule">
                <span class="color-swatch" data-state="${stateName}"></span>
                <span>${escapeHtml(text)}</span>
            </div>
        `;
    }

    function getLeaderboardEndpoint() {
        const globalEndpoint = typeof window.KOBZA_LEADERBOARD_ENDPOINT === 'string'
            ? window.KOBZA_LEADERBOARD_ENDPOINT
            : '';
        const metaEndpoint = document.querySelector('meta[name="kobza-leaderboard-endpoint"]')?.content || '';
        return String(globalEndpoint || metaEndpoint).trim().replace(/\/$/, '');
    }

    function readUrlVariation() {
        const params = new URLSearchParams(window.location.search);
        const value = String(params.get('variety') || '').trim();
        return VARIETY_RE.test(value) ? value : '';
    }

    function readUrlDifficulty() {
        const params = new URLSearchParams(window.location.search);
        const value = String(params.get('difficulty') || '').trim();
        return DIFFICULTIES[value] ? value : 'normal';
    }

    function consumeDailyResetFlag() {
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.get('resetDaily') !== '1') return;
            window.localStorage.removeItem(DAILY_STATE_KEY);
            url.searchParams.delete('resetDaily');
            window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        } catch (_) {
            /* Reset links are only a local testing helper. */
        }
    }

    function makeVarietyId() {
        const randomPart = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
        return `${Date.now()}${randomPart}`.slice(0, 18);
    }

    function gameUrl({ mode = state.mode, varietyId = state.varietyId, difficulty = state.difficulty } = {}) {
        const url = new URL(window.location.href);
        url.hash = '';
        url.search = '';
        url.pathname = url.pathname.replace(/unwordle\.html$/i, 'unwordle');

        if (mode === 'unlimited') {
            url.searchParams.set('variety', varietyId || makeVarietyId());
            if (difficulty !== 'normal') url.searchParams.set('difficulty', difficulty);
        }

        return url.toString();
    }

    function syncUrlToMode() {
        const nextUrl = gameUrl();
        if (nextUrl !== window.location.href) {
            window.history.replaceState(null, '', nextUrl);
        }
    }

    function normalizeWord(value) {
        return String(value || '')
            .trim()
            .toLocaleLowerCase('uk-UA')
            .replace(/['ʼ`’]/g, '');
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function hashString(value) {
        let h = 2166136261;
        for (let i = 0; i < value.length; i += 1) {
            h ^= value.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    function mulberry32(seed) {
        let t = seed >>> 0;
        return () => {
            t += 0x6D2B79F5;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    }

    function todayKey(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function addDays(dateKey, offset) {
        const [year, month, day] = dateKey.split('-').map(Number);
        const date = new Date(year, month - 1, day + offset);
        return todayKey(date);
    }

    function shuffleCopy(items, rng = Math.random) {
        const copy = items.slice();
        for (let i = copy.length - 1; i > 0; i -= 1) {
            const j = Math.floor(rng() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    function scoreGuess(guess, target) {
        const result = Array(WORD_LENGTH).fill(0);
        const remaining = new Map();
        const guessLetters = Array.from(guess);
        const targetLetters = Array.from(target);

        // Match Wordle duplicate-letter behavior: greens consume letters before yellows.
        for (let i = 0; i < WORD_LENGTH; i += 1) {
            if (guessLetters[i] === targetLetters[i]) {
                result[i] = 2;
            } else {
                remaining.set(targetLetters[i], (remaining.get(targetLetters[i]) || 0) + 1);
            }
        }

        for (let i = 0; i < WORD_LENGTH; i += 1) {
            if (result[i] === 2) continue;
            const count = remaining.get(guessLetters[i]) || 0;
            if (count > 0) {
                result[i] = 1;
                remaining.set(guessLetters[i], count - 1);
            }
        }

        return result;
    }

    function analyzePattern(pattern) {
        const green = pattern.filter(value => value === 2).length;
        const yellow = pattern.filter(value => value === 1).length;
        return {
            green,
            yellow,
            colored: green + yellow,
            score: green * 2 + yellow
        };
    }

    function patternToKey(pattern) {
        return pattern.join('');
    }

    function patternMatchesSpec(info, spec) {
        if (info.score < spec.min || info.score > spec.max) return false;
        if (typeof spec.minGreen === 'number' && info.green < spec.minGreen) return false;
        if (typeof spec.maxGreen === 'number' && info.green > spec.maxGreen) return false;
        if (info.patternKey === '22222') return false;
        if (info.patternKey === '00000') return Boolean(spec.allowBlank);
        return true;
    }

    function matchCountMatchesSpec(info, spec) {
        if (!spec) return true;
        if (typeof spec.min === 'number' && info.matchCount < spec.min) return false;
        if (typeof spec.max === 'number' && info.matchCount > spec.max) return false;
        return true;
    }

    function scoreProgressMatches(info, chosen, difficulty) {
        if (chosen.length === 0) return true;
        const previousScore = chosen[chosen.length - 1].score;
        if (difficulty === 'hard' && chosen.length === 1 && previousScore === 0 && info.score === 0) {
            return true;
        }
        return info.score > previousScore;
    }

    function coloredProgressMatches(info, chosen) {
        if (chosen.length === 0) return true;
        const previousColored = chosen[chosen.length - 1].colored;
        const delta = info.colored - previousColored;
        return delta >= 0 && delta <= 2;
    }

    function rowProgressMatches(info, chosen, difficulty) {
        return scoreProgressMatches(info, chosen, difficulty)
            && coloredProgressMatches(info, chosen);
    }

    function buildCluesForTarget(target, rowCount, rng, difficulty = state.difficulty) {
        const ranges = SCORE_RANGES[rowCount];
        const matchRanges = MATCH_COUNT_RANGES[difficulty] || [];
        const useMatchRanges = !state.dictionaryFallback && state.words.length >= MIN_DICTIONARY_WORDS;
        const patternCounts = new Map();
        const candidates = state.words
            .filter(word => word !== target)
            .map(word => {
                const pattern = scoreGuess(word, target);
                const patternKey = patternToKey(pattern);
                patternCounts.set(patternKey, (patternCounts.get(patternKey) || 0) + 1);
                return {
                    word,
                    pattern,
                    patternKey,
                    ...analyzePattern(pattern)
                };
            })
            .map(info => ({
                ...info,
                matchCount: patternCounts.get(info.patternKey) || 0
            }))
            .filter(info => info.patternKey !== '22222');

        const byRange = ranges.map((spec, index) => {
            const matchSpec = useMatchRanges ? matchRanges[index] : null;
            return shuffleCopy(candidates.filter(info => (
                patternMatchesSpec(info, spec)
                && matchCountMatchesSpec(info, matchSpec)
            )), rng);
        });
        if (byRange.some(bucket => bucket.length === 0)) return null;

        const usedWords = new Set();
        const usedPatterns = new Set();
        const chosen = [];

        for (let index = 0; index < rowCount; index += 1) {
            const strictPool = byRange[index].filter(info => !usedWords.has(info.word) && !usedPatterns.has(info.patternKey));
            const relaxedPool = byRange[index].filter(info => !usedWords.has(info.word));
            const strictProgressPool = strictPool.filter(info => rowProgressMatches(info, chosen, difficulty));
            const relaxedProgressPool = relaxedPool.filter(info => rowProgressMatches(info, chosen, difficulty));
            const progressPool = strictProgressPool.length ? strictProgressPool : relaxedProgressPool;
            const pool = difficulty === 'hard'
                ? progressPool.slice().sort((a, b) => a.score - b.score)
                : progressPool;
            const info = pool[0];

            if (!info) return null;
            usedWords.add(info.word);
            usedPatterns.add(info.patternKey);
            chosen.push(info);
        }

        return chosen.map(info => ({
            solution: info.word,
            pattern: info.pattern,
            letters: Array(WORD_LENGTH).fill(''),
            locked: false
        }));
    }

    function targetPool() {
        const richerWords = state.words.filter(word => new Set(Array.from(word)).size >= 4);
        return richerWords.length > 500 ? richerWords : state.words;
    }

    function rememberTarget(target, poolSize) {
        if (state.mode === 'daily' || !target) return;
        const limit = Math.min(RECENT_TARGET_LIMIT, Math.max(0, poolSize - 1));
        state.recentTargets = state.recentTargets.filter(word => word !== target);
        state.recentTargets.push(target);
        if (state.recentTargets.length > limit) {
            state.recentTargets = state.recentTargets.slice(-limit);
        }
    }

    function targetCandidatePools(rng) {
        const basePool = targetPool();
        if (state.mode === 'daily' || state.varietyId) return [shuffleCopy(basePool, rng)];

        const recentLimit = Math.min(RECENT_TARGET_LIMIT, Math.max(0, basePool.length - 1));
        const recent = new Set(state.recentTargets.slice(-recentLimit));
        const freshPool = basePool.filter(word => !recent.has(word));
        const primaryPool = freshPool.length ? freshPool : basePool;
        const pools = [shuffleCopy(primaryPool, rng)];

        if (primaryPool.length !== basePool.length) {
            pools.push(shuffleCopy(basePool, rng));
        }

        return pools;
    }

    function generatePuzzle() {
        if (state.mode === 'daily') {
            state.difficulty = 'normal';
            state.puzzleNumber = 0;
            state.varietyId = '';
        } else if (!state.varietyId) {
            state.varietyId = makeVarietyId();
        }
        state.dailyRankLoading = false;
        state.dailyRankRequested = false;

        const rowCount = DIFFICULTIES[state.difficulty].clueRows;
        const seedBase = state.mode === 'daily'
            ? `${state.mode}:${state.difficulty}:${todayKey()}:${state.puzzleNumber}`
            : `${state.mode}:${state.difficulty}:${state.varietyId}`;
        const rng = mulberry32(hashString(seedBase));
        const attemptLimit = state.mode === 'daily' ? DAILY_TARGET_ATTEMPT_LIMIT : UNLIMITED_TARGET_ATTEMPT_LIMIT;
        const pools = targetCandidatePools(rng);

        for (const pool of pools) {
            for (let i = 0; i < pool.length && i < attemptLimit; i += 1) {
                const target = pool[i];
                const clues = buildCluesForTarget(target, rowCount, rng, state.difficulty);
                if (!clues) continue;

                state.target = target;
                state.rows = clues;
                state.activeRow = 0;
                state.activeCol = 0;
                state.locked = false;
                state.revealed = false;
                state.invalidRow = null;
                state.startedAt = state.mode === 'daily' ? Date.now() : null;
                state.solvedRecorded = false;
                state.pendingUnlimitedEntry = null;
                state.lastUnlimitedEntry = null;
                rememberTarget(target, targetPool().length);
                syncUrlToMode();

                if (state.mode === 'daily') hydrateDailyRecord();
                else state.dailyRecord = null;

                const readyStatus = state.mode === 'daily'
                    ? (state.dailyRecord?.solved ? 'Сьогоднішній пазл уже розв’язано.' : 'Щоденне завдання готове.')
                    : 'Нове завдання готове.';
                setStatus(state.dictionaryFallback
                    ? `${readyStatus} Словник тимчасово недоступний, використано резервний набір.`
                    : readyStatus);
                render();
                if (state.mode === 'daily' && state.dailyRecord?.solved && !state.dailyRecord.nameSubmitted) {
                    openNameDialog('daily');
                } else if (state.mode === 'daily' && state.dailyRecord?.solved) {
                    refreshDailyRank();
                }
                return true;
            }
        }

        setStatus('Не вдалося зібрати завдання. Спробуйте ще раз.');
        return false;
    }

    async function loadWords() {
        try {
            state.dictionaryFallback = false;
            const response = await fetch(DICTIONARY_URL, { cache: 'no-cache' });
            if (!response.ok) throw new Error(`Dictionary request failed: ${response.status}`);
            const text = await response.text();
            const words = text.split(/\r?\n/)
                .map(normalizeWord)
                .filter(word => UA_WORD_RE.test(word));
            const uniqueWords = Array.from(new Set(words)).sort();
            if (uniqueWords.length < MIN_DICTIONARY_WORDS) {
                throw new Error(`Dictionary is too small: ${uniqueWords.length}`);
            }
            state.words = uniqueWords;
        } catch (_) {
            state.words = FALLBACK_WORDS.filter(word => UA_WORD_RE.test(word));
            state.dictionaryFallback = true;
            setStatus('Локальний словник недоступний. Запущено резервний набір.');
        }

        state.wordSet = new Set(state.words);
    }

    function setStatus(message) {
        if (els.status) els.status.textContent = message;
    }

    function readDailyRecord() {
        try {
            const raw = window.localStorage.getItem(DAILY_STATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function writeDailyRecord(record) {
        try {
            window.localStorage.setItem(DAILY_STATE_KEY, JSON.stringify(record));
        } catch (_) {
            /* Persistent daily timer is best-effort when storage is unavailable. */
        }
    }

    function makeFreshDailyRecord() {
        return {
            dateKey: todayKey(),
            target: state.target,
            difficulty: 'normal',
            elapsedMs: 0,
            running: false,
            paused: true,
            solved: false,
            nameSubmitted: false,
            entryId: '',
            playerName: '',
            rank: null,
            lastStartedAt: null,
            rows: state.rows.map(row => ({ letters: row.letters.slice(), locked: row.locked }))
        };
    }

    function makePendingDailyEntry(seconds) {
        return {
            mode: 'daily',
            difficulty: 'normal',
            dateKey: todayKey(),
            target: state.target,
            variation: '',
            seconds,
            solvedAt: new Date().toISOString()
        };
    }

    function makePendingUnlimitedEntry(seconds) {
        return {
            mode: 'unlimited',
            difficulty: state.difficulty,
            dateKey: todayKey(),
            target: state.target,
            variation: state.varietyId,
            seconds,
            solvedAt: new Date().toISOString()
        };
    }

    function hydrateDailyRecord() {
        const stored = readDailyRecord();
        const isSamePuzzle = stored
            && stored.dateKey === todayKey()
            && stored.target === state.target
            && stored.difficulty === 'normal';

        const record = isSamePuzzle ? stored : makeFreshDailyRecord();
        state.dailyRecord = {
            ...record,
            rows: Array.isArray(record.rows) ? record.rows : []
        };

        state.rows.forEach((row, index) => {
            const saved = state.dailyRecord.rows[index];
            if (!saved) return;
            row.letters = Array.isArray(saved.letters)
                ? saved.letters.slice(0, WORD_LENGTH).map(letter => normalizeWord(letter).slice(0, 1))
                : Array(WORD_LENGTH).fill('');
            while (row.letters.length < WORD_LENGTH) row.letters.push('');
            row.locked = Boolean(saved.locked);
        });

        if (state.dailyRecord.solved) {
            state.locked = true;
            state.rows.forEach(row => { row.locked = true; });
        } else {
            const allRowsLocked = state.rows.every(row => row.locked);
            state.locked = allRowsLocked;
            state.dailyRecord.solved = allRowsLocked;
            if (allRowsLocked) {
                state.dailyRecord.running = false;
                state.dailyRecord.paused = false;
                state.dailyRecord.lastStartedAt = null;
            }
        }

        if (state.dailyRecord.solved && !state.dailyRecord.nameSubmitted) {
            const seconds = Math.max(1, Math.round(currentDailyElapsedMs() / 1000));
            state.pendingDailyEntry = makePendingDailyEntry(seconds);
        } else {
            state.pendingDailyEntry = null;
        }

        if (!state.locked) {
            const next = state.rows.findIndex(row => !row.locked);
            state.activeRow = next === -1 ? 0 : next;
            const row = state.rows[state.activeRow];
            const firstEmpty = row?.letters.findIndex(letter => !letter) ?? 0;
            state.activeCol = firstEmpty === -1 ? 0 : firstEmpty;
        }

        persistDailyRecord();
    }

    function currentDailyElapsedMs() {
        const record = state.dailyRecord;
        if (!record) return 0;
        const base = Math.max(0, Number(record.elapsedMs) || 0);
        if (!record.running || record.paused || record.solved || !record.lastStartedAt) return base;
        return Math.max(0, base + (Date.now() - Number(record.lastStartedAt)));
    }

    function persistDailyRecord(materializeTimer = false) {
        if (state.mode !== 'daily' || !state.dailyRecord) return;

        const record = state.dailyRecord;
        record.dateKey = todayKey();
        record.target = state.target;
        record.difficulty = 'normal';
        record.rows = state.rows.map(row => ({ letters: row.letters.slice(), locked: row.locked }));

        if (materializeTimer && record.running && !record.paused && !record.solved) {
            record.elapsedMs = currentDailyElapsedMs();
            record.lastStartedAt = Date.now();
        }

        writeDailyRecord(record);
    }

    function updateActivePosition() {
        if (state.locked) return;
        const row = state.rows[state.activeRow];
        if (!row || row.locked) {
            const next = state.rows.findIndex(item => !item.locked);
            state.activeRow = next === -1 ? 0 : next;
            state.activeCol = 0;
            return;
        }
        if (state.activeCol < 0 || state.activeCol >= WORD_LENGTH) {
            const firstEmpty = row.letters.findIndex(letter => !letter);
            state.activeCol = firstEmpty === -1 ? WORD_LENGTH - 1 : firstEmpty;
        }
    }

    function tileStateName(value) {
        return STATE_NAMES[value] || 'absent';
    }

    function renderGrid() {
        const rowsHtml = state.rows.map((row, rowIndex) => {
            const tiles = row.pattern.map((color, colIndex) => {
                const letter = row.letters[colIndex] || '';
                const isActive = !isDailyPaused() && !state.locked && rowIndex === state.activeRow && colIndex === state.activeCol && !row.locked;
                return `<button class="unwordle-tile${isActive ? ' is-active' : ''}${letter ? ' is-filled' : ''}" type="button" data-row="${rowIndex}" data-col="${colIndex}" data-state="${tileStateName(color)}" aria-label="Рядок ${rowIndex + 1}, плитка ${colIndex + 1}">${escapeHtml(letter.toLocaleUpperCase('uk-UA'))}</button>`;
            }).join('');
            return `
                <div class="game-row-wrap${row.locked ? ' is-accepted' : ''}" data-row-wrap="${rowIndex}">
                    <div class="game-row${state.invalidRow === rowIndex ? ' is-invalid' : ''}" data-row="${rowIndex}">${tiles}</div>
                    <span class="row-check" aria-label="Рядок прийнято">✓</span>
                </div>
            `;
        }).join('');

        const targetTiles = Array.from(state.target).map(letter => (
            `<span class="unwordle-tile is-filled" data-state="correct">${escapeHtml(letter.toLocaleUpperCase('uk-UA'))}</span>`
        )).join('');

        els.grid.innerHTML = `
            ${rowsHtml}
            <div class="game-row-wrap game-row-wrap--target">
                <div class="game-row game-row--target" aria-label="Фінальне слово">${targetTiles}</div>
                <span class="row-check" aria-hidden="true"></span>
            </div>
        `;
    }

    function renderKeyboard() {
        const colors = getKeyboardColors();
        els.keyboard.innerHTML = KEYBOARD_ROWS.map(row => {
            const keys = row.map(key => {
                if (key === 'backspace') {
                    return '<button class="keyboard-key keyboard-key--wide" type="button" data-key="backspace" title="Стерти" aria-label="Стерти"><i class="fas fa-delete-left" aria-hidden="true"></i></button>';
                }
                const color = colors.get(key);
                return `<button class="keyboard-key" type="button" data-key="${escapeHtml(key)}"${color ? ` data-state="${color}"` : ''}>${escapeHtml(key.toLocaleUpperCase('uk-UA'))}</button>`;
            }).join('');
            return `<div class="keyboard-row">${keys}</div>`;
        }).join('');
    }

    function renderControls() {
        document.querySelectorAll('.mode-tab').forEach(button => {
            const active = button.dataset.mode === state.mode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });

        document.querySelectorAll('.difficulty-tab').forEach(button => {
            const active = button.dataset.difficulty === state.difficulty;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });

        els.difficultyTabs.hidden = state.mode === 'daily';
        els.solveButton.hidden = state.mode === 'daily';
        els.solveButton.disabled = state.mode !== 'unlimited' || state.locked || state.rows.every(row => row.locked);
        els.solveButton.setAttribute('aria-label', 'Підказати один рядок');
        els.newPuzzleButton.hidden = state.mode === 'daily';
        els.dailyTimer.hidden = state.mode !== 'daily';
        els.nextPuzzleCountdown.hidden = state.mode !== 'daily';
        els.card.classList.toggle('is-paused', isDailyPaused());
        els.shareButton.setAttribute('aria-label', state.mode === 'daily' ? 'Поділитися словом дня' : 'Поділитися варіацією');
        els.leaderboardButton.setAttribute('aria-label', state.mode === 'daily' ? 'Рейтинг' : 'Рейтинг нескінченної');
        updateTimerDisplay();
        updateNextPuzzleCountdown();
    }

    function render() {
        updateActivePosition();
        renderControls();
        renderGrid();
        renderKeyboard();
    }

    function getKeyboardColors() {
        const colors = new Map();

        Array.from(state.target).forEach(letter => {
            colors.set(letter, 'correct');
        });

        state.rows.filter(row => row.locked).forEach(row => {
            row.letters.forEach((letter, index) => {
                if (!letter) return;
                const name = tileStateName(row.pattern[index]);
                const current = colors.get(letter);
                if (!current || STATE_PRIORITY[name] > STATE_PRIORITY[current]) {
                    colors.set(letter, name);
                }
            });
        });

        return colors;
    }

    function setInvalidRow(rowIndex) {
        state.invalidRow = rowIndex;
        renderGrid();
        window.setTimeout(() => {
            if (state.invalidRow === rowIndex) {
                state.invalidRow = null;
                renderGrid();
            }
        }, 320);
    }

    function submitRow(rowIndex = state.activeRow) {
        if (isDailyPaused()) {
            setStatus('Таймер на паузі. Натисни “Продовжити”, щоб грати далі.');
            return;
        }

        const row = state.rows[rowIndex];
        if (!row || row.locked || state.locked) return;

        const word = row.letters.join('');
        if (word.length !== WORD_LENGTH) {
            setInvalidRow(rowIndex);
            setStatus('Потрібно 5 літер.');
            return;
        }

        if (!state.wordSet.has(word)) {
            setInvalidRow(rowIndex);
            setStatus('Такого слова немає у словнику.');
            return;
        }

        const actualPattern = scoreGuess(word, state.target);
        if (patternToKey(actualPattern) !== patternToKey(row.pattern)) {
            setInvalidRow(rowIndex);
            setStatus('Слово не відповідає кольорам рядка.');
            return;
        }

        row.locked = true;
        persistDailyRecord();

        const next = state.rows.findIndex(item => !item.locked);
        if (next === -1) {
            state.locked = true;
            if (state.mode === 'daily') {
                completeDailyPuzzle();
                setStatus('Готово. Завдання розв’язано.');
            } else {
                const recorded = recordUnlimitedSolve();
                setStatus(recorded
                    ? 'Готово. Завдання розв’язано.'
                    : 'Готово. Після підказки результат не йде в рейтинг.');
            }
        } else {
            state.activeRow = next;
            state.activeCol = 0;
            setStatus('Рядок прийнято.');
        }
        render();
    }

    function putLetter(letter) {
        if (isDailyPaused()) {
            setStatus('Таймер на паузі. Продовж гру, щоб вводити літери.');
            return;
        }

        if (state.locked || !UA_LETTER_RE.test(letter)) return;
        const row = state.rows[state.activeRow];
        if (!row || row.locked) return;

        if (state.mode === 'unlimited' && !state.startedAt) {
            state.startedAt = Date.now();
        }
        row.letters[state.activeCol] = letter;
        const rowIndex = state.activeRow;
        const isComplete = row.letters.every(Boolean);
        if (state.activeCol < WORD_LENGTH - 1) state.activeCol += 1;
        setStatus('');
        persistDailyRecord();
        if (isComplete) {
            submitRow(rowIndex);
            renderKeyboard();
            return;
        }
        render();
    }

    function backspace() {
        if (isDailyPaused()) return;
        if (state.locked) return;
        const row = state.rows[state.activeRow];
        if (!row || row.locked) return;

        if (row.letters[state.activeCol]) {
            row.letters[state.activeCol] = '';
        } else if (state.activeCol > 0) {
            state.activeCol -= 1;
            row.letters[state.activeCol] = '';
        }
        setStatus('');
        persistDailyRecord();
        render();
    }

    function showHint() {
        if (state.mode === 'daily' || state.locked) return;
        const rowIndex = state.rows.findIndex(row => !row.locked);
        const row = state.rows[rowIndex];
        if (!row) return;

        row.letters = Array.from(row.solution);
        row.locked = true;
        state.revealed = true;

        const next = state.rows.findIndex(item => !item.locked);
        if (next === -1) {
            state.locked = true;
            setStatus('Підказка відкрила останній рядок. Результат не йде в рейтинг.');
        } else {
            state.activeRow = next;
            state.activeCol = 0;
            setStatus('Підказка відкрила один рядок. Результат не піде в рейтинг.');
        }
        render();
    }

    function handleKeyValue(value) {
        if (value === 'enter') {
            submitRow();
            return;
        }
        if (value === 'backspace') {
            backspace();
            return;
        }
        const letter = normalizeWord(value);
        if (UA_LETTER_RE.test(letter)) putLetter(letter);
    }

    function handlePhysicalKey(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        if (state.activeModal) {
            if (event.key === 'Escape' && state.activeModal !== els.nameDialog) closeModal();
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            submitRow();
            return;
        }

        if (event.key === 'Backspace') {
            event.preventDefault();
            backspace();
            return;
        }

        const rawKey = event.key.length === 1 ? event.key.toLocaleLowerCase('uk-UA') : '';
        const mapped = LATIN_TO_UA.get(rawKey) || rawKey;
        if (UA_LETTER_RE.test(mapped)) {
            event.preventDefault();
            putLetter(mapped);
        }
    }

    function readLeaderboard() {
        try {
            const raw = window.localStorage.getItem(LEADERBOARD_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }

    function writeLeaderboard(entries) {
        try {
            window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries));
        } catch (_) {
            /* Local leaderboard is optional when storage is unavailable. */
        }
    }

    function normalizeLeaderboardEntry(item) {
        const seconds = Number(item?.seconds);
        if (!Number.isFinite(seconds) || seconds <= 0) return null;
        return {
            id: String(item?.id || `${item?.dateKey || todayKey()}-${item?.name || 'player'}-${seconds}`),
            mode: item?.mode === 'unlimited' ? 'unlimited' : 'daily',
            difficulty: item?.difficulty || 'normal',
            dateKey: String(item?.dateKey || todayKey()),
            target: normalizeWord(item?.target || state.target),
            variation: String(item?.variation || ''),
            name: String(item?.name || 'Гравець').trim().slice(0, 24) || 'Гравець',
            seconds: Math.max(1, Math.round(seconds)),
            solvedAt: item?.solvedAt || new Date().toISOString()
        };
    }

    function localDailyLeaderboard(entries = readLeaderboard()) {
        return entries
            .map(normalizeLeaderboardEntry)
            .filter(Boolean)
            .filter(item => item.mode === 'daily' && item.dateKey === todayKey() && item.target === state.target)
            .sort((a, b) => a.seconds - b.seconds || String(a.solvedAt).localeCompare(String(b.solvedAt)))
            .slice(0, 10);
    }

    function uniqueUnlimitedEntries(entries) {
        const unique = new Map();
        entries
            .map(normalizeLeaderboardEntry)
            .filter(Boolean)
            .filter(item => item.mode === 'unlimited' && item.variation)
            .forEach(item => {
                const key = `${item.name.toLocaleLowerCase('uk-UA')}|${item.difficulty}|${item.variation}`;
                const current = unique.get(key);
                if (!current || String(item.solvedAt).localeCompare(String(current.solvedAt)) < 0) {
                    unique.set(key, item);
                }
            });
        return Array.from(unique.values());
    }

    function aggregateUnlimitedScores(entries, sinceMs = 0) {
        const players = new Map();
        uniqueUnlimitedEntries(entries).forEach(item => {
            const solvedAt = new Date(item.solvedAt).getTime();
            if (sinceMs && (!Number.isFinite(solvedAt) || solvedAt < sinceMs)) return;

            const key = item.name.toLocaleLowerCase('uk-UA');
            const player = players.get(key) || {
                name: item.name || 'Гравець',
                total: 0,
                easy: 0,
                normal: 0,
                hard: 0,
                latestSolvedAt: ''
            };
            player.total += 1;
            player[item.difficulty] = (player[item.difficulty] || 0) + 1;
            if (!player.latestSolvedAt || String(item.solvedAt).localeCompare(player.latestSolvedAt) > 0) {
                player.latestSolvedAt = item.solvedAt;
            }
            players.set(key, player);
        });

        return Array.from(players.values())
            .sort((a, b) => (
                b.total - a.total
                || b.hard - a.hard
                || b.normal - a.normal
                || String(a.latestSolvedAt).localeCompare(String(b.latestSolvedAt))
                || a.name.localeCompare(b.name, 'uk-UA')
            ))
            .slice(0, 3);
    }

    function localUnlimitedRankings(entries = readLeaderboard()) {
        const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        return {
            source: 'local',
            weekly: aggregateUnlimitedScores(entries, weekAgo),
            allTime: aggregateUnlimitedScores(entries),
            error: false
        };
    }

    function findDailyRank(entries, reference) {
        if (!reference) return null;
        const sorted = entries
            .map(normalizeLeaderboardEntry)
            .filter(Boolean)
            .filter(item => item.mode === 'daily' && item.dateKey === todayKey() && item.target === state.target)
            .sort((a, b) => a.seconds - b.seconds || String(a.solvedAt).localeCompare(String(b.solvedAt)));
        const index = sorted.findIndex(item => (
            (reference.id && item.id === reference.id)
            || (
                item.seconds === reference.seconds
                && item.name === reference.name
                && item.solvedAt === reference.solvedAt
            )
        ));
        return index === -1 ? null : index + 1;
    }

    function currentDailyResultReference() {
        if (!state.dailyRecord?.solved) return null;
        const seconds = Math.max(1, Math.round((Number(state.dailyRecord.elapsedMs) || 0) / 1000));
        return {
            id: String(state.dailyRecord.entryId || ''),
            mode: 'daily',
            difficulty: 'normal',
            dateKey: todayKey(),
            target: state.target,
            name: String(state.dailyRecord.playerName || 'Гравець'),
            seconds,
            solvedAt: state.dailyRecord.solvedAt || ''
        };
    }

    async function fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), REMOTE_LEADERBOARD_TIMEOUT_MS);
        try {
            return await fetch(url, {
                ...options,
                signal: controller.signal,
                cache: 'no-store'
            });
        } finally {
            window.clearTimeout(timer);
        }
    }

    function leaderboardUrl() {
        if (!REMOTE_LEADERBOARD_ENDPOINT) return null;
        try {
            return new URL(REMOTE_LEADERBOARD_ENDPOINT, window.location.href);
        } catch (_) {
            return null;
        }
    }

    async function readRemoteDailyLeaderboard(entryId = '') {
        const url = leaderboardUrl();
        if (!url) return { source: 'local', entries: localDailyLeaderboard(), error: false };

        url.searchParams.set('mode', 'daily');
        url.searchParams.set('dateKey', todayKey());
        url.searchParams.set('target', state.target);
        if (entryId) url.searchParams.set('entryId', entryId);
        const response = await fetchWithTimeout(url.toString(), {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`Leaderboard read failed: ${response.status}`);

        const payload = await response.json();
        const rawEntries = Array.isArray(payload) ? payload : payload.entries;
        const entries = Array.isArray(rawEntries) ? rawEntries : [];
        const rank = Number(payload?.rank);
        return {
            source: 'remote',
            entries: entries
                .map(normalizeLeaderboardEntry)
                .filter(Boolean)
                .filter(item => item.mode === 'daily' && item.dateKey === todayKey() && item.target === state.target)
                .sort((a, b) => a.seconds - b.seconds || String(a.solvedAt).localeCompare(String(b.solvedAt)))
                .slice(0, 10),
            rank: Number.isFinite(rank) && rank > 0 ? rank : null,
            error: false
        };
    }

    function normalizeUnlimitedScore(item) {
        const total = Number(item?.total);
        if (!Number.isFinite(total) || total <= 0) return null;
        return {
            name: String(item?.name || 'Гравець').trim().slice(0, 24) || 'Гравець',
            total: Math.max(0, Math.round(total)),
            easy: Math.max(0, Math.round(Number(item?.easy) || 0)),
            normal: Math.max(0, Math.round(Number(item?.normal) || 0)),
            hard: Math.max(0, Math.round(Number(item?.hard) || 0))
        };
    }

    async function readRemoteUnlimitedLeaderboard() {
        const url = leaderboardUrl();
        if (!url) return localUnlimitedRankings();

        url.searchParams.set('mode', 'unlimited');
        const response = await fetchWithTimeout(url.toString(), {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error(`Leaderboard read failed: ${response.status}`);

        const payload = await response.json();
        const weekly = Array.isArray(payload?.weekly) ? payload.weekly : [];
        const allTime = Array.isArray(payload?.allTime) ? payload.allTime : [];
        return {
            source: 'remote',
            weekly: weekly.map(normalizeUnlimitedScore).filter(Boolean).slice(0, 3),
            allTime: allTime.map(normalizeUnlimitedScore).filter(Boolean).slice(0, 3),
            error: false
        };
    }

    async function writeRemoteLeaderboard(entry) {
        const url = leaderboardUrl();
        if (!url) return { ok: false, skipped: true };
        try {
            const response = await fetchWithTimeout(url.toString(), {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    mode: entry.mode,
                    difficulty: entry.difficulty,
                    dateKey: entry.dateKey,
                    target: entry.target,
                    variation: entry.variation,
                    name: entry.name,
                    seconds: entry.seconds,
                    solvedAt: entry.solvedAt
                })
            });
            const payload = await response.json().catch(() => ({}));
            const rank = Number(payload?.rank);
            return {
                ok: response.ok,
                status: response.status,
                entry: normalizeLeaderboardEntry(payload?.entry),
                rank: Number.isFinite(rank) && rank > 0 ? rank : null
            };
        } catch (_) {
            return { ok: false };
        }
    }

    function completeDailyPuzzle() {
        const seconds = Math.max(1, Math.round(currentDailyElapsedMs() / 1000));
        state.pendingDailyEntry = makePendingDailyEntry(seconds);

        if (state.dailyRecord) {
            state.dailyRecord.elapsedMs = seconds * 1000;
            state.dailyRecord.running = false;
            state.dailyRecord.paused = false;
            state.dailyRecord.solved = true;
            state.dailyRecord.lastStartedAt = null;
            persistDailyRecord();
        }

        updateTimerDisplay();
        if (!state.dailyRecord?.nameSubmitted) openNameDialog('daily');
    }

    async function recordDailyName(name) {
        if (!state.pendingDailyEntry) return;
        const cleanName = String(name || '').trim().slice(0, 24) || 'Гравець';
        const entry = {
            ...state.pendingDailyEntry,
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: cleanName
        };
        const entries = readLeaderboard();
        entries.push(entry);
        writeLeaderboard(entries);
        const remoteResult = await writeRemoteLeaderboard(entry);
        const savedEntry = remoteResult.entry || entry;

        if (state.dailyRecord) {
            state.dailyRecord.nameSubmitted = true;
            state.dailyRecord.entryId = savedEntry.id || entry.id;
            state.dailyRecord.playerName = savedEntry.name || cleanName;
            state.dailyRecord.solvedAt = savedEntry.solvedAt || entry.solvedAt;
            state.dailyRecord.rank = remoteResult.rank || findDailyRank(entries, entry);
            persistDailyRecord();
        }
        state.pendingDailyEntry = null;
        closeModal();
        const message = remoteResult.ok
            ? 'Результат додано в рейтинг.'
            : (remoteResult.skipped
                ? 'Результат збережено на цьому пристрої. Глобальний рейтинг ще не підключено.'
                : 'Результат збережено локально. Глобальний рейтинг зараз недоступний.');
        setStatus(message);
        renderControls();
        if (!state.dailyRecord?.rank) refreshDailyRank(true);
    }

    function recordUnlimitedSolve() {
        if (state.revealed || state.solvedRecorded || !state.startedAt) return false;
        const seconds = Math.max(1, Math.round((Date.now() - state.startedAt) / 1000));
        state.pendingUnlimitedEntry = makePendingUnlimitedEntry(seconds);
        state.solvedRecorded = true;
        openNameDialog('unlimited');
        return true;
    }

    async function recordUnlimitedName(name) {
        if (!state.pendingUnlimitedEntry) return;
        const cleanName = String(name || '').trim().slice(0, 24) || 'Гравець';
        const entry = {
            ...state.pendingUnlimitedEntry,
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: cleanName
        };
        const entries = readLeaderboard();
        entries.push(entry);
        writeLeaderboard(entries.slice(-250));
        const remoteResult = await writeRemoteLeaderboard(entry);
        state.lastUnlimitedEntry = remoteResult.entry || entry;
        state.pendingUnlimitedEntry = null;
        closeModal();
        const message = remoteResult.ok
            ? 'Результат додано в рейтинг варіації.'
            : (remoteResult.skipped
                ? 'Результат збережено на цьому пристрої. Глобальний рейтинг ще не підключено.'
                : 'Результат збережено локально. Глобальний рейтинг зараз недоступний.');
        setStatus(message);
    }

    async function refreshDailyRank(force = false) {
        const record = state.dailyRecord;
        if (state.mode !== 'daily' || !record?.solved || !record.nameSubmitted) return;
        if (state.dailyRankLoading) return;
        if (!force && state.dailyRankRequested) return;

        state.dailyRankRequested = true;
        state.dailyRankLoading = true;
        updateTimerDisplay();

        try {
            const reference = currentDailyResultReference();
            let result;
            try {
                result = await readRemoteDailyLeaderboard(reference?.id || '');
            } catch (_) {
                result = {
                    source: 'local',
                    entries: localDailyLeaderboard(readLeaderboard()),
                    rank: findDailyRank(readLeaderboard(), reference),
                    error: true
                };
            }

            const rank = result.rank || findDailyRank(result.entries, reference);
            record.rank = rank || null;
            persistDailyRecord();
        } finally {
            state.dailyRankLoading = false;
            updateTimerDisplay();
        }
    }

    function isDailyPaused() {
        return state.mode === 'daily' && Boolean(state.dailyRecord?.paused);
    }

    function toggleDailyPause() {
        if (state.mode !== 'daily' || !state.dailyRecord || state.dailyRecord.solved) return;
        const record = state.dailyRecord;
        if (record.running && !record.paused) {
            record.elapsedMs = currentDailyElapsedMs();
            record.running = false;
            record.paused = true;
            record.lastStartedAt = null;
            setStatus('Таймер на паузі.');
        } else {
            record.running = true;
            record.paused = false;
            record.lastStartedAt = Date.now();
            setStatus('Гру продовжено.');
        }
        persistDailyRecord();
        renderControls();
        renderGrid();
    }

    function formatClock(totalSeconds) {
        const seconds = Math.max(0, Math.floor(totalSeconds));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const rest = seconds % 60;
        if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
        return `${minutes}:${String(rest).padStart(2, '0')}`;
    }

    function formatDuration(seconds) {
        const value = Math.max(0, Math.floor(seconds));
        if (value === 0) return '0с';
        const minutes = Math.floor(value / 60);
        const rest = value % 60;
        return minutes ? `${minutes}хв ${rest}с` : `${rest}с`;
    }

    function updateTimerDisplay() {
        if (!els.dailyTimerValue || state.mode !== 'daily' || !state.dailyRecord) return;
        const elapsedSeconds = Math.floor(currentDailyElapsedMs() / 1000);
        const solved = Boolean(state.dailyRecord.solved);
        els.dailyTimer.classList.toggle('is-solved', solved);

        if (solved) {
            const rank = Number(state.dailyRecord.rank);
            const hasRank = Number.isFinite(rank) && rank > 0;
            if (state.dailyRecord.nameSubmitted && hasRank) {
                const rankLabel = `#${rank}`;
                els.dailyTimerLabel.textContent = 'Місце';
                els.dailyTimerValue.textContent = `${rankLabel} · ${formatClock(elapsedSeconds)}`;
            } else {
                els.dailyTimerLabel.textContent = 'Час';
                els.dailyTimerValue.textContent = formatClock(elapsedSeconds);
            }
            els.pauseTimerButton.hidden = true;
            els.pauseTimerButton.innerHTML = '';
            return;
        }

        els.dailyTimerLabel.textContent = 'Час';
        els.dailyTimerValue.textContent = formatClock(elapsedSeconds);

        const paused = Boolean(state.dailyRecord.paused);
        els.pauseTimerButton.hidden = solved;
        els.pauseTimerButton.innerHTML = paused
            ? '<i class="fas fa-play" aria-hidden="true"></i><span>Продовжити</span>'
            : '<i class="fas fa-pause" aria-hidden="true"></i><span>Пауза</span>';
        els.pauseTimerButton.setAttribute('aria-pressed', String(paused));

        if (state.dailyRecord.running && !state.dailyRecord.paused && !state.dailyRecord.solved) {
            persistDailyRecord(true);
        }
    }

    function secondsToNextPuzzle() {
        const now = new Date();
        const next = new Date(now);
        next.setHours(24, 0, 0, 0);
        return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000));
    }

    function updateNextPuzzleCountdown() {
        if (!els.nextPuzzleCountdown || state.mode !== 'daily') return;
        els.nextPuzzleCountdown.textContent = `Наступний пазл через ${formatClock(secondsToNextPuzzle())}`;
    }

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
    }

    function renderLeaderboardList(entries, emptyMessage) {
        return entries.length
            ? `<div class="leaderboard-list">
                ${entries.map((item, index) => `
                    <div class="leaderboard-row">
                        <span class="leaderboard-rank">${index + 1}</span>
                        <span class="leaderboard-main">
                            <strong>${escapeHtml(item.name || 'Гравець')}</strong>
                        </span>
                        <span class="leaderboard-time">
                            <strong>${formatClock(Number(item.seconds) || 0)}</strong>
                            <span>час</span>
                        </span>
                    </div>
                `).join('')}
            </div>`
            : `<p class="leaderboard-empty">${escapeHtml(emptyMessage)}</p>`;
    }

    function difficultyCountValue(item, key) {
        return Math.max(0, Math.round(Number(item?.[key]) || 0));
    }

    function renderDifficultyCounts(item) {
        const easy = difficultyCountValue(item, 'easy');
        const normal = difficultyCountValue(item, 'normal');
        const hard = difficultyCountValue(item, 'hard');
        const label = `Легкі ${easy}, звичайні ${normal}, складні ${hard}`;
        const items = [
            ['fa-play', 'Легкі', easy],
            ['fa-square', 'Звичайні', normal],
            ['fa-cube', 'Складні', hard]
        ];

        return `
            <span class="difficulty-counts" aria-label="${escapeHtml(label)}">
                ${items.map(([icon, title, value]) => `
                    <span class="difficulty-count" title="${escapeHtml(title)}">
                        <i class="fas ${icon}" aria-hidden="true"></i>
                        <strong>${value}</strong>
                    </span>
                `).join('')}
            </span>
        `;
    }

    function renderUnlimitedRankSection(title, players, emptyMessage) {
        const list = players.length
            ? `<div class="leaderboard-list">
                ${players.map((item, index) => `
                    <div class="leaderboard-row leaderboard-row--unlimited">
                        <span class="leaderboard-rank">${index + 1}</span>
                        <span class="leaderboard-main">
                            <strong>${escapeHtml(item.name || 'Гравець')}</strong>
                        </span>
                        <span class="leaderboard-difficulty">
                            ${renderDifficultyCounts(item)}
                        </span>
                    </div>
                `).join('')}
            </div>`
            : `<p class="leaderboard-empty">${escapeHtml(emptyMessage)}</p>`;

        return `
            <div class="leaderboard-section-title">${escapeHtml(title)}</div>
            ${list}
        `;
    }

    async function renderLeaderboard() {
        const entries = readLeaderboard();
        els.clearLeaderboardButton.hidden = entries.length === 0;
        els.clearLeaderboardButton.textContent = 'Очистити статистику';

        if (state.mode !== 'daily') {
            els.leaderboardTitle.textContent = 'Рейтинг нескінченної';
            els.leaderboardNote.textContent = REMOTE_LEADERBOARD_ENDPOINT
                ? 'Топ за кількістю розв’язаних пазлів.'
                : 'Глобальний рейтинг ще не підключено. Поки показано результати цього браузера.';
            els.leaderboardContent.innerHTML = `
                <p class="leaderboard-empty">Завантаження рейтингу...</p>
                ${renderStats(entries)}
            `;

            let result;
            try {
                result = await readRemoteUnlimitedLeaderboard();
            } catch (_) {
                result = { ...localUnlimitedRankings(entries), error: true };
            }

            if (result.error) {
                els.leaderboardNote.textContent = 'Глобальний рейтинг зараз недоступний. Показано результати цього браузера.';
            } else if (result.source === 'local') {
                els.leaderboardNote.textContent = 'Глобальний рейтинг ще не підключено. Поки показано результати цього браузера.';
            }

            els.leaderboardContent.innerHTML = `
                ${renderUnlimitedRankSection('Топ тижня', result.weekly || [], 'За останні 7 днів ще немає результатів.')}
                ${renderUnlimitedRankSection('Топ за весь час', result.allTime || [], 'У нескінченному режимі ще немає результатів.')}
                ${renderStats(entries)}
            `;
            return;
        }

        els.leaderboardTitle.textContent = 'Рейтинг щодня';
        els.leaderboardNote.textContent = REMOTE_LEADERBOARD_ENDPOINT
            ? 'Глобальний рейтинг за сьогодні.'
            : 'Глобальний рейтинг ще не підключено. Поки показано результати цього браузера.';
        els.leaderboardContent.innerHTML = `
            <p class="leaderboard-empty">Завантаження рейтингу...</p>
            ${renderStats(entries)}
        `;

        let result;
        try {
            result = await readRemoteDailyLeaderboard();
        } catch (_) {
            result = { source: 'local', entries: localDailyLeaderboard(entries), error: true };
        }

        if (result.error) {
            els.leaderboardNote.textContent = 'Глобальний рейтинг зараз недоступний. Показано результати цього браузера.';
        } else if (result.source === 'local') {
            els.leaderboardNote.textContent = 'Глобальний рейтинг ще не підключено. Поки показано результати цього браузера.';
        }

        els.leaderboardContent.innerHTML = `
            ${renderLeaderboardList(result.entries, 'Сьогодні ще немає результатів. Розв’яжи щоденний пазл і додай своє ім’я.')}
            ${renderStats(entries)}
        `;
    }

    function renderStats(entries) {
        const dailyEntries = entries.filter(item => item.mode === 'daily');
        const solvedDates = Array.from(new Set(dailyEntries.map(item => item.dateKey))).sort();
        const dailySeconds = dailyEntries.map(item => Number(item.seconds)).filter(Number.isFinite);
        const fastest = dailySeconds.length ? Math.min(...dailySeconds) : 0;

        const unlimitedEasy = countUnlimited(entries, 'easy');
        const unlimitedNormal = countUnlimited(entries, 'normal');
        const unlimitedHard = countUnlimited(entries, 'hard');

        return `
            <div class="leaderboard-section-title">Щоденний пазл</div>
            <div class="stats-list">
                ${renderStatRow('fa-chart-line', 'Поточна серія', currentStreak(solvedDates))}
                ${renderStatRow('fa-crown', 'Найдовша серія', longestStreak(solvedDates))}
                ${renderStatRow('fa-sun', 'Щоденних розв’язань', dailyEntries.length)}
                ${renderStatRow('fa-wand-magic-sparkles', 'Найшвидше', fastest ? formatDuration(fastest) : '0с')}
            </div>
            <div class="leaderboard-section-title">Нескінченні пазли</div>
            <div class="stats-list">
                ${renderStatRow('fa-play', 'Легкі розв’язання', unlimitedEasy)}
                ${renderStatRow('fa-square', 'Звичайні розв’язання', unlimitedNormal)}
                ${renderStatRow('fa-cube', 'Складні розв’язання', unlimitedHard)}
            </div>
        `;
    }

    function renderStatRow(icon, label, value, valueIsHtml = false) {
        return `
            <div class="stats-row">
                <i class="fas ${icon}" aria-hidden="true"></i>
                <strong>${escapeHtml(label)}</strong>
                <span>${valueIsHtml ? value : escapeHtml(value)}</span>
            </div>
        `;
    }

    function countUnlimited(entries, difficulty) {
        return entries.filter(item => item.mode === 'unlimited' && item.difficulty === difficulty).length;
    }

    function currentStreak(dateKeys) {
        const solved = new Set(dateKeys);
        if (!solved.has(todayKey())) return 0;
        let streak = 0;
        let cursor = todayKey();
        while (solved.has(cursor)) {
            streak += 1;
            cursor = addDays(cursor, -1);
        }
        return streak;
    }

    function longestStreak(dateKeys) {
        if (!dateKeys.length) return 0;
        let longest = 1;
        let current = 1;
        for (let i = 1; i < dateKeys.length; i += 1) {
            if (dateKeys[i] === addDays(dateKeys[i - 1], 1)) current += 1;
            else current = 1;
            longest = Math.max(longest, current);
        }
        return longest;
    }

    function renderHelp() {
        const slide = HELP_SLIDES[state.helpSlide];
        const isFirst = state.helpSlide === 0;
        const isLast = state.helpSlide === HELP_SLIDES.length - 1;

        els.helpContent.innerHTML = `<h2 id="helpTitle">${escapeHtml(slide.title)}</h2>${slide.body()}`;
        els.helpNav.innerHTML = `
            ${isLast ? '' : '<button class="modal-link modal-link--muted" type="button" data-help-action="skip">Пропустити</button><span>·</span>'}
            ${isFirst ? '' : '<button class="modal-link" type="button" data-help-action="back">← Назад</button><span>·</span>'}
            <button class="modal-link" type="button" data-help-action="${isLast ? 'start' : 'next'}">${isLast ? 'Почати гру' : 'Далі'} →</button>
        `;
    }

    function openModal(dialog) {
        if (!dialog) return;
        state.activeModal = dialog;
        dialog.hidden = false;
        requestAnimationFrame(() => dialog.querySelector('.unwordle-modal__panel')?.focus({ preventScroll: true }));
    }

    function closeModal() {
        if (!state.activeModal) return;
        state.activeModal.hidden = true;
        state.activeModal = null;
    }

    function openNameDialog(kind = 'daily') {
        state.nameDialogKind = kind;
        els.playerName.value = '';
        els.nameDialogNote.textContent = kind === 'unlimited'
            ? 'Введи ім’я для рейтингу цієї варіації.'
            : 'Введи ім’я для щоденного рейтингу.';
        openModal(els.nameDialog);
        requestAnimationFrame(() => els.playerName.focus({ preventScroll: true }));
    }

    function currentShareText() {
        if (state.mode === 'daily') {
            const url = gameUrl({ mode: 'daily' });
            if (state.dailyRecord?.solved) {
                const seconds = Math.max(1, Math.round(currentDailyElapsedMs() / 1000));
                return `Я розв’язав слово дня за ${formatClock(seconds)}, зможеш краще? ${url}`;
            }
            return `Спробуй слово дня в КОБЗА-НАВПАКИ: ${url}`;
        }

        const url = gameUrl({ mode: 'unlimited' });
        const seconds = Number(state.lastUnlimitedEntry?.seconds || state.pendingUnlimitedEntry?.seconds || 0);
        if (state.locked && seconds > 0) {
            return `Я розв’язав варіацію КОБЗА-НАВПАКИ за ${formatClock(seconds)}, зможеш краще? ${url}`;
        }
        return `Спробуй цю варіацію КОБЗА-НАВПАКИ: ${url}`;
    }

    async function copyText(text) {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        document.execCommand('copy');
        field.remove();
    }

    async function shareCurrentPuzzle() {
        try {
            await copyText(currentShareText());
            setStatus('Текст для поширення скопійовано.');
            window.setTimeout(() => {
                if (els.status?.textContent === 'Текст для поширення скопійовано.') setStatus('');
            }, SHARE_FEEDBACK_MS);
        } catch (_) {
            setStatus('Не вдалося скопіювати. Спробуй ще раз.');
        }
    }

    function bindEvents() {
        els.keyboard.addEventListener('click', event => {
            const key = event.target.closest('[data-key]');
            if (!key) return;
            handleKeyValue(key.dataset.key);
        });

        els.grid.addEventListener('click', event => {
            const tile = event.target.closest('.unwordle-tile[data-row]');
            if (!tile || state.locked || isDailyPaused()) return;
            const rowIndex = Number(tile.dataset.row);
            const colIndex = Number(tile.dataset.col);
            if (!Number.isInteger(rowIndex) || !Number.isInteger(colIndex)) return;
            if (state.rows[rowIndex]?.locked) return;
            state.activeRow = rowIndex;
            state.activeCol = colIndex;
            render();
        });

        document.addEventListener('keydown', handlePhysicalKey);

        els.solveButton.addEventListener('click', showHint);
        els.newPuzzleButton.addEventListener('click', () => {
            state.puzzleNumber += 1;
            state.varietyId = makeVarietyId();
            generatePuzzle();
        });
        els.pauseTimerButton.addEventListener('click', toggleDailyPause);

        document.querySelectorAll('.mode-tab').forEach(button => {
            button.addEventListener('click', () => {
                if (state.mode === button.dataset.mode) return;
                if (state.mode === 'daily') persistDailyRecord(true);
                state.mode = button.dataset.mode;
                if (state.mode === 'unlimited') state.varietyId = state.varietyId || makeVarietyId();
                generatePuzzle();
            });
        });

        document.querySelectorAll('.difficulty-tab').forEach(button => {
            button.addEventListener('click', () => {
                if (state.mode === 'daily') return;
                state.difficulty = button.dataset.difficulty;
                state.varietyId = makeVarietyId();
                generatePuzzle();
            });
        });

        els.helpButton.addEventListener('click', () => {
            state.helpSlide = 0;
            renderHelp();
            openModal(els.helpDialog);
        });

        els.shareButton.addEventListener('click', shareCurrentPuzzle);

        els.leaderboardButton.addEventListener('click', () => {
            renderLeaderboard();
            openModal(els.leaderboardDialog);
        });

        document.querySelectorAll('[data-modal-close]').forEach(control => {
            control.addEventListener('click', closeModal);
        });

        els.helpNav.addEventListener('click', event => {
            const action = event.target.closest('[data-help-action]')?.dataset.helpAction;
            if (!action) return;
            if (action === 'skip' || action === 'start') {
                closeModal();
                return;
            }
            if (action === 'back') state.helpSlide = Math.max(0, state.helpSlide - 1);
            if (action === 'next') state.helpSlide = Math.min(HELP_SLIDES.length - 1, state.helpSlide + 1);
            renderHelp();
        });

        els.clearLeaderboardButton.addEventListener('click', () => {
            writeLeaderboard([]);
            renderLeaderboard();
        });

        els.nameForm.addEventListener('submit', event => {
            event.preventDefault();
            if (state.nameDialogKind === 'unlimited') recordUnlimitedName(els.playerName.value);
            else recordDailyName(els.playerName.value);
        });

        els.skipNameButton.addEventListener('click', () => {
            if (state.nameDialogKind === 'unlimited') recordUnlimitedName('Гравець');
            else recordDailyName('Гравець');
        });

        window.addEventListener('beforeunload', () => persistDailyRecord(true));
    }

    function cacheElements() {
        els.card = document.querySelector('.unwordle-card');
        els.grid = document.getElementById('gameGrid');
        els.keyboard = document.getElementById('keyboard');
        els.status = document.getElementById('gameStatus');
        els.difficultyTabs = document.querySelector('.difficulty-tabs');
        els.solveButton = document.getElementById('solveButton');
        els.newPuzzleButton = document.getElementById('newPuzzleButton');
        els.dailyTimer = document.getElementById('dailyTimer');
        els.dailyTimerLabel = document.getElementById('dailyTimerLabel');
        els.dailyTimerValue = document.getElementById('dailyTimerValue');
        els.pauseTimerButton = document.getElementById('pauseTimerButton');
        els.nextPuzzleCountdown = document.getElementById('nextPuzzleCountdown');
        els.helpButton = document.getElementById('helpButton');
        els.shareButton = document.getElementById('shareButton');
        els.leaderboardButton = document.getElementById('leaderboardButton');
        els.helpDialog = document.getElementById('helpDialog');
        els.helpContent = document.getElementById('helpContent');
        els.helpNav = document.getElementById('helpNav');
        els.leaderboardDialog = document.getElementById('leaderboardDialog');
        els.leaderboardTitle = document.getElementById('leaderboardTitle');
        els.leaderboardNote = document.getElementById('leaderboardNote');
        els.leaderboardContent = document.getElementById('leaderboardContent');
        els.clearLeaderboardButton = document.getElementById('clearLeaderboardButton');
        els.nameDialog = document.getElementById('nameDialog');
        els.nameDialogNote = document.getElementById('nameDialogNote');
        els.nameForm = document.getElementById('nameForm');
        els.playerName = document.getElementById('playerName');
        els.skipNameButton = document.getElementById('skipNameButton');
    }

    function startIntervals() {
        window.setInterval(() => {
            updateTimerDisplay();
            updateNextPuzzleCountdown();
        }, 1000);
    }

    async function init() {
        cacheElements();
        bindEvents();
        renderKeyboard();
        await loadWords();

        consumeDailyResetFlag();
        const sharedVariety = readUrlVariation();
        if (sharedVariety) {
            state.mode = 'unlimited';
            state.difficulty = readUrlDifficulty();
            state.varietyId = sharedVariety;
            generatePuzzle();
            startIntervals();
            return;
        }

        generatePuzzle();
        if (state.dailyRecord?.solved) {
            if (state.activeModal === els.nameDialog) closeModal();
            state.mode = 'unlimited';
            state.varietyId = makeVarietyId();
            generatePuzzle();
        }
        startIntervals();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
