// Glisse's lens adapted to the existing non-React site. MIT; see LICENSE.
import { fitBackdropLens } from './lens';
import { GLASS } from './rim';

// Every glass surface receives the same material in CSS. Real displacement
// is limited to stable, visible controls because each lens costs a GPU layer.
const candidates = '.site-header__brand, .site-header__back, .site-control, .game-action, .daily-timer, .connection';
const chromium = /Chrom(?:e|ium)\//.test(navigator.userAgent) && !/EdgiOS|CriOS/.test(navigator.userAgent);
const maxLenses = window.matchMedia('(pointer: coarse)').matches ? 1 : 3;
const maxMaps = 3;
const shapes = new Set<string>();
const active = new Set<HTMLElement>();
let resizeTimer = 0;

function clearLenses() {
  active.forEach(element => {
    element.classList.remove('glisse-lens');
    element.style.removeProperty('--lg-filter');
  });
  active.clear();
}

function refreshLenses() {
  clearLenses();
  if (!chromium || document.documentElement.classList.contains('performance-mode')) return;
  if ((navigator as Navigator & { deviceMemory?: number }).deviceMemory && (navigator as Navigator & { deviceMemory: number }).deviceMemory <= 4) return;
  for (const element of document.querySelectorAll<HTMLElement>(candidates)) {
    if (active.size >= maxLenses) break;
    if (document.body.classList.contains('telegram-mini-app') && element.closest('.unwordle-card, .shyfr-shell')) continue;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    if (!width || !height || width * height > 12_000) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const key = `${width}|${height}|${style.borderTopLeftRadius}`;
    if (!shapes.has(key) && shapes.size >= maxMaps) continue;
    shapes.add(key);
    fitBackdropLens(element, GLASS);
    if (!element.style.getPropertyValue('--lg-filter')) continue;
    element.classList.add('glisse-lens');
    active.add(element);
  }
}

function schedule() {
  if ('requestIdleCallback' in window) window.requestIdleCallback(refreshLenses, { timeout: 1200 });
  else window.setTimeout(refreshLenses, 250);
}

function start() {
  // The shared header is created by site-ui's DOMContentLoaded handler.
  window.setTimeout(schedule, 250);
  window.addEventListener('resize', () => {
    clearLenses();
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(schedule, 300);
  }, { passive: true });
  window.addEventListener('lordskamp:performancemode', clearLenses);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
