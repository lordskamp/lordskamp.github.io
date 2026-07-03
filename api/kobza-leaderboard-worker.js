const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
};

const NAME_LIMIT = 24;
const MAX_SECONDS = 24 * 60 * 60;
const MAX_STORED_ENTRIES = 500;
const ENTRY_TTL_SECONDS = 60 * 60 * 24 * 35;
const UA_WORD_RE = /^[а-щьюяєіїґ]{5}$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function leaderboardKey(dateKey, target) {
    return `daily:${dateKey}:${target}`;
}

function normalizeEntry(item) {
    const dateKey = String(item?.dateKey || '');
    const target = normalizeWord(item?.target);
    const seconds = Math.round(Number(item?.seconds));

    if (!DATE_RE.test(dateKey)) return null;
    if (!UA_WORD_RE.test(target)) return null;
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_SECONDS) return null;

    return {
        id: item?.id || crypto.randomUUID(),
        mode: 'daily',
        difficulty: 'normal',
        dateKey,
        target,
        name: cleanName(item?.name),
        seconds,
        solvedAt: item?.solvedAt || new Date().toISOString()
    };
}

async function readEntries(env, dateKey, target) {
    const raw = await env.KOBZA_LEADERBOARD.get(leaderboardKey(dateKey, target));
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(normalizeEntry).filter(Boolean) : [];
    } catch (_) {
        return [];
    }
}

function sortEntries(entries) {
    return entries
        .slice()
        .sort((a, b) => a.seconds - b.seconds || String(a.solvedAt).localeCompare(String(b.solvedAt)));
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
            const dateKey = String(url.searchParams.get('dateKey') || '');
            const target = normalizeWord(url.searchParams.get('target'));
            if (!DATE_RE.test(dateKey) || !UA_WORD_RE.test(target)) {
                return json({ error: 'Invalid leaderboard query.' }, 400);
            }

            const entries = sortEntries(await readEntries(env, dateKey, target)).slice(0, 10);
            return json({ entries });
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

            const entries = await readEntries(env, entry.dateKey, entry.target);
            entries.push(entry);

            await env.KOBZA_LEADERBOARD.put(
                leaderboardKey(entry.dateKey, entry.target),
                JSON.stringify(sortEntries(entries).slice(0, MAX_STORED_ENTRIES)),
                { expirationTtl: ENTRY_TTL_SECONDS }
            );

            return json({ ok: true, entry });
        }

        return json({ error: 'Method not allowed.' }, 405);
    }
};
