(() => {
    'use strict';

    const WORD_LENGTH = 5;
    const DICTIONARY_URL = 'data/kobza-words.txt?v=20260703-variety';
    const LEADERBOARD_KEY = 'lordskamp:kobza-navpaky:leaderboard:v2';
    const DAILY_STATE_KEY = 'lordskamp:kobza-navpaky:daily-state:v1';
    const POOP_STATE_KEY = 'lordskamp:kobza-navpaky:poop-state:v1';
    const PLAYER_NAME_KEY = 'lordskamp:kobza-navpaky:player-name:v1';
    const CLOUD_DAILY_STATE_KEY = 'lordskamp-kobza-navpaky-daily-state-v1';
    const CLOUD_POOP_STATE_KEY = 'lordskamp-kobza-navpaky-poop-state-v1';
    const CLOUD_PLAYER_NAME_KEY = 'lordskamp-kobza-navpaky-player-name-v1';
    const DAILY_TIME_ZONE = resolveDailyTimeZone();
    const DAILY_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
        timeZone: DAILY_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const DAILY_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
        timeZone: DAILY_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });
    const REMOTE_LEADERBOARD_ENDPOINT = getLeaderboardEndpoint();
    const REMOTE_LEADERBOARD_TIMEOUT_MS = 7000;
    const MAX_LOCAL_LEADERBOARD_ENTRIES = 1000;
    const DAILY_CHEAT_WARNING_SECONDS = 60;
    const MIN_DICTIONARY_WORDS = 500;
    const RECENT_TARGET_LIMIT = 240;
    const DAILY_TARGET_ATTEMPT_LIMIT = 240;
    const UNLIMITED_TARGET_ATTEMPT_LIMIT = 480;
    const POOP_TARGET = 'гімно';
    const POOP_START_WORDS = [
        'балка', 'баран', 'барва', 'барка', 'будка', 'булка', 'бурка',
        'видра', 'висок', 'вовча', 'вудка', 'дошка', 'дощик', 'дудка', 'душка',
        'жуйка', 'журба', 'казан', 'казка', 'карта', 'квіти', 'книга', 'кубка',
        'курка', 'ложка', 'лунка', 'луска', 'манка', 'марка', 'моряк', 'мушка',
        'нирка', 'норка', 'папка', 'парка', 'парта', 'пиріг', 'пошта', 'пудра',
        'пушка', 'рибка', 'ручка', 'ряска', 'садок', 'сайка', 'сапка', 'сирок',
        'сонце', 'стеля', 'сушка', 'торба', 'трава', 'турка', 'тушка', 'фарба',
        'хатка', 'хмара', 'хутка', 'чашка', 'чобіт', 'шапка', 'шахта', 'шишка',
        'школа', 'штора', 'шубка', 'ягода'
    ];
    const POOP_FALLBACK_START_WORDS = [
        'дудка', 'душка', 'сушка', 'вудка', 'дошка', 'курка',
        'мушка', 'сапка', 'тушка', 'чашка', 'шапка', 'сонце'
    ];
    const POOP_FALLBACK_WORDS = [
        'дудка', 'душка', 'сушка', 'вудка', 'дошка', 'курка',
        'мушка', 'сапка', 'тушка', 'чашка', 'шапка', 'сонце',
        'думка', 'думна', 'думно', 'гумно', 'гімно',
        'душна', 'душно', 'сумка', 'сумна', 'сумно',
        'курна', 'курно', 'дурно', 'самка', 'чушка',
        'сонне', 'сінне', 'мінне', 'мідне', 'гідне', 'гідно'
    ];
    const VARIETY_RE = /^\d{8,18}$/;
    const SHARE_FEEDBACK_MS = 1800;
    const STYLE_TIME_LIMIT_SECONDS = 4 * 60;
    const STYLE_LETTER_SCORES = new Map(Object.entries({
        о: 1, а: 1, и: 1, н: 1, е: 1, і: 1, т: 1, р: 1, в: 1,
        к: 2, с: 2, м: 2, д: 2, л: 2, п: 2,
        у: 3,
        з: 4, я: 4, б: 4, г: 4,
        ч: 5, х: 5, й: 5, ь: 5,
        ж: 6, ї: 6, ц: 6, ш: 6,
        ю: 7,
        є: 8, ф: 8, щ: 8,
        ґ: 10
    }));
    const UA_WORD_RE = /^[а-щьюяєіїґ]{5}$/u;
    const UA_LETTER_RE = /^[а-щьюяєіїґ]$/u;
    const DIFFICULTIES = {
        easy: { clueRows: 2, label: 'Легка' },
        normal: { clueRows: 3, label: 'Звичайна' },
        hard: { clueRows: 5, label: 'Складна' }
    };
    const MODES = {
        daily: 'Щоденна',
        unlimited: 'Нескінченна',
        poop: 'Режим 💩'
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
        'пошта', 'берег', 'думка', 'загін', 'місто', 'океан', 'свято',
        ...POOP_FALLBACK_WORDS
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
        invalidRow: null,
        invalidAttempts: 0,
        puzzleNumber: 0,
        startedAt: 0,
        solvedRecorded: false,
        dailyRecord: null,
        dailyKey: '',
        pendingDailyEntry: null,
        poopRecord: null,
        poopKey: '',
        poopStartWord: '',
        pendingPoopEntry: null,
        pendingUnlimitedEntry: null,
        lastUnlimitedEntry: null,
        dailyRankLoading: false,
        dailyRankRequested: false,
        leaderboardSyncInFlight: false,
        varietyId: '',
        helpSlide: 0,
        activeModal: null,
        nameDialogKind: 'daily',
        dictionaryFallback: false,
        recentTargets: [],
        hintPurchasePending: false
    };

    const HELP_SLIDES = [
        {
            title: 'Як грати',
            body: () => `
                <p>Мета гри — заповнити сітку правильними літерами.</p>
                <p>Приклад стартової сітки:</p>
                ${renderHelpGrid([
                    patternRow('     ', '00100'),
                    patternRow('     ', '02010'),
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
                    ...patternRow('ЛОБИК', '02201')
                ]])}
                <div class="help-label">Погано:</div>
                ${renderHelpGrid([[
                    cell('absent', 'Ф'), cell('correct', 'Ж'), cell('absent', 'Ґ'), cell('absent', 'Ї'), cell('absent', 'Є')
                ]])}
            `
        },
        {
            title: 'Обирай рядок',
            body: () => `
                <p>Можеш натиснути будь-який незавершений рядок і вводити слово там.</p>
                ${renderHelpGrid([
                    helpRow(patternRow('ВАГОН', '01010'), { accepted: true }),
                    helpRow(patternRow('ЛОБИК', '02201'), { typing: true }),
                    wordRow('КОБЗА', 'correct')
                ])}
                <p>Коли в рядку 5 літер, гра автоматично перевіряє і слово, і точну відповідність кольорам.</p>
            `
        },
        {
            title: 'Помилки',
            body: () => `
                <p>Якщо слово не підходить, над пазлом з’явиться причина, а рядок здригнеться.</p>
                <p class="help-error-reason">Слово не відповідає кольорам рядка.</p>
                ${renderHelpGrid([
                    helpRow(patternRow('ВАГОН', '01010'), { accepted: true }),
                    helpRow(patternRow('ЛОБИК', '20202'), { invalid: true }),
                    wordRow('КОБЗА', 'correct')
                ])}
                <p>Виправ рядок: щойно він знову матиме 5 літер, гра перевірить слово автоматично.</p>
            `
        },
        {
            title: 'Гарної гри!',
            body: () => `
                <p class="help-centered">Бажаю приємної гри.</p>
                ${renderHelpGrid([
                    patternRow('ВАГОН', '01010'),
                    patternRow('ЛОБИК', '02201'),
                    wordRow('КОБЗА', 'correct')
                ])}
            `
        }
    ];

    function cell(stateName, letter = '') {
        return { state: stateName, letter };
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
            `<div class="help-example-row-wrap${row.accepted ? ' is-accepted' : ''}${row.invalid ? ' is-invalid' : ''}${row.typing ? ' is-typing' : ''}">
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

    function getTelegramBotUsername() {
        const username = document.querySelector('meta[name="kobza-telegram-bot"]')?.content || '';
        return String(username).trim().replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
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

    function readUrlMode() {
        const params = new URLSearchParams(window.location.search);
        return params.get('mode') === 'poop' ? 'poop' : 'daily';
    }

    function consumeDailyResetFlag() {
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.get('resetDaily') !== '1') return;
            window.localStorage.removeItem(DAILY_STATE_KEY);
            window.KobzaTelegram?.removeCloudValue(CLOUD_DAILY_STATE_KEY);
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
        } else if (mode === 'poop') {
            url.searchParams.set('mode', 'poop');
        }

        return url.toString();
    }

    function telegramStartParam({ mode = state.mode, varietyId = state.varietyId, difficulty = state.difficulty } = {}) {
        if (mode === 'poop') return 'p';
        if (mode === 'unlimited') {
            const difficultyKey = { easy: 'e', normal: 'n', hard: 'h' }[difficulty] || 'n';
            return `u-${difficultyKey}-${varietyId || makeVarietyId()}`;
        }
        return 'd';
    }

    function shareGameUrl(options = {}) {
        const botUsername = getTelegramBotUsername();
        if (!botUsername) return gameUrl(options);

        const link = new URL(`https://t.me/${botUsername}`);
        link.searchParams.set('startapp', telegramStartParam(options));
        return link.toString();
    }

    function telegramLaunch() {
        const param = window.KobzaTelegram?.getStartParam?.();
        if (param === 'p') return { mode: 'poop' };
        if (param === 'd') return { mode: 'daily' };

        const unlimited = /^u-([enh])-(\d{8,18})$/.exec(param || '');
        if (!unlimited) return null;
        return {
            mode: 'unlimited',
            difficulty: { e: 'easy', n: 'normal', h: 'hard' }[unlimited[1]],
            varietyId: unlimited[2]
        };
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

    function resolveDailyTimeZone() {
        const candidates = ['Europe/Kyiv', 'Europe/Kiev'];
        for (const timeZone of candidates) {
            try {
                new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
                return timeZone;
            } catch (_) {
                /* Some older runtimes still expose the previous IANA spelling. */
            }
        }
        return 'UTC';
    }

    function dateTimeParts(formatter, date) {
        return formatter.formatToParts(date).reduce((parts, item) => {
            if (item.type !== 'literal') parts[item.type] = item.value;
            return parts;
        }, {});
    }

    function todayKey(date = new Date()) {
        const { year, month, day } = dateTimeParts(DAILY_DATE_FORMATTER, date);
        return `${year}-${month}-${day}`;
    }

    function addDays(dateKey, offset) {
        const [year, month, day] = dateKey.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day + offset));
        const nextYear = date.getUTCFullYear();
        const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
        const nextDay = String(date.getUTCDate()).padStart(2, '0');
        return `${nextYear}-${nextMonth}-${nextDay}`;
    }

    function dailyOffsetMs(date) {
        const parts = dateTimeParts(DAILY_DATE_TIME_FORMATTER, date);
        const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
        const zonedAsUtc = Date.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day),
            hour,
            Number(parts.minute),
            Number(parts.second)
        );
        return zonedAsUtc - date.getTime();
    }

    function dailyKeyStartMs(dateKey) {
        const [year, month, day] = dateKey.split('-').map(Number);
        const localMidnightAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
        let timestamp = localMidnightAsUtc;

        for (let i = 0; i < 3; i += 1) {
            timestamp = localMidnightAsUtc - dailyOffsetMs(new Date(timestamp));
        }

        return timestamp;
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

    function changedLetterCount(first, second) {
        const firstLetters = Array.from(first || '');
        const secondLetters = Array.from(second || '');
        if (firstLetters.length !== WORD_LENGTH || secondLetters.length !== WORD_LENGTH) return Infinity;
        return firstLetters.reduce((total, letter, index) => total + Number(letter !== secondLetters[index]), 0);
    }

    function hasPoopTargetLetterInPlace(word) {
        return Array.from(word || '').some((letter, index) => letter === Array.from(POOP_TARGET)[index]);
    }

    function poopStartWordForDate(dateKey = todayKey()) {
        const pool = state.dictionaryFallback ? POOP_FALLBACK_START_WORDS : POOP_START_WORDS;
        const available = pool.filter(word => (
            state.wordSet.has(word) && !hasPoopTargetLetterInPlace(word)
        ));
        if (!available.length) return '';
        const rng = mulberry32(hashString(`poop:v1:${dateKey}`));
        return available[Math.floor(rng() * available.length)];
    }

    function poopRow(word = '', locked = false, isStart = false) {
        const letters = Array.from(normalizeWord(word)).slice(0, WORD_LENGTH);
        while (letters.length < WORD_LENGTH) letters.push('');
        return { letters, locked, isStart };
    }

    function generatePoopPuzzle() {
        const dateKey = todayKey();
        const startWord = poopStartWordForDate(dateKey);
        if (!startWord) {
            setStatus('Не вдалося підготувати стартове слово для режиму 💩.');
            return false;
        }

        state.difficulty = 'normal';
        state.varietyId = '';
        state.target = POOP_TARGET;
        state.rows = [];
        state.activeRow = 0;
        state.activeCol = 0;
        state.locked = false;
        state.invalidRow = null;
        state.invalidAttempts = 0;
        state.startedAt = null;
        state.solvedRecorded = false;
        state.pendingDailyEntry = null;
        state.pendingUnlimitedEntry = null;
        state.lastUnlimitedEntry = null;
        state.dailyRecord = null;
        state.dailyKey = '';
        state.poopKey = dateKey;
        state.poopStartWord = startWord;
        state.pendingPoopEntry = null;
        state.dailyRankLoading = false;
        state.dailyRankRequested = false;
        syncUrlToMode();
        hydratePoopRecord();

        setStatus(state.poopRecord?.solved
            ? `Сьогоднішній маршрут до «${POOP_TARGET}» уже пройдено.`
            : `Початкове слово: ${startWord.toLocaleUpperCase('uk-UA')}. Дійди до «${POOP_TARGET.toLocaleUpperCase('uk-UA')}», змінюючи по одній літері.`);
        render();
        if (state.poopRecord?.solved && !state.poopRecord.nameSubmitted) {
            openNameDialog('poop');
        }
        return true;
    }

    function generatePuzzle() {
        if (state.mode === 'poop') return generatePoopPuzzle();

        if (state.mode === 'daily') {
            state.difficulty = 'normal';
            state.puzzleNumber = 0;
            state.varietyId = '';
        } else if (!state.varietyId) {
            state.varietyId = makeVarietyId();
        }
        state.dailyRankLoading = false;
        state.dailyRankRequested = false;

        const dailyKey = state.mode === 'daily' ? todayKey() : '';
        const rowCount = DIFFICULTIES[state.difficulty].clueRows;
        const seedBase = state.mode === 'daily'
            ? `${state.mode}:${state.difficulty}:${dailyKey}:${state.puzzleNumber}`
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
                state.invalidRow = null;
                state.invalidAttempts = 0;
                state.startedAt = null;
                state.solvedRecorded = false;
                state.pendingUnlimitedEntry = null;
                state.lastUnlimitedEntry = null;
                state.dailyKey = dailyKey;
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

    function setTelegramHintStatus() {
        if (!els.status) return;

        const link = document.createElement('a');
        link.href = 'https://t.me/unwordle_bot?startapp=d';
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Telegram';
        link.setAttribute('aria-label', 'Відкрити КОБЗА-НАВПАКИ у Telegram');
        els.status.replaceChildren('Підказка за ⭐ доступна лише у ', link, '.');
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
            const serialized = JSON.stringify(record);
            window.localStorage.setItem(DAILY_STATE_KEY, serialized);
            window.KobzaTelegram?.setCloudValue(CLOUD_DAILY_STATE_KEY, serialized);
        } catch (_) {
            /* Persistent daily timer is best-effort when storage is unavailable. */
        }
    }

    function readPoopRecord() {
        try {
            const raw = window.localStorage.getItem(POOP_STATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function writePoopRecord(record) {
        try {
            const serialized = JSON.stringify(record);
            window.localStorage.setItem(POOP_STATE_KEY, serialized);
            window.KobzaTelegram?.setCloudValue(CLOUD_POOP_STATE_KEY, serialized);
        } catch (_) {
            /* Persistent mode progress is best-effort when storage is unavailable. */
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
            invalidAttempts: 0,
            rows: state.rows.map(row => ({ letters: row.letters.slice(), locked: row.locked }))
        };
    }

    function makeFreshPoopRecord() {
        return {
            dateKey: todayKey(),
            target: POOP_TARGET,
            startWord: state.poopStartWord,
            attempts: 0,
            solved: false,
            nameSubmitted: false,
            entryId: '',
            playerName: '',
            rank: null,
            solvedAt: '',
            rows: [poopRow(state.poopStartWord, true, true)]
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
            styleScore: calculateStyleScore(seconds),
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

    function makePendingPoopEntry() {
        return {
            mode: 'poop',
            difficulty: 'normal',
            dateKey: todayKey(),
            target: POOP_TARGET,
            startWord: state.poopStartWord,
            variation: '',
            attempts: Math.max(1, Math.round(Number(state.poopRecord?.attempts) || 0)),
            solvedAt: new Date().toISOString()
        };
    }

    function dailyHasStartedProgress() {
        const record = state.dailyRecord;
        if (!record) return false;
        const elapsed = Math.max(0, Number(record.elapsedMs) || 0);
        return elapsed > 0 || state.rows.some(row => row.locked || row.letters.some(Boolean));
    }

    function normalizeDailyTimerState() {
        const record = state.dailyRecord;
        if (!record || record.solved) return;

        if (record.running) {
            record.paused = false;
            record.lastStartedAt = record.lastStartedAt || Date.now();
            return;
        }

        if (dailyHasStartedProgress()) {
            record.running = true;
            record.paused = false;
            record.lastStartedAt = Date.now();
            return;
        }

        record.running = false;
        record.paused = true;
        record.elapsedMs = 0;
        record.lastStartedAt = null;
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
        state.invalidAttempts = Math.max(0, Math.round(Number(state.dailyRecord.invalidAttempts) || 0));

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

        if (!state.dailyRecord.solved) normalizeDailyTimerState();

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

    function hydratePoopRecord() {
        const stored = readPoopRecord();
        const isSamePuzzle = stored
            && stored.dateKey === todayKey()
            && stored.target === POOP_TARGET
            && stored.startWord === state.poopStartWord;
        const record = isSamePuzzle ? stored : makeFreshPoopRecord();
        const accepted = [state.poopStartWord];
        let draft = '';
        let solved = false;

        const savedRows = Array.isArray(record.rows) ? record.rows.slice(1) : [];
        for (const saved of savedRows) {
            const word = Array.isArray(saved?.letters)
                ? normalizeWord(saved.letters.join('')).slice(0, WORD_LENGTH)
                : '';
            if (saved?.locked) {
                if (solved || !state.wordSet.has(word) || changedLetterCount(accepted[accepted.length - 1], word) !== 1) {
                    break;
                }
                accepted.push(word);
                if (word === POOP_TARGET) solved = true;
            } else if (!solved && !draft) {
                draft = Array.from(word).filter(letter => UA_LETTER_RE.test(letter)).join('');
            }
        }

        state.rows = accepted.map((word, index) => poopRow(word, true, index === 0));
        state.locked = solved;
        if (!solved) state.rows.push(poopRow(draft, false));

        state.poopRecord = {
            ...record,
            dateKey: todayKey(),
            target: POOP_TARGET,
            startWord: state.poopStartWord,
            attempts: Math.max(
                accepted.length - 1,
                Math.max(0, Math.round(Number(record.attempts) || 0))
            ),
            solved,
            rows: state.rows.map(row => ({
                letters: row.letters.slice(),
                locked: row.locked,
                isStart: Boolean(row.isStart)
            }))
        };

        if (solved && !state.poopRecord.nameSubmitted) {
            state.pendingPoopEntry = makePendingPoopEntry();
        } else {
            state.pendingPoopEntry = null;
        }

        if (!solved) {
            state.activeRow = state.rows.length - 1;
            const firstEmpty = state.rows[state.activeRow].letters.findIndex(letter => !letter);
            state.activeCol = firstEmpty === -1 ? WORD_LENGTH - 1 : firstEmpty;
        }
        persistPoopRecord();
    }

    function currentDailyElapsedMs() {
        const record = state.dailyRecord;
        if (!record) return 0;
        const base = Math.max(0, Number(record.elapsedMs) || 0);
        if (!record.running || record.paused || record.solved || !record.lastStartedAt) return base;
        return Math.max(0, base + (Date.now() - Number(record.lastStartedAt)));
    }

    function persistDailyRecord(materializeTimer = false) {
        if (state.mode === 'poop') {
            persistPoopRecord();
            return;
        }
        if (state.mode !== 'daily' || !state.dailyRecord) return;

        const record = state.dailyRecord;
        record.dateKey = todayKey();
        record.target = state.target;
        record.difficulty = 'normal';
        record.invalidAttempts = Math.max(0, Math.round(Number(state.invalidAttempts) || 0));
        record.rows = state.rows.map(row => ({ letters: row.letters.slice(), locked: row.locked }));

        if (materializeTimer && record.running && !record.paused && !record.solved) {
            record.elapsedMs = currentDailyElapsedMs();
            record.lastStartedAt = Date.now();
        }

        writeDailyRecord(record);
    }

    function persistPoopRecord() {
        if (state.mode !== 'poop' || !state.poopRecord) return;
        const record = state.poopRecord;
        record.dateKey = todayKey();
        record.target = POOP_TARGET;
        record.startWord = state.poopStartWord;
        record.attempts = Math.max(
            state.rows.filter(row => row.locked && !row.isStart).length,
            Math.max(0, Math.round(Number(record.attempts) || 0))
        );
        record.rows = state.rows.map(row => ({
            letters: row.letters.slice(),
            locked: row.locked,
            isStart: Boolean(row.isStart)
        }));
        writePoopRecord(record);
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

    function renderPoopGrid() {
        const targetLetters = Array.from(POOP_TARGET);
        const rowsHtml = state.rows.map((row, rowIndex) => {
            const tiles = row.letters.map((letter, colIndex) => {
                const isActive = !state.locked && rowIndex === state.activeRow && colIndex === state.activeCol && !row.locked;
                const isBrown = row.locked && !row.isStart && letter === targetLetters[colIndex];
                const label = row.isStart
                    ? `Початкове слово, літера ${colIndex + 1}`
                    : `Спроба ${Math.max(1, rowIndex)}, літера ${colIndex + 1}`;
                return `<button class="unwordle-tile${isActive ? ' is-active' : ''}${letter ? ' is-filled' : ''}" type="button" data-row="${rowIndex}" data-col="${colIndex}"${isBrown ? ' data-state="poop-correct"' : ''} aria-label="${escapeHtml(label)}">${escapeHtml(letter.toLocaleUpperCase('uk-UA'))}</button>`;
            }).join('');
            return `
                <div class="game-row-wrap${row.locked && !row.isStart ? ' is-accepted' : ''}" data-row-wrap="${rowIndex}">
                    <div class="game-row${state.invalidRow === rowIndex ? ' is-invalid' : ''}" data-row="${rowIndex}">${tiles}</div>
                    <span class="row-check"${row.locked && !row.isStart ? ' aria-label="Спробу прийнято"' : ' aria-hidden="true"'}>✓</span>
                </div>
            `;
        }).join('');

        els.grid.innerHTML = rowsHtml;
        requestAnimationFrame(() => {
            els.grid.querySelector(`[data-row-wrap="${state.activeRow}"]`)?.scrollIntoView({
                block: 'center',
                behavior: 'auto'
            });
        });
    }

    function renderGrid() {
        if (state.mode === 'poop') {
            renderPoopGrid();
            return;
        }
        const waitingToStart = isDailyWaitingToStart();
        const rowsHtml = state.rows.map((row, rowIndex) => {
            const tiles = row.pattern.map((color, colIndex) => {
                const letter = row.letters[colIndex] || '';
                const isActive = !waitingToStart && !state.locked && rowIndex === state.activeRow && colIndex === state.activeCol && !row.locked;
                return `<button class="unwordle-tile${isActive ? ' is-active' : ''}${letter ? ' is-filled' : ''}" type="button" data-row="${rowIndex}" data-col="${colIndex}" data-state="${tileStateName(color)}" aria-label="Рядок ${rowIndex + 1}, плитка ${colIndex + 1}">${escapeHtml(letter.toLocaleUpperCase('uk-UA'))}</button>`;
            }).join('');
            return `
                <div class="game-row-wrap${row.locked ? ' is-accepted' : ''}" data-row-wrap="${rowIndex}">
                    <div class="game-row${state.invalidRow === rowIndex ? ' is-invalid' : ''}" data-row="${rowIndex}">${tiles}</div>
                    <span class="row-check" aria-label="Рядок прийнято">✓</span>
                </div>
            `;
        }).join('');

        const targetTiles = Array.from(state.target).map((letter, index) => {
            const visibleLetter = waitingToStart ? '' : escapeHtml(letter.toLocaleUpperCase('uk-UA'));
            const label = waitingToStart
                ? `Прихована літера ${index + 1} фінального слова`
                : `Фінальне слово, літера ${index + 1}: ${letter.toLocaleUpperCase('uk-UA')}`;
            return `<span class="unwordle-tile${waitingToStart ? ' is-hidden-letter' : ' is-filled'}" data-state="correct" aria-label="${escapeHtml(label)}">${visibleLetter}</span>`;
        }).join('');

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

        const isUnlimited = state.mode === 'unlimited';
        const isDailyPuzzleMode = state.mode === 'daily' || state.mode === 'poop';
        els.difficultyTabs.hidden = !isUnlimited;
        els.solveButton.hidden = !isUnlimited;
        els.solveButton.disabled = state.mode !== 'unlimited'
            || state.locked
            || state.rows.every(row => row.locked)
            || state.hintPurchasePending;
        els.solveButton.textContent = state.hintPurchasePending ? 'Зачекайте…' : 'Підказка · 1 ⭐';
        els.solveButton.setAttribute('aria-label', 'Купити підказку за одну Telegram Зірку');
        els.newPuzzleButton.hidden = !isUnlimited;
        const poopPuzzleSolved = Boolean(state.poopRecord?.solved);
        els.restartPoopButton.hidden = state.mode !== 'poop' || poopPuzzleSolved;
        els.restartPoopButton.disabled = state.mode !== 'poop' || state.locked || poopPuzzleSolved;
        els.dailyTimer.hidden = state.mode !== 'daily';
        els.nextPuzzleCountdown.hidden = !isDailyPuzzleMode;
        els.card.classList.toggle('is-awaiting-start', isDailyWaitingToStart());
        els.card.classList.toggle('is-poop-mode', state.mode === 'poop');
        els.shareButton.setAttribute('aria-label', state.mode === 'daily'
            ? 'Поділитися словом дня'
            : state.mode === 'poop' ? 'Поділитися режимом 💩' : 'Поділитися варіацією');
        els.leaderboardButton.setAttribute('aria-label', state.mode === 'daily'
            ? 'Рейтинг'
            : state.mode === 'poop' ? 'Рейтинг режиму 💩' : 'Рейтинг нескінченної');
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
        if (state.mode === 'poop' || isDailyWaitingToStart()) return colors;

        const targetLetters = new Set(Array.from(state.target));
        KEYBOARD_ROWS.flat().forEach(letter => {
            if (letter === 'backspace') return;
            colors.set(letter, targetLetters.has(letter) ? 'correct' : 'absent');
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

    function rejectInvalidWord(rowIndex, message) {
        window.KobzaTelegram?.haptic('error');
        state.invalidAttempts += 1;
        persistDailyRecord();
        setInvalidRow(rowIndex);
        setStatus(message);
    }

    function completePoopPuzzle() {
        state.pendingPoopEntry = makePendingPoopEntry();
        if (state.poopRecord) {
            state.poopRecord.solved = true;
            state.poopRecord.solvedAt = state.pendingPoopEntry.solvedAt;
            persistPoopRecord();
        }
        if (!state.poopRecord?.nameSubmitted) openNameDialog('poop');
    }

    function restartPoopPuzzle() {
        if (state.mode !== 'poop' || state.locked || !state.poopRecord) return;
        state.rows = [poopRow(state.poopStartWord, true, true), poopRow()];
        state.activeRow = 1;
        state.activeCol = 0;
        state.invalidRow = null;
        persistPoopRecord();
        setStatus('Маршрут очищено. Уже прийняті спроби залишаться в результаті.');
        render();
    }

    function submitPoopRow(rowIndex = state.activeRow) {
        const row = state.rows[rowIndex];
        if (!row || row.locked || state.locked) return;

        const word = row.letters.join('');
        if (word.length !== WORD_LENGTH) {
            window.KobzaTelegram?.haptic('error');
            setInvalidRow(rowIndex);
            setStatus('Потрібно 5 літер.');
            return;
        }
        if (!state.wordSet.has(word)) {
            rejectInvalidWord(rowIndex, 'Такого слова немає у словнику.');
            return;
        }

        const previousWord = state.rows[rowIndex - 1]?.letters.join('') || '';
        if (changedLetterCount(previousWord, word) !== 1) {
            rejectInvalidWord(rowIndex, 'Зміни рівно одну літеру від попереднього слова.');
            return;
        }

        row.locked = true;
        if (state.poopRecord) {
            state.poopRecord.attempts = Math.max(0, Math.round(Number(state.poopRecord.attempts) || 0)) + 1;
        }
        if (word === POOP_TARGET) {
            state.locked = true;
            completePoopPuzzle();
            window.KobzaTelegram?.haptic('success');
            setStatus(`Готово! Ти дійшов до «${POOP_TARGET}» за ${state.poopRecord?.attempts || 0} спроб.`);
        } else {
            state.rows.push(poopRow());
            state.activeRow = state.rows.length - 1;
            state.activeCol = 0;
            persistPoopRecord();
            setStatus('Слово прийнято. Зміни ще одну літеру.');
            window.KobzaTelegram?.haptic('light');
        }
        render();
    }

    function submitRow(rowIndex = state.activeRow) {
        if (state.mode === 'poop') {
            submitPoopRow(rowIndex);
            return;
        }
        if (isDailyWaitingToStart()) {
            window.KobzaTelegram?.haptic('warning');
            setStatus('Натисни “Почати”, щоб запустити таймер і грати.');
            return;
        }

        const row = state.rows[rowIndex];
        if (!row || row.locked || state.locked) return;

        const word = row.letters.join('');
        if (word.length !== WORD_LENGTH) {
            window.KobzaTelegram?.haptic('error');
            setInvalidRow(rowIndex);
            setStatus('Потрібно 5 літер.');
            return;
        }

        if (!state.wordSet.has(word)) {
            rejectInvalidWord(rowIndex, 'Такого слова немає у словнику.');
            return;
        }

        const actualPattern = scoreGuess(word, state.target);
        if (patternToKey(actualPattern) !== patternToKey(row.pattern)) {
            rejectInvalidWord(rowIndex, 'Слово не відповідає кольорам рядка.');
            return;
        }

        row.locked = true;
        persistDailyRecord();

        const next = state.rows.findIndex(item => !item.locked);
        if (next === -1) {
            state.locked = true;
            if (state.mode === 'daily') {
                const seconds = completeDailyPuzzle();
                setStatus(isSuspiciousDailyTime(seconds)
                    ? dailyCheatWarningText()
                    : 'Готово. Завдання розв’язано.');
            } else {
                const recorded = recordUnlimitedSolve();
                setStatus(recorded
                    ? 'Готово. Завдання розв’язано.'
                    : 'Готово. Результат уже збережено.');
            }
            window.KobzaTelegram?.haptic('success');
        } else {
            state.activeRow = next;
            state.activeCol = 0;
            setStatus('Рядок прийнято.');
            window.KobzaTelegram?.haptic('light');
        }
        render();
    }

    function putLetter(letter) {
        if (isDailyWaitingToStart()) {
            setStatus('Натисни “Почати”, щоб вводити літери.');
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
        if (isDailyWaitingToStart()) return;
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

        if (state.mode === 'unlimited' && !state.startedAt) state.startedAt = Date.now();
        row.letters = Array.from(row.solution);
        row.locked = true;

        const next = state.rows.findIndex(item => !item.locked);
        if (next === -1) {
            state.locked = true;
            const recorded = recordUnlimitedSolve();
            setStatus(recorded
                ? 'Підказка відкрила останній рядок. Результат можна додати в рейтинг.'
                : 'Підказка відкрила останній рядок. Результат уже збережено.');
        } else {
            state.activeRow = next;
            state.activeCol = 0;
            setStatus('Підказка відкрила один рядок. Результат можна додати в рейтинг.');
        }
        render();
    }

    function hintServiceUrl(path) {
        const baseUrl = leaderboardUrl();
        if (!baseUrl) return null;
        try {
            return new URL(path, baseUrl.origin).toString();
        } catch (_) {
            return null;
        }
    }

    async function requestHintService(path, body = {}) {
        const url = hintServiceUrl(path);
        const telegramInitData = window.KobzaTelegram?.getInitData?.() || '';
        if (!url || !telegramInitData) return { ok: false, status: 0, payload: {} };

        try {
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    Authorization: `tma ${telegramInitData}`
                },
                body: JSON.stringify(body)
            });
            return {
                ok: response.ok,
                status: response.status,
                payload: await response.json().catch(() => ({}))
            };
        } catch (_) {
            return { ok: false, status: 0, payload: {} };
        }
    }

    function wait(milliseconds) {
        return new Promise(resolve => window.setTimeout(resolve, milliseconds));
    }

    async function claimPaidHint(retries = 0) {
        let result = { ok: false, status: 0, payload: {} };
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            result = await requestHintService('/hint-claim');
            if (result.ok || result.status !== 409 || attempt === retries) return result;
            await wait(800);
        }
        return result;
    }

    async function requestPaidHint() {
        if (state.mode !== 'unlimited' || state.locked || state.hintPurchasePending) return;
        if (!window.KobzaTelegram?.isAvailable?.() || typeof window.KobzaTelegram?.openInvoice !== 'function') {
            setTelegramHintStatus();
            return;
        }

        state.hintPurchasePending = true;
        render();
        try {
            const availableCredit = await claimPaidHint();
            if (availableCredit.ok) {
                showHint();
                return;
            }

            if (availableCredit.status && availableCredit.status !== 409) {
                setStatus('Не вдалося підготувати оплату. Спробуйте ще раз.');
                return;
            }

            const invoice = await requestHintService('/hint-invoice');
            const invoiceLink = String(invoice.payload?.invoiceLink || '');
            if (!invoice.ok || !invoiceLink) {
                setStatus('Не вдалося створити рахунок на 1 ⭐. Спробуйте ще раз.');
                return;
            }

            const paymentStatus = await window.KobzaTelegram.openInvoice(invoiceLink);
            if (paymentStatus !== 'paid') {
                setStatus(paymentStatus === 'cancelled'
                    ? 'Оплату скасовано.'
                    : 'Оплату не завершено. Підказку не відкрито.');
                return;
            }

            const paidCredit = await claimPaidHint(5);
            if (!paidCredit.ok) {
                setStatus('Платіж прийнято. Зачекайте кілька секунд і натисніть «Підказка» ще раз.');
                return;
            }
            showHint();
        } finally {
            state.hintPurchasePending = false;
            render();
        }
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

    function cleanPlayerName(value) {
        return String(value || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 24) || 'Гравець';
    }

    function playerNameKey(value) {
        return cleanPlayerName(value).toLocaleLowerCase('uk-UA');
    }

    function samePlayerName(a, b) {
        return playerNameKey(a) === playerNameKey(b);
    }

    function readPlayerName() {
        try {
            return String(window.localStorage.getItem(PLAYER_NAME_KEY) || '').trim();
        } catch (_) {
            return '';
        }
    }

    function writePlayerName(name) {
        try {
            const cleanName = String(name || '').trim();
            if (cleanName) {
                window.localStorage.setItem(PLAYER_NAME_KEY, cleanName);
                window.KobzaTelegram?.setCloudValue(CLOUD_PLAYER_NAME_KEY, cleanName);
            } else {
                window.localStorage.removeItem(PLAYER_NAME_KEY);
                window.KobzaTelegram?.removeCloudValue(CLOUD_PLAYER_NAME_KEY);
            }
        } catch (_) {
            /* Remembering a player name is best-effort. */
        }
    }

    function normalizeLeaderboardEntry(item) {
        const mode = ['daily', 'unlimited', 'poop'].includes(item?.mode) ? item.mode : 'daily';
        const seconds = Number(item?.seconds);
        const attempts = Math.round(Number(item?.attempts));
        if (mode !== 'poop' && (!Number.isFinite(seconds) || seconds <= 0)) return null;
        if (mode === 'poop' && (!Number.isFinite(attempts) || attempts < 1)) return null;
        return {
            id: String(item?.id || `${item?.dateKey || todayKey()}-${item?.name || 'player'}-${mode === 'poop' ? attempts : seconds}`),
            mode,
            difficulty: item?.difficulty || 'normal',
            dateKey: String(item?.dateKey || todayKey()),
            target: normalizeWord(item?.target || state.target),
            startWord: normalizeWord(item?.startWord || ''),
            variation: String(item?.variation || ''),
            name: String(item?.name || 'Гравець').trim().slice(0, 24) || 'Гравець',
            avatarUrl: cleanAvatarUrl(item?.avatarUrl),
            seconds: mode === 'poop' ? 0 : Math.max(1, Math.round(seconds)),
            attempts: mode === 'poop' ? attempts : null,
            styleScore: mode === 'daily' ? normalizeStyleScore(item?.styleScore) : null,
            solvedAt: item?.solvedAt || new Date().toISOString(),
            remoteSyncPending: item?.remoteSyncPending === true
        };
    }

    function styleSortValue(entry) {
        const score = normalizeStyleScore(entry?.styleScore);
        return score === null ? Number.NEGATIVE_INFINITY : score;
    }

    function compareLeaderboardEntries(a, b) {
        if (a.mode === 'poop' || b.mode === 'poop') {
            return Number(a.attempts) - Number(b.attempts)
                || String(a.solvedAt).localeCompare(String(b.solvedAt))
                || String(a.id).localeCompare(String(b.id));
        }
        return a.seconds - b.seconds
            || styleSortValue(b) - styleSortValue(a)
            || String(a.solvedAt).localeCompare(String(b.solvedAt))
            || String(a.id).localeCompare(String(b.id));
    }

    function firstSubmittedEntry(a, b) {
        const solvedAtCompare = String(a.solvedAt).localeCompare(String(b.solvedAt));
        if (solvedAtCompare < 0) return a;
        if (solvedAtCompare > 0) return b;
        return String(a.id).localeCompare(String(b.id)) <= 0 ? a : b;
    }

    function bestStyleScore(entries) {
        const scores = entries
            .map(entry => normalizeStyleScore(entry?.styleScore))
            .filter(score => score !== null);
        return scores.length ? Math.max(...scores) : null;
    }

    function mergeWithFirstAttempt(first, entries) {
        if (first.mode !== 'daily') {
            return {
                entry: first,
                styleUpdated: false,
                keptExisting: true
            };
        }

        const styleScore = bestStyleScore(entries);
        const currentScore = normalizeStyleScore(first.styleScore);
        const styleUpdated = styleScore !== null && styleScore !== currentScore;

        return {
            entry: {
                ...first,
                styleScore
            },
            styleUpdated,
            keptExisting: !styleUpdated
        };
    }

    function leaderboardPlayerKey(entry) {
        if (entry.mode === 'unlimited') {
            return `unlimited:${playerNameKey(entry.name)}:${entry.difficulty}:${entry.variation}`;
        }

        if (entry.mode === 'poop') {
            return `poop:${playerNameKey(entry.name)}:${entry.dateKey}:${entry.startWord}:${entry.target}`;
        }

        return `daily:${playerNameKey(entry.name)}:${entry.dateKey}:${entry.target}`;
    }

    function uniqueLeaderboardEntries(entries) {
        const byPlayerPuzzle = new Map();
        entries
            .map(normalizeLeaderboardEntry)
            .filter(Boolean)
            .forEach(entry => {
                const key = leaderboardPlayerKey(entry);
                byPlayerPuzzle.set(key, [...(byPlayerPuzzle.get(key) || []), entry]);
            });

        return Array.from(byPlayerPuzzle.values()).map(items => {
            const first = items.reduce((oldest, item) => firstSubmittedEntry(oldest, item));
            return mergeWithFirstAttempt(first, items).entry;
        });
    }

    function mergeLocalLeaderboardEntries(entries, incomingEntries) {
        const byPlayerPuzzle = new Map();
        [...entries, ...incomingEntries]
            .map(normalizeLeaderboardEntry)
            .filter(Boolean)
            .forEach(entry => {
                const key = leaderboardPlayerKey(entry);
                byPlayerPuzzle.set(key, [...(byPlayerPuzzle.get(key) || []), entry]);
            });

        return Array.from(byPlayerPuzzle.values())
            .map(items => {
                const first = items.reduce((oldest, item) => firstSubmittedEntry(oldest, item));
                return mergeWithFirstAttempt(first, items).entry;
            })
            .sort((a, b) => String(a.solvedAt).localeCompare(String(b.solvedAt)))
            .slice(-MAX_LOCAL_LEADERBOARD_ENTRIES);
    }

    function replaceLocalLeaderboardEntry(entries, replacement) {
        const replacementId = String(replacement?.id || '');
        const withoutPreviousVersion = replacementId
            ? entries.filter(item => String(item?.id || '') !== replacementId)
            : entries;
        return mergeLocalLeaderboardEntries(withoutPreviousVersion, [replacement]);
    }

    function findLocalExistingPlayerEntry(entries, entry) {
        const normalizedEntry = normalizeLeaderboardEntry(entry);
        if (!normalizedEntry) return null;
        const key = leaderboardPlayerKey(normalizedEntry);
        return uniqueLeaderboardEntries(entries).find(item => leaderboardPlayerKey(item) === key) || null;
    }

    function localDailyLeaderboard(entries = readLeaderboard()) {
        return uniqueLeaderboardEntries(entries)
            .filter(item => item.mode === 'daily' && item.dateKey === todayKey() && item.target === state.target)
            .sort(compareLeaderboardEntries)
            .slice(0, 10);
    }

    function localPoopLeaderboard(entries = readLeaderboard()) {
        return uniqueLeaderboardEntries(entries)
            .filter(item => (
                item.mode === 'poop'
                && item.dateKey === todayKey()
                && item.target === POOP_TARGET
                && item.startWord === state.poopStartWord
            ))
            .sort(compareLeaderboardEntries)
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
                if (!current || firstSubmittedEntry(current, item) === item) {
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
        const sorted = uniqueLeaderboardEntries(entries)
            .filter(item => item.mode === 'daily' && item.dateKey === todayKey() && item.target === state.target)
            .sort(compareLeaderboardEntries);
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

    function findPoopRank(entries, reference) {
        if (!reference) return null;
        const sorted = uniqueLeaderboardEntries(entries)
            .filter(item => (
                item.mode === 'poop'
                && item.dateKey === todayKey()
                && item.target === POOP_TARGET
                && item.startWord === state.poopStartWord
            ))
            .sort(compareLeaderboardEntries);
        const index = sorted.findIndex(item => (
            (reference.id && item.id === reference.id)
            || (
                item.attempts === reference.attempts
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

    function currentPoopResultReference() {
        if (!state.poopRecord?.solved) return null;
        return {
            id: String(state.poopRecord.entryId || ''),
            mode: 'poop',
            difficulty: 'normal',
            dateKey: todayKey(),
            target: POOP_TARGET,
            startWord: state.poopStartWord,
            name: String(state.poopRecord.playerName || 'Гравець'),
            attempts: Math.max(1, Math.round(Number(state.poopRecord.attempts) || 0)),
            solvedAt: state.poopRecord.solvedAt || ''
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
                .sort(compareLeaderboardEntries)
                .slice(0, 10),
            rank: Number.isFinite(rank) && rank > 0 ? rank : null,
            error: false
        };
    }

    async function readRemotePoopLeaderboard(entryId = '') {
        const url = leaderboardUrl();
        if (!url) return { source: 'local', entries: localPoopLeaderboard(), error: false };

        url.searchParams.set('mode', 'poop');
        url.searchParams.set('dateKey', todayKey());
        url.searchParams.set('target', POOP_TARGET);
        url.searchParams.set('startWord', state.poopStartWord);
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
                .filter(item => (
                    item.mode === 'poop'
                    && item.dateKey === todayKey()
                    && item.target === POOP_TARGET
                    && item.startWord === state.poopStartWord
                ))
                .sort(compareLeaderboardEntries)
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
            avatarUrl: cleanAvatarUrl(item?.avatarUrl),
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

    async function writeRemoteLeaderboard(entry, options = {}) {
        const url = leaderboardUrl();
        if (!url) return { ok: false, skipped: true };
        try {
            const telegramInitData = window.KobzaTelegram?.getInitData?.() || '';
            const response = await fetchWithTimeout(url.toString(), {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    ...(telegramInitData ? { Authorization: `tma ${telegramInitData}` } : {})
                },
                body: JSON.stringify({
                    id: entry.id,
                    mode: entry.mode,
                    difficulty: entry.difficulty,
                    dateKey: entry.dateKey,
                    target: entry.target,
                    startWord: entry.startWord,
                    variation: entry.variation,
                    name: entry.name,
                    seconds: entry.seconds,
                    attempts: entry.attempts,
                    styleScore: entry.mode === 'daily' ? entry.styleScore : undefined,
                    solvedAt: entry.solvedAt,
                    replaceExisting: options.replaceExisting === true
                })
            });
            const payload = await response.json().catch(() => ({}));
            const rank = Number(payload?.rank);
            return {
                ok: response.ok,
                status: response.status,
                entry: normalizeLeaderboardEntry(payload?.entry),
                existing: normalizeLeaderboardEntry(payload?.existing),
                incoming: normalizeLeaderboardEntry(payload?.incoming),
                conflict: response.status === 409 && payload?.conflict === true,
                replaced: Boolean(payload?.replaced),
                keptExisting: Boolean(payload?.keptExisting),
                styleUpdated: Boolean(payload?.styleUpdated),
                rank: Number.isFinite(rank) && rank > 0 ? rank : null,
                profile: payload?.profile || null
            };
        } catch (_) {
            return { ok: false };
        }
    }

    async function remoteLeaderboardEntryExists(entry) {
        const url = leaderboardUrl();
        if (!url) return null;

        url.searchParams.set('mode', entry.mode);
        url.searchParams.set('entryId', entry.id);
        if (entry.mode === 'unlimited') {
            url.searchParams.set('difficulty', entry.difficulty);
            url.searchParams.set('variation', entry.variation);
        } else {
            url.searchParams.set('dateKey', entry.dateKey);
            url.searchParams.set('target', entry.target);
            if (entry.mode === 'poop') url.searchParams.set('startWord', entry.startWord);
        }

        try {
            const response = await fetchWithTimeout(url.toString(), {
                headers: { Accept: 'application/json' }
            });
            if (!response.ok) return null;
            const payload = await response.json();
            return Number(payload?.rank) > 0;
        } catch (_) {
            return null;
        }
    }

    function queueLegacyLeaderboardEntries() {
        const entries = readLeaderboard();
        let changed = false;
        const queuedEntries = entries.map(entry => {
            if (
                !entry
                || typeof entry !== 'object'
                || Object.prototype.hasOwnProperty.call(entry, 'remoteSyncPending')
                || !normalizeLeaderboardEntry(entry)
            ) return entry;

            changed = true;
            return { ...entry, remoteSyncPending: true };
        });
        if (changed) writeLeaderboard(queuedEntries);
    }

    function markLeaderboardEntrySynced(entry, profileEntries = []) {
        const savedEntry = { ...entry, remoteSyncPending: false };
        const entries = replaceLocalLeaderboardEntry(readLeaderboard(), savedEntry);
        writeLeaderboard(mergeLocalLeaderboardEntries(entries, profileEntries));
    }

    async function syncPendingLeaderboardEntries() {
        if (
            state.leaderboardSyncInFlight
            || !REMOTE_LEADERBOARD_ENDPOINT
            || navigator.onLine === false
        ) return { synced: 0, pending: 0 };

        queueLegacyLeaderboardEntries();
        const pendingEntries = readLeaderboard()
            .map(normalizeLeaderboardEntry)
            .filter(entry => entry?.remoteSyncPending)
            .slice(0, 25);
        if (!pendingEntries.length) return { synced: 0, pending: 0 };

        state.leaderboardSyncInFlight = true;
        let synced = 0;
        try {
            for (const pendingEntry of pendingEntries) {
                const alreadySaved = await remoteLeaderboardEntryExists(pendingEntry);
                if (alreadySaved === null) break;
                if (alreadySaved) {
                    markLeaderboardEntrySynced(pendingEntry);
                    synced += 1;
                    continue;
                }

                const result = await writeRemoteLeaderboard(pendingEntry);
                // A conflict needs the player's explicit confirmation, so leave it
                // in the queue instead of replacing somebody else's result.
                if (!result.ok) {
                    // A transport or server failure affects the rest of the queue
                    // as well, so retry it later instead of waiting on every item.
                    if (!result.conflict) break;
                    continue;
                }

                const profileEntries = profileEntriesFromPayload(result.profile);
                markLeaderboardEntrySynced(result.entry || pendingEntry, profileEntries);
                synced += 1;
            }
        } finally {
            state.leaderboardSyncInFlight = false;
        }

        return {
            synced,
            pending: readLeaderboard()
                .map(normalizeLeaderboardEntry)
                .filter(entry => entry?.remoteSyncPending)
                .length
        };
    }

    function profileEntriesFromPayload(profile) {
        return [
            ...(Array.isArray(profile?.dailyEntries) ? profile.dailyEntries : []),
            ...(Array.isArray(profile?.unlimitedEntries) ? profile.unlimitedEntries : [])
        ].map(normalizeLeaderboardEntry).filter(Boolean);
    }

    function confirmLeaderboardReplacement(existing, entry) {
        const label = entry.mode === 'unlimited'
            ? 'цієї варіації'
            : entry.mode === 'poop' ? 'сьогоднішнього режиму 💩' : 'сьогоднішнього пазла';
        const rule = entry.mode === 'daily'
            ? 'Час залишиться з першої спроби. Оновляться тільки очки стилю, якщо вони кращі.'
            : entry.mode === 'poop'
                ? 'У рейтингу залишиться результат першого проходження для цього ніку.'
                : 'Час у рейтингу залишиться з першої спроби для цього ніку.';
        return window.confirm(
            `Нік “${entry.name}” уже є в рейтингу ${label}.\n\n` +
            `Замінити запис для цього ніку?\n${rule}`
        );
    }

    function replacementStatusMessage(result, addedMessage, replacedMessage) {
        if (!result.ok) {
            return result.skipped
                ? 'Результат збережено на цьому пристрої. Глобальний рейтинг ще не підключено.'
                : 'Результат збережено локально. Глобальний рейтинг зараз недоступний.';
        }

        if (!result.replaced) return addedMessage;
        if (result.styleUpdated) return 'Очки стилю оновлено. Час залишився з першої спроби.';
        return result.keptExisting
            ? 'У рейтингу залишився перший результат для цього ніку.'
            : replacedMessage;
    }

    async function saveLeaderboardEntry(entry) {
        let remoteResult = await writeRemoteLeaderboard(entry);

        if (remoteResult.conflict) {
            const confirmed = confirmLeaderboardReplacement(remoteResult.existing || entry, entry);
            if (!confirmed) {
                return { cancelled: true, conflict: true };
            }
            remoteResult = await writeRemoteLeaderboard(entry, { replaceExisting: true });
        }

        if (!remoteResult.ok && !remoteResult.conflict) {
            const existing = findLocalExistingPlayerEntry(readLeaderboard(), entry);
            if (existing && !confirmLeaderboardReplacement(existing, entry)) {
                return { cancelled: true, conflict: true };
            }
        }

        const savedEntry = {
            ...(remoteResult.entry || entry),
            remoteSyncPending: !remoteResult.ok && !remoteResult.conflict
        };
        const profileEntries = profileEntriesFromPayload(remoteResult.profile);
        const replacedEntries = replaceLocalLeaderboardEntry(readLeaderboard(), savedEntry);
        const mergedEntries = mergeLocalLeaderboardEntries(replacedEntries, profileEntries);
        writeLeaderboard(mergedEntries);
        writePlayerName(savedEntry.name || entry.name);

        return {
            ...remoteResult,
            entry: savedEntry,
            entries: mergedEntries
        };
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
        return seconds;
    }

    async function recordDailyName(name) {
        if (!state.pendingDailyEntry) return;
        const cleanName = cleanPlayerName(name);
        const entry = {
            ...state.pendingDailyEntry,
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: cleanName
        };
        const saveResult = await saveLeaderboardEntry(entry);
        if (saveResult.cancelled) {
            els.nameDialogNote.textContent = 'Можеш змінити ім’я або підтвердити заміну існуючого запису.';
            return;
        }
        const savedEntry = saveResult.entry || entry;

        if (state.dailyRecord) {
            state.dailyRecord.nameSubmitted = true;
            state.dailyRecord.entryId = savedEntry.id || entry.id;
            state.dailyRecord.playerName = savedEntry.name || cleanName;
            state.dailyRecord.solvedAt = savedEntry.solvedAt || entry.solvedAt;
            state.dailyRecord.elapsedMs = Math.max(1, Math.round(Number(savedEntry.seconds) || entry.seconds)) * 1000;
            state.dailyRecord.rank = saveResult.rank || findDailyRank(saveResult.entries || readLeaderboard(), savedEntry);
            persistDailyRecord();
        }
        state.pendingDailyEntry = null;
        closeModal();
        setStatus(replacementStatusMessage(
            saveResult,
            'Результат додано в рейтинг.',
            'Запис у рейтингу оновлено за правилом першої спроби.'
        ));
        renderControls();
        if (!state.dailyRecord?.rank) refreshDailyRank(true);
    }

    async function recordPoopName(name) {
        if (!state.pendingPoopEntry) return;
        const cleanName = cleanPlayerName(name);
        const entry = {
            ...state.pendingPoopEntry,
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: cleanName
        };
        const saveResult = await saveLeaderboardEntry(entry);
        if (saveResult.cancelled) {
            els.nameDialogNote.textContent = 'Можеш змінити ім’я або підтвердити заміну існуючого запису.';
            return;
        }
        const savedEntry = saveResult.entry || entry;

        if (state.poopRecord) {
            state.poopRecord.nameSubmitted = true;
            state.poopRecord.entryId = savedEntry.id || entry.id;
            state.poopRecord.playerName = savedEntry.name || cleanName;
            state.poopRecord.solvedAt = savedEntry.solvedAt || entry.solvedAt;
            state.poopRecord.attempts = Math.max(1, Math.round(Number(savedEntry.attempts) || entry.attempts));
            state.poopRecord.rank = saveResult.rank || findPoopRank(saveResult.entries || readLeaderboard(), savedEntry);
            persistPoopRecord();
        }
        state.pendingPoopEntry = null;
        closeModal();
        setStatus(replacementStatusMessage(
            saveResult,
            'Результат додано в рейтинг.',
            'У рейтингу залишився результат першої спроби.'
        ));
    }

    function recordUnlimitedSolve() {
        if (state.solvedRecorded || !state.startedAt) return false;
        const seconds = Math.max(1, Math.round((Date.now() - state.startedAt) / 1000));
        state.pendingUnlimitedEntry = makePendingUnlimitedEntry(seconds);
        state.solvedRecorded = true;
        openNameDialog('unlimited');
        return true;
    }

    async function recordUnlimitedName(name) {
        if (!state.pendingUnlimitedEntry) return;
        const cleanName = cleanPlayerName(name);
        const entry = {
            ...state.pendingUnlimitedEntry,
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: cleanName
        };
        const saveResult = await saveLeaderboardEntry(entry);
        if (saveResult.cancelled) {
            els.nameDialogNote.textContent = 'Можеш змінити ім’я або підтвердити заміну існуючого запису.';
            return;
        }
        state.lastUnlimitedEntry = saveResult.entry || entry;
        state.pendingUnlimitedEntry = null;
        closeModal();
        setStatus(replacementStatusMessage(
            saveResult,
            'Результат додано в рейтинг варіації.',
            'У рейтингу варіації залишився час першої спроби.'
        ));
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

    function isDailyWaitingToStart() {
        if (state.mode !== 'daily' || !state.dailyRecord || state.dailyRecord.solved) return false;
        return !state.dailyRecord.running;
    }

    function startDailyTimer() {
        if (state.mode !== 'daily' || !state.dailyRecord || state.dailyRecord.solved) return;
        const record = state.dailyRecord;
        if (record.running) return;
        record.running = true;
        record.paused = false;
        record.lastStartedAt = Date.now();
        setStatus('Гру розпочато. Таймер уже не зупиняється.');
        persistDailyRecord();
        render();
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

    function isSuspiciousDailyTime(seconds) {
        return Number(seconds) > 0 && Number(seconds) < DAILY_CHEAT_WARNING_SECONDS;
    }

    function dailyCheatWarningText() {
        return 'Попередження: слово дня менш ніж за 1 хвилину виглядає як читерство.';
    }

    function normalizeStyleScore(value) {
        if (value === null || typeof value === 'undefined' || value === '') return null;
        const score = Math.round(Number(value));
        return Number.isFinite(score) ? score : null;
    }

    function scoreStyleWord(word) {
        return Array.from(normalizeWord(word)).reduce((total, letter) => (
            total + (STYLE_LETTER_SCORES.get(letter) || 0)
        ), 0);
    }

    function confirmedStyleWords() {
        return state.rows
            .filter(row => row.locked)
            .map(row => row.letters.join(''))
            .filter(word => UA_WORD_RE.test(word));
    }

    function calculateStyleScore(seconds, invalidAttempts = state.invalidAttempts) {
        const words = confirmedStyleWords();
        const mistakes = Math.max(0, Math.round(Number(invalidAttempts) || 0));
        const wordScore = words.reduce((total, word) => total + scoreStyleWord(word), 0);
        const confirmedWordBonus = words.length * 10;
        const cleanBonus = mistakes === 0 ? 25 : 0;
        const timeBonus = Math.max(0, STYLE_TIME_LIMIT_SECONDS - Math.max(0, Math.round(Number(seconds) || 0)));
        return wordScore + confirmedWordBonus + cleanBonus + timeBonus - (mistakes * 3);
    }

    function formatStyleScore(value) {
        const score = normalizeStyleScore(value);
        return score === null ? '—' : String(score);
    }

    function updateTimerDisplay() {
        if (!els.dailyTimerValue || state.mode !== 'daily' || !state.dailyRecord) return;
        const elapsedSeconds = Math.floor(currentDailyElapsedMs() / 1000);
        const solved = Boolean(state.dailyRecord.solved);
        const waitingToStart = isDailyWaitingToStart();
        els.dailyTimer.classList.toggle('is-solved', solved);
        els.dailyTimer.classList.toggle('is-running', !solved && !waitingToStart);

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

        els.pauseTimerButton.hidden = !waitingToStart;
        els.pauseTimerButton.innerHTML = waitingToStart
            ? '<i class="fas fa-play" aria-hidden="true"></i><span>Почати</span>'
            : '';
        els.pauseTimerButton.setAttribute('aria-label', 'Почати слово дня');
        els.pauseTimerButton.removeAttribute('aria-pressed');

        if (state.dailyRecord.running && !state.dailyRecord.paused && !state.dailyRecord.solved) {
            persistDailyRecord(true);
        }
    }

    function secondsToNextPuzzle() {
        const now = new Date();
        const nextKey = addDays(todayKey(now), 1);
        return Math.max(0, Math.ceil((dailyKeyStartMs(nextKey) - now.getTime()) / 1000));
    }

    function updateNextPuzzleCountdown() {
        if (!els.nextPuzzleCountdown || (state.mode !== 'daily' && state.mode !== 'poop')) return;
        els.nextPuzzleCountdown.textContent = `Наступний пазл через ${formatClock(secondsToNextPuzzle())}`;
    }

    function refreshDailyPuzzleIfNeeded() {
        if (state.mode !== 'daily' && state.mode !== 'poop') return;
        const currentKey = todayKey();
        const currentPuzzleKey = state.mode === 'poop' ? state.poopKey : state.dailyKey;
        if (!currentPuzzleKey) {
            if (state.mode === 'poop') state.poopKey = currentKey;
            else state.dailyKey = currentKey;
            return;
        }
        if (currentPuzzleKey !== currentKey) generatePuzzle();
    }

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
    }

    function cleanAvatarUrl(value) {
        const raw = String(value || '').trim();
        if (!raw || raw.length > 2048) return '';
        try {
            const url = new URL(raw);
            return url.protocol === 'https:' ? url.toString() : '';
        } catch (_) {
            return '';
        }
    }

    function renderLeaderboardRank(index, avatarUrl = '', name = 'Гравець') {
        const rank = index + 1;
        const medals = ['🥇', '🥈', '🥉'];
        const label = `${rank} місце${name ? ` — ${name}` : ''}`;
        const safeAvatarUrl = cleanAvatarUrl(avatarUrl);
        if (safeAvatarUrl) {
            return `<span class="leaderboard-avatar" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><img src="${escapeHtml(safeAvatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`;
        }
        if (medals[index]) {
            return `<span class="leaderboard-rank leaderboard-rank--medal" title="${rank} місце" aria-label="${rank} місце">${medals[index]}</span>`;
        }
        return `<span class="leaderboard-rank">${rank}</span>`;
    }

    function renderLeaderboardList(entries, emptyMessage) {
        return entries.length
            ? `<div class="leaderboard-list">
                ${entries.map((item, index) => `
                    <div class="leaderboard-row">
                        ${renderLeaderboardRank(index, item.avatarUrl, item.name)}
                        <span class="leaderboard-main">
                            <strong>${escapeHtml(item.name || 'Гравець')}</strong>
                        </span>
                        <span class="leaderboard-style" title="Очки стилю" aria-label="Очки стилю: ${escapeHtml(formatStyleScore(item.styleScore))}">
                            <strong>${escapeHtml(formatStyleScore(item.styleScore))}</strong>
                            <span>очки стилю</span>
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

    function renderPoopLeaderboardList(entries, emptyMessage) {
        return entries.length
            ? `<div class="leaderboard-list">
                ${entries.map((item, index) => `
                    <div class="leaderboard-row leaderboard-row--poop">
                        ${renderLeaderboardRank(index, item.avatarUrl, item.name)}
                        <span class="leaderboard-main">
                            <strong>${escapeHtml(item.name || 'Гравець')}</strong>
                        </span>
                        <span class="leaderboard-attempts">
                            <strong>${Math.max(1, Math.round(Number(item.attempts) || 0))}</strong>
                            <span>спроб</span>
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
                        ${renderLeaderboardRank(index, item.avatarUrl, item.name)}
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

        if (state.mode === 'poop') {
            els.leaderboardTitle.textContent = 'Рейтинг режиму 💩';
            els.leaderboardNote.textContent = REMOTE_LEADERBOARD_ENDPOINT
                ? 'Менше спроб — вище місце.'
                : 'Глобальний рейтинг ще не підключено. Поки показано результати цього браузера.';
            els.leaderboardContent.innerHTML = '<p class="leaderboard-empty">Завантаження рейтингу...</p>';

            let result;
            try {
                result = await readRemotePoopLeaderboard();
            } catch (_) {
                result = { source: 'local', entries: localPoopLeaderboard(entries), error: true };
            }

            if (result.error) {
                els.leaderboardNote.textContent = 'Глобальний рейтинг зараз недоступний. Показано результати цього браузера.';
            } else if (result.source === 'local') {
                els.leaderboardNote.textContent = 'Глобальний рейтинг ще не підключено. Поки показано результати цього браузера.';
            }

            els.leaderboardContent.innerHTML = renderPoopLeaderboardList(
                result.entries,
                'Сьогодні ще немає результатів. Дійди до «ГІМНО» і додай своє ім’я.'
            );
            return;
        }

        if (state.mode === 'unlimited') {
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

        els.leaderboardTitle.textContent = 'Сьогоднішній рейтинг';
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
        const profileName = readPlayerName();
        const statsEntries = uniqueLeaderboardEntries(entries)
            .filter(item => !profileName || samePlayerName(item.name, profileName));
        const dailyEntries = statsEntries.filter(item => item.mode === 'daily');
        const solvedDates = Array.from(new Set(dailyEntries.map(item => item.dateKey))).sort();
        const dailySeconds = dailyEntries.map(item => Number(item.seconds)).filter(Number.isFinite);
        const fastest = dailySeconds.length ? Math.min(...dailySeconds) : 0;

        const unlimitedEasy = countUnlimited(statsEntries, 'easy');
        const unlimitedNormal = countUnlimited(statsEntries, 'normal');
        const unlimitedHard = countUnlimited(statsEntries, 'hard');
        const statsTitle = profileName
            ? `Особиста статистика · ${profileName}`
            : 'Статистика цього браузера';

        return `
            <div class="leaderboard-section-title">${escapeHtml(statsTitle)}</div>
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
        if (state.mode === 'poop') {
            els.helpContent.innerHTML = `
                <h2 id="helpTitle">Режим 💩</h2>
                <p>Почни з показаного слова й дійди до <strong>ГІМНО</strong>.</p>
                <p>Кожна наступна спроба має бути словом зі словника і відрізнятися від попередньої рівно однією літерою.</p>
                <p>Літери, що вже стоять на своїх місцях як у «ГІМНО», стають коричневими. Інших підказок і кольорів немає.</p>
                <p>У рейтингу перемагає той, хто дійде за найменшу кількість прийнятих спроб.</p>
            `;
            els.helpNav.innerHTML = '<button class="modal-link" type="button" data-help-action="start">Зрозуміло</button>';
            return;
        }
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
        window.KobzaTelegram?.setBackButtonVisible(dialog !== els.nameDialog);
        requestAnimationFrame(() => dialog.querySelector('.unwordle-modal__panel')?.focus({ preventScroll: true }));
    }

    function closeModal() {
        if (!state.activeModal) return;
        state.activeModal.hidden = true;
        state.activeModal = null;
        window.KobzaTelegram?.setBackButtonVisible(false);
    }

    function openNameDialog(kind = 'daily') {
        state.nameDialogKind = kind;
        const telegramName = window.KobzaTelegram?.getPlayerName?.();
        if (window.KobzaTelegram?.getInitData?.() && telegramName) {
            if (kind === 'unlimited') void recordUnlimitedName(telegramName);
            else if (kind === 'poop') void recordPoopName(telegramName);
            else void recordDailyName(telegramName);
            return;
        }
        els.playerName.value = readPlayerName();
        if (kind === 'unlimited') {
            els.nameDialogNote.textContent = 'Введи ім’я для рейтингу цієї варіації.';
        } else if (kind === 'poop') {
            els.nameDialogNote.textContent = 'Введи ім’я для щоденного рейтингу режиму 💩.';
        } else if (isSuspiciousDailyTime(state.pendingDailyEntry?.seconds)) {
            els.nameDialogNote.textContent = `${dailyCheatWarningText()} Якщо все чесно, збережи результат.`;
        } else {
            els.nameDialogNote.textContent = 'Введи ім’я для щоденного рейтингу.';
        }
        openModal(els.nameDialog);
        requestAnimationFrame(() => els.playerName.focus({ preventScroll: true }));
    }

    function currentShareText() {
        if (state.mode === 'poop') {
            const attempts = Number(state.poopRecord?.attempts || state.pendingPoopEntry?.attempts || 0);
            if (state.locked && attempts > 0) {
                return `Я дійшов до ГІМНО за ${attempts} спроб у режимі 💩, зможеш краще?`;
            }
            return 'Спробуй режим 💩 у КОБЗА-НАВПАКИ.';
        }

        if (state.mode === 'daily') {
            if (state.dailyRecord?.solved) {
                const seconds = Math.max(1, Math.round(currentDailyElapsedMs() / 1000));
                return `Я розв’язав слово дня за ${formatClock(seconds)}, зможеш краще?`;
            }
            return 'Спробуй слово дня в КОБЗА-НАВПАКИ.';
        }

        const seconds = Number(state.lastUnlimitedEntry?.seconds || state.pendingUnlimitedEntry?.seconds || 0);
        if (state.locked && seconds > 0) {
            return `Я розв’язав варіацію КОБЗА-НАВПАКИ за ${formatClock(seconds)}, зможеш краще?`;
        }
        return 'Спробуй цю варіацію КОБЗА-НАВПАКИ.';
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
        const shareText = currentShareText();
        const url = state.mode === 'poop'
            ? shareGameUrl({ mode: 'poop' })
            : state.mode === 'daily'
                ? shareGameUrl({ mode: 'daily' })
                : shareGameUrl({ mode: 'unlimited' });
        const shareMessage = [shareText, url].filter(Boolean).join('\n');

        if (window.KobzaTelegram?.share(shareText, url)) {
            window.KobzaTelegram?.haptic('light');
            return;
        }

        try {
            if (navigator.share) {
                await navigator.share({ title: 'КОБЗА-НАВПАКИ', text: shareMessage });
                setStatus('Гра готова до поширення.');
            } else {
                await copyText(shareMessage);
                setStatus('Текст для поширення скопійовано.');
            }
            window.setTimeout(() => {
                if (['Текст для поширення скопійовано.', 'Гра готова до поширення.'].includes(els.status?.textContent)) setStatus('');
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
            if (!tile || state.locked || isDailyWaitingToStart()) return;
            const rowIndex = Number(tile.dataset.row);
            const colIndex = Number(tile.dataset.col);
            if (!Number.isInteger(rowIndex) || !Number.isInteger(colIndex)) return;
            if (state.rows[rowIndex]?.locked) return;
            state.activeRow = rowIndex;
            state.activeCol = colIndex;
            render();
        });

        document.addEventListener('keydown', handlePhysicalKey);

        els.solveButton.addEventListener('click', () => {
            void requestPaidHint();
        });
        els.newPuzzleButton.addEventListener('click', () => {
            state.puzzleNumber += 1;
            state.varietyId = makeVarietyId();
            generatePuzzle();
        });
        els.restartPoopButton.addEventListener('click', restartPoopPuzzle);
        els.pauseTimerButton.addEventListener('click', startDailyTimer);

        document.querySelectorAll('.mode-tab').forEach(button => {
            button.addEventListener('click', () => {
                if (state.mode === button.dataset.mode) return;
                if (state.mode === 'daily') persistDailyRecord(true);
                if (state.mode === 'poop') persistPoopRecord();
                state.mode = button.dataset.mode;
                window.KobzaTelegram?.haptic('selection');
                if (state.mode === 'unlimited') state.varietyId = state.varietyId || makeVarietyId();
                generatePuzzle();
            });
        });

        document.querySelectorAll('.difficulty-tab').forEach(button => {
            button.addEventListener('click', () => {
                if (state.mode !== 'unlimited') return;
                state.difficulty = button.dataset.difficulty;
                window.KobzaTelegram?.haptic('selection');
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

        els.leaderboardButton.addEventListener('click', async () => {
            await syncPendingLeaderboardEntries();
            await renderLeaderboard();
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

        els.nameForm.addEventListener('submit', event => {
            event.preventDefault();
            if (state.nameDialogKind === 'unlimited') recordUnlimitedName(els.playerName.value);
            else if (state.nameDialogKind === 'poop') recordPoopName(els.playerName.value);
            else recordDailyName(els.playerName.value);
        });

        els.skipNameButton.addEventListener('click', () => {
            if (state.nameDialogKind === 'unlimited') recordUnlimitedName('Гравець');
            else if (state.nameDialogKind === 'poop') recordPoopName('Гравець');
            else recordDailyName('Гравець');
        });

        window.addEventListener('beforeunload', () => {
            persistDailyRecord(true);
            persistPoopRecord();
        });
        window.addEventListener('online', () => {
            void syncPendingLeaderboardEntries();
        });
    }

    function cacheElements() {
        els.card = document.querySelector('.unwordle-card');
        els.grid = document.getElementById('gameGrid');
        els.keyboard = document.getElementById('keyboard');
        els.status = document.getElementById('gameStatus');
        els.difficultyTabs = document.querySelector('.difficulty-tabs');
        els.solveButton = document.getElementById('solveButton');
        els.newPuzzleButton = document.getElementById('newPuzzleButton');
        els.restartPoopButton = document.getElementById('restartPoopButton');
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
        els.nameDialog = document.getElementById('nameDialog');
        els.nameDialogNote = document.getElementById('nameDialogNote');
        els.nameForm = document.getElementById('nameForm');
        els.playerName = document.getElementById('playerName');
        els.skipNameButton = document.getElementById('skipNameButton');
    }

    function startIntervals() {
        window.setInterval(() => {
            refreshDailyPuzzleIfNeeded();
            updateTimerDisplay();
            updateNextPuzzleCountdown();
        }, 1000);
    }

    async function init() {
        const telegramSession = await window.KobzaTelegram?.init({
            cloudKeys: [
                { cloudKey: CLOUD_DAILY_STATE_KEY, localKey: DAILY_STATE_KEY },
                { cloudKey: CLOUD_POOP_STATE_KEY, localKey: POOP_STATE_KEY },
                { cloudKey: CLOUD_PLAYER_NAME_KEY, localKey: PLAYER_NAME_KEY }
            ]
        });
        cacheElements();
        bindEvents();
        if (telegramSession?.telegram && !telegramSession.cloudStorage?.ok) {
            setStatus('Хмарне сховище Telegram недоступне. Оновіть Telegram і відкрийте гру знову.');
            return;
        }
        const telegramPlayerName = window.KobzaTelegram?.getPlayerName();
        if (telegramPlayerName && !readPlayerName()) writePlayerName(telegramPlayerName);
        window.KobzaTelegram?.setBackHandler(() => {
            if (state.activeModal && state.activeModal !== els.nameDialog) closeModal();
        });
        renderKeyboard();
        await loadWords();
        void syncPendingLeaderboardEntries();

        consumeDailyResetFlag();
        const telegramSharedGame = telegramLaunch();
        const sharedVariety = telegramSharedGame?.mode === 'unlimited'
            ? telegramSharedGame.varietyId
            : readUrlVariation();
        if (sharedVariety) {
            state.mode = 'unlimited';
            state.difficulty = telegramSharedGame?.difficulty || readUrlDifficulty();
            state.varietyId = sharedVariety;
            generatePuzzle();
            startIntervals();
            return;
        }

        if (telegramSharedGame?.mode === 'poop' || readUrlMode() === 'poop') {
            state.mode = 'poop';
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
