import { t } from './locale.js';
export class Sound {
  constructor(button) {
    this.button = button;
    this.context = null;
    try { this.muted = window.localStorage.getItem('hvylia.muted') !== 'false'; } catch { this.muted = true; }
    this.update();
    button.addEventListener('click', () => {
      this.muted = !this.muted;
      try { window.localStorage.setItem('hvylia.muted', String(this.muted)); } catch { /* Preference stays in memory. */ }
      this.update();
      if (!this.muted) this.play('lock');
    });
  }
  update() {
    this.button.textContent = this.muted ? t.soundOff : t.soundOn;
    this.button.setAttribute('aria-pressed', String(!this.muted));
  }
  play(kind) {
    if (this.muted) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.context ||= new AudioContext();
      this.context.resume().catch(() => {});
      const patterns = { lock: [280], reveal: [330, 440], score: [440, 550], win: [330, 440, 550, 660] };
      (patterns[kind] || patterns.lock).forEach((frequency, i) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        const at = this.context.currentTime + i * 0.085;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.025, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
        oscillator.connect(gain).connect(this.context.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.22);
      });
    } catch { /* Sound is optional when the browser does not support Web Audio. */ }
  }
}
