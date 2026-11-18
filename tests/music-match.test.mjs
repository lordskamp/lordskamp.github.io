import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTracklists, normalizePlaylist, playlistLink } from '../music-match/comparison.js';
import { handlePlaylistRequest, parseSpotifyPage, parseYouTubePage } from '../api/music-match-worker.js';

const spotify = 'https://open.spotify.com/playlist/1IoanWYXz1mT8ZLjYpP34W';
const youtube = 'https://music.youtube.com/playlist?list=PL_demo-1';

test('recognizes playlist URLs and strips parameters unrelated to their identity', () => {
    assert.deepEqual(playlistLink(spotify.replace('/playlist/', '/intl-uk/playlist/') + '?si=test'), {
        service: 'spotify',
        url: spotify
    });
    assert.deepEqual(playlistLink('https://www.youtube.com/watch?v=xyz&list=PL_demo-1&index=5'), {
        service: 'youtube',
        url: youtube
    });
    assert.equal(playlistLink('https://spotify.link/aBc123?si=abc').url, 'https://spotify.link/aBc123');
    for (const url of [
        spotify.replace('spotify.com', 'spotify.com.example.org'),
        spotify.replace('/playlist/', '/track/'),
        'https://www.youtube.com/watch?v=xyz',
        'http://music.youtube.com/playlist?list=PL_demo-1',
        'https://music.youtube.com/watch?v=example&list=RDAMVMexample',
        'https://alice:secret@music.youtube.com/playlist?list=PL_demo-1'
    ]) {
        assert.equal(playlistLink(url), null);
    }
});

function spotifyPage(rows) {
    const data = { props: { pageProps: { state: { data: { entity: { type: 'playlist', name: 'After hours', trackList: rows } } } } } };
    return `<script type="application/json" id="__NEXT_DATA__">${JSON.stringify(data)}</script>`;
}

function youtubePage(contents, shelf = 'musicPlaylistShelfRenderer') {
    const data = {
        metadata: { playlistMetadataRenderer: { title: 'Late night' } },
        contents: { sectionListRenderer: { contents: [{ [shelf]: { contents } }] } }
    };
    return `<script>var ytInitialData = ${JSON.stringify(data)}; var somethingElse = { notAPlaylist: true };</script>`;
}

const sampleSpotify = spotifyPage([
    { title: 'One More Time', subtitle: 'Daft Punk', uri: 'spotify:track:abc' },
    { title: 'Voices', subtitle: 'Someone', uri: 'spotify:episode:def' }
]);

const column = (runs) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs } } });

const sampleYouTube = youtubePage([
    { musicResponsiveListItemRenderer: {
        playlistItemData: { videoId: 'abc' },
        flexColumns: [
            column([{ text: 'One More Time (Official Video)' }]),
            column([{ text: 'Daft Punk' }, { text: ' • ' }, { text: 'Discovery' }])
        ]
    } },
    { continuationItemRenderer: { continuationEndpoint: {} } }
]);

test('extracts public track metadata and marks unavailable rows or a capped result', () => {
    assert.deepEqual(parseSpotifyPage(sampleSpotify), {
        name: 'After hours', tracks: [{ title: 'One More Time', artist: 'Daft Punk' }], incomplete: false, skipped: 1
    });
    assert.equal(parseSpotifyPage(spotifyPage(Array.from({ length: 100 }, () => ({
        title: 'One More Time', subtitle: 'Daft Punk'
    })))).incomplete, true);
    assert.deepEqual(parseYouTubePage(sampleYouTube), {
        name: 'Late night', tracks: [{ title: 'One More Time (Official Video)', artist: 'Daft Punk' }], incomplete: true, skipped: 0
    });
    assert.equal(parseYouTubePage('<html>No playlist</html>'), null);
});

function request(url, origin = 'https://lordskamp.github.io') {
    return new Request('https://music-match.lordskamp.workers.dev/api/playlist', {
        method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ url })
    });
}

const env = { SITE_ORIGIN: 'https://lordskamp.github.io' };

test('two link imports can be compared across Spotify and YouTube Music', async () => {
    const called = [];
    const requestPage = async (url, options) => {
        assert.equal(options.redirect, 'manual');
        called.push(url);
        return new Response(url.startsWith('https://open.spotify.com') ? sampleSpotify : sampleYouTube);
    };
    const responses = await Promise.all([
        handlePlaylistRequest(request(spotify), env, requestPage),
        handlePlaylistRequest(request(youtube), env, requestPage)
    ]);
    assert.deepEqual(called.sort(), [youtube, spotify.replace('/playlist/', '/embed/playlist/')]);
    assert.ok(responses.every((response) => response.ok));
    assert.equal(responses[0].headers.get('Access-Control-Allow-Origin'), env.SITE_ORIGIN);
    const [left, right] = await Promise.all(responses.map((response) => response.json()));
    const result = compareTracklists(normalizePlaylist(left.tracks), normalizePlaylist(right.tracks));
    assert.equal(result.score, 1);
    assert.equal(result.tracks.common.length, 1);
});

test('falls back to the public YouTube playlist if the Music page has no rows', async () => {
    const response = await handlePlaylistRequest(request(youtube), env, async (url) => {
        if (url === youtube) return new Response('<html>No playlist data here</html>');
        assert.equal(url, youtube.replace('music.youtube', 'www.youtube'));
        return new Response(youtubePage([
            { playlistVideoRenderer: { videoId: 'abc', title: { simpleText: 'One More Time' }, shortBylineText: { simpleText: 'Daft Punk - Topic' } } },
            { playlistVideoRenderer: { videoId: 'xyz', isPlayable: false } }
        ], 'playlistVideoListRenderer'));
    });
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.deepEqual(report.tracks, [{ title: 'One More Time', artist: 'Daft Punk' }]);
    assert.equal(report.skipped, 1);
});

test('only follows a Spotify short link to a recognized playlist', async () => {
    const input = 'https://spotify.link/aBc123';
    const calls = [];
    const ok = await handlePlaylistRequest(request(input), env, async (url) => {
        calls.push(url);
        if (url === input) return new Response(null, { status: 302, headers: { Location: spotify } });
        return new Response(sampleSpotify);
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(calls, [input, spotify.replace('/playlist/', '/embed/playlist/')]);
    const rejected = await handlePlaylistRequest(request(input), env, async (url) => {
        assert.equal(url, input);
        return new Response(null, { status: 302, headers: { Location: 'http://localhost:8790/internal' } });
    });
    assert.deepEqual(await rejected.json(), { error: 'shortLink' });

    const wrongOrigin = await handlePlaylistRequest(request(spotify, 'https://example.org'), env, () => assert.fail());
    assert.equal(wrongOrigin.status, 403);
    const limited = await handlePlaylistRequest(request(spotify), {
        ...env, PLAYLIST_LIMIT: { limit: async () => ({ success: false }) }
    }, () => assert.fail());
    assert.equal(limited.status, 429);
});

test('duplicate songs are collapsed while live and remix versions remain distinct', () => {
    const title = 'One More Time';
    const artist = 'Daft Punk';
    const left = normalizePlaylist([{ title, artist }, { title, artist }]);
    const right = normalizePlaylist([
        { title: title + ' (Official Music Video)', artist },
        { title: title + ' (Live)', artist },
        { title: title + ' (Remix)', artist }
    ]);
    const result = compareTracklists(left, right);
    assert.deepEqual(result.sizes, [1, 3]);
    assert.equal(result.tracks.score, 0.5);
    assert.equal(result.artists.score, 1);
    assert.equal(result.score, (0.5 * 35 + 40) / 75);
    assert.equal(compareTracklists(left, left).score, 1);
    assert.equal(compareTracklists(left, normalizePlaylist([{ title: 'Lithium', artist: 'Nirvana' }])).score, 0);
});
