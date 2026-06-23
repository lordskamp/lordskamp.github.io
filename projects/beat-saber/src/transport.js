import { EVENTS, SOCKET_IO_MODULE_URL } from './constants.js';

export function createRoomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

export function normalizeRoom(value) {
    return String(value || '').replace(/[^\w-]/g, '').slice(0, 8);
}

export function getInitialRoom() {
    return normalizeRoom(new URLSearchParams(window.location.search).get('room')) || createRoomCode();
}

export function buildPadUrl(room, serverUrl) {
    const url = new URL('pad/', window.location.href);
    url.searchParams.set('room', normalizeRoom(room));
    if (serverUrl) url.searchParams.set('server', serverUrl);
    return url.href;
}

function isSameRoom(payload, room) {
    return !payload?.room || normalizeRoom(payload.room) === normalizeRoom(room);
}

function unpackMessage(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (raw instanceof Blob) return null;
    return raw;
}

function createOfflineTransport(onStatus) {
    onStatus?.('Без relay: desktop fallback');
    return {
        online: false,
        sendFeedback() {},
        sendState() {},
        reconnect() {},
        close() {}
    };
}

function createWebSocketTransport({ room, serverUrl, onPose, onHello, onStatus }) {
    const socket = new WebSocket(serverUrl);

    socket.addEventListener('open', () => {
        onStatus?.('WebSocket relay online');
        socket.send(JSON.stringify({ event: EVENTS.hello, type: 'hello', role: 'desktop', room, at: Date.now() }));
    });

    socket.addEventListener('message', event => {
        const message = unpackMessage(event.data);
        if (!message || !isSameRoom(message, room)) return;
        if (message.event === EVENTS.pose || message.type === 'saber-pose') onPose?.(message);
        if (message.event === EVENTS.hello && message.role === 'pad') onHello?.(message);
    });

    socket.addEventListener('close', () => onStatus?.('WebSocket relay offline'));
    socket.addEventListener('error', () => onStatus?.('WebSocket relay error'));

    const send = payload => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 64 * 1024) return;
        socket.send(JSON.stringify(payload));
    };

    return {
        online: true,
        sendFeedback(payload) {
            send({ event: EVENTS.feedback, role: 'desktop', room, ...payload });
        },
        sendState(payload) {
            send({ event: EVENTS.state, role: 'desktop', room, ...payload });
        },
        reconnect() {},
        close() {
            socket.close(1000, 'desktop closed');
        }
    };
}

async function createSocketIoTransport({ room, serverUrl, onPose, onHello, onStatus }) {
    const { io } = await import(SOCKET_IO_MODULE_URL);
    const socket = io(serverUrl, {
        transports: ['websocket'],
        upgrade: false,
        reconnection: true,
        query: { room, role: 'desktop' }
    });

    socket.on('connect', () => {
        onStatus?.('Socket.IO relay online');
        socket.emit(EVENTS.hello, { role: 'desktop', room, at: Date.now() });
    });
    socket.on('disconnect', () => onStatus?.('Socket.IO relay offline'));
    socket.on('connect_error', () => onStatus?.('Socket.IO relay error'));
    socket.on(EVENTS.pose, payload => {
        if (isSameRoom(payload, room)) onPose?.(payload);
    });
    socket.on(EVENTS.hello, payload => {
        if (payload?.role === 'pad' && isSameRoom(payload, room)) onHello?.(payload);
    });

    return {
        online: true,
        sendFeedback(payload) {
            socket.emit(EVENTS.feedback, { role: 'desktop', room, ...payload });
        },
        sendState(payload) {
            socket.volatile.emit(EVENTS.state, { role: 'desktop', room, ...payload });
        },
        reconnect() {
            socket.connect();
        },
        close() {
            socket.disconnect();
        }
    };
}

export async function createDesktopTransport(options) {
    const serverUrl = String(options.serverUrl || '').trim();
    if (!serverUrl) return createOfflineTransport(options.onStatus);
    if (/^wss?:\/\//i.test(serverUrl)) return createWebSocketTransport({ ...options, serverUrl });
    if (/^https?:\/\//i.test(serverUrl)) return createSocketIoTransport({ ...options, serverUrl });
    options.onStatus?.('Невідомий relay URL');
    return createOfflineTransport(options.onStatus);
}
