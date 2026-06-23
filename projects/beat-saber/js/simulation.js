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

function distanceToSegment(point, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = point.x - a.x;
    const apy = point.y - a.y;
    const lengthSq = (abx * abx) + (aby * aby);
    if (lengthSq <= 0.0001) return Math.hypot(apx, apy);
    const t = clamp(((apx * abx) + (apy * aby)) / lengthSq, 0, 1);
    return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
}

export function directionMatches(requiredDirection, swingVector) {
    if (requiredDirection === 8) return true;
    const required = CUT_DIRECTIONS[requiredDirection] || CUT_DIRECTIONS[8];
    const swing = normalizeVector(swingVector);
    return ((required.x * swing.x) + (required.y * swing.y)) >= 0.25;
}

function directionMatchesAny(requiredDirection, candidates) {
    return candidates.some(candidate => candidate && directionMatches(requiredDirection, candidate));
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
        this.hitWindow = 0.34;
        this.missWindow = 0.36;
        this.hitRadius = 0.46;
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
        const directionCandidates = [
            swing?.swingVector,
            swing?.vector,
            ...(Array.isArray(swing?.directionCandidates) ? swing.directionCandidates : [])
        ];
        const power = clamp(Number(swing?.power) || 0.65, 0, 1.5);
        const radius = this.hitRadius + (power > 0.95 ? 0.08 : 0);
        const blade = swing?.blade && swing.blade.base && swing.blade.tip
            ? {
                base: {
                    x: clamp(Number(swing.blade.base.x) || 0, -1.2, 1.2),
                    y: clamp(Number(swing.blade.base.y) || 0, -1.1, 1.1)
                },
                tip: {
                    x: clamp(Number(swing.blade.tip.x) || 0, -1.2, 1.2),
                    y: clamp(Number(swing.blade.tip.y) || 0, -1.1, 1.1)
                }
            }
            : null;
        const candidates = [];

        this.notes.forEach(note => {
            if (note.state !== 'pending') return;
            const dt = Math.abs(note.timeSec - time);
            if (dt > this.hitWindow) return;
            const notePoint = noteToNormalized(note);
            const distance = blade
                ? distanceToSegment(notePoint, blade.base, blade.tip)
                : Math.hypot(notePoint.x - point.x, notePoint.y - point.y);
            if (distance > radius) return;
            candidates.push({ note, dt, distance });
        });

        candidates.sort((a, b) => (a.dt + a.distance * 0.2) - (b.dt + b.distance * 0.2));

        const events = [];
        candidates.slice(0, 4).forEach(candidate => {
            const { note, dt, distance } = candidate;
            if (note.state !== 'pending') return;

            const goodDirection = directionMatchesAny(note.direction, directionCandidates);
            const mobileAssist = swing?.source === 'motion-pad' && power >= 0.45 && distance <= radius * 0.78;
            note.hitAt = time;

            if (goodDirection || mobileAssist) {
                note.state = 'hit';
                this.combo += 1;
                this.maxCombo = Math.max(this.maxCombo, this.combo);
                this.hits += 1;
                const directionBonus = goodDirection ? 20 : 8;
                this.score += Math.round(72 + directionBonus + (this.combo * 3) + ((this.hitWindow - dt) / this.hitWindow) * 35 + (1 - distance / radius) * 20);
                events.push({ type: 'hit', note, combo: this.combo, score: this.score, assisted: !goodDirection });
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
