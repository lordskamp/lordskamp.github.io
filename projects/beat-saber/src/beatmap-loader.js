import { JSZIP_MODULE_URL } from './constants.js';

function pick(object, ...keys) {
    for (const key of keys) {
        if (object && object[key] !== undefined) return object[key];
    }
    return undefined;
}

function findEntry(zip, filename) {
    const normalized = String(filename || '').toLowerCase();
    return Object.values(zip.files).find(file => !file.dir && file.name.toLowerCase() === normalized);
}

function difficultyLabel(value) {
    if (value === 'ExpertPlus') return 'Expert+';
    return value || 'Normal';
}

function beatToSeconds(beat, bpm, songOffset) {
    return (Number(beat) || 0) * 60 / bpm + songOffset;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function makeObjectUrl(zip, filename, mimeType) {
    const entry = findEntry(zip, filename);
    if (!entry) return Promise.resolve('');
    return entry.async('blob').then(blob => URL.createObjectURL(new Blob([blob], { type: mimeType })));
}

function parseDifficultySets(info) {
    const v4Difficulties = Array.isArray(info.difficultyBeatmaps) ? info.difficultyBeatmaps : null;
    if (v4Difficulties) {
        const oneSaber = v4Difficulties.filter(item => item.characteristic === 'OneSaber');
        const selected = oneSaber.length ? oneSaber : v4Difficulties;
        return selected.map(item => ({
            key: item.difficulty,
            label: difficultyLabel(item.difficulty),
            rank: Number(item.difficultyRank) || Number(item.difficultyRankLabel) || 0,
            filename: item.beatmapDataFilename,
            lightshowFilename: item.lightshowDataFilename,
            jumpSpeed: Number(item.noteJumpMovementSpeed) || 16,
            beatOffset: Number(item.noteJumpStartBeatOffset) || 0,
            characteristic: item.characteristic || 'Standard'
        })).filter(item => item.key && item.filename).sort((a, b) => a.rank - b.rank);
    }

    const sets = pick(info, '_difficultyBeatmapSets', 'difficultyBeatmapSets') || [];
    const oneSaber = sets.find(set => pick(set, '_beatmapCharacteristicName', 'beatmapCharacteristicName') === 'OneSaber');
    const selectedSet = oneSaber || sets[0] || {};
    const characteristic = pick(selectedSet, '_beatmapCharacteristicName', 'beatmapCharacteristicName') || 'Standard';
    const difficulties = pick(selectedSet, '_difficultyBeatmaps', 'difficultyBeatmaps') || [];

    return difficulties.map(item => ({
        key: pick(item, '_difficulty', 'difficulty'),
        label: difficultyLabel(pick(item, '_difficulty', 'difficulty')),
        rank: Number(pick(item, '_difficultyRank', 'difficultyRank')) || 0,
        filename: pick(item, '_beatmapFilename', 'beatmapFilename'),
        lightshowFilename: pick(item, '_lightshowDataFilename', 'lightshowDataFilename'),
        jumpSpeed: Number(pick(item, '_noteJumpMovementSpeed', 'noteJumpMovementSpeed')) || 16,
        beatOffset: Number(pick(item, '_noteJumpStartBeatOffset', 'noteJumpStartBeatOffset')) || 0,
        characteristic
    })).filter(item => item.key && item.filename).sort((a, b) => a.rank - b.rank);
}

function noteKey(note) {
    return `${note.beat.toFixed(3)}:${note.x}:${note.y}:${note.color}:${note.direction}`;
}

function normalizeV4ColorNotes(data) {
    if (!Array.isArray(data.colorNotes) || !Array.isArray(data.colorNotesData)) return null;
    return data.colorNotes.map(note => {
        const meta = data.colorNotesData[Number(note.i) || 0] || {};
        return {
            beat: Number(note.b) || 0,
            x: Number(meta.x) || 0,
            y: Number(meta.y) || 0,
            color: Number(meta.c) || 0,
            direction: Number(meta.d),
            angle: Number(meta.a) || 0
        };
    });
}

function normalizeNotes(data, bpm, songOffset) {
    const v4Notes = normalizeV4ColorNotes(data);
    const rawNotes = v4Notes || (Array.isArray(data.colorNotes)
        ? data.colorNotes.map(note => ({
            beat: Number(note.b) || 0,
            x: Number(note.x) || 0,
            y: Number(note.y) || 0,
            color: Number(note.c) || 0,
            direction: Number(note.d),
            angle: Number(note.a) || 0
        }))
        : (data._notes || []).map(note => ({
            beat: Number(note._time) || 0,
            x: Number(note._lineIndex) || 0,
            y: Number(note._lineLayer) || 0,
            color: Number(note._type) || 0,
            direction: Number(note._cutDirection),
            angle: 0
        })));

    const seen = new Set();
    return rawNotes
        .filter(note => note.color === 1 && note.x >= 0 && note.x <= 3 && note.y >= 0 && note.y <= 2)
        .map(note => ({
            ...note,
            direction: Number.isFinite(note.direction) ? note.direction : 8,
            timeSec: beatToSeconds(note.beat, bpm, songOffset),
            state: 'pending',
            runtimeId: ''
        }))
        .filter(note => {
            const key = noteKey(note);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => a.timeSec - b.timeSec)
        .map((note, index) => ({ ...note, runtimeId: `note-${index}` }));
}

function lightColorFromBasicValue(value) {
    if (value === 9) return 'white';
    if (value >= 1 && value <= 4) return 'blue';
    if (value >= 5 && value <= 8) return 'red';
    return 'off';
}

function intensityFromBasicValue(value, floatValue = 1) {
    if (value <= 0) return 0;
    const flash = value === 2 || value === 3 || value === 6 || value === 7 ? 1.35 : 0.86;
    const fade = value === 3 || value === 7 ? 0.78 : 1;
    return clamp((Number(floatValue) || 1) * flash * fade, 0.18, 2.4);
}

function normalizeBasicEvents(data, bpm, songOffset) {
    let rawEvents = [];

    if (Array.isArray(data.basicEvents) && Array.isArray(data.basicEventsData)) {
        rawEvents = data.basicEvents.map(event => {
            const meta = data.basicEventsData[Number(event.i) || 0] || {};
            return {
                beat: Number(event.b) || 0,
                target: Number(meta.t) || 0,
                value: Number(meta.i) || 0,
                floatValue: Number(meta.f) || 1
            };
        });
    } else if (Array.isArray(data.basicBeatmapEvents)) {
        rawEvents = data.basicBeatmapEvents.map(event => ({
            beat: Number(event.b) || 0,
            target: Number(event.et) || 0,
            value: Number(event.i) || 0,
            floatValue: Number(event.f) || 1
        }));
    } else if (Array.isArray(data._events)) {
        rawEvents = data._events.map(event => ({
            beat: Number(event._time) || 0,
            target: Number(event._type) || 0,
            value: Number(event._value) || 0,
            floatValue: Number(event._floatValue) || 1
        }));
    }

    return rawEvents.map((event, index) => ({
        id: `basic-light-${index}`,
        kind: 'basic',
        timeSec: beatToSeconds(event.beat, bpm, songOffset),
        target: event.target,
        value: event.value,
        color: lightColorFromBasicValue(event.value),
        intensity: intensityFromBasicValue(event.value, event.floatValue)
    }));
}

function normalizeColorBoxEvents(data, bpm, songOffset) {
    const events = [];

    if (Array.isArray(data.lightColorEventBoxGroups)) {
        data.lightColorEventBoxGroups.forEach((group, groupIndex) => {
            (group.e || []).forEach((box, boxIndex) => {
                (box.e || []).forEach((event, eventIndex) => {
                    events.push({
                        id: `color-box-${groupIndex}-${boxIndex}-${eventIndex}`,
                        kind: 'color-box',
                        timeSec: beatToSeconds((Number(group.b) || 0) + (Number(event.b) || 0), bpm, songOffset),
                        target: Number(group.g) || groupIndex,
                        color: Number(event.c) === 2 ? 'white' : Number(event.c) === 1 ? 'blue' : 'red',
                        intensity: clamp(Number(event.s) || Number(event.brightness) || 1, 0.18, 2.4),
                        strobe: Number(event.f) || 0
                    });
                });
            });
        });
    }

    if (Array.isArray(data.eventBoxGroups) && Array.isArray(data.lightColorEventBoxes) && Array.isArray(data.lightColorEvents)) {
        data.eventBoxGroups.forEach((group, groupIndex) => {
            (group.e || []).forEach((lane, laneIndex) => {
                (lane.l || []).forEach((boxRef, refIndex) => {
                    const box = data.lightColorEventBoxes[Number(boxRef.i) || 0];
                    const event = box ? data.lightColorEvents[Number(box.e) || 0] : null;
                    if (!event) return;
                    events.push({
                        id: `v4-color-box-${groupIndex}-${laneIndex}-${refIndex}`,
                        kind: 'color-box',
                        timeSec: beatToSeconds((Number(group.b) || 0) + (Number(boxRef.b) || 0) + (Number(event.p) || 0), bpm, songOffset),
                        target: Number(group.g) || groupIndex,
                        color: Number(event.c) === 2 ? 'white' : Number(event.c) === 1 ? 'blue' : 'red',
                        intensity: clamp(Number(event.b) || 1, 0.18, 2.4),
                        strobe: Number(event.f) || 0
                    });
                });
            });
        });
    }

    return events;
}

function normalizeRotationEvents(data, bpm, songOffset) {
    const events = [];

    if (Array.isArray(data.lightRotationEventBoxGroups)) {
        data.lightRotationEventBoxGroups.forEach((group, groupIndex) => {
            (group.e || []).forEach((box, boxIndex) => {
                (box.l || []).forEach((event, eventIndex) => {
                    events.push({
                        id: `rotation-${groupIndex}-${boxIndex}-${eventIndex}`,
                        kind: 'rotation',
                        timeSec: beatToSeconds((Number(group.b) || 0) + (Number(event.b) || 0), bpm, songOffset),
                        target: Number(group.g) || groupIndex,
                        axis: Number(box.a) || 1,
                        rotation: Number(event.r) || 0,
                        intensity: 0.65
                    });
                });
            });
        });
    }

    return events;
}

function normalizeLightEvents(data, bpm, songOffset) {
    return [
        ...normalizeBasicEvents(data, bpm, songOffset),
        ...normalizeColorBoxEvents(data, bpm, songOffset),
        ...normalizeRotationEvents(data, bpm, songOffset)
    ].filter(event => event.intensity > 0 || event.kind === 'rotation')
        .sort((a, b) => a.timeSec - b.timeSec);
}

async function readJsonEntry(zip, filename) {
    const entry = findEntry(zip, filename);
    if (!entry) return null;
    return JSON.parse(await entry.async('text'));
}

async function loadExternalLightmap(JSZip, lightmapBlob) {
    if (!lightmapBlob) return null;
    const zip = await JSZip.loadAsync(lightmapBlob);
    const infoEntry = findEntry(zip, 'info.dat') || findEntry(zip, 'Info.dat');
    if (!infoEntry) return null;
    const info = JSON.parse(await infoEntry.async('text'));
    return {
        zip,
        info,
        bpm: Number(pick(info, '_beatsPerMinute', 'beatsPerMinute', info.audio?.bpm)) || 120,
        songOffset: Number(pick(info, '_songTimeOffset', 'songTimeOffset')) || 0,
        difficulties: parseDifficultySets(info)
    };
}

async function loadExternalLightEvents(externalLightmap, difficulty) {
    if (!externalLightmap) return { events: [], source: '' };
    const sourceDifficulty = externalLightmap.difficulties.find(item => item.key === difficulty.key)
        || externalLightmap.difficulties.find(item => item.rank === difficulty.rank)
        || externalLightmap.difficulties.at(-1);
    if (!sourceDifficulty) return { events: [], source: '' };
    const sourceData = await readJsonEntry(externalLightmap.zip, sourceDifficulty.lightshowFilename || sourceDifficulty.filename);
    if (!sourceData) return { events: [], source: '' };
    return {
        events: normalizeLightEvents(sourceData, externalLightmap.bpm, externalLightmap.songOffset),
        source: sourceDifficulty.lightshowFilename || sourceDifficulty.filename
    };
}

async function parseZip(blob, sourceName, options = {}) {
    const { default: JSZip } = await import(JSZIP_MODULE_URL);
    const zip = await JSZip.loadAsync(blob);
    const externalLightmap = await loadExternalLightmap(JSZip, options.lightmapBlob);
    const infoEntry = findEntry(zip, 'info.dat') || findEntry(zip, 'Info.dat');
    if (!infoEntry) throw new Error('У ZIP немає info.dat');

    const info = JSON.parse(await infoEntry.async('text'));
    const bpm = Number(pick(info, '_beatsPerMinute', 'beatsPerMinute', info.audio?.bpm)) || 120;
    const songOffset = Number(pick(info, '_songTimeOffset', 'songTimeOffset')) || 0;
    const songFilename = pick(info, '_songFilename', 'songFilename', info.audio?.songFilename);
    const coverFilename = pick(info, '_coverImageFilename', 'coverImageFilename');
    const difficulties = parseDifficultySets(info);

    if (!difficulties.length) throw new Error('Не знайдено OneSaber/Standard difficulty');
    if (!songFilename || !findEntry(zip, songFilename)) throw new Error('У ZIP немає аудіофайлу');

    const urls = [];
    const audioUrl = await makeObjectUrl(zip, songFilename, songFilename.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg');
    urls.push(audioUrl);
    const coverUrl = coverFilename ? await makeObjectUrl(zip, coverFilename, 'image/jpeg') : '';
    if (coverUrl) urls.push(coverUrl);

    return {
        sourceName,
        info,
        title: pick(info, '_songName', 'songName', info.song?.title) || sourceName || 'Untitled',
        artist: pick(info, '_songAuthorName', 'songAuthorName', info.song?.author) || '',
        mapper: pick(info, '_levelAuthorName', 'levelAuthorName') || '',
        bpm,
        songOffset,
        audioUrl,
        coverUrl,
        difficulties,
        async loadDifficulty(difficultyKey) {
            const difficulty = difficulties.find(item => item.key === difficultyKey) || difficulties[difficulties.length - 1];
            const beatmapData = await readJsonEntry(zip, difficulty.filename);
            if (!beatmapData) throw new Error(`Не знайдено ${difficulty.filename}`);

            const lightshowData = difficulty.lightshowFilename
                ? await readJsonEntry(zip, difficulty.lightshowFilename)
                : null;

            let lightEvents = normalizeLightEvents(lightshowData || beatmapData, bpm, songOffset);
            let lightSource = lightshowData ? difficulty.lightshowFilename : difficulty.filename;

            if (!lightEvents.length && externalLightmap) {
                const external = await loadExternalLightEvents(externalLightmap, difficulty);
                lightEvents = external.events;
                lightSource = external.source ? `${external.source} sidecar` : lightSource;
            }

            return {
                difficulty,
                notes: normalizeNotes(beatmapData, bpm, songOffset),
                lightEvents,
                lightSource,
                travelTime: Math.max(1.25, Math.min(2.7, 2.35 - ((difficulty.jumpSpeed - 14) * 0.055)))
            };
        },
        dispose() {
            urls.forEach(url => URL.revokeObjectURL(url));
        }
    };
}

export async function loadTrackFromUrl(url, options = {}) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Не вдалося завантажити мапу: ${response.status}`);
    let lightmapBlob = null;
    if (options.lightmapUrl) {
        const lightmapResponse = await fetch(options.lightmapUrl);
        if (lightmapResponse.ok) lightmapBlob = await lightmapResponse.blob();
    }
    return parseZip(await response.blob(), url.split('/').pop() || 'Built-in track', { lightmapBlob });
}

export function loadTrackFromFile(file) {
    if (!file) throw new Error('Файл не вибрано');
    return parseZip(file, file.name);
}
