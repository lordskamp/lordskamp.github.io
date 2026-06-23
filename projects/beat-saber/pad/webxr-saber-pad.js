const XR_SESSION_MODE = 'immersive-ar';
const XR_OPTIONS = { requiredFeatures: ['local-floor'] };
const SOCKET_IO_MODULE_URL = 'https://cdn.socket.io/4.7.5/socket.io.esm.min.js';
const POSE_EVENT = 'saber:pose';
const HELLO_EVENT = 'saber:hello';

const ui = {
    shell: document.querySelector('.pad-shell'),
    startButton: document.getElementById('startSaberButton'),
    stopButton: document.getElementById('stopSaberButton'),
    roomInput: document.getElementById('roomInput'),
    serverInput: document.getElementById('serverInput'),
    roomLabel: document.getElementById('roomLabel'),
    trackingState: document.getElementById('trackingState'),
    posX: document.getElementById('posX'),
    posY: document.getElementById('posY'),
    posZ: document.getElementById('posZ'),
    frameRate: document.getElementById('frameRate')
};

const params = new URLSearchParams(window.location.search);

const state = {
    room: normalizeRoom(params.get('room')) || '0000',
    serverUrl: params.get('server') || params.get('socket') || '',
    session: null,
    referenceSpace: null,
    transport: null,
    frameCount: 0,
    fpsStart: performance.now(),
    lastPose: null,
    seq: 0
};

function normalizeRoom(value) {
    return String(value || '').replace(/[^\w-]/g, '').slice(0, 8);
}

function setStatus(message, mode = 'idle') {
    ui.trackingState.textContent = message;
    ui.shell.dataset.state = mode;
}

function setRoom(value) {
    state.room = normalizeRoom(value) || '0000';
    ui.roomInput.value = state.room === '0000' ? '' : state.room;
    ui.roomLabel.textContent = state.room;
}

function setServerUrl(value) {
    state.serverUrl = String(value || '').trim();
    ui.serverInput.value = state.serverUrl;
}

function clonePoint(point) {
    return {
        x: Number(point?.x) || 0,
        y: Number(point?.y) || 0,
        z: Number(point?.z) || 0
    };
}

function cloneQuaternion(quaternion) {
    return {
        x: Number(quaternion?.x) || 0,
        y: Number(quaternion?.y) || 0,
        z: Number(quaternion?.z) || 0,
        w: Number(quaternion?.w) || 1
    };
}

function cloneMatrix(matrix) {
    return Array.from(matrix || []);
}

function quaternionConjugate(q) {
    return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function quaternionMultiply(a, b) {
    return {
        x: (a.w * b.x) + (a.x * b.w) + (a.y * b.z) - (a.z * b.y),
        y: (a.w * b.y) - (a.x * b.z) + (a.y * b.w) + (a.z * b.x),
        z: (a.w * b.z) + (a.x * b.y) - (a.y * b.x) + (a.z * b.w),
        w: (a.w * b.w) - (a.x * b.x) - (a.y * b.y) - (a.z * b.z)
    };
}

function estimateVelocity(position, orientation, now) {
    const previous = state.lastPose;
    if (!previous) {
        return {
            linearVelocity: { x: 0, y: 0, z: 0 },
            angularVelocity: { x: 0, y: 0, z: 0 }
        };
    }

    const dt = Math.max((now - previous.time) / 1000, 0.001);
    const linearVelocity = {
        x: (position.x - previous.position.x) / dt,
        y: (position.y - previous.position.y) / dt,
        z: (position.z - previous.position.z) / dt
    };

    const delta = quaternionMultiply(orientation, quaternionConjugate(previous.orientation));
    const sign = delta.w < 0 ? -1 : 1;
    const angle = 2 * Math.acos(Math.max(-1, Math.min(1, delta.w * sign)));
    const s = Math.sqrt(Math.max(0.000001, 1 - (delta.w * delta.w)));
    const angularVelocity = {
        x: ((delta.x * sign) / s) * angle / dt,
        y: ((delta.y * sign) / s) * angle / dt,
        z: ((delta.z * sign) / s) * angle / dt
    };

    return { linearVelocity, angularVelocity };
}

function updateReadout(position, orientation, now) {
    ui.posX.textContent = position.x.toFixed(2);
    ui.posY.textContent = position.y.toFixed(2);
    ui.posZ.textContent = position.z.toFixed(2);

    const roll = Math.atan2(
        2 * ((orientation.w * orientation.z) + (orientation.x * orientation.y)),
        1 - (2 * ((orientation.y * orientation.y) + (orientation.z * orientation.z)))
    );
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * ((orientation.w * orientation.x) - (orientation.z * orientation.y)))));
    const yaw = Math.atan2(
        2 * ((orientation.w * orientation.y) + (orientation.z * orientation.x)),
        1 - (2 * ((orientation.x * orientation.x) + (orientation.y * orientation.y)))
    );

    ui.shell.style.setProperty('--saber-roll', `${roll}rad`);
    ui.shell.style.setProperty('--saber-pitch', `${pitch * 0.55}rad`);
    ui.shell.style.setProperty('--saber-yaw', `${yaw * 0.55}rad`);

    state.frameCount += 1;
    if (now - state.fpsStart >= 500) {
        ui.frameRate.textContent = Math.round((state.frameCount * 1000) / (now - state.fpsStart));
        state.frameCount = 0;
        state.fpsStart = now;
    }
}

function makePosePayload(pose, xrTime) {
    const position = clonePoint(pose.transform.position);
    const orientation = cloneQuaternion(pose.transform.orientation);
    const matrix = cloneMatrix(pose.transform.matrix);
    const now = performance.now();
    const velocity = estimateVelocity(position, orientation, now);

    state.lastPose = { position, orientation, time: now };

    return {
        type: 'saber-pose',
        role: 'pad',
        mode: XR_SESSION_MODE,
        room: state.room,
        seq: state.seq += 1,
        clientTime: now,
        xrTime,
        referenceSpace: 'local-floor',
        position,
        orientation,
        matrix,
        ...velocity
    };
}

function sendLowLatency(payload) {
    if (!state.transport) return;
    state.transport.sendPose(payload);
}

function createNoopTransport() {
    return {
        sendPose() {},
        sendHello() {},
        close() {}
    };
}

function createNativeWebSocketTransport(url) {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';

    socket.addEventListener('open', () => {
        setStatus('XR + WebSocket', 'tracking');
        socket.send(JSON.stringify({
            type: 'hello',
            event: HELLO_EVENT,
            role: 'pad',
            room: state.room,
            at: Date.now()
        }));
    });

    socket.addEventListener('close', () => {
        if (state.session) setStatus('XR без каналу', 'tracking');
    });

    socket.addEventListener('error', () => {
        if (state.session) setStatus('WebSocket помилка', 'error');
    });

    return {
        sendPose(payload) {
            if (socket.readyState !== WebSocket.OPEN) return;
            if (socket.bufferedAmount > 64 * 1024) return;
            socket.send(JSON.stringify({ event: POSE_EVENT, ...payload }));
        },
        sendHello() {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'hello', event: HELLO_EVENT, role: 'pad', room: state.room }));
            }
        },
        close() {
            socket.close(1000, 'pad closed');
        }
    };
}

async function createSocketIoTransport(url) {
    const { io } = await import(SOCKET_IO_MODULE_URL);
    const socket = io(url, {
        transports: ['websocket'],
        upgrade: false,
        reconnection: true,
        query: { room: state.room, role: 'pad' }
    });

    socket.on('connect', () => {
        setStatus('XR + Socket.IO', 'tracking');
        socket.emit(HELLO_EVENT, { role: 'pad', room: state.room, at: Date.now() });
    });

    socket.on('disconnect', () => {
        if (state.session) setStatus('XR без каналу', 'tracking');
    });

    socket.on('connect_error', () => {
        if (state.session) setStatus('Socket.IO помилка', 'error');
    });

    return {
        sendPose(payload) {
            const target = socket.volatile || socket;
            target.emit(POSE_EVENT, payload);
        },
        sendHello() {
            socket.emit(HELLO_EVENT, { role: 'pad', room: state.room, at: Date.now() });
        },
        close() {
            socket.disconnect();
        }
    };
}

async function createTransport() {
    if (!state.serverUrl) {
        setStatus('XR без каналу', 'tracking');
        return createNoopTransport();
    }

    if (/^wss?:\/\//i.test(state.serverUrl)) {
        return createNativeWebSocketTransport(state.serverUrl);
    }

    if (/^https?:\/\//i.test(state.serverUrl)) {
        return createSocketIoTransport(state.serverUrl);
    }

    throw new Error('Невідомий формат каналу');
}

async function ensureWebXrSupport() {
    if (!window.isSecureContext) {
        throw new Error('WebXR потребує HTTPS або localhost.');
    }

    if (!navigator.xr) {
        throw new Error('WebXR недоступний у цьому браузері.');
    }

    const supported = await navigator.xr.isSessionSupported(XR_SESSION_MODE);
    if (!supported) {
        throw new Error('immersive-ar не підтримується на цьому пристрої.');
    }
}

function onXrFrame(xrTime, frame) {
    const session = frame.session;
    if (!state.referenceSpace) return;

    const pose = frame.getViewerPose(state.referenceSpace);
    if (pose) {
        const payload = makePosePayload(pose, xrTime);
        updateReadout(payload.position, payload.orientation, performance.now());
        sendLowLatency(payload);
    }

    session.requestAnimationFrame(onXrFrame);
}

async function startSaber() {
    ui.startButton.disabled = true;
    setStatus('Перевірка WebXR', 'loading');

    try {
        setRoom(ui.roomInput.value || state.room);
        setServerUrl(ui.serverInput.value || state.serverUrl);

        await ensureWebXrSupport();

        setStatus('Запуск AR', 'loading');
        state.transport = await createTransport();
        state.session = await navigator.xr.requestSession(XR_SESSION_MODE, XR_OPTIONS);
        state.session.addEventListener('end', () => stopSaber(), { once: true });
        state.referenceSpace = await state.session.requestReferenceSpace('local-floor');
        state.frameCount = 0;
        state.fpsStart = performance.now();
        state.lastPose = null;
        state.transport.sendHello();

        ui.stopButton.disabled = false;
        setStatus('XR трекінг', 'tracking');
        state.session.requestAnimationFrame(onXrFrame);
    } catch (error) {
        console.error(error);
        stopSaber({ keepError: true });
        setStatus(error.message || 'Не вдалося запустити меч', 'error');
    } finally {
        if (!state.session) ui.startButton.disabled = false;
    }
}

function stopSaber({ keepError = false } = {}) {
    const session = state.session;
    state.session = null;
    state.referenceSpace = null;
    state.lastPose = null;
    state.transport?.close();
    state.transport = null;

    if (session && session.end) {
        session.end().catch(() => {});
    }

    ui.startButton.disabled = false;
    ui.stopButton.disabled = true;
    if (!keepError) setStatus('Зупинено', 'idle');
}

ui.startButton.addEventListener('click', startSaber);
ui.stopButton.addEventListener('click', stopSaber);
ui.roomInput.addEventListener('input', event => setRoom(event.target.value));
ui.serverInput.addEventListener('input', event => setServerUrl(event.target.value));

setRoom(state.room);
setServerUrl(state.serverUrl);
