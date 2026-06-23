function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeVector(x, y) {
    const length = Math.hypot(x, y);
    if (length < 0.001) return { x: 0, y: 1 };
    return { x: x / length, y: y / length };
}

function normalizeVector3(x, y, z) {
    const length = Math.hypot(x, y, z);
    if (length < 0.001) return { x: 0, y: 0.7, z: -0.7 };
    return { x: x / length, y: y / length, z: z / length };
}

function degreesToRadians(value) {
    return value * Math.PI / 180;
}

function shortestAngleDelta(current, origin) {
    let delta = (Number(current) || 0) - (Number(origin) || 0);
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
}

function rotateAroundX(vector, angle) {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    return {
        x: vector.x,
        y: (vector.y * cos) - (vector.z * sin),
        z: (vector.y * sin) + (vector.z * cos)
    };
}

function rotateAroundY(vector, angle) {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    return {
        x: (vector.x * cos) + (vector.z * sin),
        y: vector.y,
        z: (-vector.x * sin) + (vector.z * cos)
    };
}

function rotateAroundZ(vector, angle) {
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    return {
        x: (vector.x * cos) - (vector.y * sin),
        y: (vector.x * sin) + (vector.y * cos),
        z: vector.z
    };
}

function makeBlade({ hand, alpha, gamma, beta, previousPose, dt }) {
    const handSign = hand === 'left' ? -1 : 1;
    const yawRad = degreesToRadians(clamp(alpha, -96, 96) * 0.9);
    const pitchRad = degreesToRadians(clamp(beta, -82, 82) * 0.72);
    const rollRad = degreesToRadians(clamp(gamma, -86, 86) * 0.86);
    const base3D = {
        x: clamp((handSign * 0.34) + (Math.sin(yawRad) * 0.18), -0.62, 0.62),
        y: -0.82,
        z: 1.08
    };

    let axis3D = normalizeVector3(handSign * 0.08, 0.88, -1.08);
    axis3D = rotateAroundY(axis3D, yawRad);
    axis3D = rotateAroundX(axis3D, pitchRad);
    axis3D = rotateAroundZ(axis3D, rollRad);
    axis3D = normalizeVector3(axis3D.x, axis3D.y, axis3D.z);

    const length = 1.72;
    const tip3D = {
        x: clamp(base3D.x + (axis3D.x * length), -1.16, 1.16),
        y: clamp(base3D.y + (axis3D.y * length), -1.0, 1.1),
        z: clamp(base3D.z + (axis3D.z * length), -1.08, 1.12)
    };
    const base = { x: base3D.x, y: base3D.y };
    const tip = { x: tip3D.x, y: tip3D.y };
    const previousTip = previousPose?.blade?.tip || tip;
    const previousTip3D = previousPose?.blade?.tip3D || tip3D;
    const swingVector = normalizeVector((tip.x - previousTip.x) / dt, (tip.y - previousTip.y) / dt);
    const swingVector3 = normalizeVector3(
        (tip3D.x - previousTip3D.x) / dt,
        (tip3D.y - previousTip3D.y) / dt,
        (tip3D.z - previousTip3D.z) / dt
    );

    return {
        base,
        tip,
        base3D,
        tip3D,
        axis3D,
        yawRad,
        pitchRad,
        rollRad,
        twistRad: rollRad,
        bladeVector: normalizeVector(axis3D.x, axis3D.y),
        swingVector,
        swingVector3
    };
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
        this.pose = {
            x: 0,
            y: 0,
            vector: { x: 0, y: 1 },
            swingVector: { x: 0, y: 1 },
            blade: { base: { x: 0.34, y: -0.82 }, tip: { x: 0.48, y: 0.72 } }
        };
        this.running = false;
        this.lastPoseSent = 0;
        this.lastSwingAt = 0;
        this.lastOrientationAt = 0;
        this.lastMotionAt = 0;
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

        const alpha = shortestAngleDelta(this.latest.alpha, this.origin.alpha);
        const gamma = shortestAngleDelta(this.latest.gamma, this.origin.gamma);
        const beta = shortestAngleDelta(this.latest.beta, this.origin.beta);
        const dt = Math.max((now - (this.lastOrientationAt || now)) / 1000, 0.016);
        const blade = makeBlade({ hand: this.hand, alpha, gamma, beta, previousPose: previous, dt });
        const x = blade.tip.x;
        const y = blade.tip.y;
        const swingVector = blade.swingVector;
        const bladeVector = blade.bladeVector;

        this.pose = { x, y, vector: bladeVector, bladeVector, swingVector, blade, hand: this.hand };
        this.lastOrientationAt = now;
        this.onPose?.(this.pose);

        if (now - this.lastPoseSent > 16) {
            this.sendPose?.({
                x,
                y,
                vector: bladeVector,
                bladeVector,
                swingVector,
                blade,
                alpha,
                beta,
                gamma,
                rawAlpha: this.latest.alpha,
                rawBeta: this.latest.beta,
                rawGamma: this.latest.gamma,
                hand: this.hand
            });
            this.lastPoseSent = now;
        }

        const speed = Math.hypot(
            (blade.tip.x - (previous.blade?.tip?.x || blade.tip.x)) / dt,
            (blade.tip.y - (previous.blade?.tip?.y || blade.tip.y)) / dt,
            (blade.tip3D.z - (previous.blade?.tip3D?.z || blade.tip3D.z)) / dt
        );
        if (speed > 2.85) {
            this.emitSwing(speed, swingVector, now);
        }
    }

    handleMotion(event) {
        const now = performance.now();
        const acceleration = event.acceleration || event.accelerationIncludingGravity || {};
        const x = Number(acceleration.x) || 0;
        const y = Number(acceleration.y) || 0;
        const z = Number(acceleration.z) || 0;
        const motionMagnitude = Math.hypot(x, y, z);
        const rotation = event.rotationRate || {};
        const rotationMagnitude = Math.hypot(
            Number(rotation.alpha) || 0,
            Number(rotation.beta) || 0,
            Number(rotation.gamma) || 0
        );
        const planarMagnitude = Math.hypot(x, y);
        const isLinearSwing = motionMagnitude >= 10.8 && planarMagnitude >= 2.4;
        const isRotationalSwing = rotationMagnitude >= 115;
        if (!isLinearSwing && !isRotationalSwing) return;

        const motionVector = planarMagnitude >= 2.4 ? normalizeVector(x, -y) : null;
        const orientationVector = this.pose.swingVector || this.pose.bladeVector || this.pose.vector;
        const vector = motionVector || orientationVector;
        this.lastMotionAt = now;
        this.emitSwing(Math.max(motionMagnitude / 2.2, rotationMagnitude / 80), vector, now);
    }

    emitSwing(rawPower, vector, now) {
        if (now - this.lastSwingAt < 115) return;
        this.lastSwingAt = now;
        const power = clamp(rawPower / 16, 0.25, 1.35);
        const swingVector = normalizeVector(vector?.x, vector?.y);
        const payload = {
            x: this.pose.x,
            y: this.pose.y,
            vector: swingVector,
            swingVector,
            directionCandidates: [
                swingVector,
                this.pose.swingVector,
                this.pose.bladeVector,
                this.pose.vector
            ],
            bladeVector: this.pose.bladeVector,
            blade: this.pose.blade,
            power,
            source: 'motion-pad',
            hand: this.hand
        };
        this.sendSwing?.(payload);
        this.onSwing?.(payload);
    }
}
