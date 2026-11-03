import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the private playback controller without constructing the entire gallery.
const source = readFileSync(new URL('../portfolio-app.js', import.meta.url), 'utf8');
const start = source.indexOf('/* ── Init Lottie animations');
const end = source.indexOf('/* ── Category Filtering', start);
assert.ok(start >= 0 && end > start, 'Portfolio playback controller must exist');

function setup({ observer = true, reduce = false } = {}) {
  const listeners = {};
  const media = { matches: reduce, addEventListener: (_, fn) => { listeners.motion = fn; } };
  const animations = [];
  const elements = Array.from({ length: 2 }, (_, i) => ({
    dataset: { lottieSrc: `animation ${i}.json` },
    classList: { add() {}, remove() {} },
  }));
  let intersect;
  const observed = new Set();
  class IntersectionObserver {
    constructor(callback) { intersect = callback; }
    observe(el) { observed.add(el); }
    unobserve(el) { observed.delete(el); }
  }
  const document = {
    hidden: false,
    querySelectorAll: () => elements,
    addEventListener: (_, fn) => { listeners.visibility = fn; },
  };
  const lottie = { loadAnimation(options) {
    const events = {};
    const animation = {
      options, events, playing: options.autoplay, destroyed: false,
      play() { this.playing = true; },
      pause() { this.playing = false; },
      destroy() { this.destroyed = true; this.playing = false; },
      addEventListener: (name, callback) => { events[name] = callback; },
    };
    animations.push(animation);
    return animation;
  } };
  runInNewContext(`${source.slice(start, end)}\ninitLottie();`, {
    document, lottie, IntersectionObserver,
    window: { matchMedia: () => media, ...(observer ? { IntersectionObserver } : {}) },
  });
  return {
    animations, elements, observed,
    show(index, visible) { intersect([{ target: elements[index], isIntersecting: visible }]); },
    hideTab(hidden) { document.hidden = hidden; listeners.visibility(); },
    reduceMotion(value) { media.matches = value; listeners.motion(); },
  };
}

test('Lottie loads on approach, pauses off-screen and reuses an existing player', () => {
  const env = setup();
  assert.equal(env.animations.length, 0);
  env.show(0, true);
  const animation = env.animations[0];
  assert.equal(animation.options.autoplay, false);
  assert.equal(animation.playing, true);
  env.show(0, false);
  assert.equal(animation.playing, false);
  animation.events.DOMLoaded(); // A late download must not restart an off-screen card.
  assert.equal(animation.playing, false);
  env.show(0, true);
  assert.equal(env.animations.length, 1);
  assert.equal(animation.playing, true);
});

test('hidden tabs and reduced motion pause playback without reviving off-screen cards', () => {
  const env = setup();
  env.show(0, true);
  env.show(1, true);
  env.show(1, false);
  env.hideTab(true);
  assert.ok(env.animations.every(animation => !animation.playing));
  env.hideTab(false);
  assert.equal(env.animations[0].playing, true);
  assert.equal(env.animations[1].playing, false);
  env.reduceMotion(true);
  assert.equal(env.animations[0].playing, false);
  env.reduceMotion(false);
  assert.equal(env.animations[0].playing, true);
  assert.equal(env.animations[1].playing, false);
});

test('failed downloads release the animation and cannot restart on visibility changes', () => {
  const env = setup();
  env.show(0, true);
  env.animations[0].events.data_failed();
  env.hideTab(true);
  env.hideTab(false);
  assert.equal(env.animations[0].destroyed, true);
  assert.equal(env.animations[0].playing, false);
  assert.equal(env.observed.has(env.elements[0]), false);
});

test('without IntersectionObserver, reduced motion still prevents autoplay', () => {
  const env = setup({ observer: false, reduce: true });
  assert.equal(env.animations.length, 2);
  assert.ok(env.animations.every(animation => !animation.playing));
  env.reduceMotion(false);
  assert.ok(env.animations.every(animation => animation.playing));
});
