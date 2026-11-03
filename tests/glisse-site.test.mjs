import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function environment({ telegram = false } = {}) {
  const observers = [];
  const classes = new Set();
  const rimClasses = new Set();
  const card = {
    isConnected: true,
    classList: { add: name => classes.add(name), contains: name => classes.has(name) },
    matches: selector => selector.includes('.unwordle-card'),
    append(node) { this.rim = node; node.isConnected = true; },
  };
  const root = { classList: { contains: () => false } };
  const document = {
    readyState: 'complete', documentElement: root,
    body: { classList: { contains: name => telegram && name === 'telegram-mini-app' } },
    querySelectorAll: () => [card],
    createElement: () => ({ classList: rimClasses, setAttribute() {}, remove() { this.isConnected = false; } }),
  };
  class MutationObserver { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} }
  class ResizeObserver { observe() {} unobserve() {} }
  class IntersectionObserver { observe() {} unobserve() {} }
  const window = { setTimeout() {}, requestIdleCallback() {}, IntersectionObserver };
  const context = { document, navigator: { userAgent: 'Chrome/130' }, window, MutationObserver, ResizeObserver, IntersectionObserver,
    getComputedStyle: () => ({ backdropFilter: 'blur(6px)', position: 'static' }),
    requestAnimationFrame: callback => callback(), setTimeout() {}, Map, Set };
  runInNewContext(readFileSync(new URL('../assets/glisse/site-glass.js', import.meta.url), 'utf8'), context);
  return { card, classes, observers };
}

test('adds a Glisse layer and restores it when dynamic content replaces its children', () => {
  const { card, classes, observers } = environment();
  assert.ok(classes.has('glisse-surface'));
  assert.ok(classes.has('glisse-positioned'));
  const rim = card.rim;
  assert.equal(rim.className, 'glisse-rim');
  rim.isConnected = false;
  card.rim = undefined;
  observers[0].callback();
  assert.equal(card.rim, rim);
});

test('does not replace the native Telegram game surface', () => {
  const { card, classes } = environment({ telegram: true });
  assert.equal(classes.has('glisse-surface'), false);
  assert.equal(card.rim, undefined);
});
