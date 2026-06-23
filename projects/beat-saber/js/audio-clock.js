export class GameAudio {
    constructor() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('Web Audio API is not available in this browser.');

        this.context = new AudioContextClass();
        this.gain = this.context.createGain();
        this.gain.gain.value = 0.9;
        this.gain.connect(this.context.destination);
        this.buffer = null;
        this.source = null;
        this.startedAt = 0;
        this.offset = 0;
        this.playing = false;
        this.url = '';
        this.onEnded = null;
    }

    async load(url) {
        this.stop();
        this.url = url;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load audio: ${url}`);
        const arrayBuffer = await response.arrayBuffer();
        this.buffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
        this.offset = 0;
        return this.buffer;
    }

    async resume() {
        if (this.context.state !== 'running') {
            await this.context.resume();
        }
    }

    async start(offset = this.offset) {
        if (!this.buffer) throw new Error('No audio buffer loaded.');
        await this.resume();
        this.stopSourceOnly();

        this.source = this.context.createBufferSource();
        this.source.buffer = this.buffer;
        this.source.connect(this.gain);
        this.offset = Math.max(0, Math.min(offset, this.buffer.duration));
        this.startedAt = this.context.currentTime - this.offset;
        this.playing = true;
        this.source.onended = () => {
            if (!this.playing) return;
            this.playing = false;
            this.offset = 0;
            if (typeof this.onEnded === 'function') this.onEnded();
        };
        this.source.start(0, this.offset);
    }

    pause() {
        if (!this.playing) return;
        this.offset = this.currentTime;
        this.playing = false;
        this.stopSourceOnly();
    }

    stop() {
        this.playing = false;
        this.offset = 0;
        this.stopSourceOnly();
    }

    stopSourceOnly() {
        if (!this.source) return;
        try {
            this.source.onended = null;
            this.source.stop();
        } catch (_) {
            /* Source may already be stopped. */
        }
        this.source.disconnect();
        this.source = null;
    }

    setVolume(value) {
        this.gain.gain.value = Math.max(0, Math.min(1, Number(value) || 0));
    }

    get currentTime() {
        if (!this.buffer) return 0;
        if (!this.playing) return this.offset;
        return Math.max(0, Math.min(this.context.currentTime - this.startedAt, this.buffer.duration));
    }

    get duration() {
        return this.buffer ? this.buffer.duration : 0;
    }
}
