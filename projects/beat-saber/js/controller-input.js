function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeVector(x, y) {
    const length = Math.hypot(x, y);
    if (length < 0.001) return { x: 0, y: 1 };
    return { x: x / length, y: y / length };
}

async function requestSensorPermission(EventClass) {
    if (!EventClass || typeof EventClass.requestPermission !== 'function') return 'granted';
    return EventClass.requestPermission();
}

export class MotionPadController {
    constructor({ sendPose, sendSwing, onPose, onSwing, onStatus }) {
        this.sendPose = sendPose;
        this.sendSwing = sendSwing;
        this.onPose = onPose;
        this.onSwing = onSwing;
        this.onStatus = onStatus;
        this.hand = 'right';
        this.latest = { alpha: 0, beta: 0, gamma: 0 };
        this.origin = { alpha: 0, beta: 0, gamma: 0 };
        this.pose = { x: 0, y: 0, vector: { x: 0, y: 1 } };
        this.running = false;
        this.lastPoseSent = 0;
        this.lastSwingAt = 0;
        this.lastOrientationAt = 0;
        this.boundOrientation = event => this.handleOrientation(event);
        this.boundMotion = event => this.handleMotion(event);
    }

    setHand(hand) {
        this.hand = hand === 'left' ? 'left' : 'right';
    }

    async start() {
        const orientation = await requestSensorPermission(window.DeviceOrientationEvent);
        const motion = await requestSensorPermission(window.DeviceMotionEvent);

        if (orientation === 'denied' || motion === 'denied') {
            throw new Error('Motion permission denied.');
        }

        if (!this.running) {
            window.addEventListener('deviceorientation', this.boundOrientation, { passive: true });
            window.addEventListener('devicemotion', this.boundMotion, { passive: true });
            this.running = true;
        }

        this.calibrate();
        this.onStatus?.('Sensors ready.');
    }

    stop() {
        if (!this.running) return;
        window.removeEventListener('deviceorientation', this.boundOrientation);
        window.removeEventListener('devicemotion', this.boundMotion);
        this.running = false;
    }

    calibrate() {
        this.origin = { ...this.latest };
        this.onStatus?.('Calibrated.');
    }

    handleOrientation(event) {
        const now = performance.now();
        const previous = this.pose;

        this.latest = {
            alpha: Number(event.alpha) || 0,
            beta: Number(event.beta) || 0,
            gamma: Number(event.gamma) || 0
        };

        const gamma = this.latest.gamma - this.origin.gamma;
        const beta = this.latest.beta - this.origin.beta;
        const x = clamp(gamma / 38, -1, 1);
        const y = clamp(-beta / 42, -1, 1);
        const dt = Math.max((now - (this.lastOrientationAt || now)) / 1000, 0.016);
        const vx = (x - previous.x) / dt;
        const vy = (y - previous.y) / dt;
        const vector = normalizeVector(vx, vy);

        this.pose = { x, y, vector };
        this.lastOrientationAt = now;
        this.onPose?.({ ...this.pose, hand: this.hand });

        if (now - this.lastPoseSent > 16) {
            this.sendPose?.({
                x,
                y,
                vector,
                alpha: this.latest.alpha,
                beta: this.latest.beta,
                gamma: this.latest.gamma,
                hand: this.hand
            });
            this.lastPoseSent = now;
        }

        const speed = Math.hypot(vx, vy);
        if (speed > 7.2) {
            this.emitSwing(speed, vector, now);
        }
    }

    handleMotion(event) {
        const acceleration = event.acceleration || event.accelerationIncludingGravity || {};
        const x = Number(acceleration.x) || 0;
        const y = Number(acceleration.y) || 0;
        const z = Number(acceleration.z) || 0;
        const magnitude = Math.hypot(x, y, z);
        if (magnitude < 13.5) return;

        const vector = this.pose.vector || normalizeVector(x, -y);
        this.emitSwing(magnitude / 2.2, vector, performance.now());
    }

    emitSwing(rawPower, vector, now) {
        if (now - this.lastSwingAt < 115) return;
        this.lastSwingAt = now;
        const power = clamp(rawPower / 16, 0.25, 1.35);
        const payload = {
            x: this.pose.x,
            y: this.pose.y,
            vector,
            power,
            hand: this.hand
        };
        this.sendSwing?.(payload);
        this.onSwing?.(payload);
    }
}
