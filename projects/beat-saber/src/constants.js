export const BUILT_IN_TRACK_URL = './assets/tracks/khlopchyk-renie-cares.zip';
export const BUILT_IN_LIGHTMAP_URL = './assets/tracks/khlopchyk-renie-cares-standard-lightmap.zip';
export const SOCKET_IO_MODULE_URL = 'https://cdn.socket.io/4.7.5/socket.io.esm.min.js';
export const JSZIP_MODULE_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';
export const THREE_MODULE_URL = 'https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js';

export const EVENTS = {
    hello: 'saber:hello',
    pose: 'saber:pose',
    feedback: 'saber:feedback',
    state: 'saber:state'
};

export const CUT_DIRECTIONS = {
    0: { x: 0, y: 1 },
    1: { x: 0, y: -1 },
    2: { x: -1, y: 0 },
    3: { x: 1, y: 0 },
    4: { x: -0.707, y: 0.707 },
    5: { x: 0.707, y: 0.707 },
    6: { x: -0.707, y: -0.707 },
    7: { x: 0.707, y: -0.707 },
    8: { x: 0, y: 0 }
};

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function normalize2(x, y, fallback = { x: 0, y: -1 }) {
    const length = Math.hypot(Number(x) || 0, Number(y) || 0);
    if (length < 0.001) return { ...fallback };
    return { x: x / length, y: y / length };
}
