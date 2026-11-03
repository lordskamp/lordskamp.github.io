import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function environment({ coarse = false, memory = 8, performance = false, telegram = false } = {}) {
  const queue = [];
  const listeners = {};
  let canvases = 0;
  const elements = Array.from({ length: 6 }, (_, index) => {
    const classes = new Set();
    const values = new Map();
    return {
      offsetWidth: 30 + index, offsetHeight: 20,
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      style: { setProperty: (key, value) => values.set(key, value), getPropertyValue: key => values.get(key) || '', removeProperty: key => values.delete(key) },
      closest: () => telegram,
    };
  });
  const node = () => ({ style: {}, isConnected: true, setAttribute() {}, append() {} });
  const document = {
    readyState: 'complete',
    documentElement: { classList: { contains: name => performance && name === 'performance-mode' } },
    body: { classList: { contains: name => telegram && name === 'telegram-mini-app' }, append() {} },
    querySelectorAll: () => elements,
    createElementNS: node,
    createElement: () => {
      canvases++;
      return { width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }), toDataURL: () => 'data:image/png;base64,AA==' };
    },
  };
  const window = {
    matchMedia: () => ({ matches: coarse }),
    setTimeout: callback => (queue.push(callback), queue.length), clearTimeout() {},
    requestIdleCallback: callback => queue.push(callback),
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  const context = { document, navigator: { userAgent: 'Chrome/130', deviceMemory: memory }, window,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', borderTopLeftRadius: '10px', getPropertyValue: () => '' }),
    Uint8ClampedArray, Float32Array, Map, Set, Math };
  runInNewContext(readFileSync(new URL('../assets/glisse/site-glass.js', import.meta.url), 'utf8'), context);
  while (queue.length) queue.shift()();
  return { elements, listeners, canvasCount: () => canvases };
}

test('limits expensive Glisse lenses and generated maps', () => {
  const { elements, canvasCount, listeners } = environment();
  assert.equal(elements.filter(element => element.classList.contains('glisse-lens')).length, 3);
  assert.equal(canvasCount(), 3);
  listeners['lordskamp:performancemode']();
  assert.equal(elements.filter(element => element.classList.contains('glisse-lens')).length, 0);
});

test('uses one lens for touch and skips expensive effects in restricted modes', () => {
  assert.equal(environment({ coarse: true }).canvasCount(), 1);
  assert.equal(environment({ memory: 4 }).canvasCount(), 0);
  assert.equal(environment({ performance: true }).canvasCount(), 0);
  assert.equal(environment({ telegram: true }).canvasCount(), 0);
});
