// Glisse 0.5.0, MIT, adapted to existing HTML. All glass uses the same renderer.
import { compactMap } from './compact-lens';
import { shapeOf, type Shape } from './lens';
import { container, svg } from './svg';

const selector = [
  '.site-header__brand', '.site-header__back', '.site-control', '.profile-card-modal__panel',
  '.lazy-video-play', '.link-item', '.island', '.award-card', '.section-content-shell',
  '.top-bar', '.back-btn', '.ctrl-btn', '.cat-tab', '.case-card', '.source-badge',
  '.lottie-item', '.logo-cell', '.poster-item', '.volunteer-card', '.volunteer-tap-hint',
  '.video-item', '.unwordle-card', '.game-action', '.daily-timer', '.shyfr-shell', '.toast', '.connection',
].join(',');
const chromium = /Chrom(?:e|ium)\//.test(navigator.userAgent);
const scriptUrl = document.currentScript?.getAttribute('src') || '/assets/glisse/site-glass.js';
type Entry = { material: HTMLElement; visible: boolean; key: string; generation: number };
type Cached = { filter: SVGElement; url: string; refs: number };
const surfaces = new Map<HTMLElement, Entry>();
const cache = new Map<string, Cached>();
const jobs = new Map<string, { shape: Shape; resolve: (value: Cached) => void; promise: Promise<Cached> }>();
let serial = 0;
let worker: Worker | undefined;
let trimScheduled = false;

function finish(key: string, map: ReturnType<typeof compactMap>) {
  const job = jobs.get(key);
  if (!job) return;
  const { width, height } = job.shape;
  const canvas = document.createElement('canvas');
  canvas.width = map.columns; canvas.height = map.rows;
  const context = canvas.getContext('2d')!;
  const bitmap = context.createImageData(map.columns, map.rows);
  bitmap.data.set(map.data); context.putImageData(bitmap, 0, 0);
  const id = `site-glisse-${serial++}`;
  const filter = svg('filter', { id, x: 0, y: 0, width, height, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
  filter.append(
    svg('feImage', { href: canvas.toDataURL(), x: 0, y: 0, width, height, preserveAspectRatio: 'none', result: 'lens' }),
    svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'lens', scale: Math.min(64, .45 * Math.min(width, height)), xChannelSelector: 'R', yChannelSelector: 'A' }),
  );
  container().append(filter);
  const value = { filter, url: `url("#${id}")`, refs: 0 };
  cache.set(key, value); jobs.delete(key); job.resolve(value);
}

function idle(callback: () => void) {
  if ('requestIdleCallback' in window) window.requestIdleCallback(callback, { timeout: 600 });
  else window.setTimeout(callback, 16);
}

function createWorker() {
  if (!chromium || !('Worker' in window)) return;
  try {
    worker = new Worker(new URL('glass-worker.js?v=3', new URL(scriptUrl, document.baseURI)));
    worker.onmessage = event => finish(event.data.key, event.data);
    worker.onerror = () => {
      worker?.terminate(); worker = undefined;
      jobs.forEach((job, key) => idle(() => finish(key, compactMap(job.shape))));
    };
  } catch { worker = undefined; }
}

function acquire(key: string, shape: Shape): Promise<Cached> {
  const found = cache.get(key);
  if (found) return Promise.resolve(found);
  const existing = jobs.get(key);
  if (existing) return existing.promise;
  let resolve!: (value: Cached) => void;
  const promise = new Promise<Cached>(done => { resolve = done; });
  jobs.set(key, { shape, resolve, promise });
  if (worker) worker.postMessage({ key, shape });
  else idle(() => finish(key, compactMap(shape)));
  return promise;
}

function trim() {
  // Keep every in-use map and a small reusable pool, never an unbounded history
  // of every size encountered while resizing or browsing portfolio categories.
  let unused = [...cache.values()].filter(item => item.refs === 0).length;
  for (const [key, item] of cache) {
    if (unused <= 24) break;
    if (item.refs) continue;
    item.filter.remove(); cache.delete(key); unused--;
  }
}

function scheduleTrim() {
  // All consumers of a just-finished map must claim it before eviction runs.
  if (trimScheduled) return;
  trimScheduled = true;
  window.setTimeout(() => { trimScheduled = false; trim(); }, 0);
}

function release(entry: Entry) {
  entry.generation++;
  const cached = cache.get(entry.key);
  if (cached) cached.refs = Math.max(0, cached.refs - 1);
  entry.key = '';
  entry.material.style.removeProperty('--glisse-filter');
  scheduleTrim();
}

async function fit(element: HTMLElement) {
  const entry = surfaces.get(element);
  if (!entry?.visible || !element.isConnected || !chromium) return;
  const shape = shapeOf(element);
  if (!shape) return;
  const key = `${shape.width}|${shape.height}|${shape.radius}`;
  if (entry.key === key) return;
  release(entry);
  const generation = entry.generation;
  const value = await acquire(key, shape);
  if (!entry.visible || !element.isConnected || generation !== entry.generation) { scheduleTrim(); return; }
  value.refs++; entry.key = key;
  entry.material.style.setProperty('--glisse-filter', value.url);
}

const resize = new ResizeObserver(entries => entries.forEach(entry => void fit(entry.target as HTMLElement)));
const visible = new IntersectionObserver(entries => entries.forEach(({ target, isIntersecting }) => {
  const element = target as HTMLElement;
  const entry = surfaces.get(element);
  if (!entry) return;
  entry.visible = isIntersecting;
  entry.material.classList.toggle('is-visible', isIntersecting);
  if (isIntersecting) { resize.observe(element); void fit(element); }
  else { resize.unobserve(element); release(entry); }
}), { rootMargin: '80px' });

function mount(element: HTMLElement) {
  if (surfaces.has(element)) return;
  if (element.matches('.stickers-grid .lottie-item, body.telegram-mini-app .unwordle-card, body.telegram-mini-app .shyfr-shell')) return;
  const material = document.createElement('span');
  material.className = 'site-glass-material'; material.setAttribute('aria-hidden', 'true');
  if (getComputedStyle(element).position === 'static') element.classList.add('site-glass-positioned');
  element.setAttribute('data-site-glass', '');
  element.append(material);
  surfaces.set(element, { material, visible: false, key: '', generation: 0 });
  visible.observe(element);
}

function discover(root: Element | Document) {
  if (root instanceof Element && root.matches(selector)) mount(root as HTMLElement);
  root.querySelectorAll<HTMLElement>(selector).forEach(mount);
}

function start() {
  createWorker(); discover(document);
  new MutationObserver(records => {
    let removed = false;
    for (const record of records) {
      if (record.target instanceof SVGElement) continue;
      const owner = surfaces.get(record.target as HTMLElement);
      if (owner && !owner.material.isConnected) (record.target as HTMLElement).append(owner.material);
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && !node.classList.contains('site-glass-material')) discover(node);
      }
      if (record.removedNodes.length) removed = true;
    }
    if (removed) surfaces.forEach((entry, element) => {
      if (element.isConnected) return;
      release(entry); visible.unobserve(element); resize.unobserve(element);
      entry.material.remove(); element.removeAttribute('data-site-glass');
      element.classList.remove('site-glass-positioned'); surfaces.delete(element);
    });
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
