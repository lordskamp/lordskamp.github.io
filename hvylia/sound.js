import { t } from './locale.js';

// A small, entirely synthesized palette: felt clicks, radio air, and warm bells.
// Every voice runs through its own envelope and the shared soft limiter.
const MAX_CUES = 4;
const MOVE_INTERVAL = 0.07;

export class Sound {
  constructor(button) {
    this.button = button;
    this.context = null;
    this.master = null;
    this.active = new Set();
    this.lastMove = -Infinity;
    this.unlockListening = false;
    this.onInteraction = event => {
      if (event.isTrusted && !this.muted) this.unlock();
    };
    try { this.muted = window.localStorage.getItem('hvylia.muted') !== 'false'; } catch { this.muted = true; }
    this.update();
    this.listenForUnlock();
    button.addEventListener('click', () => {
      this.muted = !this.muted;
      try { window.localStorage.setItem('hvylia.muted', String(this.muted)); } catch { /* Preference stays in memory. */ }
      this.update();
      if (this.muted) this.silence();
      else this.unlock().then(unlocked => { if (unlocked) this.play('lock'); });
    });
  }

  update() {
    this.button.textContent = this.muted ? t.soundOff : t.soundOn;
    this.button.setAttribute('aria-pressed', String(!this.muted));
  }

  listenForUnlock() {
    if (this.unlockListening) return;
    this.unlockListening = true;
    document.addEventListener('pointerdown', this.onInteraction, true);
    document.addEventListener('keydown', this.onInteraction, true);
  }

  stopListeningForUnlock() {
    this.unlockListening = false;
    document.removeEventListener('pointerdown', this.onInteraction, true);
    document.removeEventListener('keydown', this.onInteraction, true);
  }

  async unlock() {
    if (this.muted) return false;
    try {
      if (!this.context || this.context.state === 'closed') this.createContext();
      const context = this.context;
      if (context.state !== 'running') {
        // Starting a silent buffer inside the gesture also unlocks older iOS Safari.
        const source = context.createBufferSource();
        source.buffer = context.createBuffer(1, 1, context.sampleRate);
        source.connect(context.destination);
        source.onended = () => source.disconnect();
        source.start();
        await context.resume();
      }
      if (context.state !== 'running' || this.muted) return false;
      this.master.gain.cancelScheduledValues(context.currentTime);
      this.master.gain.setTargetAtTime(0.42, context.currentTime, 0.012);
      this.stopListeningForUnlock();
      return true;
    } catch {
      this.listenForUnlock();
      return false; // Audio remains optional in unsupported or restricted browsers.
    }
  }

  createContext() {
    const BrowserAudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = new BrowserAudioContext();
    const context = this.context;
    this.master = context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.42;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 18;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    this.master.connect(limiter).connect(context.destination);
    this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.5), context.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 731;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    context.onstatechange = () => {
      if (context.state === 'running') this.stopListeningForUnlock();
      else this.listenForUnlock();
    };
  }

  silence() {
    if (!this.context || !this.master) return;
    const at = this.context.currentTime;
    this.master.gain.cancelScheduledValues(at);
    this.master.gain.setTargetAtTime(0, at, 0.006);
    for (const cue of this.active) this.stopCue(cue);
  }

  stopCue(cue) {
    const at = this.context.currentTime;
    cue.bus.gain.cancelScheduledValues(at);
    cue.bus.gain.setTargetAtTime(0, at, 0.004);
    for (const source of cue.sources) {
      try { source.stop(at + 0.018); } catch { /* The voice may already have ended. */ }
    }
  }

  play(kind, options = {}) {
    if (this.muted || !this.context || this.context.state !== 'running') return false;
    const now = this.context.currentTime;
    if (kind === 'move') {
      if (now - this.lastMove < MOVE_INTERVAL || this.active.size >= 3) return false;
      this.lastMove = now;
    }
    let lead = 0.005;
    if (this.active.size >= MAX_CUES) {
      const oldest = this.active.values().next().value;
      this.stopCue(oldest);
      this.active.delete(oldest);
      // Let the displaced cue fade out before introducing another voice group.
      lead = 0.025;
    }
    try {
      const cue = { nodes: [], sources: new Set(), bus: this.context.createGain(), at: now + lead };
      cue.bus.connect(this.master);
      cue.nodes.push(cue.bus);
      this.active.add(cue);
      switch (kind) {
        case 'move':
          this.air(cue, 0, 0.022, 0.045, 1400, 2300, 1);
          this.tone(cue, 0, 0.045, 610, 0.025, 'triangle', 510);
          break;
        case 'suspense':
          this.air(cue, 0, 0.38, 0.075, 290, 1850, 2.2, 0.12);
          this.tone(cue, 0.05, 0.34, 196, 0.027, 'sine', 246.94, 0, 0.14);
          break;
        case 'reveal':
          this.bell(cue, 0, 0.4, 293.66, 0.135, -0.18);
          this.bell(cue, 0.13, 0.4, 440, 0.13, 0.18);
          this.air(cue, 0, 0.16, 0.023, 1800, 800, 0.7, 0.025);
          break;
        case 'score': {
          const points = Number.isFinite(options.points) ? options.points : 2;
          const frequency = points >= 4 ? 659.25 : points > 0 ? 523.25 : 293.66;
          this.bell(cue, 0, 0.35, frequency, points > 0 ? 0.12 : 0.065, -0.08);
          if (points > 0) this.bell(cue, 0.075, 0.3, frequency * 1.5, 0.07, 0.12);
          break;
        }
        case 'win':
          [293.66, 369.99, 440, 587.33].forEach((frequency, i) => {
            this.bell(cue, i * 0.085, 0.73, frequency, 0.105, (i - 1.5) * 0.12);
          });
          this.tone(cue, 0, 1.08, 146.83, 0.055, 'sine', 146.83, 0, 0.025);
          break;
        default:
          this.air(cue, 0, 0.018, 0.1, 2000, 1100, 0.8);
          this.tone(cue, 0.004, 0.105, 145, 0.2, 'sine', 78);
          this.tone(cue, 0, 0.04, 380, 0.024, 'triangle', 190);
      }
      return true;
    } catch {
      this.silence();
      return false;
    }
  }

  bell(cue, delay, duration, frequency, volume, pan) {
    this.tone(cue, delay, duration, frequency, volume, 'sine', frequency, pan, 0.004);
    this.tone(cue, delay, duration * 0.62, frequency * 2, volume * 0.23, 'sine', frequency * 2, pan, 0.002);
    this.tone(cue, delay, duration * 0.35, frequency * 3.01, volume * 0.075, 'sine', frequency * 3.01, pan, 0.002);
  }

  tone(cue, delay, duration, frequency, volume, type, endFrequency = frequency, pan = 0, attack = 0.003) {
    const oscillator = this.context.createOscillator();
    oscillator.type = type;
    const at = cue.at + delay;
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    const gain = this.envelope(cue, at, duration, volume, attack);
    oscillator.connect(gain);
    if (this.context.createStereoPanner) {
      const panner = this.context.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner).connect(cue.bus);
      cue.nodes.push(panner);
    } else gain.connect(cue.bus);
    this.startSource(cue, oscillator, at, duration);
  }

  air(cue, delay, duration, volume, frequency, endFrequency, resonance, attack = 0.002) {
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    const filter = this.context.createBiquadFilter();
    const at = cue.at + delay;
    filter.type = 'bandpass';
    filter.Q.value = resonance;
    filter.frequency.setValueAtTime(frequency, at);
    filter.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    const gain = this.envelope(cue, at, duration, volume, attack);
    source.connect(filter).connect(gain).connect(cue.bus);
    cue.nodes.push(filter);
    this.startSource(cue, source, at, duration);
  }

  envelope(cue, at, duration, volume, attack) {
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    gain.gain.setValueAtTime(0, at + duration + 0.003);
    cue.nodes.push(gain);
    return gain;
  }

  startSource(cue, source, at, duration) {
    cue.sources.add(source);
    cue.nodes.push(source);
    source.onended = () => {
      source.disconnect();
      source.onended = null;
      cue.sources.delete(source);
      if (cue.sources.size) return;
      for (const node of cue.nodes) node.disconnect();
      this.active.delete(cue);
    };
    source.start(at);
    source.stop(at + duration + 0.005);
  }
}
