export const maxPlaylistTracks = 100;

export function playlistLink(value) {
    if (typeof value !== 'string' || value.length > 1024) return null;
    let url;
    try {
        url = new URL(value.trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;

    if (url.hostname === 'open.spotify.com') {
        const id = /^\/(?:intl-[a-z-]+\/)?playlist\/([a-z\d]{22})\/?$/i.exec(url.pathname)?.[1];
        return id ? { service: 'spotify', url: `https://open.spotify.com/playlist/${id}` } : null;
    }

    if (url.hostname === 'spotify.link' && /^\/[a-z\d]{4,64}\/?$/i.test(url.pathname)) {
        return { service: 'spotify', url: url.origin + url.pathname };
    }

    if (['music.youtube.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) {
        const id = url.searchParams.get('list');
        const isPlaylist = ['/playlist', '/watch'].includes(url.pathname) || url.hostname === 'youtu.be';
        if (isPlaylist && /^[\w-]{5,150}$/.test(id ?? '') && !id.startsWith('RD')) {
            return { service: 'youtube', url: `https://music.youtube.com/playlist?list=${id}` };
        }
    }
    return null;
}

function trackKey(value) {
    return value.normalize('NFKD')
        .replace(/\p{Script=Latin}\p{M}*/gu, (letter) => letter.replace(/\p{M}/gu, ''))
        .normalize('NFC')
        .toLowerCase()
        .replace(/['’‘ʼ]/gu, '')
        .replace(/&/gu, ' and ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function cleanTitle(title) {
    return title
        .replace(/\s*[([]\s*(?:(?:official\s+)?(?:music\s+)?video|official audio|lyric(?:s| video)?)\s*[)\]]/giu, '')
        .replace(/\s*[–—-]\s*(?:official (?:music )?video|official audio|lyric video)\s*$/iu, '')
        .replace(/\s*[([]\s*(?:feat\.?|ft\.?)\s+[^)\]]+[)\]]/giu, '')
        .trim();
}

function labeledKeys(values) {
    const labels = new Map();
    for (const value of values) {
        const label = value.trim();
        const key = trackKey(label);
        if (key && !labels.has(key)) labels.set(key, label);
    }
    return labels;
}

function makeTrack(rawTitle, rawArtist) {
    const title = cleanTitle(rawTitle);
    const titleKey = trackKey(title);
    const artists = labeledKeys(rawArtist.split(/\s*[;|]\s*|\s+(?:feat\.?|ft\.?)\s+/iu));
    if (!titleKey || !artists.size) return null;
    const key = `${artists.keys().next().value}\0${titleKey}`;
    return { key, title, artists };
}

export function normalizePlaylist(items) {
    if (!Array.isArray(items) || items.length > maxPlaylistTracks) throw new Error('upstream');
    const tracks = items.map((item) => {
        if (typeof item?.title !== 'string' || typeof item.artist !== 'string') return null;
        return makeTrack(item.title, item.artist);
    }).filter(Boolean);
    if (!tracks.length) throw new Error('empty');
    return uniqueTracks(tracks);
}

function uniqueTracks(tracks) {
    const unique = new Map();
    for (const track of tracks) {
        const existing = unique.get(track.key);
        if (!existing) {
            unique.set(track.key, track);
            continue;
        }
        for (const [key, label] of track.artists) existing.artists.set(key, label);
    }
    return [...unique.values()];
}

function artistProfile(tracks) {
    const entries = new Map();
    for (const { artists } of tracks) {
        for (const [key, label] of artists) {
            const entry = entries.get(key) ?? { label, weight: 0 };
            entry.weight += 1 / (artists.size * tracks.length);
            entries.set(key, entry);
        }
    }
    return entries;
}

function overlap(left, right) {
    const common = [];
    for (const [key, { label, weight }] of left) {
        const other = right.get(key);
        if (other) common.push({ label, weight: Math.min(weight, other.weight) });
    }
    const score = common.reduce((sum, { weight }) => sum + weight, 0);
    common.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label, 'uk'));
    return { score, common: common.map(({ label }) => label) };
}

export function compareTracklists(left, right) {
    if (!left.length || !right.length) throw new Error('empty');
    const rightKeys = new Set(right.map(({ key }) => key));
    const commonTracks = left.filter(({ key }) => rightKeys.has(key));
    const trackScore = 2 * commonTracks.length / (left.length + right.length);
    const artists = overlap(artistProfile(left), artistProfile(right));
    const score = (trackScore * 7 + artists.score * 8) / 15;
    return {
        score,
        tracks: { score: trackScore, common: commonTracks },
        artists,
        sizes: [left.length, right.length]
    };
}
