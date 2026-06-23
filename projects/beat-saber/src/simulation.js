import { clamp, CUT_DIRECTIONS, normalize2 } from './constants.js';

function noteWorldPosition(note) {
    return {
        x: (note.x - 1.5) * 0.78,
        y: 0.72 + (note.y * 0.58),
        z: 0
    };
}

function distancePointToSegment(point, a, b) {
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const ap = { x: point.x - a.x, y: point.y - a.y, z: point.z - a.z };
    const lengthSq = (ab.x * ab.x) + (ab.y * ab.y) + (ab.z * ab.z);
    if (lengthSq <= 0.0001) return Math.hypot(ap.x, ap.y, ap.z);
    const t = clamp(((ap.x * ab.x) + (ap.y * ab.y) + (ap.z * ab.z)) / lengthSq, 0, 1);
    return Math.hypot(
        point.x - (a.x + (ab.x * t)),
        point.y - (a.y + (ab.y * t)),
        point.z - (a.z + (ab.z * t))
    );
}

function directionMatches(direction, swingVector) {
    if (direction === 8) return true;
    const required = CUT_DIRECTIONS[direction] || CUT_DIRECTIONS[8];
    const swing = normalize2(swingVector?.x, swingVector?.y);
    return ((required.x * swing.x) + (required.y * swing.y)) >= 0.22;
}

export class OneSaberSimulation {
    constructor() {
        this.notes = [];
        this.lightEvents = [];
        this.travelTime = 2.1;
        this.hitWindow = 0.28;
        this.missWindow = 0.32;
        this.hitRadius = 0.28;
        this.time = 0;
        this.resetScore();
    }

    load({ notes, lightEvents, travelTime }) {
        this.notes = notes.map(note => ({ ...note, state: 'pending', hitAt: null, missAt: null }));
        this.lightEvents = lightEvents || [];
        this.travelTime = travelTime || this.travelTime;
        this.resetScore();
    }

    resetScore() {
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.hits = 0;
        this.badCuts = 0;
        this.misses = 0;
        this.notes.forEach(note => {
            note.state = 'pending';
            note.hitAt = null;
            note.missAt = null;
        });
    }

    update(time) {
        this.time = time;
        const events = [];
        this.notes.forEach(note => {
            if (note.state !== 'pending') return;
            if (time > note.timeSec + this.missWindow) {
                note.state = 'missed';
                note.missAt = time;
                this.combo = 0;
                this.misses += 1;
                events.push({ type: 'miss', note });
            }
        });
        return events;
    }

    tryCut(saber, time = this.time) {
        if (!saber?.base || !saber?.tip) return [];
        const candidates = [];
        const swingVector = normalize2(saber.swingVector?.x, saber.swingVector?.y);
        const speed = Math.hypot(saber.tipVelocity?.x || 0, saber.tipVelocity?.y || 0, saber.tipVelocity?.z || 0);
        const radius = this.hitRadius + (Math.min(speed, 3.2) * 0.025);

        this.notes.forEach(note => {
            if (note.state !== 'pending') return;
            const dt = Math.abs(note.timeSec - time);
            if (dt > this.hitWindow) return;
            const notePoint = noteWorldPosition(note);
            const distance = distancePointToSegment(notePoint, saber.base, saber.tip);
            if (distance > radius) return;
            candidates.push({ note, dt, distance });
        });

        candidates.sort((a, b) => (a.dt + a.distance * 0.24) - (b.dt + b.distance * 0.24));

        const events = [];
        candidates.slice(0, 2).forEach(candidate => {
            const { note, dt, distance } = candidate;
            if (note.state !== 'pending') return;

            const goodDirection = directionMatches(note.direction, swingVector);
            note.hitAt = time;

            if (goodDirection || speed >= 1.65) {
                note.state = 'hit';
                this.combo += 1;
                this.maxCombo = Math.max(this.maxCombo, this.combo);
                this.hits += 1;
                this.score += Math.round(86 + Math.min(this.combo, 30) * 2 + ((this.hitWindow - dt) / this.hitWindow) * 28 + (1 - distance / radius) * 22);
                events.push({ type: 'hit', note, score: this.score, combo: this.combo });
            } else {
                note.state = 'bad';
                this.combo = 0;
                this.badCuts += 1;
                this.score += 10;
                events.push({ type: 'bad-cut', note, score: this.score, combo: 0 });
            }
        });

        return events;
    }

    summary() {
        const total = this.notes.length || 1;
        return {
            score: this.score,
            combo: this.combo,
            maxCombo: this.maxCombo,
            hits: this.hits,
            badCuts: this.badCuts,
            misses: this.misses,
            total: this.notes.length,
            accuracy: Math.round((this.hits / total) * 100)
        };
    }
}

export { noteWorldPosition };
