import { maxPlaylistTracks, playlistLink } from '../music-match/comparison.js';

const maxPageBytes = 5 * 1024 * 1024;
const maxLinkBytes = 2048;
const IS_SPOTIFY_TRACK = /^spotify:(?:track|local):/;

class PlaylistError extends Error {
    constructor(code, status = 422) {
        super(code);
        this.status = status;
    }
}

function* objects(data) {
    const stack = [data];
    while (stack.length) {
        const value = stack.pop();
        if (!value || typeof value !== 'object') continue;
        if (!Array.isArray(value)) yield value;
        for (const child of Object.values(value)) {
            if (child && typeof child === 'object') stack.push(child);
        }
    }
}

function makeTrack(title, artist) {
    if (typeof title !== 'string' || typeof artist !== 'string') return null;
    title = title.trim().slice(0, 400);
    artist = artist.trim().slice(0, 400);
    return title && artist ? { title, artist } : null;
}

function playlist(name, rows, incomplete) {
    const tracks = rows.slice(0, maxPlaylistTracks).filter(Boolean);
    if (!tracks.length) return null;
    return {
        name: typeof name === 'string' ? name.trim().slice(0, 240) : '',
        tracks,
        incomplete: incomplete || rows.length > maxPlaylistTracks,
        skipped: Math.min(rows.length, maxPlaylistTracks) - tracks.length
    };
}

export function parseSpotifyPage(html) {
    const data = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
    if (!data) return null;
    const candidates = objects(JSON.parse(data));
    for (const item of candidates) {
        if (!Array.isArray(item.trackList) || (item.type && item.type !== 'playlist')) continue;
        return playlist(item.name ?? item.title, item.trackList.map((track) => {
            if (track?.uri && !IS_SPOTIFY_TRACK.test(track.uri)) return null;
            return makeTrack(track?.title, track?.subtitle);
        }), item.trackList.length >= maxPlaylistTracks);
    }
    return null;
}

function youtubeJson(html) {
    const prefix = /(?:\bvar\s+ytInitialData|\bwindow\[["']ytInitialData["']\])\s*=\s*(?=\{)/.exec(html);
    if (!prefix) return null;
    const start = prefix.index + prefix[0].length;
    let depth = 0;
    let string = false;
    for (let i = start; i < html.length; i++) {
        const char = html[i];
        if (string) {
            if (char === '\\') i++;
            else if (char === '"') string = false;
        } else if (char === '"') {
            string = true;
        } else if (char === '{') {
            depth++;
        } else if (char === '}' && --depth === 0) {
            return JSON.parse(html.slice(start, i + 1));
        }
    }
    return null;
}

function youtubeText(value) {
    return value?.simpleText ?? value?.runs?.map((run) => run.text).join('') ?? '';
}

function youtubeMusicTrack(item) {
    if (!item?.playlistItemData?.videoId || item.musicItemRendererDisplayPolicy === 'MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT') return null;
    const [first, second] = item.flexColumns ?? [];
    const title = youtubeText(first?.musicResponsiveListItemFlexColumnRenderer?.text);
    const credits = second?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
    const artists = credits.filter(({ navigationEndpoint }) =>
        navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
            ?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST'
    ).map(({ text }) => text);
    const artist = artists.join('; ') || (credits[0]?.text ?? '').split(/\s+•\s+/u)[0];
    return makeTrack(title, artist);
}

function youtubeVideoTrack(item) {
    if (!item?.videoId || item.isPlayable === false) return null;
    const title = youtubeText(item.title);
    const channel = youtubeText(item.shortBylineText ?? item.ownerText);
    const explicitArtist = /^(.+?)\s+[–—-]\s+(.+)$/u.exec(title);
    if (explicitArtist) return makeTrack(explicitArtist[2], explicitArtist[1]);
    return makeTrack(title, channel.replace(/\s+-\s+Topic$/u, ''));
}

export function parseYouTubePage(html) {
    const data = youtubeJson(html);
    if (!data) return null;
    const name = data.metadata?.playlistMetadataRenderer?.title ?? data.microformat?.microformatDataRenderer?.title;
    for (const item of objects(data.contents)) {
        const shelf = item.musicPlaylistShelfRenderer ?? item.playlistVideoListRenderer;
        if (!Array.isArray(shelf?.contents)) continue;
        const rows = shelf.contents.filter((row) => row.musicResponsiveListItemRenderer || row.playlistVideoRenderer);
        const hasMore = Boolean(shelf.continuations?.length || shelf.contents.some((row) => row.continuationItemRenderer));
        return playlist(name, rows.map((row) => row.musicResponsiveListItemRenderer
            ? youtubeMusicTrack(row.musicResponsiveListItemRenderer)
            : youtubeVideoTrack(row.playlistVideoRenderer)
        ), hasMore);
    }
    return null;
}

async function readText(message, maxBytes) {
    const reader = message.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = '';
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return text + decoder.decode();
            bytes += value.byteLength;
            if (bytes > maxBytes) {
                await reader.cancel();
                throw new PlaylistError('tooLarge');
            }
            text += decoder.decode(value, { stream: true });
        }
    } finally {
        reader.releaseLock();
    }
}

async function fetchPage(url, requestPage) {
    const response = await requestPage(url, {
        headers: { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.8' },
        redirect: 'manual',
        signal: AbortSignal.timeout(6500)
    });
    if (response.status === 429) throw new PlaylistError('busy', 503);
    if (response.status >= 500) throw new PlaylistError('upstream', 502);
    return response;
}

async function spotifyId(link, requestPage) {
    if (new URL(link.url).hostname === 'open.spotify.com') return new URL(link.url).pathname.split('/').at(-1);
    let target = link.url;
    for (let hop = 0; hop < 3; hop++) {
        const response = await fetchPage(target, requestPage);
        const location = response.headers.get('Location');
        if (response.status < 300 || response.status >= 400 || !location) break;
        const next = playlistLink(new URL(location, target).href);
        if (!next || next.service !== 'spotify') break;
        if (new URL(next.url).hostname === 'open.spotify.com') return new URL(next.url).pathname.split('/').at(-1);
        target = next.url;
    }
    throw new PlaylistError('shortLink');
}

export async function loadPublicPlaylist(link, requestPage = fetch) {
    if (link.service === 'spotify') {
        const id = await spotifyId(link, requestPage);
        const response = await fetchPage(`https://open.spotify.com/embed/playlist/${id}`, requestPage);
        const data = response.ok && parseSpotifyPage(await readText(response, maxPageBytes));
        if (data) return data;
    } else {
        const id = new URL(link.url).searchParams.get('list');
        for (const base of ['https://music.youtube.com', 'https://www.youtube.com']) {
            const response = await fetchPage(`${base}/playlist?list=${id}`, requestPage);
            const data = response.ok && parseYouTubePage(await readText(response, maxPageBytes));
            if (data) return data;
        }
    }
    throw new PlaylistError('unavailable');
}

export async function handlePlaylistRequest(request, env, requestPage = fetch) {
    const origin = request.headers.get('Origin');
    const allowed = origin === env.SITE_ORIGIN
        || origin === 'http://127.0.0.1:4173' || origin === 'http://localhost:4173';
    const headers = {
        'Cache-Control': 'no-store',
        'Vary': 'Origin'
    };
    if (allowed) headers['Access-Control-Allow-Origin'] = origin;
    const json = (body, status = 200) => Response.json(body, { status, headers });
    if (new URL(request.url).pathname !== '/api/playlist') return json({ error: 'notFound' }, 404);
    if (!allowed) return json({ error: 'origin' }, 403);
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: { ...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }
        });
    }
    if (request.method !== 'POST') return json({ error: 'method' }, 405);

    let link;
    try {
        const body = JSON.parse(await readText(request, maxLinkBytes));
        link = playlistLink(body?.url);
    } catch {
        return json({ error: 'link' }, 400);
    }
    if (!link) return json({ error: 'link' }, 400);

    try {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
        if (env.PLAYLIST_LIMIT && !(await env.PLAYLIST_LIMIT.limit({ key: ip })).success) {
            return json({ error: 'busy' }, 429);
        }
        return json(await loadPublicPlaylist(link, requestPage));
    } catch (error) {
        if (error instanceof PlaylistError) return json({ error: error.message }, error.status);
        return json({ error: 'upstream' }, 502);
    }
}

export default {
    fetch: (request, env) => handlePlaylistRequest(request, env)
};
