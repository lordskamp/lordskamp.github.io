import { compareTracklists, normalizePlaylist, playlistLink } from './comparison.js';

const sample = [
    [
        'Daft Punk — One More Time',
        'Daft Punk — Digital Love',
        'Justice — D.A.N.C.E.',
        'Justice — Genesis',
        'Avicii — Levels',
        'Eric Prydz — Opus',
        'Eric Prydz — Pjanoo',
        'Moby — Porcelain',
        'Disclosure — Latch',
        'Stardust — Music Sounds Better with You'
    ],
    [
        'Daft Punk — One More Time (Official Video)',
        'Daft Punk — Around the World',
        'Justice — D.A.N.C.E.',
        'Justice — Safe and Sound',
        'Avicii — Levels',
        'Eric Prydz — Opus',
        'deadmau5 — Strobe',
        'The Chemical Brothers — Galvanize',
        'Modjo — Lady (Hear Me Tonight)',
        'Cassius — 1999'
    ]
];

const services = { spotify: 'Spotify', youtube: 'YouTube Music' };
const messages = {
    empty: 'У цьому плейлисті не вдалося знайти треки з назвами й виконавцями.',
    unavailable: 'Не вдалося прочитати плейлист. Перевір, чи відкривається його список треків без входу.',
    shortLink: 'Не вдалося відкрити коротке посилання. Скопіюй повну адресу плейлиста зі Spotify.',
    tooLarge: 'Сторінка цього плейлиста завелика для завантаження.',
    busy: 'Забагато запитів. Спробуй ще раз за хвилину.',
    upstream: 'Сервіс не відповів. Спробуй ще раз.',
    link: 'Встав посилання на плейлист Spotify або YouTube Music.',
    network: 'Не вдалося з’єднатися із сервісом порівняння. Спробуй ще раз.'
};

const apiOrigin = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://127.0.0.1:8790'
    : 'https://music-match.lordskamp.workers.dev';
const form = document.getElementById('match-form');
const submit = document.getElementById('match-submit');
const submitLabel = document.getElementById('match-submit-label');
const demo = document.getElementById('match-demo');
const result = document.getElementById('match-result');
const decks = [...form.querySelectorAll('[data-deck]')].map((element) => ({
    link: element.querySelector('[data-link]'),
    source: element.querySelector('[data-source]'),
    error: element.querySelector('[data-error]')
}));
let activeRequest;

function showError(deck, message = '') {
    deck.error.textContent = message;
    deck.error.hidden = !message;
    if (message) deck.link.setAttribute('aria-invalid', 'true');
    else deck.link.removeAttribute('aria-invalid');
}

function updateLink(deck) {
    const link = playlistLink(deck.link.value);
    deck.source.hidden = !link;
    if (link) {
        deck.source.href = link.url;
        deck.source.textContent = `Відкрити у ${services[link.service]} ↗`;
    } else {
        deck.source.removeAttribute('href');
    }
    return link;
}

function setLoading(loading) {
    submit.disabled = loading;
    submitLabel.textContent = loading ? 'Завантажуємо плейлисти…' : 'Порівняти плейлисти';
}

function cancelLoading() {
    activeRequest?.abort();
    activeRequest = null;
    setLoading(false);
}

for (const deck of decks) {
    deck.link.addEventListener('input', () => {
        cancelLoading();
        updateLink(deck);
        for (const item of decks) showError(item);
        result.hidden = true;
    });
}

async function fetchPlaylist(link, signal) {
    const response = await fetch(`${apiOrigin}/api/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: link.url }),
        signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return { ...data, tracks: normalizePlaylist(data.tracks) };
}

function percent(value) {
    return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

function metricRow(label, metric) {
    const row = document.createElement('div');
    const name = document.createElement('dt');
    name.textContent = label;
    const value = document.createElement('dd');
    const amount = percent(metric.score);
    const bar = document.createElement('progress');
    bar.setAttribute('aria-hidden', 'true');
    bar.max = 100;
    bar.value = amount;
    const number = document.createElement('span');
    number.textContent = `${amount}%`;
    value.append(bar, number);
    row.append(name, value);
    return row;
}

function commonList(label, values) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${label} · ${values.length}`;
    details.append(summary);
    details.addEventListener('toggle', () => {
        if (!details.open || details.children.length > 1) return;
        if (!values.length) {
            const empty = document.createElement('p');
            empty.textContent = 'Без збігів.';
            details.append(empty);
            return;
        }
        const list = document.createElement('ul');
        for (const label of values) {
            const item = document.createElement('li');
            item.textContent = label;
            list.append(item);
        }
        details.append(list);
    });
    return details;
}

function showResult(playlists, isDemo = false) {
    const report = compareTracklists(...playlists.map(({ tracks }) => tracks));
    const names = playlists.map(({ name }, index) => name || ['Твій плейлист', 'Інший плейлист'][index]);
    document.getElementById('match-score').textContent = percent(report.score);
    document.getElementById('match-result-context').textContent =
        `${isDemo ? 'Приклад · ' : ''}${names[0]} (${report.sizes[0]}) × ${names[1]} (${report.sizes[1]})`;
    const coverage = document.getElementById('match-coverage');
    const notes = playlists.flatMap(({ incomplete, skipped }, index) => {
        if (incomplete) return [`Плейлист «${names[index]}» може містити більше треків, ніж вдалося прочитати.`];
        if (skipped > 0) return [`«${names[index]}» містить пропущені записи (${skipped}).`];
        return [];
    });
    coverage.hidden = !notes.length;
    coverage.textContent = notes.join(' ');
    document.getElementById('match-small-sample').hidden = report.sizes.every((size) => size >= 10);
    document.getElementById('match-metrics').replaceChildren(
        metricRow('Треки', report.tracks),
        metricRow('Виконавці', report.artists)
    );
    const groups = [
        commonList('Спільні треки', report.tracks.common.map(({ title, artists }) =>
            `${artists.values().next().value} — ${title}`
        )),
        commonList('Спільні виконавці', report.artists.common)
    ];
    document.getElementById('match-overlaps').replaceChildren(...groups);
    result.hidden = false;
    document.getElementById('match-result-title').focus();
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    result.hidden = true;
    const links = decks.map((deck) => {
        const link = updateLink(deck);
        showError(deck, link ? '' : messages.link);
        return link;
    });
    const invalidIndex = links.indexOf(null);
    if (invalidIndex !== -1) {
        decks[invalidIndex].link.focus();
        return;
    }

    const controller = new AbortController();
    activeRequest = controller;
    setLoading(true);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    const first = fetchPlaylist(links[0], signal);
    const second = links[0].url === links[1].url ? first : fetchPlaylist(links[1], signal);
    const reports = await Promise.allSettled([first, second]);
    if (activeRequest !== controller) return;
    cancelLoading();

    reports.forEach((report, index) => {
        if (report.status === 'rejected') {
            const code = report.reason?.message;
            showError(decks[index], Object.hasOwn(messages, code) ? messages[code] : messages.network);
        }
    });
    const failedIndex = reports.findIndex(({ status }) => status === 'rejected');
    if (failedIndex !== -1) decks[failedIndex].link.focus();
    else showResult(reports.map(({ value }) => value));
});

demo.addEventListener('click', () => {
    cancelLoading();
    for (const deck of decks) showError(deck);
    const playlists = sample.map((entries) => {
        const tracks = entries.map((entry) => {
            const [artist, title] = entry.split(' — ');
            return { title, artist };
        });
        return { tracks: normalizePlaylist(tracks) };
    });
    showResult(playlists, true);
});
demo.disabled = false;
setLoading(false);
