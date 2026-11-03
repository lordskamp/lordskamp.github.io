import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../home.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
const particlesCode = section('/* ==== Floating particles:', '/* ==== i18n');
const tiltCode = section("(() => {\n    if (window.matchMedia('(max-width", '/* ==== Profile Image Switcher');

function target(properties = {}) {
  const events = new Map();
  return Object.assign({
    addEventListener(name, callback) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(callback);
    },
    removeEventListener(name, callback) { events.get(name)?.delete(callback); },
    emit(name, event = {}) { events.get(name)?.forEach(callback => callback(event)); },
  }, properties);
}

function environment({ economical = false, coarse = false, reduced = false } = {}) {
  const frames = new Map();
  let sequence = 0;
  const requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; };
  const cancelAnimationFrame = id => frames.delete(id);
  const motion = target({ matches: reduced });
  const classes = new Set(economical ? ['performance-mode'] : []);
  const context = { arcs: [], clears: 0, setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    clearRect() { this.clears++; this.arcs = []; },
    arc(x, y, radius) { this.arcs.push({ x, y, radius }); },
  };
  const canvas = { getContext: () => context, setAttribute() {} };
  const container = { clientWidth: 800, clientHeight: 600, children: [], appendChild(el) { this.children.push(el); } };
  const elements = ['profileImg', 'work', 'projects'].map(id => target({
    id, style: {}, classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }),
  }));
  const document = target({
    hidden: false, documentElement: { classList: { contains: name => classes.has(name) } },
    getElementById: () => container,
    createElement: () => canvas,
    querySelectorAll: selector => selector.includes('.island') ? elements : elements.slice(0, 1),
  });
  const window = target({ PointerEvent: true, devicePixelRatio: 3,
    matchMedia: query => query.includes('prefers-reduced-motion') ? motion
      : { matches: query.includes('hover: hover') ? !coarse : coarse },
  });
  return {
    document, window, motion, classes, context, container, canvas, elements, frames,
    run(code) { runInNewContext(code, { document, window, requestAnimationFrame, cancelAnimationFrame,
      getComputedStyle: () => ({ getPropertyValue: () => '#ffffff' }) }); },
    tick(now) { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(now)); },
  };
}

test('particles remain visible with a smaller budget in performance mode', () => {
  const env = environment();
  env.run(particlesCode);
  env.tick(100);
  assert.equal(env.container.children.length, 1);
  assert.equal(env.context.arcs.length, 24);
  assert.equal(env.canvas.width, 1200); // Device pixel ratio is capped at 1.5.
  const clears = env.context.clears;
  env.tick(110);
  assert.equal(env.context.clears, clears); // No redraw for every 60/120 Hz callback.
  env.classes.add('performance-mode');
  env.window.emit('lordskamp:performancemode');
  env.tick(200);
  assert.equal(env.context.arcs.length, 12);
  assert.equal(env.canvas.width, 800);
  assert.equal(env.frames.size, 1);
});

test('particles pause when hidden, honor changing reduced motion and resume once', () => {
  const env = environment({ economical: true, coarse: true, reduced: true });
  env.run(particlesCode);
  assert.equal(env.frames.size, 0);
  env.motion.matches = false;
  env.motion.emit('change');
  env.tick(100);
  assert.equal(env.context.arcs.length, 8);
  env.document.hidden = true;
  env.document.emit('visibilitychange');
  assert.equal(env.frames.size, 0);
  env.document.hidden = false;
  env.document.emit('visibilitychange');
  env.document.emit('visibilitychange');
  assert.equal(env.frames.size, 1);
  env.motion.matches = true;
  env.motion.emit('change');
  assert.equal(env.frames.size, 0);
  assert.equal(env.context.arcs.length, 0);
});

test('blocks tilt on hover one at a time and reset on scroll or reduced motion', () => {
  const env = environment();
  env.run(tiltCode);
  const [, work, projects] = env.elements;
  const pointer = { clientX: 190, clientY: 90, pointerType: 'mouse' };
  work.emit('pointerenter', pointer);
  env.tick(100);
  assert.match(work.style.transform, /rotateX\(-3\.2deg\) rotateY\(3\.6deg\)/);
  projects.emit('pointerenter', pointer);
  env.tick(200);
  assert.equal(work.style.transform, '');
  assert.ok(projects.style.transform);
  env.window.emit('scroll');
  assert.equal(projects.style.transform, '');
  work.emit('pointerenter', pointer);
  env.motion.matches = true;
  env.motion.emit('change');
  assert.equal(work.style.transform, '');
  assert.equal(env.frames.size, 0);
  work.emit('pointerenter', pointer);
  assert.equal(env.frames.size, 0);
});

test('touch devices do not attach mouse tilt behavior', () => {
  const env = environment({ coarse: true });
  env.run(tiltCode);
  env.elements[1].emit('pointerenter', { pointerType: 'touch', clientX: 190, clientY: 90 });
  assert.equal(env.frames.size, 0);
  assert.equal(env.elements[1].style.transform, undefined);
});
