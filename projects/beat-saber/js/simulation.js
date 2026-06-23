import { CUT_DIRECTIONS } from './map-parser.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeVector(vector) {
    const x = Number(vector?.x) || 0;
    const y = Number(vector?.y) || 0;
    const length = Math.hypot(x, y);
    if (length < 0.001) return { x: 0, y: 1 };
    return { x: x / length, y: y / length };
}

export function noteToNormalized(note) {
    return {
        x: ((note.x / 3) * 2) - 1,
        y: note.y - 1
    };
}

export function directionMatches(requiredDirection, swingVector) {
    if (requiredDirection === 8) return true;
    const required = CUT_DIRECTIONS[requiredDirection] || CUT_DIRECTIONS[8];
    const swing = normalizeVector(swingVector);
    return ((required.x * swing.x) + (required.y * swing.y)) >= 0.25;
}

export class BeatSaberSimulation {
    constructor() {
        this.notes = [];
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.hits = 0;
        this.badCuts = 0;
        this.misses = 0;
        this.currentTime = 0;
        this.travelTime = 2.2;
        this.hitWindow = 0.28;
        this.missWindow = 0.36;
        this.hitRadius = 0.42;
    }

    loadNotes(notes, options = {}) {
        this.travelTime = Number(options.travelTime) || this.travelTime;
        this.notes = notes.map((note, runtimeIndex) => ({
            ...note,
            runtimeId: `${note.id}-${runtimeIndex}`,
            state: 'pending',
            hitAt: null,
            missAt: null
        }));
        this.resetScore();
    }

    resetScore() {
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.hits = 0;
        this.badCuts = 0;
        this.misses = 0;
        this.currentTime = 0;
        this.notes.forEach(note => {
            note.state = 'pending';
            note.hitAt = null;
            note.missAt = null;
        });
    }

    update(currentTime) {
        this.currentTime = currentTime;
        const events = [];

        this.notes.forEach(note => {
            if (note.state !== 'pending') return;
            if (currentTime > note.timeSec + this.missWindow) {
                note.state = 'missed';
                note.missAt = currentTime;
                this.combo = 0;
                this.misses += 1;
                events.push({ type: 'miss', note });
            }
        });

        return events;
    }

    trySwing(swing) {
        const time = Number.isFinite(swing?.time) ? swing.time : this.currentTime;
        const point = {
            x: clamp(Number(swing?.x) || 0, -1, 1),
            y: clamp(Number(swing?.y) || 0, -1, 1)
        };
        const vector = normalizeVector(swing?.vector);
        const power = clamp(Number(swing?.power) || 0.65, 0, 1.5);
        const radius = this.hitRadius + (power > 0.95 ? 0.08 : 0);
        const candidates = [];

        this.notes.forEach(note => {
            if (note.state !== 'pending') return;
            const dt = Math.abs(note.timeSec - time);
            if (dt > this.hitWindow) return;
            const notePoint = noteToNormalized(note);
            const distance = Math.hypot(notePoint.x - point.x, notePoint.y - point.y);
            if (distance > radius) return;
            candidates.push({ note, dt, distance });
        });

        candidates.sort((a, b) => (a.dt + a.distance * 0.2) - (b.dt + b.distance * 0.2));

        const events = [];
        candidates.slice(0, 4).forEach(candidate => {
            const { note, dt, distance } = candidate;
            if (note.state !== 'pending') return;

            const goodDirection = directionMatches(note.direction, vector);
            note.hitAt = time;

            if (goodDirection) {
                note.state = 'hit';
                this.combo += 1;
                this.maxCombo = Math.max(this.maxCombo, this.combo);
                this.hits += 1;
                this.score += Math.round(80 + (this.combo * 3) + ((this.hitWindow - dt) / this.hitWindow) * 35 + (1 - distance / radius) * 20);
                events.push({ type: 'hit', note, combo: this.combo, score: this.score });
            } else {
                note.state = 'bad';
                this.combo = 0;
                this.badCuts += 1;
                this.score += 10;
                events.push({ type: 'bad-cut', note, score: this.score });
            }
        });

        return events;
    }

    getSummary() {
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
