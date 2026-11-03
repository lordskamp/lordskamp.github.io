// Glisse's lens and rim are adapted to the site's existing, non-React DOM.
// Copyright (c) 2026 Kelvin Zhang. See LICENSE in this directory.
import { fitBackdropLens } from './lens';
import { GLASS, paintRim } from './rim';

const selectors = [
  '.site-header__brand', '.site-header__back', '.site-control',
  '.profile-card-modal__panel', '.lazy-video-play',
  '.link-item', '.island', '.award-card', '.section-content-shell',
  '.top-bar', '.back-btn', '.ctrl-btn', '.case-card', '.lottie-item',
  '.logo-cell', '.poster-item', '.volunteer-card', '.volunteer-tap-hint', '.video-item',
  '.unwordle-card', '.game-action', '.daily-timer', '.shyfr-shell', '.toast', '.connection',
].join(',');

const chrome = /Chrom(?:e|ium)\//.test(navigator.userAgent) && !/EdgiOS|CriOS/.test(navigator.userAgent);
const surfaces = new Map<HTMLElement, HTMLElement>();
const pending = new Set<HTMLElement>();
let scheduled = false;

// Large panels keep the frost and CSS rim: pixel maps for them can be very
// expensive, particularly on high-density phones. Smaller controls get the
// original Glisse displacement and rim maps.
function fit(element: HTMLElement) {
  if (!element.isConnected || document.documentElement.classList.contains('performance-mode')) return;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  if (rect.width * rect.height > 60_000) {
    element.style.removeProperty('--lg-filter');
    element.style.removeProperty('--lg-rim');
    return;
  }
  paintRim(element);
  if (chrome) fitBackdropLens(element, GLASS);
}

function queue(element: HTMLElement) {
  pending.add(element);
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    const next = pending.values().next().value as HTMLElement | undefined;
    if (!next) return;
    pending.delete(next);
    fit(next);
    if (pending.size) queue(pending.values().next().value!);
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 500 });
  else window.setTimeout(run, 50);
}

const resize = new ResizeObserver(entries => entries.forEach(entry => queue(entry.target as HTMLElement)));
const visibility = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const element = entry.target as HTMLElement;
    if (entry.isIntersecting) { resize.observe(element); queue(element); }
    else { resize.unobserve(element); pending.delete(element); }
  });
}, { rootMargin: '100px' }) : null;

function scan() {
  for (const [element, rim] of surfaces) {
    if (element.isConnected) continue;
    visibility?.unobserve(element);
    resize.unobserve(element);
    pending.delete(element);
    rim.remove();
    surfaces.delete(element);
  }
  document.querySelectorAll<HTMLElement>(selectors).forEach(element => {
    const existingRim = surfaces.get(element);
    if (existingRim) {
      // Some controls replace their own text while the page is running.
      if (!existingRim.isConnected) element.append(existingRim);
      return;
    }
    const style = getComputedStyle(element);
    if ((style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter')) === 'none') return;
    // Telegram's native theme intentionally disables the glass surfaces.
    if (document.body.classList.contains('telegram-mini-app') && element.matches('.unwordle-card, .shyfr-shell')) return;
    const rim = document.createElement('span');
    rim.className = 'glisse-rim';
    rim.setAttribute('aria-hidden', 'true');
    if (style.position === 'static') element.classList.add('glisse-positioned');
    element.classList.add('glisse-surface');
    element.append(rim);
    surfaces.set(element, rim);
    if (visibility) visibility.observe(element);
    else { resize.observe(element); queue(element); }
  });
}

function start() {
  scan();
  let scanPending = false;
  new MutationObserver(() => {
    if (scanPending) return;
    scanPending = true;
    requestAnimationFrame(() => { scanPending = false; scan(); });
  }).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(() => { scan(); surfaces.forEach((_rim, element) => queue(element)); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
