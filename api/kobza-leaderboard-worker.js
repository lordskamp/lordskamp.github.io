const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
};

const NAME_LIMIT = 24;
const MAX_SECONDS = 24 * 60 * 60;
const MAX_POOP_ATTEMPTS = 500;
const MAX_ABS_STYLE_SCORE = 10000;
const MAX_STORED_ENTRIES = 500;
const MAX_UNLIMITED_STORED_ENTRIES = 5000;
const MAX_PROFILE_ENTRIES = 1000;
const MAX_PROFILE_SCAN_KEYS = 1000;
const ENTRY_TTL_SECONDS = 60 * 60 * 24 * 35;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const UNLIMITED_AGGREGATE_KEY = 'unlimited:aggregate';
const PROFILE_KEY_PREFIX = 'profile:';
const UA_WORD_RE = /^[а-щьюяєіїґ]{5}$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VARIETY_RE = /^\d{8,18}$/;
const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
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

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8'
        }
    });
}

function normalizeWord(value) {
    return String(value || '')
        .trim()
        .toLocaleLowerCase('uk-UA')
        .replace(/['ʼ`’]/g, '');
}

function cleanName(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, NAME_LIMIT) || 'Гравець';
}

function playerNameKey(value) {
    return cleanName(value).toLocaleLowerCase('uk-UA');
}

function samePlayerName(a, b) {
    return playerNameKey(a) === playerNameKey(b);
}

function cleanDifficulty(value) {
    const difficulty = String(value || 'normal');
    return DIFFICULTIES.has(difficulty) ? difficulty : 'normal';
}

function cleanStyleScore(value) {
    if (value === null || typeof value === 'undefined' || value === '') return null;
    const score = Math.round(Number(value));
    if (!Number.isFinite(score) || Math.abs(score) > MAX_ABS_STYLE_SCORE) return null;
    return score;
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

function poopStartWordForDate(dateKey) {
    const rng = mulberry32(hashString(`poop:v1:${dateKey}`));
    return POOP_START_WORDS[Math.floor(rng() * POOP_START_WORDS.length)];
}

function leaderboardKeyFor(mode, params) {
    if (mode === 'unlimited') {
        return `unlimited:${params.difficulty}:${params.variation}`;
    }

    if (mode === 'poop') {
        return `poop:${params.dateKey}:${params.startWord}:${params.target}`;
    }

    return `daily:${params.dateKey}:${params.target}`;
}

function matchesLeaderboard(entry, mode, params) {
    if (entry.mode !== mode) return false;
    if (mode === 'unlimited') {
        return entry.difficulty === params.difficulty && entry.variation === params.variation;
    }

    if (mode === 'poop') {
        return entry.dateKey === params.dateKey
            && entry.target === params.target
            && entry.startWord === params.startWord;
    }

    return entry.dateKey === params.dateKey && entry.target === params.target;
}

function normalizeEntry(item) {
    const mode = item?.mode === 'unlimited'
        ? 'unlimited'
        : item?.mode === 'poop' ? 'poop' : 'daily';
    const difficulty = mode === 'unlimited' ? cleanDifficulty(item?.difficulty) : 'normal';
    const dateKey = String(item?.dateKey || new Date().toISOString().slice(0, 10));
    const target = normalizeWord(item?.target);
    const startWord = normalizeWord(item?.startWord);
    const variation = String(item?.variation || '').trim();
    const seconds = Math.round(Number(item?.seconds));
    const attempts = Math.round(Number(item?.attempts));
    const styleScore = mode === 'daily' ? cleanStyleScore(item?.styleScore) : null;

    if (mode !== 'poop' && (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_SECONDS)) return null;
    if (mode === 'poop' && (!Number.isFinite(attempts) || attempts < 1 || attempts > MAX_POOP_ATTEMPTS)) return null;
    if (!DATE_RE.test(dateKey)) return null;
    if (!UA_WORD_RE.test(target)) return null;
    if (mode === 'unlimited' && !VARIETY_RE.test(variation)) return null;
    if (mode === 'poop' && (target !== POOP_TARGET || startWord !== poopStartWordForDate(dateKey))) return null;

    return {
        id: item?.id || crypto.randomUUID(),
        mode,
        difficulty,
        dateKey,
        target,
        startWord: mode === 'poop' ? startWord : '',
        variation: mode === 'unlimited' ? variation : '',
        name: cleanName(item?.name),
        seconds: mode === 'poop' ? 0 : seconds,
        attempts: mode === 'poop' ? attempts : null,
        styleScore,
        solvedAt: item?.solvedAt || new Date().toISOString()
    };
}

function isInternalTestEntry(entry) {
    return entry.name.toLocaleLowerCase('uk-UA').startsWith('codex ');
}

async function readEntries(env, mode, params) {
    const raw = await env.KOBZA_LEADERBOARD.get(leaderboardKeyFor(mode, params));
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed
                .map(normalizeEntry)
                .filter(Boolean)
                .filter(entry => matchesLeaderboard(entry, mode, params))
            : [];
    } catch (_) {
        return [];
    }
}

async function readUnlimitedEntries(env) {
    const raw = await env.KOBZA_LEADERBOARD.get(UNLIMITED_AGGREGATE_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed
                .map(normalizeEntry)
                .filter(Boolean)
                .filter(entry => entry.mode === 'unlimited')
                .filter(entry => !isInternalTestEntry(entry))
            : [];
    } catch (_) {
        return [];
    }
}

function styleSortValue(entry) {
    const score = cleanStyleScore(entry?.styleScore);
    return score === null ? Number.NEGATIVE_INFINITY : score;
}

function compareEntries(a, b) {
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

function sortEntries(entries) {
    return entries.slice().sort(compareEntries);
}

function firstSubmittedEntry(a, b) {
    const solvedAtCompare = String(a.solvedAt).localeCompare(String(b.solvedAt));
    if (solvedAtCompare < 0) return a;
    if (solvedAtCompare > 0) return b;
    return String(a.id).localeCompare(String(b.id)) <= 0 ? a : b;
}

function bestStyleScore(entries) {
    const scores = entries
        .map(entry => cleanStyleScore(entry?.styleScore))
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
    const currentScore = cleanStyleScore(first.styleScore);
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

function sameLeaderboardPlayer(a, b) {
    if (!a || !b || a.mode !== b.mode || !samePlayerName(a.name, b.name)) return false;
    if (a.mode === 'unlimited') {
        return a.difficulty === b.difficulty && a.variation === b.variation;
    }

    if (a.mode === 'poop') {
        return a.dateKey === b.dateKey
            && a.target === b.target
            && a.startWord === b.startWord;
    }

    return a.dateKey === b.dateKey && a.target === b.target;
}

function mergeLeaderboardEntry(entries, entry, { allowReplace = false } = {}) {
    const matches = [];
    const others = [];

    entries.forEach(item => {
        if (sameLeaderboardPlayer(item, entry)) matches.push(item);
        else others.push(item);
    });

    if (!matches.length) {
        return {
            entries: [...others, entry],
            entry,
            hadExisting: false,
            keptExisting: false
        };
    }

    const first = matches.reduce((oldest, item) => firstSubmittedEntry(oldest, item));
    const merged = mergeWithFirstAttempt(first, [...matches, entry]);

    if (!allowReplace) {
        return {
            conflict: true,
            existing: first,
            incoming: entry,
            entry: merged.entry,
            styleUpdated: merged.styleUpdated
        };
    }

    return {
        entries: [...others, merged.entry],
        entry: merged.entry,
        hadExisting: true,
        keptExisting: merged.keptExisting,
        styleUpdated: merged.styleUpdated
    };
}

function unlimitedKey(entry) {
    return `${entry.name.toLocaleLowerCase('uk-UA')}|${entry.difficulty}|${entry.variation}`;
}

function upsertUnlimitedEntry(entries, entry) {
    const byPuzzle = new Map();
    entries.forEach(item => {
        if (item.mode !== 'unlimited') return;
        const key = unlimitedKey(item);
        byPuzzle.set(key, byPuzzle.has(key) ? firstSubmittedEntry(byPuzzle.get(key), item) : item);
    });

    const key = unlimitedKey(entry);
    byPuzzle.set(key, byPuzzle.has(key) ? firstSubmittedEntry(byPuzzle.get(key), entry) : entry);

    return Array.from(byPuzzle.values())
        .sort((a, b) => String(b.solvedAt).localeCompare(String(a.solvedAt)))
        .slice(0, MAX_UNLIMITED_STORED_ENTRIES);
}

function playerProfileKey(name) {
    return `${PROFILE_KEY_PREFIX}${encodeURIComponent(playerNameKey(name))}`;
}

function profileEntryKey(entry) {
    if (entry.mode === 'unlimited') {
        return `unlimited:${entry.difficulty}:${entry.variation}`;
    }

    if (entry.mode === 'poop') {
        return `poop:${entry.dateKey}:${entry.startWord}:${entry.target}`;
    }

    return `daily:${entry.dateKey}:${entry.target}`;
}

function uniquePlayerEntries(entries, name) {
    const key = playerNameKey(name);
    const byPuzzle = new Map();

    entries
        .map(normalizeEntry)
        .filter(Boolean)
        .filter(entry => playerNameKey(entry.name) === key)
        .forEach(entry => {
            const puzzleKey = profileEntryKey(entry);
            byPuzzle.set(puzzleKey, [...(byPuzzle.get(puzzleKey) || []), entry]);
        });

    return Array.from(byPuzzle.values()).map(items => {
        const first = items.reduce((oldest, item) => firstSubmittedEntry(oldest, item));
        return mergeWithFirstAttempt(first, items).entry;
    });
}

async function readPlayerProfileEntries(env, name) {
    const raw = await env.KOBZA_LEADERBOARD.get(playerProfileKey(name));
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(normalizeEntry).filter(Boolean) : [];
    } catch (_) {
        return [];
    }
}

async function scanDailyEntriesForName(env, name) {
    if (typeof env.KOBZA_LEADERBOARD.list !== 'function') return [];

    const nameKey = playerNameKey(name);
    const found = [];
    let cursor = undefined;
    let scanned = 0;

    do {
        const options = { prefix: 'daily:', limit: 100 };
        if (cursor) options.cursor = cursor;

        const page = await env.KOBZA_LEADERBOARD.list(options);
        const keys = Array.isArray(page?.keys)
            ? page.keys.map(item => item?.name).filter(Boolean)
            : [];
        scanned += keys.length;

        const values = await Promise.all(keys.map(key => env.KOBZA_LEADERBOARD.get(key)));
        values.forEach(raw => {
            if (!raw) return;
            try {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return;
                parsed
                    .map(normalizeEntry)
                    .filter(Boolean)
                    .filter(entry => entry.mode === 'daily' && playerNameKey(entry.name) === nameKey)
                    .forEach(entry => found.push(entry));
            } catch (_) {
                /* Ignore malformed historical leaderboard chunks. */
            }
        });

        cursor = page?.cursor;
        if (page?.list_complete !== false) break;
    } while (cursor && scanned < MAX_PROFILE_SCAN_KEYS);

    return found;
}

function buildPlayerProfile(name, entries) {
    const clean = cleanName(name);
    const unique = uniquePlayerEntries(entries, clean);
    const dailyEntries = unique
        .filter(entry => entry.mode === 'daily')
        .sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)) || compareEntries(a, b))
        .slice(0, MAX_PROFILE_ENTRIES);
    const unlimitedEntries = unique
        .filter(entry => entry.mode === 'unlimited')
        .sort((a, b) => String(b.solvedAt).localeCompare(String(a.solvedAt)))
        .slice(0, MAX_PROFILE_ENTRIES);
    const dailySeconds = dailyEntries.map(entry => Number(entry.seconds)).filter(Number.isFinite);
    const unlimited = unlimitedEntries.reduce((total, entry) => {
        total.total += 1;
        total[entry.difficulty] += 1;
        return total;
    }, { total: 0, easy: 0, normal: 0, hard: 0 });

    return {
        name: clean,
        dailyEntries,
        unlimitedEntries,
        daily: {
            solved: dailyEntries.length,
            fastestSeconds: dailySeconds.length ? Math.min(...dailySeconds) : 0
        },
        unlimited
    };
}

async function readPlayerProfile(env, name, extraEntries = []) {
    const clean = cleanName(name);
    const [storedEntries, unlimitedEntries, dailyEntries] = await Promise.all([
        readPlayerProfileEntries(env, clean),
        readUnlimitedEntries(env),
        scanDailyEntriesForName(env, clean)
    ]);
    const profile = buildPlayerProfile(clean, [
        ...storedEntries,
        ...unlimitedEntries,
        ...dailyEntries,
        ...extraEntries
    ]);

    await env.KOBZA_LEADERBOARD.put(
        playerProfileKey(clean),
        JSON.stringify([...profile.dailyEntries, ...profile.unlimitedEntries].slice(0, MAX_PROFILE_ENTRIES))
    );

    return profile;
}

function summarizeUnlimited(entries, sinceMs = 0) {
    const players = new Map();
    entries.forEach(entry => {
        const solvedAt = new Date(entry.solvedAt).getTime();
        if (sinceMs && (!Number.isFinite(solvedAt) || solvedAt < sinceMs)) return;

        const key = entry.name.toLocaleLowerCase('uk-UA');
        const player = players.get(key) || {
            name: entry.name,
            total: 0,
            easy: 0,
            normal: 0,
            hard: 0,
            latestSolvedAt: ''
        };
        player.total += 1;
        player[entry.difficulty] += 1;
        if (!player.latestSolvedAt || String(entry.solvedAt).localeCompare(player.latestSolvedAt) > 0) {
            player.latestSolvedAt = entry.solvedAt;
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
        .slice(0, 3)
        .map(({ latestSolvedAt, ...item }) => item);
}

function unlimitedSummary(entries) {
    const now = Date.now();
    return {
        weekly: summarizeUnlimited(entries, now - WEEK_MS),
        allTime: summarizeUnlimited(entries)
    };
}

function readQueryParams(url) {
    const requestedMode = url.searchParams.get('mode');
    const mode = requestedMode === 'unlimited'
        ? 'unlimited'
        : requestedMode === 'poop' ? 'poop' : 'daily';

    if (mode === 'unlimited') {
        const difficulty = cleanDifficulty(url.searchParams.get('difficulty'));
        const variation = String(url.searchParams.get('variation') || '').trim();
        if (!variation) return { mode, params: { aggregate: true } };
        if (!VARIETY_RE.test(variation)) return null;
        return { mode, params: { difficulty, variation } };
    }

    const dateKey = String(url.searchParams.get('dateKey') || '');
    const target = normalizeWord(url.searchParams.get('target'));
    if (!DATE_RE.test(dateKey) || !UA_WORD_RE.test(target)) return null;

    if (mode === 'poop') {
        const startWord = normalizeWord(url.searchParams.get('startWord'));
        if (target !== POOP_TARGET || startWord !== poopStartWordForDate(dateKey)) return null;
        return { mode, params: { dateKey, target, startWord } };
    }

    return { mode, params: { dateKey, target } };
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        if (!env.KOBZA_LEADERBOARD) {
            return json({ error: 'KOBZA_LEADERBOARD KV binding is missing.' }, 500);
        }

        const url = new URL(request.url);

        if (request.method === 'GET') {
            const profileName = url.searchParams.get('profileName');
            if (profileName) {
                return json({
                    profile: await readPlayerProfile(env, profileName)
                });
            }

            const query = readQueryParams(url);
            if (!query) return json({ error: 'Invalid leaderboard query.' }, 400);

            if (query.mode === 'unlimited' && query.params.aggregate) {
                return json(unlimitedSummary(await readUnlimitedEntries(env)));
            }

            const entryId = String(url.searchParams.get('entryId') || '');
            const entries = sortEntries(await readEntries(env, query.mode, query.params));
            const rankIndex = entryId
                ? entries.findIndex(entry => entry.id === entryId)
                : -1;
            return json({
                entries: entries.slice(0, 10),
                rank: rankIndex === -1 ? null : rankIndex + 1
            });
        }

        if (request.method === 'POST') {
            let body;
            try {
                body = await request.json();
            } catch (_) {
                return json({ error: 'Invalid JSON body.' }, 400);
            }

            const entry = normalizeEntry(body);
            if (!entry) return json({ error: 'Invalid leaderboard entry.' }, 400);
            const allowReplace = body?.replaceExisting === true;

            if (entry.mode === 'unlimited') {
                const params = { difficulty: entry.difficulty, variation: entry.variation };
                const variationEntries = await readEntries(env, entry.mode, params);
                const merged = mergeLeaderboardEntry(variationEntries, entry, { allowReplace });
                if (merged.conflict) {
                    return json({
                        error: 'PLAYER_EXISTS',
                        conflict: true,
                        existing: merged.existing,
                        incoming: merged.incoming,
                        entry: merged.entry,
                        styleUpdated: Boolean(merged.styleUpdated)
                    }, 409);
                }

                const savedEntry = merged.entry;
                const sortedVariationEntries = sortEntries(merged.entries).slice(0, MAX_STORED_ENTRIES);
                const unlimitedEntries = upsertUnlimitedEntry(await readUnlimitedEntries(env), savedEntry);
                const rankIndex = summarizeUnlimited(unlimitedEntries).findIndex(item => (
                    samePlayerName(item.name, savedEntry.name)
                ));

                await Promise.all([
                    env.KOBZA_LEADERBOARD.put(
                        leaderboardKeyFor(entry.mode, params),
                        JSON.stringify(sortedVariationEntries),
                        { expirationTtl: ENTRY_TTL_SECONDS }
                    ),
                    env.KOBZA_LEADERBOARD.put(
                        UNLIMITED_AGGREGATE_KEY,
                        JSON.stringify(unlimitedEntries)
                    )
                ]);

                return json({
                    ok: true,
                    entry: savedEntry,
                    rank: rankIndex === -1 ? null : rankIndex + 1,
                    replaced: Boolean(merged.hadExisting),
                    keptExisting: Boolean(merged.keptExisting),
                    styleUpdated: Boolean(merged.styleUpdated),
                    profile: await readPlayerProfile(env, savedEntry.name, [savedEntry]),
                    ...unlimitedSummary(unlimitedEntries)
                });
            }

            const params = entry.mode === 'poop'
                ? { dateKey: entry.dateKey, target: entry.target, startWord: entry.startWord }
                : { dateKey: entry.dateKey, target: entry.target };
            const entries = await readEntries(env, entry.mode, params);
            const merged = mergeLeaderboardEntry(entries, entry, { allowReplace });
            if (merged.conflict) {
                return json({
                    error: 'PLAYER_EXISTS',
                    conflict: true,
                    existing: merged.existing,
                    incoming: merged.incoming,
                    entry: merged.entry,
                    styleUpdated: Boolean(merged.styleUpdated)
                }, 409);
            }

            const savedEntry = merged.entry;
            const sortedEntries = sortEntries(merged.entries).slice(0, MAX_STORED_ENTRIES);
            const rankIndex = sortedEntries.findIndex(item => item.id === savedEntry.id);

            await env.KOBZA_LEADERBOARD.put(
                leaderboardKeyFor(entry.mode, params),
                JSON.stringify(sortedEntries),
                { expirationTtl: ENTRY_TTL_SECONDS }
            );

            return json({
                ok: true,
                entry: savedEntry,
                rank: rankIndex === -1 ? null : rankIndex + 1,
                replaced: Boolean(merged.hadExisting),
                keptExisting: Boolean(merged.keptExisting),
                styleUpdated: Boolean(merged.styleUpdated),
                profile: await readPlayerProfile(env, savedEntry.name, [savedEntry])
            });
        }

        return json({ error: 'Method not allowed.' }, 405);
    }
};
