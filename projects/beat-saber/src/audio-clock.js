export class AudioClock {
    constructor() {
        this.audio = new Audio();
        this.audio.preload = 'auto';
        this.audio.crossOrigin = 'anonymous';
    }

    async load(url) {
        this.stop();
        this.audio.src = url;
        this.audio.load();
        await new Promise((resolve, reject) => {
            const cleanup = () => {
                this.audio.removeEventListener('canplaythrough', onReady);
                this.audio.removeEventListener('loadedmetadata', onReady);
                this.audio.removeEventListener('error', onError);
            };
            const onReady = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(new Error('Не вдалося завантажити аудіо'));
            };
            this.audio.addEventListener('canplaythrough', onReady, { once: true });
            this.audio.addEventListener('loadedmetadata', onReady, { once: true });
            this.audio.addEventListener('error', onError, { once: true });
        });
    }

    async play(fromStart = false) {
        if (fromStart) this.audio.currentTime = 0;
        await this.audio.play();
    }

    pause() {
        this.audio.pause();
    }

    stop() {
        this.audio.pause();
        if (Number.isFinite(this.audio.duration)) this.audio.currentTime = 0;
    }

    get currentTime() {
        return this.audio.currentTime || 0;
    }

    get duration() {
        return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    }

    get ended() {
        return this.audio.ended;
    }
}
