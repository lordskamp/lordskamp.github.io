import { BUILT_IN_TRACKS } from './tracks.js';
import { loadStaticTrack, loadZipTrack, runParserSmokeTest, selectDefaultDifficulty } from './map-parser.js';
import { GameAudio } from './audio-clock.js';
import { BeatSaberSimulation } from './simulation.js';
import { BeatSaberRenderer } from './renderer-three.js';
import { buildPadUrl, createDesktopTransport, createRoomCode, getRoomFromUrl } from './transport-trystero.js';

const state = {
    renderer: null,
    simulation: new BeatSaberSimulation(),
    audio: null,
    track: null,
    difficulty: null,
    difficultyData: null,
    transport: null,
    roomId: getRoomFromUrl() || createRoomCode(),
    playing: false,
    connected: false,
    saber: {
        x: 0.48,
        y: 0.72,
        vector: { x: 0.08, y: 1 },
        bladeVector: { x: 0.08, y: 1 },
        swingVector: { x: 0, y: 1 },
        blade: {
            base: { x: 0.34, y: -0.82 },
            tip: { x: 0.48, y: 0.72 },
            base3D: { x: 0.34, y: -0.82, z: 1.08 },
            tip3D: { x: 0.48, y: 0.72, z: -0.55 },
            axis3D: { x: 0.08, y: 0.74, z: -0.67 },
            twistRad: 0,
            rollRad: 0
        },
        hand: 'right'
    },
    lastHudUpdate: 0,
    lastPadState: 0,
    pointer: { x: 0, y: 0, t: performance.now() }
};

const ui = {
    root: document.querySelector('.bs-page'),
    scene: document.getElementById('bsScene'),
    status: document.getElementById('connectionStatus'),
    roomCode: document.getElementById('roomCode'),
    padLink: document.getElementById('padLink'),
    qrCanvas: document.getElementById('qrCanvas'),
    trackList: document.getElementById('trackList'),
    dropZone: document.getElementById('dropZone'),
    zipInput: document.getElementById('zipInput'),
    difficultySelect: document.getElementById('difficultySelect'),
    selectedCover: document.getElementById('selectedCover'),
    selectedTitle: document.getElementById('selectedTitle'),
    selectedMeta: document.getElementById('selectedMeta'),
    startButton: document.getElementById('startButton'),
    pauseButton: document.getElementById('pauseButton'),
    stopButton: document.getElementById('stopButton'),
    score: document.getElementById('scoreValue'),
    combo: document.getElementById('comboValue'),
    accuracy: document.getElementById('accuracyValue'),
    time: document.getElementById('timeValue'),
    noteCount: document.getElementById('noteCount'),
    swingFlash: document.getElementById('swingFlash')
};

function setStatus(text, mode = 'idle') {
    ui.status.textContent = text;
    ui.status.dataset.mode = mode;
}

function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const rest = Math.floor(safe % 60).toString().padStart(2, '0');
    return `${minutes}:${rest}`;
}

function updateSelectedTrackUi() {
    if (!state.track) return;
    const info = state.track.info;
    ui.selectedTitle.textContent = info.songName || state.track.title || 'Untitled map';
    ui.selectedMeta.textContent = `${info.songAuthorName || state.track.artist} / ${Math.round(info.bpm)} BPM`;
    ui.selectedCover.src = state.track.coverUrl || '';
    ui.selectedCover.hidden = !state.track.coverUrl;
    ui.noteCount.textContent = state.difficultyData ? `${state.difficultyData.notes.length} notes` : 'No notes loaded';
}

function updateHud(force = false) {
    const now = performance.now();
    if (!force && now - state.lastHudUpdate < 90) return;
    state.lastHudUpdate = now;
    const summary = state.simulation.getSummary();
    ui.score.textContent = summary.score.toLocaleString('en-US');
    ui.combo.textContent = `${summary.combo}x`;
    ui.accuracy.textContent = `${summary.accuracy}%`;
    ui.time.textContent = `${formatTime(state.audio?.currentTime || 0)} / ${formatTime(state.audio?.duration || 0)}`;
}

function flashSwing(type) {
    ui.swingFlash.dataset.type = type;
    ui.swingFlash.classList.remove('is-active');
    window.requestAnimationFrame(() => ui.swingFlash.classList.add('is-active'));
}

async function renderQr() {
    const url = buildPadUrl(state.roomId);
    ui.roomCode.textContent = state.roomId;
    ui.padLink.href = url;
    ui.padLink.textContent = url.replace(/^https?:\/\//, '');

    if (window.qrcode && ui.qrCanvas) {
        try {
            const qr = window.qrcode(0, 'M');
            qr.addData(url);
            qr.make();
            const ctx = ui.qrCanvas.getContext('2d');
            const count = qr.getModuleCount();
            const size = ui.qrCanvas.width;
            const margin = 10;
            const moduleSize = (size - (margin * 2)) / count;
            ctx.fillStyle = '#f6feff';
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = '#031014';
            for (let row = 0; row < count; row += 1) {
                for (let col = 0; col < count; col += 1) {
                    if (!qr.isDark(row, col)) continue;
                    ctx.fillRect(
                        Math.round(margin + (col * moduleSize)),
                        Math.round(margin + (row * moduleSize)),
                        Math.ceil(moduleSize),
                        Math.ceil(moduleSize)
                    );
                }
            }
        } catch (error) {
            console.warn('QR generation failed', error);
        }
    }
}

function renderBuiltInTracks() {
    ui.trackList.textContent = '';
    BUILT_IN_TRACKS.forEach(track => {
        const button = document.createElement('button');
        button.className = 'bs-track-button';
        button.type = 'button';
        button.dataset.trackId = track.id;
        button.innerHTML = `
            <span class="bs-track-button__title">${track.title}</span>
            <span class="bs-track-button__meta">${track.artist} / ${track.badge}</span>
        `;
        button.addEventListener('click', () => loadTrackById(track.id));
        ui.trackList.appendChild(button);
    });
}

function markSelectedTrack(trackId) {
    ui.trackList.querySelectorAll('.bs-track-button').forEach(button => {
        button.classList.toggle('is-selected', button.dataset.trackId === trackId);
    });
}

function renderDifficulties() {
    ui.difficultySelect.textContent = '';
    state.track.difficulties.forEach(difficulty => {
        const option = document.createElement('option');
        option.value = difficulty.key;
        option.textContent = difficulty.label;
        ui.difficultySelect.appendChild(option);
    });

    const selected = selectDefaultDifficulty(state.track.difficulties);
    if (selected) {
        ui.difficultySelect.value = selected.key;
        return loadDifficulty(selected.key);
    }
    ui.noteCount.textContent = 'No supported difficulty';
    return Promise.resolve();
}

async function prepareAudio() {
    if (state.audio) {
        state.audio.stop();
        state.audio = null;
    }
    state.audio = new GameAudio();
    state.audio.onEnded = () => {
        state.playing = false;
        ui.root.classList.remove('is-playing');
        setStatus('Track finished', 'ready');
    };
    await state.audio.load(state.track.audioUrl);
}

async function loadTrack(trackPromise, trackId = '') {
    stopGame();
    setStatus('Loading track...', 'loading');
    state.track?.dispose?.();
    state.track = await trackPromise;
    markSelectedTrack(trackId || state.track.id);
    await renderDifficulties();
    await prepareAudio();
    updateSelectedTrackUi();
    updateHud(true);
    setStatus(state.connected ? 'Pad connected' : 'Ready', state.connected ? 'online' : 'ready');
}

async function loadTrackById(trackId) {
    const track = BUILT_IN_TRACKS.find(item => item.id === trackId);
    if (!track) return;

    try {
        await loadTrack(loadStaticTrack(track), trackId);
    } catch (error) {
        console.error(error);
        setStatus(error.message, 'error');
    }
}

async function loadDifficulty(key) {
    if (!state.track) return;
    const difficulty = state.track.difficulties.find(item => item.key === key);
    if (!difficulty) return;

    setStatus('Loading difficulty...', 'loading');
    state.difficulty = difficulty;
    state.difficultyData = await state.track.loadDifficulty(difficulty);
    state.simulation.loadNotes(state.difficultyData.notes, { travelTime: state.difficultyData.travelTime });
    updateSelectedTrackUi();
    updateHud(true);
    setStatus(state.connected ? 'Pad connected' : 'Ready', state.connected ? 'online' : 'ready');
}

async function handleZipFile(file) {
    if (!file) return;

    try {
        await loadTrack(loadZipTrack(file), '');
    } catch (error) {
        console.error(error);
        setStatus(error.message, 'error');
    }
}

async function startGame() {
    if (!state.track || !state.audio || !state.difficultyData) return;
    try {
        state.simulation.resetScore();
        await state.audio.start(0);
        state.playing = true;
        ui.root.classList.add('is-playing');
        setStatus(state.connected ? 'Playing with pad' : 'Playing', state.connected ? 'online' : 'ready');
        updateHud(true);
    } catch (error) {
        console.error(error);
        setStatus(error.message, 'error');
    }
}

function pauseGame() {
    if (!state.audio) return;
    state.audio.pause();
    state.playing = false;
    ui.root.classList.remove('is-playing');
    setStatus('Paused', 'ready');
}

function stopGame() {
    if (state.audio) state.audio.stop();
    state.playing = false;
    ui.root?.classList.remove('is-playing');
    state.simulation.resetScore();
    updateHud(true);
}

function handleSwing(swing) {
    const payload = {
        ...swing,
        x: Number.isFinite(swing.x) ? swing.x : state.saber.x,
        y: Number.isFinite(swing.y) ? swing.y : state.saber.y,
        vector: swing.vector || swing.bladeVector || state.saber.bladeVector || state.saber.vector,
        bladeVector: swing.bladeVector || state.saber.bladeVector,
        swingVector: swing.swingVector || swing.vector || state.saber.swingVector || state.saber.vector,
        directionCandidates: Array.isArray(swing.directionCandidates) ? swing.directionCandidates : [],
        blade: swing.blade || state.saber.blade,
        source: swing.source || 'desktop',
        time: state.audio?.currentTime || 0
    };

    state.saber = { ...state.saber, ...payload };
    flashSwing('neutral');

    if (!state.playing) return;

    const events = state.simulation.trySwing(payload);
    if (!events.length) return;

    let best = 'neutral';
    events.forEach(event => {
        if (event.type === 'hit') best = 'hit';
        if (event.type === 'bad-cut') best = best === 'hit' ? best : 'bad';
        state.renderer.pulseNote(event.note, event.type === 'hit' ? 'hit' : 'bad');
    });

    flashSwing(best);
    state.transport?.sendFeedback?.({ type: best, score: state.simulation.score, combo: state.simulation.combo });
    updateHud(true);
}

function setupPointerFallback() {
    const makeBladeFromPointer = (x, y) => {
        const base = { x: state.saber.hand === 'left' ? -0.34 : 0.34, y: -0.82 };
        const tip = { x: Math.max(-1.12, Math.min(1.12, x)), y: Math.max(-1, Math.min(1.08, y)) };
        const dx = tip.x - base.x;
        const dy = tip.y - base.y;
        const length = Math.hypot(dx, dy) || 1;
        return {
            base,
            tip,
            base3D: { x: base.x, y: base.y, z: 1.08 },
            tip3D: { x: tip.x, y: tip.y, z: -0.55 },
            axis3D: { x: dx / length, y: dy / length, z: -0.72 },
            vector: { x: dx / length, y: dy / length },
            twistRad: 0,
            rollRad: 0
        };
    };

    ui.scene.addEventListener('pointermove', event => {
        const rect = ui.scene.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = (1 - ((event.clientY - rect.top) / rect.height)) * 2 - 1;
        const now = performance.now();
        const dt = Math.max((now - state.pointer.t) / 1000, 0.016);
        const vector = {
            x: (x - state.pointer.x) / dt,
            y: (y - state.pointer.y) / dt
        };
        const length = Math.hypot(vector.x, vector.y) || 1;
        const blade = makeBladeFromPointer(x, y);
        state.saber = {
            ...state.saber,
            x: blade.tip.x,
            y: blade.tip.y,
            vector: blade.vector,
            bladeVector: blade.vector,
            swingVector: { x: vector.x / length, y: vector.y / length },
            blade
        };
        state.pointer = { x, y, t: now };
    });

    ui.scene.addEventListener('pointerdown', event => {
        ui.scene.setPointerCapture?.(event.pointerId);
        handleSwing({ ...state.saber, power: 0.9 });
    });

    window.addEventListener('keydown', event => {
        if (event.code !== 'Space') return;
        event.preventDefault();
        handleSwing({ ...state.saber, power: 0.85 });
    });
}

function setupDragDrop() {
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
    ui.dropZone.addEventListener('drop', event => handleZipFile(event.dataTransfer.files[0]));
    ui.zipInput.addEventListener('change', event => handleZipFile(event.target.files[0]));
}

async function setupTransport() {
    setStatus('Connecting room...', 'loading');
    state.transport = await createDesktopTransport(state.roomId, {
        onStatus: (mode, message) => setStatus(message, mode === 'online' ? 'ready' : mode),
        onPeerJoin: () => {
            state.connected = true;
            setStatus('Pad connected', 'online');
        },
        onPeerLeave: () => {
            state.connected = false;
            setStatus('Pad disconnected', 'ready');
        },
        onHello: data => {
            if (data?.role === 'pad') {
                state.connected = true;
                setStatus('Pad connected', 'online');
            }
        },
        onPose: data => {
            state.connected = true;
            state.saber = {
                ...state.saber,
                x: Math.max(-1, Math.min(1, Number(data.x) || 0)),
                y: Math.max(-1, Math.min(1, Number(data.y) || 0)),
                vector: data.bladeVector || data.vector || state.saber.vector,
                bladeVector: data.bladeVector || data.vector || state.saber.bladeVector,
                swingVector: data.swingVector || state.saber.swingVector,
                blade: data.blade || state.saber.blade,
                hand: data.hand || state.saber.hand
            };
        },
        onSwing: data => {
            state.connected = true;
            handleSwing({
                x: Number(data.x),
                y: Number(data.y),
                vector: data.vector,
                bladeVector: data.bladeVector,
                swingVector: data.swingVector || data.vector,
                directionCandidates: data.directionCandidates,
                blade: data.blade,
                power: Number(data.power) || 0.8,
                source: data.source || 'motion-pad',
                hand: data.hand || state.saber.hand
            });
        }
    });
}

function sendPadState(now) {
    if (!state.transport || now - state.lastPadState < 180) return;
    state.lastPadState = now;
    const summary = state.simulation.getSummary();
    state.transport.sendState({
        playing: state.playing,
        score: summary.score,
        combo: summary.combo,
        accuracy: summary.accuracy,
        time: state.audio?.currentTime || 0
    });
}

function setupControls() {
    ui.startButton.addEventListener('click', startGame);
    ui.pauseButton.addEventListener('click', pauseGame);
    ui.stopButton.addEventListener('click', stopGame);
    ui.difficultySelect.addEventListener('change', event => {
        stopGame();
        loadDifficulty(event.target.value).catch(error => {
            console.error(error);
            setStatus(error.message, 'error');
        });
    });
}

async function init() {
    runParserSmokeTest();
    renderBuiltInTracks();
    await renderQr();
    setupControls();
    setupDragDrop();
    setupPointerFallback();

    state.renderer = new BeatSaberRenderer();
    await state.renderer.init(ui.scene);
    state.renderer.start((dt, now) => {
        const currentTime = state.audio?.currentTime || 0;
        const events = state.simulation.update(currentTime);
        events.forEach(event => {
            state.renderer.pulseNote(event.note, 'bad');
            state.transport?.sendFeedback?.({ type: 'miss', combo: 0 });
        });
        state.renderer.updateFrame({
            notes: state.simulation.notes,
            lightEvents: state.difficultyData?.lights || [],
            currentTime,
            travelTime: state.simulation.travelTime,
            saber: state.saber
        });
        updateHud(false);
        sendPadState(now);
    });

    setupTransport();
    await loadTrackById(BUILT_IN_TRACKS[0].id);
}

init().catch(error => {
    console.error(error);
    setStatus(error.message, 'error');
});
