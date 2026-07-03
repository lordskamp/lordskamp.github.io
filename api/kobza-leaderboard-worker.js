const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
};

const NAME_LIMIT = 24;
const MAX_SECONDS = 24 * 60 * 60;
const MAX_STORED_ENTRIES = 500;
const MAX_UNLIMITED_STORED_ENTRIES = 5000;
const ENTRY_TTL_SECONDS = 60 * 60 * 24 * 35;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const UNLIMITED_AGGREGATE_KEY = 'unlimited:aggregate';
const UA_WORD_RE = /^[а-щьюяєіїґ]{5}$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VARIETY_RE = /^\d{8,18}$/;
const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);

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

function cleanDifficulty(value) {
    const difficulty = String(value || 'normal');
    return DIFFICULTIES.has(difficulty) ? difficulty : 'normal';
}

function leaderboardKeyFor(mode, params) {
    if (mode === 'unlimited') {
        return `unlimited:${params.difficulty}:${params.variation}`;
    }

    return `daily:${params.dateKey}:${params.target}`;
}

function matchesLeaderboard(entry, mode, params) {
    if (entry.mode !== mode) return false;
    if (mode === 'unlimited') {
        return entry.difficulty === params.difficulty && entry.variation === params.variation;
    }

    return entry.dateKey === params.dateKey && entry.target === params.target;
}

function normalizeEntry(item) {
    const mode = item?.mode === 'unlimited' ? 'unlimited' : 'daily';
    const difficulty = mode === 'unlimited' ? cleanDifficulty(item?.difficulty) : 'normal';
    const dateKey = String(item?.dateKey || new Date().toISOString().slice(0, 10));
    const target = normalizeWord(item?.target);
    const variation = String(item?.variation || '').trim();
    const seconds = Math.round(Number(item?.seconds));

    if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_SECONDS) return null;
    if (!DATE_RE.test(dateKey)) return null;
    if (!UA_WORD_RE.test(target)) return null;
    if (mode === 'unlimited' && !VARIETY_RE.test(variation)) return null;

    return {
        id: item?.id || crypto.randomUUID(),
        mode,
        difficulty,
        dateKey,
        target,
        variation: mode === 'unlimited' ? variation : '',
        name: cleanName(item?.name),
        seconds,
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

function sortEntries(entries) {
    return entries
        .slice()
        .sort((a, b) => a.seconds - b.seconds || String(a.solvedAt).localeCompare(String(b.solvedAt)));
}

function unlimitedKey(entry) {
    return `${entry.name.toLocaleLowerCase('uk-UA')}|${entry.difficulty}|${entry.variation}`;
}

function upsertUnlimitedEntry(entries, entry) {
    const byPuzzle = new Map();
    entries.forEach(item => {
        if (item.mode === 'unlimited') byPuzzle.set(unlimitedKey(item), item);
    });
    const key = unlimitedKey(entry);
    if (!byPuzzle.has(key)) byPuzzle.set(key, entry);
    return Array.from(byPuzzle.values())
        .sort((a, b) => String(b.solvedAt).localeCompare(String(a.solvedAt)))
        .slice(0, MAX_UNLIMITED_STORED_ENTRIES);
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
    const mode = url.searchParams.get('mode') === 'unlimited' ? 'unlimited' : 'daily';

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

            if (entry.mode === 'unlimited') {
                const params = { difficulty: entry.difficulty, variation: entry.variation };
                const variationEntries = await readEntries(env, entry.mode, params);
                const sortedVariationEntries = sortEntries([...variationEntries, entry]).slice(0, MAX_STORED_ENTRIES);
                const unlimitedEntries = upsertUnlimitedEntry(await readUnlimitedEntries(env), entry);
                const rankIndex = summarizeUnlimited(unlimitedEntries).findIndex(item => (
                    item.name.toLocaleLowerCase('uk-UA') === entry.name.toLocaleLowerCase('uk-UA')
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
                    entry,
                    rank: rankIndex === -1 ? null : rankIndex + 1,
                    ...unlimitedSummary(unlimitedEntries)
                });
            }

            const params = { dateKey: entry.dateKey, target: entry.target };
            const entries = await readEntries(env, entry.mode, params);
            entries.push(entry);

            const sortedEntries = sortEntries(entries).slice(0, MAX_STORED_ENTRIES);
            const rankIndex = sortedEntries.findIndex(item => item.id === entry.id);

            await env.KOBZA_LEADERBOARD.put(
                leaderboardKeyFor(entry.mode, params),
                JSON.stringify(sortedEntries),
                { expirationTtl: ENTRY_TTL_SECONDS }
            );

            return json({
                ok: true,
                entry,
                rank: rankIndex === -1 ? null : rankIndex + 1
            });
        }

        return json({ error: 'Method not allowed.' }, 405);
    }
};
