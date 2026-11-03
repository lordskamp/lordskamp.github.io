import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const runtime = readFileSync(new URL('../assets/glisse/site-glass.js', import.meta.url), 'utf8');
const workerCode = readFileSync(new URL('../assets/glisse/glass-worker.js', import.meta.url), 'utf8');

function draw(shape) {
  let result;
  const self = { postMessage: value => { result = value; } };
  runInNewContext(workerCode, { self });
  self.onmessage({ data: { key: 'test', shape } });
  return result;
}

function environment({ count = 12, unique = false, worker = true, chromium = true } = {}) {
  const queue = [];
  const observers = {};
  const messages = [];
  let canvases = 0;
  let workerInstance;
  class Element {
    constructor(className = '') {
      this.className = className;
      this.children = [];
      this.attributes = new Map();
      const values = new Map();
      this.style = { setProperty: (k, v) => values.set(k, v), removeProperty: k => values.delete(k), getPropertyValue: k => values.get(k) || '' };
      this.classList = {
        contains: name => this.className.split(' ').includes(name),
        add: name => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
        remove: name => { this.className = this.className.split(' ').filter(item => item !== name).join(' '); },
        toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name),
      };
      this.offsetWidth = 160; this.offsetHeight = 48;
    }
    get isConnected() { return this.root || !!this.parent?.isConnected; }
    setAttribute(k, v) { this.attributes.set(k, v); }
    getAttribute(k) { return this.attributes.get(k); }
    removeAttribute(k) { this.attributes.delete(k); }
    append(...children) { children.forEach(child => { child.remove(); child.parent = this; this.children.push(child); }); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
    matches(selector) { return selector.split(',').some(part => /^\.[\w-]+$/.test(part) && this.classList.contains(part.slice(1))); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  }
  class SVGElement extends Element {}
  const body = new Element(); body.root = true;
  const elements = Array.from({ length: count }, (_, i) => {
    const element = new Element(i % 2 ? 'link-item' : 'island');
    if (unique) element.offsetWidth += i;
    body.append(element); return element;
  });
  const document = {
    body, readyState: 'complete', baseURI: 'https://example.test/portfolio',
    currentScript: { getAttribute: () => '/assets/glisse/site-glass.js?v=3' },
    querySelectorAll: selector => body.querySelectorAll(selector),
    createElementNS: (_ns, tag) => { const node = new SVGElement(); node.tag = tag; return node; },
    createElement: tag => {
      if (tag !== 'canvas') return new Element();
      canvases++;
      return { getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} }), toDataURL: () => 'data:image/png;base64,AA==' };
    },
  };
  class Worker {
    constructor(url) { this.url = url; workerInstance = this; }
    postMessage(message) {
      messages.push(message);
      queue.push(() => { if (!this.stopped) this.onmessage({ data: { ...draw(message.shape), key: message.key } }); });
    }
    terminate() { this.stopped = true; }
  }
  const observer = name => class {
    constructor(callback) { observers[name] = callback; }
    observe() {}
    unobserve() {}
  };
  const window = { setTimeout: callback => queue.push(callback), requestIdleCallback: callback => queue.push(callback), ...(worker ? { Worker } : {}) };
  runInNewContext(runtime, { document, window, navigator: { userAgent: chromium ? 'Chrome/140' : 'Firefox/140', deviceMemory: 2 },
    Element, HTMLElement: Element, SVGElement, Worker, URL,
    ResizeObserver: observer('resize'), IntersectionObserver: observer('visible'), MutationObserver: observer('mutation'),
    getComputedStyle: () => ({ position: 'static', borderTopLeftRadius: '16px' }),
  });
  return {
    elements, body, Element, messages,
    worker: () => workerInstance,
    canvasCount: () => canvases,
    filters: () => body.children.flatMap(node => node.children.flatMap(child => child.children)).filter(node => node.tag === 'filter'),
    intersect: (nodes, visible) => observers.visible(nodes.map(target => ({ target, isIntersecting: visible }))),
    resize: nodes => observers.resize(nodes.map(target => ({ target }))),
    mutate: records => observers.mutation(records),
    async settle() {
      for (let i = 0; i < 1000; i++) {
        await Promise.resolve();
        if (!queue.length) return;
        queue.shift()();
      }
      throw new Error('Observer work did not settle');
    },
  };
}

const material = element => element.children.find(child => child.classList.contains('site-glass-material'));
const filterOf = element => material(element).style.getPropertyValue('--glisse-filter');

test('Glisse lens bends both axes and bounds map work for large panels', () => {
  const map = draw({ width: 160, height: 80, radius: 16 });
  const at = (x, y, channel) => map.data[(y * map.columns + x) * 4 + channel];
  assert.ok(at(8, 40, 0) > 128);
  assert.ok(at(151, 40, 0) < 128);
  assert.ok(at(80, 8, 3) > 128);
  assert.ok(at(80, 71, 3) < 128);
  assert.ok(Math.abs(at(80, 40, 0) - 128) <= 1);
  for (const shape of [{ width: 1920, height: 4000, radius: 16 }, { width: 4000, height: 40, radius: 20 }]) {
    const large = draw(shape);
    assert.ok(Math.max(large.columns, large.rows) <= 512);
    assert.ok(large.columns * large.rows <= 33024);
  }
});

test('every visible surface gets refraction, with one shared map for equal sizes', async () => {
  const env = environment();
  assert.equal(env.canvasCount(), 0);
  env.intersect(env.elements, true);
  await env.settle();
  assert.equal(env.elements.filter(filterOf).length, 12);
  assert.equal(new Set(env.elements.map(filterOf)).size, 1);
  assert.equal(env.canvasCount(), 1);
  assert.equal(env.messages.length, 1);
  assert.equal(env.filters()[0].children.filter(node => node.tag === 'feDisplacementMap').length, 1);
  assert.equal(env.worker().url.href, 'https://example.test/assets/glisse/glass-worker.js?v=3');
  env.resize(env.elements);
  await env.settle();
  assert.equal(env.canvasCount(), 1);
});

test('scrolling releases off-screen effects and reuses their maps on return', async () => {
  const env = environment();
  env.intersect(env.elements, true); await env.settle();
  env.intersect(env.elements, false); await env.settle();
  assert.ok(env.elements.every(element => !filterOf(element) && !material(element).classList.contains('is-visible')));
  env.intersect(env.elements, true); await env.settle();
  assert.ok(env.elements.every(filterOf));
  assert.equal(env.canvasCount(), 1);
});

test('late worker results cannot restore old sizes or disconnected surfaces', async () => {
  const env = environment({ count: 2 });
  env.intersect(env.elements, true);
  env.elements[0].offsetWidth = 200;
  env.resize([env.elements[0]]);
  env.elements[1].remove();
  await env.settle();
  const active = env.filters().find(node => filterOf(env.elements[0]).includes(node.getAttribute('id')));
  assert.equal(active.getAttribute('width'), '200');
  assert.equal(filterOf(env.elements[1]), '');
});

test('translation replaces text without losing glass; new cards mount incrementally', async () => {
  const env = environment({ count: 1 });
  env.intersect(env.elements, true); await env.settle();
  const existing = material(env.elements[0]); existing.remove();
  env.mutate([{ target: env.elements[0], addedNodes: [], removedNodes: [existing] }]);
  assert.equal(material(env.elements[0]), existing);
  const added = new env.Element('source-badge'); env.body.append(added);
  env.mutate([{ target: env.body, addedNodes: [added], removedNodes: [] }]);
  env.intersect([added], true); await env.settle();
  assert.ok(filterOf(added));
  assert.equal(env.canvasCount(), 1);
});

test('removing and reinserting a card never stacks a second glass material', async () => {
  const env = environment({ count: 1 });
  const element = env.elements[0];
  env.intersect([element], true); await env.settle();
  element.remove();
  env.mutate([{ target: env.body, addedNodes: [], removedNodes: [element] }]);
  assert.equal(element.children.length, 0);
  env.body.append(element);
  env.mutate([{ target: env.body, addedNodes: [element], removedNodes: [] }]);
  env.intersect([element], true); await env.settle();
  assert.equal(element.children.length, 1);
  assert.ok(filterOf(element));
  assert.equal(env.canvasCount(), 1);
});

test('eviction preserves live filters and limits unused resize/category maps', async () => {
  const env = environment({ count: 40, unique: true });
  env.intersect(env.elements, true); await env.settle();
  assert.equal(env.filters().length, 40);
  env.intersect(env.elements.slice(0, 39), false); await env.settle();
  assert.equal(env.filters().length, 25);
  const active = filterOf(env.elements[39]);
  assert.ok(env.filters().some(filter => active.includes(filter.getAttribute('id'))));
});

test('blocked workers fall back to idle generation; other browsers retain CSS glass', async () => {
  for (const hasWorker of [true, false]) {
    const env = environment({ worker: hasWorker });
    env.intersect(env.elements, true);
    if (hasWorker) env.worker().onerror();
    await env.settle();
    assert.ok(env.elements.every(filterOf));
    assert.equal(env.canvasCount(), 1);
  }
  const env = environment({ chromium: false });
  env.intersect(env.elements, true); await env.settle();
  assert.equal(env.canvasCount(), 0);
  assert.ok(env.elements.every(element => material(element).classList.contains('is-visible')));
});
