import { telegramHaptic } from './telegram.js';

export class Haptics {
  constructor(button) {
    this.button = button;
    this.lastSelection = 0;
    this.enabled = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      const saved = window.localStorage.getItem('hvylia.haptics');
      if (saved !== null) this.enabled = saved === 'on';
    } catch { /* The live preference also works without storage. */ }
    button.addEventListener('click', () => {
      this.enabled = !this.enabled;
      try { window.localStorage.setItem('hvylia.haptics', this.enabled ? 'on' : 'off'); } catch { /* Keep the current preference. */ }
      this.update();
      if (this.enabled) this.impact();
    });
    this.update();
  }

  update() {
    this.button.setAttribute('aria-pressed', String(this.enabled));
    this.button.innerHTML = `<span>Вібрація</span><span class="preference-value">${this.enabled ? 'Увімк.' : 'Вимк.'}</span>`;
  }

  feedback(kind, value, pattern) {
    if (!this.enabled || document.visibilityState === 'hidden') return;
    if (telegramHaptic(kind, value)) return;
    try { window.navigator.vibrate?.(pattern); } catch { /* Some browsers do not offer vibration. */ }
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
}
