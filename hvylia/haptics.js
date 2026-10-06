import { telegramHaptic } from './telegram.js';
import { mechanicalSchedule, mechanicalPulses } from './mechanics.js';

export class Haptics {
  constructor(button) {
    this.button = button;
    this.lastSelection = 0;
    this.lastMechanical = -Infinity;
    this.mechanicalCancels = new Set();
    this.browserPulse = null;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.enabled = !this.reducedMotion.matches;
    this.reducedMotion.addEventListener?.('change', () => {
      if (this.reducedMotion.matches) this.cancelMechanical();
    });
    try {
      const saved = window.localStorage.getItem('hvylia.haptics');
      if (saved !== null) this.enabled = saved === 'on';
    } catch { /* The live preference also works without storage. */ }
    button.addEventListener('click', () => {
      this.enabled = !this.enabled;
      this.cancelMechanical();
      try { window.localStorage.setItem('hvylia.haptics', this.enabled ? 'on' : 'off'); } catch { /* Keep the current preference. */ }
      this.update();
      if (this.enabled) this.impact();
    });
    this.update();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.cancelMechanical();
    });
  }

  update() {
    this.button.setAttribute('aria-pressed', String(this.enabled));
    this.button.innerHTML = `<span>Вібрація</span><span class="preference-value">${this.enabled ? 'Увімк.' : 'Вимк.'}</span>`;
  }

  feedback(kind, value, pattern) {
    if (!this.enabled || document.visibilityState === 'hidden') return false;
    if (telegramHaptic(kind, value)) { this.browserPulse = null; return 'native'; }
    try {
      if (window.navigator.vibrate?.(pattern)) { this.browserPulse = null; return 'browser'; }
    } catch { /* Some browsers do not offer vibration. */ }
    return false;
  }

  selection() {
    const now = performance.now();
    if (now - this.lastSelection < 120) return;
    this.lastSelection = now;
    this.feedback('selection', null, 6);
  }

  impact(style = 'light') { this.feedback('impact', style, style === 'medium' ? 18 : 9); }
  success() { this.feedback('notification', 'success', [12, 40, 20]); }
  error() { this.feedback('notification', 'error', [15, 30, 15]); }

  cancelMechanical(mechanism) {
    for (const cancel of this.mechanicalCancels) if (!mechanism || cancel.mechanism === mechanism) cancel();
  }

  mechanical(options = {}) {
    const schedule = mechanicalSchedule(options);
    if (schedule) this.cancelMechanical(schedule.mechanism);
    if (!schedule || !this.enabled || document.visibilityState === 'hidden'
      || this.reducedMotion.matches) return () => {};
    const timers = new Set();
    let cancelled = false;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
      this.mechanicalCancels.delete(cancel);
      // Cancelling one mechanism must not cut off a pulse from the other one.
      if (this.browserPulse?.owner === cancel && performance.now() < this.browserPulse.until) {
        this.browserPulse = null;
        try { window.navigator.vibrate?.(0); } catch { /* Stop the active browser pulse if supported. */ }
      }
    };
    cancel.mechanism = schedule.mechanism;
    this.mechanicalCancels.add(cancel);
    const started = performance.now();
    const pulses = mechanicalPulses(schedule);
    for (const pulse of pulses) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (cancelled) return;
        if (!this.enabled || document.visibilityState === 'hidden'
          || this.reducedMotion.matches) { cancel(); return; }
        const now = performance.now();
        // Browser timers can all wake together after a stalled frame. Skip old
        // pulses instead of delivering a burst unrelated to the visible wheel.
        if (now - started - pulse.at > 45 || now - this.lastMechanical < 70) return;
        this.lastMechanical = now;
        const milliseconds = pulse.kind === 'detent' ? 8 : 6;
        const delivered = pulse.kind === 'selection'
          ? this.feedback('selection', null, milliseconds)
          : this.feedback('impact', pulse.kind === 'detent' ? 'light' : 'soft', milliseconds);
        if (delivered === 'browser') this.browserPulse = { owner: cancel, until: now + milliseconds };
      }, pulse.at);
      timers.add(timer);
    }
    const complete = window.setTimeout(() => {
      timers.clear(); cancelled = true; this.mechanicalCancels.delete(cancel);
    }, schedule.duration + 10);
    timers.add(complete);
    return cancel;
  }
}
