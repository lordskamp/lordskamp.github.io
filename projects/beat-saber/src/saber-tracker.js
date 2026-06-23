import { clamp, normalize2 } from './constants.js';

function qMultiply(a, b) {
    return {
        x: (a.w * b.x) + (a.x * b.w) + (a.y * b.z) - (a.z * b.y),
        y: (a.w * b.y) - (a.x * b.z) + (a.y * b.w) + (a.z * b.x),
        z: (a.w * b.z) + (a.x * b.y) - (a.y * b.x) + (a.z * b.w),
        w: (a.w * b.w) - (a.x * b.x) - (a.y * b.y) - (a.z * b.z)
    };
}

function rotateVector(vector, q) {
    const p = { x: vector.x, y: vector.y, z: vector.z, w: 0 };
    const inverse = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    const result = qMultiply(qMultiply(q, p), inverse);
    return { x: result.x, y: result.y, z: result.z };
}

function vectorLength(vector) {
    return Math.hypot(vector.x, vector.y, vector.z) || 1;
}

function normalize3(vector, fallback = { x: 0, y: 0.4, z: -0.9 }) {
    const length = vectorLength(vector);
    if (length < 0.001) return { ...fallback };
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

export class SaberTracker {
    constructor() {
        this.origin = null;
        this.saber = this.makeFallbackSaber();
        this.previousTip = null;
        this.previousTime = performance.now();
    }

    makeFallbackSaber(x = 0.35, y = 1.1) {
        const base = { x: x - 0.18, y: y - 0.5, z: 0.62 };
        const tip = { x: x + 0.12, y: y + 0.65, z: -0.1 };
        return {
            base,
            tip,
            direction: normalize3({ x: tip.x - base.x, y: tip.y - base.y, z: tip.z - base.z }),
            swingVector: { x: 0, y: -1 },
            tipVelocity: { x: 0, y: 0, z: 0 },
            source: 'pointer'
        };
    }

    recenter() {
        this.origin = null;
    }

    updateFromPointer(normalizedX, normalizedY, now = performance.now()) {
        const x = clamp(normalizedX, -1, 1) * 1.32;
        const y = 1.22 + (clamp(normalizedY, -1, 1) * 0.86);
        const previousTip = this.saber.tip;
        const saber = this.makeFallbackSaber(x, y);
        const dt = Math.max((now - this.previousTime) / 1000, 0.016);
        saber.tipVelocity = {
            x: (saber.tip.x - previousTip.x) / dt,
            y: (saber.tip.y - previousTip.y) / dt,
            z: (saber.tip.z - previousTip.z) / dt
        };
        saber.swingVector = normalize2(saber.tipVelocity.x, saber.tipVelocity.y);
        this.saber = saber;
        this.previousTime = now;
        return this.saber;
    }

    updateFromPose(payload) {
        const position = payload?.position;
        const orientation = payload?.orientation;
        if (!position || !orientation) return this.saber;

        if (!this.origin) {
            this.origin = {
                position: { x: position.x, y: position.y, z: position.z },
                setAt: performance.now()
            };
        }

        const rel = {
            x: position.x - this.origin.position.x,
            y: position.y - this.origin.position.y,
            z: position.z - this.origin.position.z
        };
        const q = {
            x: Number(orientation.x) || 0,
            y: Number(orientation.y) || 0,
            z: Number(orientation.z) || 0,
            w: Number(orientation.w) || 1
        };
        const bladeDirection = normalize3(rotateVector({ x: 0, y: 0, z: -1 }, q));
        const base = {
            x: clamp(rel.x * 1.12, -1.55, 1.55),
            y: clamp(1.12 + (rel.y * 1.05), 0.3, 2.4),
            z: clamp(0.55 - (rel.z * 1.05), -0.82, 1.12)
        };
        const tip = {
            x: base.x + (bladeDirection.x * 1.28),
            y: base.y + (bladeDirection.y * 1.28),
            z: base.z + (bladeDirection.z * 1.28)
        };
        const now = Number(payload.clientTime) || performance.now();
        const previousTip = this.previousTip || this.saber.tip || tip;
        const dt = Math.max((now - this.previousTime) / 1000, 0.008);
        const tipVelocity = {
            x: (tip.x - previousTip.x) / dt,
            y: (tip.y - previousTip.y) / dt,
            z: (tip.z - previousTip.z) / dt
        };

        this.saber = {
            base,
            tip,
            direction: bladeDirection,
            swingVector: normalize2(tipVelocity.x, tipVelocity.y),
            tipVelocity,
            source: 'webxr',
            raw: payload
        };
        this.previousTip = tip;
        this.previousTime = now;
        return this.saber;
    }
}
