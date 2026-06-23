import { AudioClock } from './audio-clock.js';
import { loadTrackFromFile, loadTrackFromUrl } from './beatmap-loader.js';
import { BUILT_IN_LIGHTMAP_URL, BUILT_IN_TRACK_URL } from './constants.js';
import { BeatSaberScene } from './renderer.js';
import { SaberTracker } from './saber-tracker.js';
import { OneSaberSimulation } from './simulation.js';
import { buildPadUrl, createDesktopTransport, getInitialRoom, normalizeRoom } from './transport.js';

const ui = {
    shell: document.querySelector('.game-shell'),
    scene: document.getElementById('scene'),
    status: document.getElementById('connectionStatus'),
    roomCode: document.getElementById('roomCode'),
    roomInput: document.getElementById('roomInput'),
    serverInput: document.getElementById('serverInput'),
    padLink: document.getElementById('padLink'),
    qrCanvas: document.getElementById('qrCanvas'),
    cover: document.getElementById('coverImage'),
    title: document.getElementById('trackTitle'),
    meta: document.getElementById('trackMeta'),
    difficulty: document.getElementById('difficultySelect'),
    loadBuiltIn: document.getElementById('loadBuiltInButton'),
    dropZone: document.getElementById('dropZone'),
    zipInput: document.getElementById('zipInput'),
    play: document.getElementById('playButton'),
    pause: document.getElementById('pauseButton'),
    recenter: document.getElementById('recenterButton'),
    score: document.getElementById('scoreValue'),
    combo: document.getElementById('comboValue'),
    accuracy: document.getElementById('accuracyValue'),
    time: document.getElementById('timeValue')
};

const state = {
    room: getInitialRoom(),
    serverUrl: new URLSearchParams(window.location.search).get('server') || '',
    renderer: new BeatSaberScene(),
    tracker: new SaberTracker(),
    simulation: new OneSaberSimulation(),
    audio: new AudioClock(),
    transport: null,
    track: null,
    difficultyData: null,
    playing: false,
    lastHudAt: 0,
    lastStateAt: 0,
    lastCutAt: 0
};

function setStatus(text, mode = 'ready') {
    ui.status.textContent = text;
    ui.shell.dataset.state = mode;
}

function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const rest = Math.floor(safe % 60).toString().padStart(2, '0');
    return `${minutes}:${rest}`;
}

function updateHud(force = false) {
    const now = performance.now();
    if (!force && now - state.lastHudAt < 100) return;
    state.lastHudAt = now;
    const summary = state.simulation.summary();
    ui.score.textContent = summary.score.toLocaleString('en-US');
    ui.combo.textContent = `${summary.combo}x`;
    ui.accuracy.textContent = `${summary.accuracy}%`;
    ui.time.textContent = `${formatTime(state.audio.currentTime)} / ${formatTime(state.audio.duration)}`;
}

function renderPairing() {
    ui.roomCode.textContent = state.room;
    ui.roomInput.value = state.room;
    ui.serverInput.value = state.serverUrl;

    const url = buildPadUrl(state.room, state.serverUrl);
    ui.padLink.href = url;
    ui.padLink.textContent = url.replace(/^https?:\/\//, '');

    if (!window.qrcode || !ui.qrCanvas) return;
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const ctx = ui.qrCanvas.getContext('2d');
    const size = ui.qrCanvas.width;
    const count = qr.getModuleCount();
    const margin = 10;
    const unit = (size - margin * 2) / count;
    ctx.fillStyle = '#f7feff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#031014';
    for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
            if (!qr.isDark(row, col)) continue;
            ctx.fillRect(Math.round(margin + col * unit), Math.round(margin + row * unit), Math.ceil(unit), Math.ceil(unit));
        }
    }
}

function renderTrack() {
    if (!state.track) return;
    ui.title.textContent = state.track.title;
    const noteCount = state.difficultyData?.notes.length || 0;
    const lightCount = state.difficultyData?.lightEvents.length || 0;
    ui.meta.textContent = `${state.track.artist || 'Unknown'} / ${Math.round(state.track.bpm)} BPM / ${noteCount} notes / ${lightCount} lights`;
    ui.cover.src = state.track.coverUrl || '';
    ui.cover.hidden = !state.track.coverUrl;

    ui.difficulty.textContent = '';
    state.track.difficulties.forEach(difficulty => {
        const option = document.createElement('option');
        option.value = difficulty.key;
        option.textContent = difficulty.label;
        ui.difficulty.appendChild(option);
    });
    if (state.difficultyData) ui.difficulty.value = state.difficultyData.difficulty.key;
}

async function loadDifficulty(key) {
    if (!state.track) return;
    state.difficultyData = await state.track.loadDifficulty(key);
    state.simulation.load(state.difficultyData);
    renderTrack();
    updateHud(true);
}

async function loadTrack(trackPromise) {
    setStatus('Завантаження мапи', 'loading');
    state.playing = false;
    state.audio.stop();
    state.track?.dispose?.();
    state.track = await trackPromise;
    const defaultDifficulty = state.track.difficulties.at(-2) || state.track.difficulties.at(-1);
    await loadDifficulty(defaultDifficulty.key);
    await state.audio.load(state.track.audioUrl);
    renderTrack();
    updateHud(true);
    setStatus('Готово', 'ready');
}

async function setupTransport() {
    state.transport?.close();
    state.transport = await createDesktopTransport({
        room: state.room,
        serverUrl: state.serverUrl,
        onStatus: message => setStatus(message, state.playing ? 'playing' : 'ready'),
        onHello: () => setStatus('Pad connected', state.playing ? 'playing' : 'ready'),
        onPose: payload => {
            state.tracker.updateFromPose(payload);
        }
    });
    renderPairing();
}

function handleCutEvents(events) {
    if (!events.length) return;
    events.forEach(event => {
        state.renderer.pulseNote(event.note, event.type === 'hit' ? 'hit' : 'bad');
    });
    const best = events.some(event => event.type === 'hit') ? 'hit' : 'bad';
    const summary = state.simulation.summary();
    state.transport?.sendFeedback({ type: best, score: summary.score, combo: summary.combo });
    updateHud(true);
}

function maybeTryCut(now) {
    const saber = state.tracker.saber;
    const speed = Math.hypot(saber.tipVelocity?.x || 0, saber.tipVelocity?.y || 0, saber.tipVelocity?.z || 0);
    if (speed < 1.15 || now - state.lastCutAt < 70) return;
    state.lastCutAt = now;
    handleCutEvents(state.simulation.tryCut(saber, state.audio.currentTime));
}

async function play() {
    if (!state.track || !state.difficultyData) return;
    try {
        await state.audio.play(state.audio.ended);
        state.playing = true;
        setStatus('Playing', 'playing');
    } catch (error) {
        setStatus(error.message || 'Audio blocked', 'error');
    }
}

function pause() {
    state.audio.pause();
    state.playing = false;
    setStatus('Paused', 'ready');
}

function setupPointerFallback() {
    ui.scene.addEventListener('pointermove', event => {
        const rect = ui.scene.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = (1 - ((event.clientY - rect.top) / rect.height)) * 2 - 1;
        state.tracker.updateFromPointer(x, y);
    });

    ui.scene.addEventListener('pointerdown', event => {
        ui.scene.setPointerCapture?.(event.pointerId);
        handleCutEvents(state.simulation.tryCut({
            ...state.tracker.saber,
            tipVelocity: { x: 0, y: -2.2, z: 0 },
            swingVector: { x: 0, y: -1 }
        }, state.audio.currentTime));
    });
}

function setupDropZone() {
    ['dragenter', 'dragover'].forEach(name => {
        ui.dropZone.addEventListener(name, event => {
            event.preventDefault();
            ui.dropZone.classList.add('is-dragging');
        });
    });
    ['dragleave', 'drop'].forEach(name => {
        ui.dropZone.addEventListener(name, event => {
            event.preventDefault();
            ui.dropZone.classList.remove('is-dragging');
        });
    });
    ui.dropZone.addEventListener('drop', event => {
        loadTrack(loadTrackFromFile(event.dataTransfer.files[0])).catch(error => setStatus(error.message, 'error'));
    });
    ui.zipInput.addEventListener('change', event => {
        loadTrack(loadTrackFromFile(event.target.files[0])).catch(error => setStatus(error.message, 'error'));
    });
}

function setupControls() {
    ui.play.addEventListener('click', play);
    ui.pause.addEventListener('click', pause);
    ui.recenter.addEventListener('click', () => state.tracker.recenter());
    ui.loadBuiltIn.addEventListener('click', () => loadTrack(loadTrackFromUrl(BUILT_IN_TRACK_URL, { lightmapUrl: BUILT_IN_LIGHTMAP_URL })).catch(error => setStatus(error.message, 'error')));
    ui.difficulty.addEventListener('change', event => {
        pause();
        loadDifficulty(event.target.value).catch(error => setStatus(error.message, 'error'));
    });
    ui.roomInput.addEventListener('change', event => {
        state.room = normalizeRoom(event.target.value) || state.room;
        setupTransport();
    });
    ui.serverInput.addEventListener('change', event => {
        state.serverUrl = event.target.value.trim();
        setupTransport();
    });
}

function sendPadState(now) {
    if (!state.transport || now - state.lastStateAt < 150) return;
    state.lastStateAt = now;
    state.transport.sendState({
        playing: state.playing,
        time: state.audio.currentTime,
        ...state.simulation.summary()
    });
}

async function init() {
    setupControls();
    setupDropZone();
    setupPointerFallback();
    renderPairing();
    await setupTransport();
    await state.renderer.init(ui.scene);
    state.renderer.start((dt, now) => {
        if (state.playing) {
            const misses = state.simulation.update(state.audio.currentTime);
            misses.forEach(event => state.renderer.pulseNote(event.note, 'bad'));
            if (state.audio.ended) pause();
        }
        maybeTryCut(now);
        state.renderer.update({
            notes: state.simulation.notes,
            lightEvents: state.simulation.lightEvents,
            currentTime: state.audio.currentTime,
            travelTime: state.simulation.travelTime,
            saber: state.tracker.saber
        });
        updateHud(false);
        sendPadState(now);
    });
    await loadTrack(loadTrackFromUrl(BUILT_IN_TRACK_URL, { lightmapUrl: BUILT_IN_LIGHTMAP_URL }));
}

init().catch(error => setStatus(error.message || 'Startup failed', 'error'));
