const TRYSTERO_URL = 'https://cdn.jsdelivr.net/npm/trystero@0.25.2/+esm';
const APP_ID = 'lordskamp-beat-saber-pad-v1';

function normalizeRoom(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function noop() {}

export function createRoomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

export function getRoomFromUrl() {
    return normalizeRoom(new URLSearchParams(window.location.search).get('room'));
}

export function buildPadUrl(roomId) {
    const url = new URL('pad/', window.location.href);
    url.searchParams.set('room', normalizeRoom(roomId));
    return url.href;
}

function wireAction(room, name, handler = noop) {
    const action = room.makeAction(name);

    if (Array.isArray(action)) {
        const [send, receive] = action;
        receive((data, peerId) => handler(data, { peerId }));
        return { send };
    }

    action.onMessage = (data, meta = {}) => handler(data, meta);
    return {
        send(data, peerId) {
            return action.send(data, peerId);
        }
    };
}

function createOfflineTransport(reason, handlers) {
    handlers?.onStatus?.('offline', reason);
    return {
        online: false,
        reason,
        sendPose: noop,
        sendSwing: noop,
        sendFeedback: noop,
        sendState: noop,
        sendHello: noop,
        destroy: noop
    };
}

async function createTransport(role, roomId, handlers = {}) {
    const roomCode = normalizeRoom(roomId);
    if (!roomCode) return createOfflineTransport('No room code.', handlers);

    let module;
    try {
        module = await import(TRYSTERO_URL);
    } catch (error) {
        return createOfflineTransport(`Trystero failed to load: ${error.message}`, handlers);
    }

    try {
        const room = module.joinRoom({ appId: APP_ID }, roomCode);
        const pose = wireAction(room, 'pose', (data, meta) => handlers.onPose?.(data, meta.peerId));
        const swing = wireAction(room, 'swing', (data, meta) => handlers.onSwing?.(data, meta.peerId));
        const feedback = wireAction(room, 'feedback', (data, meta) => handlers.onFeedback?.(data, meta.peerId));
        const state = wireAction(room, 'state', (data, meta) => handlers.onState?.(data, meta.peerId));
        const hello = wireAction(room, 'hello', (data, meta) => handlers.onHello?.(data, meta.peerId));

        room.onPeerJoin = peerId => {
            handlers.onPeerJoin?.(peerId);
            hello.send({ role, room: roomCode, at: Date.now() });
        };
        room.onPeerLeave = peerId => handlers.onPeerLeave?.(peerId);

        window.setTimeout(() => {
            hello.send({ role, room: roomCode, at: Date.now() });
            handlers.onStatus?.('online', 'Waiting for peer.');
        }, 350);

        return {
            online: true,
            room,
            roomCode,
            sendPose: data => pose.send({ ...data, role, sentAt: performance.now() }),
            sendSwing: data => swing.send({ ...data, role, sentAt: performance.now() }),
            sendFeedback: data => feedback.send({ ...data, role, sentAt: performance.now() }),
            sendState: data => state.send({ ...data, role, sentAt: performance.now() }),
            sendHello: data => hello.send({ ...data, role, room: roomCode, at: Date.now() }),
            destroy() {
                if (room && typeof room.leave === 'function') room.leave();
            }
        };
    } catch (error) {
        return createOfflineTransport(`Could not join room: ${error.message}`, handlers);
    }
}

export function createDesktopTransport(roomId, handlers) {
    return createTransport('desktop', roomId, handlers);
}

export function createPadTransport(roomId, handlers) {
    return createTransport('pad', roomId, handlers);
}
