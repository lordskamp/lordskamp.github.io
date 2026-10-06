import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { mechanicalProgressTime, mechanicalSchedule, mechanicalPulses } from '../hvylia/mechanics.js';
import { t as locale } from '../hvylia/locale.js';

// Give each test its own browser and clock; production modules keep normal imports.
const sources = await Promise.all(['sound', 'haptics'].map(async name => (await readFile(new URL(`../hvylia/${name}.js`, import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gmu, '').replace(/\bexport\s+/gu, '')));
const { default: createModule } = await import(`data:text/javascript;base64,${Buffer.from(`export default function(window, document, performance, telegramHaptic, mechanicalSchedule, mechanicalPulses, t) {
  ${sources.join('\n')}\nreturn { Sound, Haptics };
}`).toString('base64')}`);
const Event = globalThis.Event;
const EventTarget = globalThis.EventTarget;

class Clock {
  now = 100_000;
  serial = 0;
  tasks = new Map();
  set(callback, delay) {
    const id = ++this.serial;
    this.tasks.set(id, { callback, at: this.now + Math.max(0, delay) });
    return id;
  }
  clear(id) { this.tasks.delete(id); }
  tick(milliseconds, stalled = false) {
    const end = this.now + milliseconds;
    if (stalled) this.now = end;
    for (;;) {
      const next = [...this.tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, task] = next;
      if (!stalled) this.now = task.at;
      this.tasks.delete(id);
      task.callback();
    }
    this.now = end;
  }
}

class Param {
  value = 0;
  events = [];
  setValueAtTime(value, at) { this.events.push({ kind: 'set', value, at }); return this; }
  linearRampToValueAtTime(value, at) { this.events.push({ kind: 'linear', value, at }); return this; }
  exponentialRampToValueAtTime(value, at) { this.events.push({ kind: 'exponential', value, at }); return this; }
  setTargetAtTime(value, at, duration) { this.events.push({ kind: 'target', value, at, duration }); return this; }
  cancelScheduledValues(at) { this.events.push({ kind: 'cancel', at }); return this; }
}

class AudioNode {
  constructor(context, kind) { this.context = context; this.kind = kind; this.connections = []; this.disconnected = false; context.nodes.push(this); }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; this.connections.length = 0; }
}

class AudioSource extends AudioNode {
  constructor(context, kind) { super(context, kind); this.frequency = new Param(); this.stops = []; context.sources.push(this); }
  start(at = this.context.currentTime) { this.startedAt = at; }
  stop(at = this.context.currentTime) {
    this.stops.push(at);
    this.context.clock.clear(this.endTimer);
    this.endTimer = this.context.clock.set(() => {
      this.ended = true;
      this.onended?.();
    }, (at - this.context.currentTime) * 1000);
  }
}

function harness({ native = false, vibration = true, reduced = false, muted = true, haptics = 'on' } = {}) {
  const clock = new Clock();
  const document = new EventTarget();
  document.visibilityState = 'visible';
  const media = new EventTarget();
  media.matches = reduced;
  const storage = new Map([['hvylia.muted', String(muted)], ['hvylia.haptics', haptics]]);
  const pulses = [], vibrations = [], contexts = [];
  const window = {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => media,
    setTimeout: (callback, delay) => clock.set(callback, delay),
    clearTimeout: id => clock.clear(id),
    navigator: {}
  };
  if (vibration) window.navigator.vibrate = pattern => { vibrations.push({ at: clock.now, pattern }); return true; };
  window.AudioContext = class {
    state = 'running';
    sampleRate = 48_000;
    nodes = [];
    sources = [];
    constructor() { this.clock = clock; this.destination = new AudioNode(this, 'destination'); contexts.push(this); }
    get currentTime() { return clock.now / 1000; }
    createGain() { return Object.assign(new AudioNode(this, 'gain'), { gain: new Param() }); }
    createDynamicsCompressor() { return Object.assign(new AudioNode(this, 'limiter'), Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, new Param()]))); }
    createBiquadFilter() { return Object.assign(new AudioNode(this, 'filter'), { frequency: new Param(), Q: new Param() }); }
    createStereoPanner() { return Object.assign(new AudioNode(this, 'panner'), { pan: new Param() }); }
    createBuffer(_channels, length, rate) { const values = new Float32Array(length); return { duration: length / rate, getChannelData: () => values }; }
    createBufferSource() { return new AudioSource(this, 'noise'); }
    createOscillator() { return new AudioSource(this, 'tone'); }
    async resume() { this.changeState('running'); }
    changeState(state) { this.state = state; this.onstatechange?.(); }
  };
  const button = () => Object.assign(new EventTarget(), { setAttribute(name, value) { this[name] = value; } });
  const { Sound, Haptics } = createModule(window, document, { now: () => clock.now }, (kind, value) => {
    if (!native) return false;
    pulses.push({ kind, value, at: clock.now }); return true;
  }, mechanicalSchedule, mechanicalPulses, locale);
  return {
    clock, document, media, window, storage, pulses, vibrations, contexts,
    sound: () => new Sound(button()), haptics: () => new Haptics(button()),
    visible(value) { document.visibilityState = value ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')); },
    reduce(value) { media.matches = value; media.dispatchEvent(new Event('change')); }
  };
}

const wheel = { mechanism: 'wheel', duration: 980, distance: 190 };
const shutter = { mechanism: 'shutter', duration: 650, distance: 180 };

test('mechanical teeth follow both visible easing curves, with a slowing cadence and public distance only', () => {
  for (const [mechanism, curve] of Object.entries({ wheel: [0.18, 0.72, 0.24, 1], shutter: [0.22, 0.75, 0.25, 1] })) {
    const polynomial = (u, a, b) => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u ** 2 * b + u ** 3;
    for (const parameter of [0, 0.1, 0.25, 0.5, 0.8, 1]) {
      const progress = polynomial(parameter, curve[1], curve[3]);
      assert.ok(Math.abs(mechanicalProgressTime(progress, mechanism) - polynomial(parameter, curve[0], curve[2])) < 1e-8);
    }
  }
  const small = mechanicalSchedule({ ...wheel, distance: 135 });
  const large = mechanicalSchedule({ ...wheel, distance: 224 });
  assert.equal(small.teeth.length, 13); // 36 visible wheel teeth: one every 10 degrees.
  assert.equal(large.teeth.length, 22);
  assert.ok(large.teeth.every((at, index) => at > 0 && at < large.duration && (index === 0 || at > large.teeth[index - 1])));
  const gaps = large.teeth.slice(1).map((at, index) => at - large.teeth[index]);
  assert.ok(gaps.at(-1) > gaps[0] * 4);
  assert.deepEqual(mechanicalSchedule({ ...wheel, target: 0 }), mechanicalSchedule({ ...wheel, target: 100 }));
  for (const options of [{}, { ...wheel, duration: 0 }, { ...wheel, distance: NaN }, { ...wheel, distance: 0 }, { ...wheel, mechanism: 'target' }]) assert.equal(mechanicalSchedule(options), null);
  for (const schedule of [small, large, mechanicalSchedule(shutter)]) {
    const pulses = mechanicalPulses(schedule);
    assert.equal(pulses.at(-1).kind, 'detent');
    assert.ok(pulses.every((pulse, index) => index === 0 || pulse.at - pulses[index - 1].at >= 70));
    assert.ok(pulses.at(-1).at < schedule.duration);
  }
});

test('mechanical audio never unlocks or creates a context and respects saved mute, visibility and reduced motion', async () => {
  const h = harness();
  const sound = h.sound();
  assert.equal(await sound.unlock(), false);
  sound.mechanical(wheel)();
  assert.equal(h.contexts.length, 0);
  assert.equal(sound.muted, true);
  sound.button.dispatchEvent(new Event('click'));
  await Promise.resolve();
  assert.equal(sound.muted, false);
  assert.equal(h.storage.get('hvylia.muted'), 'false');
  h.clock.tick(200);
  h.visible(false);
  sound.mechanical(wheel)();
  assert.equal(sound.active.size, 0);
  h.visible(true);
  h.reduce(true);
  sound.mechanical(wheel)();
  assert.equal(sound.active.size, 0);
  const enabled = harness({ muted: false });
  enabled.sound().mechanical(wheel)();
  assert.equal(enabled.contexts.length, 0, 'an enabled preference still needs a gesture to unlock');
});

test('wheel friction lasts through its motion, teeth slow down, and audio nodes clean up after finishing', async () => {
  const h = harness({ muted: false });
  const sound = h.sound();
  await sound.unlock();
  const cancel = sound.mechanical(wheel);
  const cue = [...sound.active][0];
  const sources = [...cue.sources];
  const whirr = sources.find(source => source.kind === 'noise' && source.loop);
  assert.ok(whirr, 'friction loops the short noise buffer for the full rotation');
  assert.ok(whirr.stops[0] - whirr.startedAt >= 0.98);
  const ratchets = sources.filter(source => source.kind === 'tone' && source.type === 'triangle');
  assert.equal(ratchets.length, mechanicalSchedule(wheel).teeth.length);
  assert.ok(ratchets.at(-1).startedAt - ratchets.at(-2).startedAt > (ratchets[1].startedAt - ratchets[0].startedAt) * 3);
  h.clock.tick(1100);
  assert.equal(sound.active.size, 0);
  assert.equal(sound.mechanicalCancels.size, 0);
  assert.ok(cue.nodes.every(node => node.disconnected));
  assert.equal(h.clock.tasks.size, 0);
  cancel(); cancel();
  assert.equal(h.clock.tasks.size, 0, 'completed cancellation is idempotent');
});

test('wheel and shutter audio coexist; replacing or cancelling one does not stop the other', async () => {
  const h = harness({ muted: false });
  const sound = h.sound();
  await sound.unlock();
  const stopOld = sound.mechanical(wheel);
  const old = [...sound.active][0];
  const stopShutter = sound.mechanical(shutter);
  const screen = [...sound.active][1];
  assert.equal(sound.mechanicalCancels.size, 2);
  assert.equal(old.stopping, undefined);
  const stopNew = sound.mechanical({ ...wheel, distance: 224 });
  assert.equal(old.stopping, true);
  assert.equal(screen.stopping, undefined);
  assert.ok([...old.sources].some(source => source.stops.at(-1) < source.startedAt), 'cancelled future teeth cannot begin playing');
  stopOld();
  assert.equal(screen.stopping, undefined);
  h.clock.tick(30);
  assert.equal(sound.active.size, 2);
  stopNew(); stopNew();
  assert.equal(screen.stopping, undefined);
  h.clock.tick(30);
  assert.equal(sound.active.size, 1);
  stopShutter();
  h.clock.tick(30);
  assert.equal(sound.active.size, 0);
  assert.equal(sound.mechanicalCancels.size, 0);
});

test('mute, hiding, suspension and a changed motion preference cancel audio; returning restores the live master', async () => {
  for (const reason of ['mute', 'hidden', 'suspended', 'reduced']) {
    const h = harness({ muted: false });
    const sound = h.sound();
    await sound.unlock();
    sound.mechanical(wheel); sound.mechanical(shutter);
    if (reason === 'mute') sound.button.dispatchEvent(new Event('click'));
    if (reason === 'hidden') h.visible(false);
    if (reason === 'suspended') sound.context.changeState('suspended');
    if (reason === 'reduced') h.reduce(true);
    assert.equal(sound.mechanicalCancels.size, 0, reason);
    h.clock.tick(35);
    assert.equal(sound.active.size, 0, reason);
    assert.ok(sound.context.sources.every(source => source.disconnected), reason);
    if (reason === 'hidden') {
      assert.equal(sound.master.gain.events.at(-1).value, 0);
      h.visible(true);
      assert.equal(sound.master.gain.events.at(-1).value, 0.42, 'running context recovers after tab hide');
      assert.equal(sound.play('lock'), true);
    }
    if (reason === 'suspended') {
      sound.mechanical(wheel)();
      assert.equal(sound.active.size, 0);
      await sound.unlock();
      sound.mechanical(wheel);
      assert.equal(sound.active.size, 1);
    }
  }
});

test('existing cue limits still bound rapid audio overlap and clean up ordinary cues', async () => {
  const h = harness({ muted: false });
  const sound = h.sound();
  await sound.unlock();
  sound.mechanical(wheel); sound.mechanical(shutter);
  for (let index = 0; index < 12; index += 1) {
    assert.equal(sound.play('score', { points: 4 }), true);
    assert.ok(sound.active.size <= 4);
  }
  assert.equal(sound.mechanicalCancels.size, 0, 'displaced mechanical handles become inactive');
  h.clock.tick(1500);
  assert.equal(sound.active.size, 0);
  assert.equal(h.clock.tasks.size, 0);
  assert.ok(sound.context.sources.every(source => source.disconnected));
});

test('native mechanical haptics slow down with the wheel and end with a light detent', () => {
  const h = harness({ native: true });
  const haptics = h.haptics();
  const cancel = haptics.mechanical(wheel);
  h.clock.tick(1100);
  assert.ok(h.pulses.length >= 4);
  assert.equal(h.pulses[0].value, 'soft');
  assert.equal(h.pulses.at(-1).value, 'light');
  const gaps = h.pulses.slice(1).map((pulse, index) => pulse.at - h.pulses[index].at);
  assert.ok(gaps.every(gap => gap >= 70));
  assert.ok(gaps.at(-1) > gaps[0]);
  assert.ok(h.pulses.some(pulse => pulse.kind === 'selection'));
  assert.deepEqual(h.vibrations, [], 'native Telegram feedback bypasses browser vibration');
  assert.equal(haptics.mechanicalCancels.size, 0);
  cancel(); cancel();
  assert.deepEqual(h.vibrations, []);
});

test('native wheel and shutter pulses coexist with a shared throttle and separate cancellation', () => {
  const h = harness({ native: true });
  const haptics = h.haptics();
  const stopWheel = haptics.mechanical(wheel);
  haptics.mechanical(shutter);
  assert.equal(haptics.mechanicalCancels.size, 2);
  h.clock.tick(100);
  const stopReplacement = haptics.mechanical({ ...wheel, distance: 224 });
  assert.equal(haptics.mechanicalCancels.size, 2, 'wheel replacement leaves the shutter running');
  stopWheel(); stopWheel();
  assert.equal(haptics.mechanicalCancels.size, 2, 'old wheel handle is inactive');
  stopReplacement();
  assert.equal(haptics.mechanicalCancels.size, 1);
  h.clock.tick(1000);
  assert.ok(h.pulses.some(pulse => pulse.at > 100_100 && pulse.value === 'light'), 'shutter detent survives wheel cancellation');
  assert.ok(h.pulses.every((pulse, index) => index === 0 || pulse.at - h.pulses[index - 1].at >= 70));
  assert.equal(haptics.mechanicalCancels.size, 0);
  assert.deepEqual(h.vibrations, []);
});

test('browser haptics use short bursts and cancel only the active pulse belonging to that mechanism', () => {
  const h = harness();
  const haptics = h.haptics();
  const stopWheel = haptics.mechanical(wheel);
  h.clock.tick(0);
  assert.equal(h.vibrations.at(-1).pattern, 6);
  stopWheel(); stopWheel();
  assert.deepEqual(h.vibrations.map(pulse => pulse.pattern), [6, 0]);
  h.clock.tick(80);
  const inactiveWheel = haptics.mechanical(wheel);
  h.clock.tick(0);
  haptics.mechanical(shutter);
  h.clock.tick(70);
  const beforeCancel = h.vibrations.length;
  inactiveWheel(); // Its 6 ms pulse has ended; do not stop the other mechanism.
  assert.equal(h.vibrations.length, beforeCancel);
  h.clock.tick(1000);
  const bursts = h.vibrations.filter(pulse => pulse.pattern > 0);
  assert.ok(bursts.every(pulse => [6, 8].includes(pulse.pattern)));
  assert.ok(bursts.some(pulse => pulse.pattern === 8));
  assert.ok(bursts.every((pulse, index) => index === 0 || pulse.at - bursts[index - 1].at >= 70));
  assert.equal(haptics.mechanicalCancels.size, 0);
});

test('cancelling a mechanism does not cut off a later button vibration or vibrate while typing', () => {
  const h = harness();
  const haptics = h.haptics();
  h.document.dispatchEvent(new Event('keydown'));
  h.document.dispatchEvent(new Event('input'));
  assert.deepEqual(h.vibrations, []);
  const cancel = haptics.mechanical(wheel);
  h.clock.tick(0);
  haptics.impact('medium');
  cancel();
  assert.deepEqual(h.vibrations.map(pulse => pulse.pattern), [6, 18]);
  h.clock.tick(1200);
  assert.deepEqual(h.vibrations.map(pulse => pulse.pattern), [6, 18]);
});

test('haptic preference, visibility and reduced motion cancel timers immediately and suppress future pulses', () => {
  for (const reason of ['disabled', 'hidden', 'reduced']) {
    const h = harness();
    const haptics = h.haptics();
    haptics.mechanical(wheel); haptics.mechanical(shutter);
    h.clock.tick(0);
    if (reason === 'disabled') haptics.button.dispatchEvent(new Event('click'));
    if (reason === 'hidden') h.visible(false);
    if (reason === 'reduced') h.reduce(true);
    const calls = h.vibrations.length;
    assert.equal(haptics.mechanicalCancels.size, 0, reason);
    assert.equal(h.clock.tasks.size, 0, reason);
    h.clock.tick(1200);
    haptics.mechanical(wheel)();
    h.clock.tick(1200);
    assert.equal(h.vibrations.length, calls, reason);
    if (reason === 'disabled') assert.equal(h.storage.get('hvylia.haptics'), 'off');
  }
  const disabled = harness({ haptics: 'off' });
  disabled.haptics().mechanical(wheel)();
  assert.equal(disabled.clock.tasks.size, 0);
  const reduced = harness({ reduced: true });
  reduced.haptics().mechanical(wheel)();
  assert.equal(reduced.clock.tasks.size, 0);
});

test('stalled frames skip stale haptic pulses, and unsupported vibration remains optional', () => {
  const h = harness();
  const haptics = h.haptics();
  haptics.mechanical(wheel);
  h.clock.tick(500, true);
  assert.ok(h.vibrations.length <= 1, 'queued timers cannot deliver a burst after a stalled frame');
  h.clock.tick(600);
  assert.ok(h.vibrations.every((pulse, index) => index === 0 || pulse.at - h.vibrations[index - 1].at >= 70));
  const unsupported = harness({ vibration: false });
  const optional = unsupported.haptics();
  assert.doesNotThrow(() => { const cancel = optional.mechanical(wheel); unsupported.clock.tick(1); cancel(); });
  assert.equal(optional.mechanicalCancels.size, 0);
});
