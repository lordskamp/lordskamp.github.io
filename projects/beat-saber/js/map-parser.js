const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

export const CUT_DIRECTIONS = {
    0: { label: 'up', x: 0, y: 1 },
    1: { label: 'down', x: 0, y: -1 },
    2: { label: 'left', x: -1, y: 0 },
    3: { label: 'right', x: 1, y: 0 },
    4: { label: 'up-left', x: -0.707, y: 0.707 },
    5: { label: 'up-right', x: 0.707, y: 0.707 },
    6: { label: 'down-left', x: -0.707, y: -0.707 },
    7: { label: 'down-right', x: 0.707, y: -0.707 },
    8: { label: 'any', x: 0, y: 0 }
};

const DIFFICULTY_ORDER = ['Normal', 'Hard', 'Easy', 'Expert', 'ExpertPlus'];

let jsZipPromise = null;

function loadJSZip() {
    if (!jsZipPromise) {
        jsZipPromise = import(JSZIP_URL).then(module => module.default || module.JSZip || module);
    }
    return jsZipPromise;
}

function stripBom(text) {
    return String(text || '').replace(/^\uFEFF/, '');
}

function parseJsonText(text, label) {
    try {
        return JSON.parse(stripBom(text));
    } catch (error) {
        throw new Error(`Could not parse ${label}: ${error.message}`);
    }
}

function asNumber(value, fallback = 0) {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function joinAssetUrl(rootUrl, filename) {
    if (!filename) return '';
    try {
        return new URL(filename, new URL(rootUrl, window.location.href)).href;
    } catch (_) {
        return `${rootUrl}${filename}`;
    }
}

function filenameOnly(path) {
    return String(path || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
}

function normalizeZipName(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\.?\//, '');
}

function getInfoValue(info, underscoredKey, plainKey, fallback = '') {
    if (Object.prototype.hasOwnProperty.call(info, underscoredKey)) return info[underscoredKey];
    if (Object.prototype.hasOwnProperty.call(info, plainKey)) return info[plainKey];
    return fallback;
}

export function beatToSeconds(beat, bpm) {
    const safeBpm = Math.max(asNumber(bpm, 120), 1);
    return asNumber(beat) * (60 / safeBpm);
}

export function parseInfoDat(info, rootUrl = '') {
    const bpm = asNumber(getInfoValue(info, '_beatsPerMinute', 'beatsPerMinute', 120), 120);
    const sets = asArray(getInfoValue(info, '_difficultyBeatmapSets', 'difficultyBeatmapSets', []));
    const difficulties = [];

    sets.forEach(set => {
        const characteristic = getInfoValue(set, '_beatmapCharacteristicName', 'beatmapCharacteristicName', 'Standard');
        const maps = asArray(getInfoValue(set, '_difficultyBeatmaps', 'difficultyBeatmaps', []));

        maps.forEach(map => {
            const difficulty = getInfoValue(map, '_difficulty', 'difficulty', 'Unknown');
            const filename = getInfoValue(map, '_beatmapFilename', 'beatmapFilename', '');
            if (!filename) return;

            difficulties.push({
                key: `${characteristic}:${difficulty}:${filename}`,
                characteristic,
                difficulty,
                filename,
                label: `${characteristic} / ${difficulty}`,
                rank: asNumber(getInfoValue(map, '_difficultyRank', 'difficultyRank', 0), 0),
                noteJumpMovementSpeed: asNumber(getInfoValue(map, '_noteJumpMovementSpeed', 'noteJumpMovementSpeed', 14), 14),
                noteJumpStartBeatOffset: asNumber(getInfoValue(map, '_noteJumpStartBeatOffset', 'noteJumpStartBeatOffset', 0), 0)
            });
        });
    });

    const songFilename = getInfoValue(info, '_songFilename', 'songFilename', '');
    const coverImageFilename = getInfoValue(info, '_coverImageFilename', 'coverImageFilename', '');

    return {
        version: getInfoValue(info, '_version', 'version', ''),
        songName: getInfoValue(info, '_songName', 'songName', 'Untitled map'),
        songSubName: getInfoValue(info, '_songSubName', 'songSubName', ''),
        songAuthorName: getInfoValue(info, '_songAuthorName', 'songAuthorName', 'Unknown artist'),
        levelAuthorName: getInfoValue(info, '_levelAuthorName', 'levelAuthorName', 'Unknown mapper'),
        bpm,
        songFilename,
        coverImageFilename,
        audioUrl: joinAssetUrl(rootUrl, songFilename),
        coverUrl: joinAssetUrl(rootUrl, coverImageFilename),
        difficulties
    };
}

export function normalizeBeatmapNotes(beatmap, bpm) {
    const v3Notes = asArray(beatmap.colorNotes);
    const v2Notes = asArray(beatmap._notes);
    const sourceNotes = v3Notes.length
        ? v3Notes.map(note => ({
            beat: note.b,
            x: note.x,
            y: note.y,
            color: note.c,
            direction: note.d,
            angleOffset: note.a || 0
        }))
        : v2Notes
            .filter(note => note._type === 0 || note._type === 1)
            .map(note => ({
                beat: note._time,
                x: note._lineIndex,
                y: note._lineLayer,
                color: note._type,
                direction: note._cutDirection,
                angleOffset: 0
            }));

    return sourceNotes
        .filter(note => Number.isFinite(asNumber(note.beat, NaN)))
        .filter(note => note.color === 0 || note.color === 1)
        .map((note, index) => {
            const beat = asNumber(note.beat, 0);
            const direction = Number.isInteger(note.direction) ? note.direction : asNumber(note.direction, 8);
            return {
                id: `note-${index}-${Math.round(beat * 1000)}`,
                index,
                beat,
                timeSec: beatToSeconds(beat, bpm),
                x: Math.max(0, Math.min(3, Math.round(asNumber(note.x, 0)))),
                y: Math.max(0, Math.min(2, Math.round(asNumber(note.y, 0)))),
                color: asNumber(note.color, 0),
                direction: Math.max(0, Math.min(8, Math.round(direction))),
                directionLabel: (CUT_DIRECTIONS[direction] || CUT_DIRECTIONS[8]).label,
                angleOffset: asNumber(note.angleOffset, 0)
            };
        })
        .sort((a, b) => a.timeSec - b.timeSec || a.index - b.index);
}

function lightColorFromValue(value, fallback = 'blue') {
    const normalized = Math.round(asNumber(value, 0));
    if (normalized === 0) return 'off';
    if (normalized >= 5 && normalized <= 8) return 'red';
    if (normalized >= 1 && normalized <= 4) return 'blue';
    return fallback;
}

function targetFromEventType(type) {
    const normalized = Math.round(asNumber(type, 0));
    if (normalized === 2 || normalized === 6 || normalized === 10) return 'left';
    if (normalized === 3 || normalized === 7 || normalized === 11) return 'right';
    if (normalized === 0 || normalized === 4 || normalized === 8) return 'back';
    return 'center';
}

export function normalizeLightshowEvents(beatmap, bpm) {
    const events = [];

    asArray(beatmap.basicBeatmapEvents).forEach((event, index) => {
        const beat = asNumber(event.b, NaN);
        if (!Number.isFinite(beat)) return;
        const color = lightColorFromValue(event.i);
        events.push({
            id: `light-basic-${index}`,
            beat,
            timeSec: beatToSeconds(beat, bpm),
            target: targetFromEventType(event.et),
            color,
            intensity: color === 'off' ? 0 : Math.max(0.35, asNumber(event.f, 1)),
            source: 'basicBeatmapEvents'
        });
    });

    asArray(beatmap._events).forEach((event, index) => {
        const beat = asNumber(event._time, NaN);
        if (!Number.isFinite(beat)) return;
        const color = lightColorFromValue(event._value);
        events.push({
            id: `light-v2-${index}`,
            beat,
            timeSec: beatToSeconds(beat, bpm),
            target: targetFromEventType(event._type),
            color,
            intensity: color === 'off' ? 0 : Math.max(0.35, asNumber(event._floatValue, 1)),
            source: '_events'
        });
    });

    asArray(beatmap.colorBoostBeatmapEvents).forEach((event, index) => {
        const beat = asNumber(event.b, NaN);
        if (!Number.isFinite(beat)) return;
        events.push({
            id: `light-boost-${index}`,
            beat,
            timeSec: beatToSeconds(beat, bpm),
            target: 'boost',
            color: event.o ? 'boost' : 'off',
            intensity: event.o ? 1.35 : 0.25,
            source: 'colorBoostBeatmapEvents'
        });
    });

    asArray(beatmap.lightColorEventBoxGroups).forEach((group, groupIndex) => {
        const groupBeat = asNumber(group.b, NaN);
        if (!Number.isFinite(groupBeat)) return;
        asArray(group.e).forEach((box, boxIndex) => {
            asArray(box.e).forEach((event, eventIndex) => {
                const beat = groupBeat + asNumber(event.b, 0);
                const color = event.c === 0 ? 'red' : event.c === 1 ? 'blue' : 'white';
                events.push({
                    id: `light-box-${groupIndex}-${boxIndex}-${eventIndex}`,
                    beat,
                    timeSec: beatToSeconds(beat, bpm),
                    target: group.g % 2 ? 'right' : 'left',
                    color,
                    intensity: Math.max(0.2, asNumber(event.s, 1)),
                    source: 'lightColorEventBoxGroups'
                });
            });
        });
    });

    return events.sort((a, b) => a.timeSec - b.timeSec);
}

export function selectDefaultDifficulty(difficulties) {
    if (!difficulties.length) return null;
    for (const name of DIFFICULTY_ORDER) {
        const match = difficulties.find(diff => diff.difficulty === name);
        if (match) return match;
    }
    return difficulties.slice().sort((a, b) => a.rank - b.rank)[0];
}

export function travelTimeForDifficulty(difficulty) {
    const njs = asNumber(difficulty?.noteJumpMovementSpeed, 14);
    return Math.max(1.45, Math.min(2.65, 2.35 - ((njs - 14) * 0.07)));
}

export async function loadStaticTrack(track) {
    const response = await fetch(track.infoUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load ${track.infoUrl}`);
    const rawInfo = parseJsonText(await response.text(), track.infoUrl);
    const info = parseInfoDat(rawInfo, track.rootUrl);

    return {
        kind: 'static',
        id: track.id,
        title: track.title,
        artist: track.artist,
        badge: track.badge,
        rawInfo,
        info,
        audioUrl: info.audioUrl,
        coverUrl: info.coverUrl,
        difficulties: info.difficulties,
        async loadDifficulty(difficulty) {
            const beatmapUrl = joinAssetUrl(track.rootUrl, difficulty.filename);
            const beatmapResponse = await fetch(beatmapUrl, { cache: 'no-store' });
            if (!beatmapResponse.ok) throw new Error(`Could not load ${difficulty.filename}`);
            const beatmap = parseJsonText(await beatmapResponse.text(), difficulty.filename);
            const notes = normalizeBeatmapNotes(beatmap, info.bpm);
            const lights = normalizeLightshowEvents(beatmap, info.bpm);
            console.info('[Beat Saber parser]', difficulty.label, { notes, lights });
            return { beatmap, difficulty, notes, lights, travelTime: travelTimeForDifficulty(difficulty) };
        }
    };
}

function findZipEntry(zip, desiredName, baseDir = '') {
    const normalizedDesired = normalizeZipName(desiredName);
    const normalizedBase = normalizeZipName(baseDir);
    const exact = `${normalizedBase}${normalizedDesired}`.toLowerCase();
    const entries = Object.values(zip.files).filter(entry => !entry.dir);

    return entries.find(entry => normalizeZipName(entry.name).toLowerCase() === exact)
        || entries.find(entry => filenameOnly(entry.name) === filenameOnly(desiredName))
        || null;
}

function guessMime(filename) {
    const name = filenameOnly(filename);
    if (name.endsWith('.ogg')) return 'audio/ogg';
    if (name.endsWith('.wav')) return 'audio/wav';
    if (name.endsWith('.mp3')) return 'audio/mpeg';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
}

async function entryObjectUrl(entry) {
    if (!entry) return '';
    const blob = await entry.async('blob');
    return URL.createObjectURL(new Blob([blob], { type: guessMime(entry.name) }));
}

export async function loadZipTrack(file) {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(file);
    const infoEntry = Object.values(zip.files)
        .filter(entry => !entry.dir)
        .find(entry => filenameOnly(entry.name) === 'info.dat');

    if (!infoEntry) throw new Error('No Info.dat or info.dat found in this archive.');

    const infoDir = normalizeZipName(infoEntry.name).includes('/')
        ? normalizeZipName(infoEntry.name).replace(/[^/]+$/, '')
        : '';
    const rawInfo = parseJsonText(await infoEntry.async('string'), infoEntry.name);
    const info = parseInfoDat(rawInfo, '');
    const audioEntry = findZipEntry(zip, info.songFilename, infoDir);
    const coverEntry = findZipEntry(zip, info.coverImageFilename, infoDir);
    const audioUrl = await entryObjectUrl(audioEntry);
    const coverUrl = await entryObjectUrl(coverEntry);
    const objectUrls = [audioUrl, coverUrl].filter(Boolean);

    return {
        kind: 'zip',
        id: `zip-${Date.now()}`,
        title: info.songName,
        artist: info.songAuthorName,
        badge: 'Custom ZIP',
        rawInfo,
        info,
        audioUrl,
        coverUrl,
        difficulties: info.difficulties,
        dispose() {
            objectUrls.forEach(url => URL.revokeObjectURL(url));
        },
        async loadDifficulty(difficulty) {
            const entry = findZipEntry(zip, difficulty.filename, infoDir);
            if (!entry) throw new Error(`No ${difficulty.filename} found in this archive.`);
            const beatmap = parseJsonText(await entry.async('string'), difficulty.filename);
            const notes = normalizeBeatmapNotes(beatmap, info.bpm);
            const lights = normalizeLightshowEvents(beatmap, info.bpm);
            console.info('[Beat Saber parser]', difficulty.label, { notes, lights });
            return { beatmap, difficulty, notes, lights, travelTime: travelTimeForDifficulty(difficulty) };
        }
    };
}

export function runParserSmokeTest() {
    const info = parseInfoDat({
        _beatsPerMinute: 120,
        _songFilename: 'song.ogg',
        _coverImageFilename: 'cover.png',
        _difficultyBeatmapSets: [
            {
                _beatmapCharacteristicName: 'Standard',
                _difficultyBeatmaps: [
                    { _difficulty: 'Normal', _difficultyRank: 3, _beatmapFilename: 'StandardNormal.dat' }
                ]
            }
        ]
    }, './');
    const notes = normalizeBeatmapNotes({
        version: '3.0.0',
        colorNotes: [
            { b: 1, x: 0, y: 0, c: 0, d: 1 },
            { b: 2.5, x: 3, y: 2, c: 1, d: 5 },
            { b: 4, x: 1, y: 1, c: 1, d: 8 }
        ]
    }, info.bpm);
    console.info('[Beat Saber parser smoke test]', notes);
    return notes;
}
