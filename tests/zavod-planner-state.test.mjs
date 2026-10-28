import assert from 'node:assert/strict';
import test from 'node:test';

import { CATALOG_CABLES, optionFor } from '../Zavod/catalog-base.js';
import { createPlannerUI, newJob, restartTarget, restorePlanner, syncPlannerSelection } from '../Zavod/plan-ui.js';
import { DEFAULT_RULES } from '../Zavod/core.js';
import { number } from '../Zavod/core.js';
import { scheduleJobs } from '../Zavod/planner.js';
import { setupFor } from '../Zavod/setup-data.js';

const globalCable = optionFor('vvgng-p');
const initialState = () => ({
  cableId: globalCable.id,
  section: 1.5,
  drums: [{ id: 'initial-drum', color: 'blue', length: '15000', name: '', breakdowns: '' }]
});
const oldDrum = (overrides = {}) => ({
  id: 'old-drum', color: 'blue', length: '15000', name: 'Барабан № 27', breakdowns: '3682; 9240', ...overrides
});

function withPlannerHarness(state, run, getSetup = () => ({ mode: 'dual', stored: {} })) {
  const previousDocument = globalThis.document, previousWindow = globalThis.window, elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', textContent: '', listeners: new Map(), value: '',
      classList: { toggle() {} }, setAttribute() {},
      addEventListener(type, listener) { this.listeners.set(type, listener); },
      querySelector() { return null; }, querySelectorAll() { return []; }, scrollIntoView() {}
    });
    return elements.get(id);
  };
  globalThis.document = { getElementById: element, addEventListener() {} };
  globalThis.window = { addEventListener() {}, CSS: { escape: value => value } };
  try {
    const planner = createPlannerUI({ state, getSetup, persist() {}, toast() {}, haptic() {} });
    const clickAction = (id, action) => {
      const button = { dataset: { action }, closest: () => ({ dataset: { drum: id } }) };
      element('drums').listeners.get('click')({ target: { closest: selector => selector === '[data-action]' ? button : null } });
    };
    run({ planner, element, clickAction });
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
}

test('the untouched initial planning task follows the main cable and section without rewriting the queue', () => {
  const state = initialState(); restorePlanner(null, state);
  const queue = structuredClone(state.drums), id = state.jobs[0].id;
  state.cableId = optionFor('pv3').id; state.section = 4;
  assert.equal(syncPlannerSelection(state), true);
  assert.equal(state.jobs[0].cableId, state.cableId);
  assert.equal(state.jobs[0].section, 4);
  assert.equal(state.jobs[0].id, id);
  assert.deepEqual(state.drums, queue);
  assert.equal(syncPlannerSelection(state), false, 'repeated entry is idempotent');
});

test('thread jobs follow the main selection, generate and restore without displaying a fictitious section', () => {
  const state = { ...initialState(), rules: { ...DEFAULT_RULES } }; restorePlanner(null, state);
  state.cableId = 'thread-bundle'; state.section = 1;
  assert.equal(syncPlannerSelection(state), true);
  const job = state.jobs[0]; job.lengthsText = '15';
  assert.equal(job.cores, 1);
  assert.deepEqual(job.colors, ['white']);
  const planned = scheduleJobs(state.jobs);
  assert.deepEqual(planned.errors, []);
  state.drums = planned.drums; state.planJobs = structuredClone(state.jobs);
  state.drums.forEach(drum => { drum.status = 'done'; });
  withPlannerHarness(state, ({ planner, element }) => {
    planner.render();
    assert.equal(planner.drumTitle(state.drums[0]), 'Джгути');
    assert.match(element('jobs').innerHTML, /<label hidden>Переріз жили/);
    assert.doesNotMatch(element('jobs').innerHTML, /data-job-field="cores"/);
    assert.match(element('jobs').innerHTML, /<fieldset class="job-colors" hidden>/);
    assert.doesNotMatch(element('jobs').innerHTML, /job-priority|job-batch/);
    assert.match(element('jobs').innerHTML, /Довжини барабанів, км/);
    assert.match(element('drums').innerHTML, /<label hidden>Переріз, мм²/);
    assert.match(element('drums').innerHTML, /<label[^>]*hidden[^>]*>Колір<select/);
    assert.match(element('drums').innerHTML, /<b>Джгути<\/b>/);
    assert.match(element('plan-summary').innerHTML, /1 \/ 1 готово/);
    assert.doesNotMatch(element('plan-summary').innerHTML, /1 мм²|3×1/);
    assert.doesNotMatch(element('plan-summary').innerHTML, /кожного кольору|комплекту кольорів/);
    assert.match(element('drums').innerHTML, /Без барвника\./);
  }, (id, section, color, finalDiameter) => setupFor(id, section, {}, color, { finalDiameter }));
  const restored = { ...initialState(), cableId: 'thread-bundle', section: 1 };
  restorePlanner(structuredClone(state), restored);
  assert.deepEqual(restored.drums, state.drums);
  assert.deepEqual(restored.jobs, state.jobs);
});

test('thread task target diameter survives planning and local queue restoration', () => {
  const task = newJob('thread-bundle', 1, { id: 'thread-size', finalDiameter: '2,5', lengthsText: '15' });
  const scheduled = scheduleJobs([task]);
  const saved = { ...initialState(), cableId: 'thread-bundle', section: 1, jobs: [task], planJobs: [task], drums: scheduled.drums };
  const restored = initialState(); restorePlanner(saved, restored);
  assert.equal(number(restored.jobs[0].finalDiameter), 2.5);
  assert.equal(number(restored.planJobs[0].finalDiameter), 2.5);
  assert(restored.drums.every(drum => number(drum.finalDiameter) === 2.5));
  const regenerated = scheduleJobs(restored.jobs, restored.drums);
  assert.deepEqual(regenerated.errors, []);
  assert(regenerated.drums.every(drum => drum.finalDiameter === 2.5));
});

test('restoring old thread jobs normalises their stream without replacing existing production rows', () => {
  const task = { id: 'old-thread-task', cableId: 'thread-bundle', section: 1, cores: 3,
    colors: ['yellow-green', 'blue', 'brown'], lengthsText: '15', finalDiameter: '1,7', urgent: true, batchSize: 3 };
  const drums = ['yellow-green', 'blue', 'brown'].map((color, index) => ({
    id: `old-thread-task:${color}:0`, jobId: task.id, cableId: task.cableId, section: 1,
    color, length: '15000', finalDiameter: '1,7', name: `Б-${index}`, breakdowns: '6838', status: index ? 'queued' : 'done'
  }));
  const saved = { ...initialState(), cableId: task.cableId, section: 1, jobs: [task], planJobs: [task], drums };
  const state = initialState();
  restorePlanner(saved, state);
  for (const restored of [...state.jobs, ...state.planJobs]) {
    assert.equal(restored.cores, 1);
    assert.deepEqual(restored.colors, ['white']);
    assert.equal(restored.urgent, false);
    assert.equal(restored.lengthsText, '15');
  }
  assert.deepEqual(state.drums, drums, 'stored physical drums, names, faults and completion remain intact');
});

test('thread setup receives its task diameter and a changed diameter invalidates the cached settings', () => {
  const state = { ...initialState(), rules: { ...DEFAULT_RULES } };
  state.jobs = [newJob('thread-bundle', 1, { finalDiameter: '1,5', lengthsText: '15' })];
  state.planJobs = structuredClone(state.jobs); state.drums = scheduleJobs(state.jobs).drums;
  const calls = [];
  withPlannerHarness(state, ({ planner }) => {
    const first = planner.setup(state.drums[0]);
    assert.equal(first.finalDiameter, 1.5);
    assert.equal(planner.setup(state.drums[0]), first);
    state.drums[0].finalDiameter = 1.7;
    assert.equal(planner.setup(state.drums[0]).finalDiameter, 1.7);
    assert.deepEqual(calls, [['thread-bundle', 1, 'white', 1.5], ['thread-bundle', 1, 'white', 1.7]]);
  }, (id, section, color, finalDiameter) => {
    calls.push([id, section, color, finalDiameter]);
    return { mode: 'single', stored: {}, finalDiameter };
  });
});

test('thread diameter transitions keep nominal length and show matrix changes without dye instructions', () => {
  const state = { ...initialState(), rules: { ...DEFAULT_RULES } };
  state.jobs = [newJob('thread-bundle', 1, { finalDiameter: 1.5, lengthsText: '15 + 11' })];
  state.planJobs = structuredClone(state.jobs); state.drums = scheduleJobs(state.jobs).drums;
  state.drums[1].finalDiameter = 1.7;
  withPlannerHarness(state, ({ planner, element, clickAction }) => {
    const result = planner.result(state.drums[0], 0);
    assert.equal(result.target, 15000);
    assert.equal(result.matrixChange, true);
    assert.match(planner.transitionText(state.drums[0], 0), /змінити матрицю на 1,9 мм/);
    assert.doesNotMatch(planner.transitionText(state.drums[0], 0), /барвник №|за 150|− 150/);
    planner.render();
    assert.match(element('drums').innerHTML, /Перехід після зупинки\. Без барвника\./);
    clickAction(state.drums[0].id, 'cycle-status');
    clickAction(state.drums[0].id, 'cycle-status');
    assert.match(element('plan-live').textContent, /Без барвника: готово/);
    assert.doesNotMatch(element('plan-summary').innerHTML, /кожного кольору|комплекту кольорів/);
  }, (id, section, color, finalDiameter) => ({ mode: 'single', noDye: true, stored: {}, effective: { matrix: number(finalDiameter) + .2 } }));
});

test('multiplication notation updates while editing without moving the caret and survives reload', () => {
  const state = { ...initialState(), rules: { ...DEFAULT_RULES } };
  restorePlanner(null, state);
  const job = state.jobs[0], total = { textContent: '' };
  const card = { dataset: { job: job.id }, querySelector: () => total };
  const input = { value: '3*15 + 11', dataset: { jobField: 'lengthsText' }, selectionStart: 2, selectionEnd: 2, selectionDirection: 'none',
    closest: () => card, setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; } };
  withPlannerHarness(state, ({ element }) => element('jobs').listeners.get('input')({ target: input }));
  assert.equal(input.value, '3×15 + 11');
  assert.equal(input.selectionStart, 2);
  assert.equal(input.selectionEnd, 2);
  assert.equal(job.lengthsText, input.value);
  assert.match(total.textContent, /168 км/);
  const restored = initialState();
  restorePlanner({ jobs: [{ ...job, lengthsText: '3*15 + 11' }], planJobs: [{ ...job, lengthsText: '3*15' }] }, restored);
  assert.equal(restored.jobs[0].lengthsText, '3×15 + 11');
  assert.equal(restored.planJobs[0].lengthsText, '3×15');
});

test('restored drum fault records do not control the independent splice module', () => {
  const saved = { ...initialState(), drums: [oldDrum({ id: 'spliced', breakdowns: '5385; 8459' })],
    splicePlan: { drumId: 'spliced', length: '11000', breakdowns: '6838' } };
  const state = { ...initialState(), rules: { ...DEFAULT_RULES } };
  restorePlanner(saved, state);
  assert.equal(state.splicePlan, undefined);
  assert.equal(state.drums[0].length, '15000');
  withPlannerHarness(state, ({ planner, element }) => {
    element('splice-label').textContent = '(6830+4170)';
    planner.renderQueue();
    assert.equal(element('splice-label').textContent, '(6830+4170)', 'the queue cannot replace the independent result');
    assert.equal(planner.result(state.drums[0], 0).target, 15000);
    assert.match(element('drums').innerHTML, /data-splice-label>\(5380\+3070\+6550\)/);
    state.rules.splice = 45;
    planner.renderOutputs();
    assert.equal(element('splice-label').textContent, '(6830+4170)');
  });
  const deleted = { ...initialState(), rules: { ...DEFAULT_RULES } };
  restorePlanner({ ...saved, drums: [] }, deleted);
  assert.equal(deleted.splicePlan, undefined);
});

test('faults and joints use the same nominal metres through transitions', () => {
  const first = oldDrum({ id: 'spliced', cableId: globalCable.id, section: 2.5, breakdowns: '', joints: '6838' });
  const next = oldDrum({ id: 'next', cableId: globalCable.id, section: 2.5, color: 'brown', breakdowns: '' });
  const state = { ...initialState(), jobs: [], planJobs: [], rules: { ...DEFAULT_RULES }, drums: [first, next] };
  withPlannerHarness(state, ({ planner }) => {
    const transition = planner.result(first, 0);
    assert.equal(transition.splice.label, '(6830+8170)');
    assert.equal(transition.target, 15850);
    assert.equal(transition.events[0].at, 13000);
    assert.equal(first.length, '15000');
    next.section = 1.5;
    assert.equal(planner.result(first, 0).target, 14850);
    first.joints = '5385; 8459';
    assert.equal(planner.result(first, 0).target, 14850);
    first.joints = '8459; 8450';
    const invalid = planner.result(first, 0);
    assert.equal(invalid.target, null);
    assert.equal(invalid.splice.label, '');
    assert.ok(invalid.errors.length);
  });
});

test('main cable changes preserve filled, edited, customized and generated planning tasks', () => {
  for (const customization of [
    state => { state.jobs[0].lengthsText = '3×15 + 11'; },
    state => { state.planDirty = true; },
    state => { state.manualOrder = true; },
    state => { state.planJobs = [structuredClone(state.jobs[0])]; },
    state => { state.jobs[0].colors = ['black', 'white', 'red']; },
    state => { state.jobs[0].urgent = true; },
    state => { state.jobs.push(newJob(globalCable.id, 2.5)); }
  ]) {
    const state = initialState(); restorePlanner(null, state); customization(state);
    const before = structuredClone(state.jobs);
    state.cableId = optionFor('pv3').id; state.section = 4;
    assert.equal(syncPlannerSelection(state), false);
    assert.deepEqual(state.jobs, before);
  }
});

test('compact rows keep essential dye timing while formulas and explanations stay inside expanded details', () => {
  const state = { ...initialState(), jobs: [], planJobs: [], rules: { ...DEFAULT_RULES }, drums: [
    oldDrum({ id: 'blue', cableId: globalCable.id, section: 2.5, name: '', breakdowns: '' }),
    oldDrum({ id: 'brown', cableId: globalCable.id, section: 2.5, color: 'brown', name: '', breakdowns: '' }),
    oldDrum({ id: 'striped', cableId: globalCable.id, section: 2.5, color: 'yellow-green', name: '', breakdowns: '' })
  ] };
  withPlannerHarness(state, ({ planner, element }) => {
    planner.renderQueue();
    const first = planner.transitionText(state.drums[0], 0);
    assert.match(first, /15\s?000 − 150 \+ 1\s?000 = 15\s?850 м/);
    assert.match(first, /№2 — за 2\s?000 м до кінця \(старе налаштування\), на 13\s?000 м/);
    const head = planner.transitionText(state.drums[1], 1);
    assert.match(head, /№1 — орієнтовно за 300 м до зупинки, на 14\s?550 м/);
    assert.match(head, /розсікач/);
    const html = element('drums').innerHTML;
    assert.ok(html.includes(`<p class="drum-transition" data-transition="blue" >${first}</p>`));
    assert.ok(element('drums').innerHTML.includes(`<p class="drum-transition" data-transition="brown" >${head}</p>`));
    const blue = html.slice(html.indexOf('data-drum="blue"'), html.indexOf('data-drum="brown"'));
    assert.ok(blue.indexOf('data-transition="blue"') < blue.indexOf('</details>'), 'the complete transition belongs to expanded details');
    const summary = blue.slice(blue.indexOf('<summary class="drum-summary">'), blue.indexOf('</summary>'));
    assert.match(summary, /class="queue-alert">Барвник №2: 13\s?000 м/);
    assert.match(summary, /Екран 15\s?850 м/);
    assert.doesNotMatch(summary, /− 150|до кінця|розсікач|data-splice-label/);
    assert.doesNotMatch(html, /class="status-label"/);
  });
});

test('per-drum modes survive restoration and undo while invalid metadata stays automatic', () => {
  const single = oldDrum({ id: 'single', mode: 'single' });
  const dual = oldDrum({ id: 'dual', mode: 'dual' });
  const invalid = oldDrum({ id: 'invalid', mode: 'other' });
  const state = initialState();
  restorePlanner({ drums: [single, dual, invalid], previousPlan: { drums: [single], planJobs: [] } }, state);
  assert.deepEqual(state.drums.map(drum => drum.mode), ['single', 'dual', undefined]);
  assert.equal(state.previousPlan.drums[0].mode, 'single');
});

test('new jobs repeat the previous task while manually added drums use the main mode preference', () => {
  const state = { ...initialState(), color: 'brown', rules: { ...DEFAULT_RULES }, modePreferences: { [globalCable.id]: 'dual' } };
  restorePlanner(null, state);
  assert.equal(state.jobs[0].mode, 'dual');
  state.modePreferences[globalCable.id] = 'single';
  assert.equal(syncPlannerSelection(state), true);
  assert.equal(state.jobs[0].mode, 'single');
  state.jobs[0].lengthsText = '15';
  state.modePreferences[globalCable.id] = 'dual';
  assert.equal(syncPlannerSelection(state), false);
  assert.equal(state.jobs[0].mode, 'single');
  withPlannerHarness(state, ({ element }) => {
    element('add-job').listeners.get('click')();
    assert.equal(state.jobs[1].mode, 'single');
    assert.equal(state.jobs[1].lengthsText, '15');
    assert.notEqual(state.jobs[1].id, state.jobs[0].id);
    element('add-drum').listeners.get('click')();
    assert.equal(state.drums.at(-1).mode, 'dual');
  });
  const restored = initialState();
  restorePlanner({ jobs: state.jobs, planJobs: state.jobs, drums: state.drums }, restored);
  assert.deepEqual(restored.jobs.map(job => job.mode), ['single', 'single']);
  assert.deepEqual(restored.planJobs.map(job => job.mode), ['single', 'single']);
});

test('planner setup forwards explicit modes in its fifth argument and invalidates each cached variant', () => {
  const state = { ...initialState(), rules: { ...DEFAULT_RULES }, jobs: [], planJobs: [], drums: [] };
  const calls = [];
  const lookup = (...args) => { calls.push(args); return { mode: args[4] ?? 'dual', stored: {}, effective: {} }; };
  withPlannerHarness(state, ({ planner }) => {
    const drum = oldDrum({ cableId: globalCable.id, section: 2.5, color: 'brown', mode: 'single' });
    assert.equal(planner.setup(drum).mode, 'single');
    assert.equal(calls.at(-1)[4], 'single');
    drum.mode = 'dual';
    assert.equal(planner.setup(drum).mode, 'dual');
    assert.equal(calls.length, 2);
    delete drum.mode;
    planner.setup(drum); assert.equal(calls.at(-1)[4], undefined);
    drum.color = 'black'; drum.mode = 'single';
    planner.setup(drum); assert.equal(calls.at(-1)[4], 'dual');
    drum.color = 'yellow-green';
    planner.setup(drum); assert.equal(calls.at(-1)[4], 'dual');
    drum.cableId = 'thread-bundle'; drum.finalDiameter = '1,8'; drum.mode = 'dual';
    planner.setup(drum); assert.equal(calls.at(-1)[4], 'single'); assert.equal(calls.at(-1)[3], '1,8');
  }, lookup);
});

test('drum mode controls are only available for adjustable colours and editing them changes the saved drum', () => {
  const drums = [
    oldDrum({ id: 'brown', cableId: globalCable.id, section: 2.5, color: 'brown', name: '', breakdowns: '' }),
    oldDrum({ id: 'black', cableId: globalCable.id, section: 2.5, color: 'black', name: '', breakdowns: '' }),
    oldDrum({ id: 'striped', cableId: globalCable.id, section: 2.5, color: 'yellow-green', name: '', breakdowns: '' }),
    oldDrum({ id: 'thread', cableId: 'thread-bundle', section: 1, color: 'white', name: '', breakdowns: '' })
  ];
  const state = { ...initialState(), rules: { ...DEFAULT_RULES }, jobs: [], planJobs: [], drums };
  withPlannerHarness(state, ({ planner, element }) => {
    planner.renderQueue();
    const html = element('drums').innerHTML;
    assert.equal((html.match(/data-mode-picker hidden/g) || []).length, 3);
    assert.equal((html.match(/data-mode-picker >Екструдери/g) || []).length, 1);
    const change = value => element('drums').listeners.get('input')({ target: { dataset: { field: 'mode' }, value, closest: () => ({ dataset: { drum: 'brown' } }) } });
    change('single'); assert.equal(state.drums[0].mode, 'single');
    change('dual'); assert.equal(state.drums[0].mode, 'dual');
    change(''); assert.equal(Object.hasOwn(state.drums[0], 'mode'), false);
  }, (id, section, color, diameter, mode) => ({ mode: mode ?? 'dual', noDye: id === 'thread-bundle', stored: {}, effective: { matrix: 3 } }));
});

test('done rows keep their positions, expose undo and still participate in manual movement', () => {
  const task = newJob(globalCable.id, 2.5, { id: 'task', lengthsText: '15' });
  const state = { ...initialState(), jobs: [task], planJobs: [task], rules: { ...DEFAULT_RULES }, drums: [
    oldDrum({ id: 'blue', jobId: 'task', cableId: globalCable.id, section: 2.5, color: 'blue', status: 'done' }),
    oldDrum({ id: 'brown', jobId: 'task', cableId: globalCable.id, section: 2.5, color: 'brown', status: 'done' }),
    oldDrum({ id: 'striped', jobId: 'task', cableId: globalCable.id, section: 2.5, color: 'yellow-green', status: 'queued' })
  ] };
  const initialIds = state.drums.map(drum => drum.id);
  withPlannerHarness(state, ({ planner, element, clickAction }) => {
    planner.renderQueue();
    const html = element('drums').innerHTML;
    assert.ok(html.indexOf('data-drum="blue"') < html.indexOf('data-drum="brown"') && html.indexOf('data-drum="brown"') < html.indexOf('data-drum="striped"'));
    assert.equal(html.includes('completed-queue'), false);
    assert.match(html, /data-status="done" data-color="blue" style="--done-color:#3874bc"/);
    assert.match(html, />Не готово<\/button>/);
    assert.equal((html.match(/data-drag-handle/g) || []).length, 3, 'finished rows remain movable');
    clickAction('striped', 'cycle-status');
    assert.equal(state.drums[2].status, 'active');
    clickAction('striped', 'cycle-status');
    assert.deepEqual(state.drums.map(drum => drum.id), initialIds);
    assert.equal(state.drums[2].status, 'done');
    assert.match(element('plan-summary').innerHTML, /3 \/ 3 готово/);
    clickAction('striped', 'cycle-status');
    assert.equal(state.drums[2].status, 'queued');
    assert.deepEqual(state.drums.map(drum => drum.id), initialIds);
    assert.match(element('plan-summary').innerHTML, /2 \/ 3 готово/);
    clickAction('blue', 'down');
    assert.deepEqual(state.drums.map(drum => drum.id), ['brown', 'blue', 'striped']);
    assert.equal(state.drums[1].status, 'done');
  });
});

test('new planning tasks leave lengths empty while explicitly saved lengths survive restoration', () => {
  assert.equal(newJob(globalCable.id, 1.5).lengthsText, '');
  const savedTask = newJob(globalCable.id, 2.5, { id: 'actual-lengths', lengthsText: '2×8,5 + 4' });
  const state = initialState();
  restorePlanner({ jobs: [savedTask], planJobs: [savedTask], drums: [] }, state);
  assert.equal(state.jobs[0].lengthsText, '2×8,5 + 4');
  assert.equal(state.planJobs[0].lengthsText, '2×8,5 + 4');
});

test('the queue uses practical lead measurements for each extruder and falls back independently to general rules', () => {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const elements = new Map();
  globalThis.document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, { value: '', textContent: '', setAttribute() {}, classList: { toggle() {} }, addEventListener() {} }); return elements.get(id); },
    addEventListener() {}
  };
  globalThis.window = { addEventListener() {} };
  try {
    const drums = [oldDrum({ id: 'blue', cableId: globalCable.id, section: 2.5, breakdowns: '' }), oldDrum({ id: 'brown', cableId: globalCable.id, section: 2.5, color: 'brown', breakdowns: '' })];
    let mode = 'dual', stored = { colorLead1: 450, colorLead2: 2500 };
    const planner = createPlannerUI({
      state: { ...initialState(), drums, planJobs: [], rules: { ...DEFAULT_RULES } },
      getSetup: () => ({ mode, stored }), persist() {}, toast() {}, haptic() {}
    });
    assert.equal(planner.result(drums[0], 0).events[0].at, 12500, 'E2 uses its own practical lead');
    // Each new UI instance owns a setup cache, just as a rerender refreshes it.
    mode = 'single'; stored = { colorLead1: 450, colorLead2: null };
    const single = createPlannerUI({
      state: { ...initialState(), drums, planJobs: [], rules: { ...DEFAULT_RULES } },
      getSetup: () => ({ mode, stored }), persist() {}, toast() {}, haptic() {}
    });
    assert.equal(single.result(drums[0], 0).events[0].at, 14400, 'E1 uses its own practical lead from the stop');
    stored = { colorLead1: null, colorLead2: -1 }; mode = 'dual';
    const fallback = createPlannerUI({
      state: { ...initialState(), drums, planJobs: [], rules: { ...DEFAULT_RULES } },
      getSetup: () => ({ mode, stored }), persist() {}, toast() {}, haptic() {}
    });
    assert.equal(fallback.result(drums[0], 0).events[0].at, 13000);
    assert.equal(DEFAULT_RULES.lead2, 2000, 'practical values do not modify shared defaults');
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test('operator colour-lead anchors reach the drum calculation without replacing custom rules with generic forecasts', () => {
  const cases = [
    { method: 'operator-anchor', effective: 800, expected: 800 },
    { method: 'operator-interpolation', effective: 650, expected: 650 },
    { method: 'default-lead', effective: 2000, expected: 2222 },
    { method: 'measured-lead', effective: 900, expected: 2222 },
    { method: 'related-practical', effective: 900, expected: 2222 },
    { method: 'operator-anchor', effective: -1, expected: 2222 },
    { method: 'operator-anchor', effective: 800, stored: 600, expected: 600 },
    { method: 'operator-interpolation', effective: 650, practical: 950, expected: 950 },
    { method: 'operator-anchor', effective: 800, stored: 0, expected: 0 },
  ];
  for (const testCase of cases) {
    const drums = [
      oldDrum({ id: 'blue', cableId: globalCable.id, section: 2.5, color: 'blue', breakdowns: '' }),
      oldDrum({ id: 'brown', cableId: globalCable.id, section: 2.5, color: 'brown', breakdowns: '' })
    ];
    const state = { ...initialState(), jobs: [], planJobs: [], drums, rules: { ...DEFAULT_RULES, lead1: 111, lead2: 2222 } };
    const info = { mode: 'dual', stored: { colorLead2: testCase.stored }, practical: { colorLead2: testCase.practical },
      effective: { colorLead2: testCase.effective }, forecast: { fieldMethods: { colorLead2: testCase.method } } };
    withPlannerHarness(state, ({ planner }) => {
      const event = planner.result(drums[0], 0).events[0];
      assert.equal(event.lead, testCase.expected, JSON.stringify(testCase));
      assert.equal(event.at, 15000 - testCase.expected - (event.fromStop ? 150 : 0), JSON.stringify(testCase));
      assert.equal(state.rules.lead2, 2222, 'using an operator model cannot overwrite saved manual rules');
    }, () => info);
  }
});

test('legacy version 1 queues preserve operator order, ids, labels and faults with global cable settings', () => {
  const saved = {
    version: 1,
    drums: [
      oldDrum({ id: 'drum-2', color: 'brown', length: '11000', name: 'Б-2' }),
      oldDrum({ id: 'drum-0', color: 'yellow-green', name: 'Б-0', breakdowns: '735' }),
      oldDrum({ id: 'drum-1', color: 'blue', name: 'Б-1', breakdowns: '' })
    ]
  };
  const state = initialState();
  restorePlanner(saved, state);

  assert.deepEqual(state.drums, saved.drums.map(drum => ({
    ...drum, jobId: '', cableId: globalCable.id, section: state.section, status: 'queued'
  })));
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].cableId, globalCable.id);
  assert.equal(state.jobs[0].section, state.section);
  assert.deepEqual(state.planJobs, []);
  assert.equal(state.previousPlan, null);
});

test('version 1 saved tasks and Unicode or quoted ids retain links through a reload', () => {
  const jobId = 'Наряд "ВВГ" \'А\' [2] : 🟡';
  const task = newJob(globalCable.id, 2.5, { id: jobId });
  const saved = {
    version: 1,
    jobs: [task], planJobs: [task], planDirty: true, manualOrder: true,
    drums: [
      oldDrum({ id: `Барабан "2" 'ж' — ${jobId}`, jobId, cableId: task.cableId, section: task.section, color: 'yellow-green' }),
      oldDrum({ id: 'Синій [1] : "0"', jobId, cableId: task.cableId, section: task.section })
    ]
  };
  const snapshot = structuredClone(saved);
  const state = initialState();
  restorePlanner(saved, state);

  assert.deepEqual(state.jobs, [task]);
  assert.deepEqual(state.planJobs, [task]);
  assert.deepEqual(state.drums, saved.drums.map(drum => ({ ...drum, status: 'queued' })));
  assert.ok(state.drums.every(drum => drum.jobId === state.planJobs[0].id));
  assert.equal(state.planDirty, true);
  assert.equal(state.manualOrder, true);
  assert.deepEqual(saved, snapshot, 'restoration must not rewrite the saved data');
});

test('saved production queues beyond the old fifty-drum limit are restored in full', () => {
  const drums = Array.from({ length: 76 }, (_, index) => oldDrum({
    id: `persisted-${index}`, color: index % 2 ? 'brown' : 'blue',
    length: index % 7 ? '15000' : '11000', name: `Б-${index}`, breakdowns: `${index + 1}`
  }));
  const state = initialState();
  restorePlanner({ version: 1, drums }, state);

  assert.equal(state.drums.length, 76);
  assert.deepEqual(state.drums.map(({ id, color, length, name, breakdowns }) => ({ id, color, length, name, breakdowns })), drums);
  assert.equal(state.drums.at(-1).name, 'Б-75');
});

test('an intentionally empty saved queue remains empty instead of restoring starter drums', () => {
  const state = initialState();
  restorePlanner({ version: 1, drums: [] }, state);

  assert.deepEqual(state.drums, []);
  assert.equal(state.jobs.length, 1, 'the task builder should still have an editable starting task');
});

test('an unsupported per-drum section falls back to a section available for that cable', () => {
  const cable = CATALOG_CABLES.find(option => option.brand === 'H05V-U');
  assert.ok(cable);
  const state = initialState();
  assert.equal(cable.sections.includes(state.section), false, 'the global setup must be incompatible with this cable');
  restorePlanner({ drums: [oldDrum({ cableId: cable.id, section: 999 })] }, state);

  assert.equal(state.drums[0].cableId, cable.id);
  assert.equal(state.drums[0].section, cable.sections[0]);
  assert.ok(optionFor(state.drums[0].cableId).sections.includes(state.drums[0].section));
  assert.notEqual(state.drums[0].section, state.section);
});

test('missing or invalid per-drum cable ids fall back to the supported global setup', () => {
  const state = initialState();
  restorePlanner({ drums: [oldDrum({ cableId: 'removed-cable', section: 999 })] }, state);

  assert.equal(state.drums[0].cableId, globalCable.id);
  assert.equal(state.drums[0].section, state.section);
  assert.ok(globalCable.sections.includes(state.drums[0].section));
});

test('the previous plan keeps its own queue, metadata and task links for undo after a reload', () => {
  const previousTask = newJob(globalCable.id, 2.5, { id: 'Попереднє "завдання"', urgent: true, batchSize: 2 });
  const previousDrums = [
    oldDrum({ id: 'previous-brown', jobId: previousTask.id, cableId: previousTask.cableId, section: previousTask.section, color: 'brown', name: 'До зміни' }),
    oldDrum({ id: 'previous-blue', jobId: previousTask.id, cableId: previousTask.cableId, section: previousTask.section, length: '11000', breakdowns: '104' })
  ];
  const saved = {
    drums: [oldDrum({ id: 'current' })], manualOrder: false,
    previousPlan: { drums: previousDrums, planJobs: [previousTask], manualOrder: true }
  };
  const snapshot = structuredClone(saved);
  const state = initialState();
  restorePlanner(saved, state);

  assert.equal(state.drums[0].id, 'current');
  assert.equal(state.manualOrder, false);
  assert.deepEqual(state.previousPlan, {
    ...saved.previousPlan, reason: 'edit',
    drums: saved.previousPlan.drums.map(drum => ({ ...drum, status: 'queued' }))
  });
  assert.ok(state.previousPlan.drums.every(drum => drum.jobId === state.previousPlan.planJobs[0].id));
  state.previousPlan.drums[0].name = 'Після відновлення';
  assert.deepEqual(saved, snapshot, 'undo data must be restored independently from the saved snapshot');
});

test('resource inputs update the current result immediately, preserve input nodes and are included in copied plans', () => {
  const task = newJob(optionFor('pv3').id, 2.5, { coreClass: 3, colors: ['white', 'blue'], lengthsText: '15' });
  const state = { ...initialState(), jobs: [task], planJobs: [task], drums: scheduleJobs([task]).drums, rules: { ...DEFAULT_RULES } };
  withPlannerHarness(state, ({ planner, element }) => {
    const container = element('plan-resources'), stockOutput = { innerHTML: '' };
    planner.render();
    const initialHTML = container.innerHTML;
    assert.match(initialHTML, /Жила на завдання/);
    assert.match(initialHTML, /30<small>км/);
    assert.doesNotMatch(initialHTML, /data-shift-field|Поправки часу|resource-footnote/);
    assert.doesNotMatch(element('jobs').innerHTML, /Скрутка чекає|Перша партія/);
    assert.match(initialHTML, /Ще <b>2<\/b> повні барабани/);
    const stockGroup = { dataset: { stockKey: '2.5:3' }, querySelector: () => stockOutput };
    const stockInput = { dataset: { stockField: 'piecesText' }, value: '10000, 1500', closest: () => stockGroup };
    container.listeners.get('input')({ target: stockInput });
    assert.match(stockOutput.innerHTML, /Ще <b>1<\/b> повний барабан/);
    assert.equal(state.coreStock['2.5:3'].piecesText, '10000, 1500');
    assert.equal(container.innerHTML, initialHTML, 'editing pieces does not replace the focused input');
    const copied = planner.resourcesText().join('\n');
    assert.match(copied, /Обід: 60/);
    assert.match(copied, /ще повних барабанів: 1/);
    assert.match(copied, /Інструмент на все завдання/);
    stockInput.value = '10000,';
    container.listeners.get('input')({ target: stockInput });
    assert.match(stockOutput.innerHTML, /class="error"/);
  }, () => ({ mode: 'single', stored: {}, reference: { workingSpeed: 100 }, effective: { dorn: 2.15, matrix: 3.7 }, sources: {} }));
});

test('production statuses survive a reload while legacy and invalid values return to the queue', () => {
  const statuses = ['done', 'active', 'queued', undefined, 'finished', true, null];
  const saved = { drums: statuses.map((status, index) => oldDrum({ id: `status-${index}`, status })) };
  const snapshot = structuredClone(saved);
  const state = initialState();
  restorePlanner(saved, state);

  assert.deepEqual(state.drums.map(drum => drum.status), ['done', 'active', 'queued', 'queued', 'queued', 'queued', 'queued']);
  assert.deepEqual(state.drums.map(drum => drum.id), saved.drums.map(drum => drum.id));
  assert.deepEqual(saved, snapshot, 'status migration must not rewrite the saved snapshot');
});

test('only the first active drum is restored in each current or undo queue', () => {
  const saved = {
    drums: [
      oldDrum({ id: 'current-done', status: 'done' }),
      oldDrum({ id: 'current-active', status: 'active' }),
      oldDrum({ id: 'current-second-active', status: 'active' })
    ],
    previousPlan: {
      reason: 'status', planJobs: [], manualOrder: true,
      drums: [
        oldDrum({ id: 'previous-active', status: 'active' }),
        oldDrum({ id: 'previous-done', status: 'done' }),
        oldDrum({ id: 'previous-second-active', status: 'active' })
      ]
    }
  };
  const snapshot = structuredClone(saved);
  const state = initialState();
  restorePlanner(saved, state);

  assert.deepEqual(state.drums.map(drum => drum.status), ['done', 'active', 'queued']);
  assert.deepEqual(state.previousPlan.drums.map(drum => drum.status), ['active', 'done', 'queued']);
  assert.equal(state.previousPlan.reason, 'status');
  assert.equal(state.previousPlan.manualOrder, true);
  assert.deepEqual(saved, snapshot, 'normalizing exclusive active work must be immutable');
});

test('a cleared queue restores its full previous work and a valid undo reason after reload', () => {
  const task = newJob(globalCable.id, 2.5, { id: 'clear-task' });
  const saved = {
    drums: [], jobs: [task], planJobs: [task],
    previousPlan: {
      reason: 'clear', planJobs: [task], manualOrder: true,
      drums: [
        oldDrum({ id: 'done-work', jobId: task.id, cableId: task.cableId, section: task.section, status: 'done' }),
        oldDrum({ id: 'active-work', jobId: task.id, cableId: task.cableId, section: task.section, status: 'active' })
      ]
    }
  };
  const state = initialState();
  restorePlanner(saved, state);

  assert.deepEqual(state.drums, []);
  assert.deepEqual(state.previousPlan, saved.previousPlan);
  assert.ok(state.previousPlan.drums.every(drum => drum.jobId === state.previousPlan.planJobs[0].id));
  state.previousPlan.drums[0].status = 'queued';
  assert.equal(saved.previousPlan.drums[0].status, 'done', 'undo work is independent from the saved snapshot');

  const invalidReasonState = initialState();
  restorePlanner({ previousPlan: { ...saved.previousPlan, reason: 'untrusted' } }, invalidReasonState);
  assert.equal(invalidReasonState.previousPlan.reason, 'edit');
});

test('coiling mode and joint positions survive local plan restoration and show compensation', () => {
  const cable = CATALOG_CABLES.find(item => item.brand === 'ПВ3');
  const job = newJob(cable.id, 2.5, { id: 'coil-job', lengthsText: '1', colors: ['blue'], coiling: true });
  const drum = { id: 'coil-drum', jobId: job.id, cableId: cable.id, section: 2.5, color: 'blue', length: '1000', breakdowns: '250', joints: '', coiling: true };
  const state = { ...initialState(), rules: { ...DEFAULT_RULES } };
  restorePlanner({ ...initialState(), jobs: [job], planJobs: [job], drums: [drum] }, state);
  assert.equal(state.jobs[0].coiling, true);
  assert.equal(state.drums[0].coiling, true);
  state.drums[0].joints = '700';
  withPlannerHarness(state, ({ planner, element }) => {
    const result = planner.result(state.drums[0], 0);
    assert.equal(result.production.coils, 10);
    assert.equal(result.production.waste, 100);
    assert.equal(result.production.target, 1100);
    planner.renderQueue();
    assert.match(element('drums').innerHTML, /Бухтовка/);
    assert.match(element('drums').innerHTML, /Додатково/);
  });
});

test('drum player shows tools and settings and navigation does not change production status', () => {
  const cable = optionFor('pv3');
  const state = { ...initialState(), rules: { ...DEFAULT_RULES }, jobs: [], planJobs: [], drums: [
    { id: 'first', cableId: cable.id, section: 2.5, color: 'yellow-green', length: '1000', status: 'active' },
    { id: 'second', cableId: cable.id, section: 2.5, color: 'blue', length: '1000', status: 'queued' }
  ] };
  const getSetup = (cableId, section, color, diameter, mode) => setupFor(cableId, section, {}, color, { finalDiameter: diameter, mode });
  withPlannerHarness(state, ({ planner, element }) => {
    planner.renderQueue();
    const panel = element('drum-player');
    assert.match(panel.innerHTML, /Барабан 1 \/ 2/);
    assert.match(panel.innerHTML, /Смугастий/);
    assert.match(panel.innerHTML, /Дорн/);
    assert.match(panel.innerHTML, /SIKORA/);
    const button = { dataset: { player: 'next' }, disabled: false };
    panel.listeners.get('click')({ target: { closest: () => button } });
    assert.match(panel.innerHTML, /Барабан 2 \/ 2/);
    assert.match(panel.innerHTML, /Будь-який/);
    assert.deepEqual(state.drums.map(drum => drum.status), ['active', 'queued']);
    button.dataset.player = 'previous';
    panel.listeners.get('click')({ target: { closest: () => button } });
    assert.match(panel.innerHTML, /Барабан 1 \/ 2/);
  }, getSetup);
});

test('second extruder operator lead is measured from the planned manual stop', () => {
  const drums = [
    oldDrum({ id: 'blue', cableId: globalCable.id, section: 1.5, coreClass: 5, color: 'blue', breakdowns: '' }),
    oldDrum({ id: 'brown', cableId: globalCable.id, section: 1.5, coreClass: 5, color: 'brown', breakdowns: '' })
  ];
  const state = { ...initialState(), jobs: [], planJobs: [], drums, rules: { ...DEFAULT_RULES } };
  const info = { mode: 'dual', stored: {}, effective: {}, forecast: {} };
  withPlannerHarness(state, ({ planner, element }) => {
    const result = planner.result(drums[0], 0);
    assert.equal(result.target, 15850, 'the temporary screen setting still prevents automatic transfer');
    assert.equal(result.stopAt, 14850);
    assert.deepEqual(result.events[0], { extruder: 2, at: 13250, lead: 1600, dye: 'Коричневий', fromStop: true });
    planner.renderQueue();
    assert.match(element('drums').innerHTML, /Планова зупинка/);
    assert.match(element('drum-player').innerHTML, /Показ після запуску/);
    assert.match(element('drums').innerHTML, /Відкрити байпаси.*Стравити через основну головку/);
  }, () => info);
});

test('restart transfer uses the actual counter after good cable appears', () => {
  assert.equal(restartTarget('14871'), 15041);
  assert.equal(restartTarget('14863'), 15033);
  for (const input of ['', '10.5', '-1', '1e3', '9007199254740991']) assert.equal(restartTarget(input), null);
});

test('coiling is determined by the confirmed brand, regardless of old manual choices', () => {
  for (const [brand, section, expectedSize] of [
    ['ПВ1', 1.5, 200], ['ПВ3', 1, 300], ['H05V-U', 0.5, 200],
    ['H05V-K', 0.75, 100], ['H07V-U', 2.5, 100], ['H07V-K', 6, 100]
  ]) {
    const cable = CATALOG_CABLES.find(item => item.brand === brand);
    const drums = [{ id: 'coil', cableId: cable.id, section, color: 'blue', length: '1000', breakdowns: '50', coiling: false }];
    const state = { ...initialState(), rules: { ...DEFAULT_RULES }, jobs: [], planJobs: [], drums };
    withPlannerHarness(state, ({ planner, element }) => {
      const result = planner.result(drums[0], 0);
      assert.equal(result.coiling, true, brand);
      assert.equal(result.production.size, expectedSize, brand);
      assert.equal(result.production.waste, 50, brand);
      planner.renderQueue();
      assert.doesNotMatch(element('jobs').innerHTML, /data-job-field="coiling"/);
      assert.doesNotMatch(element('drums').innerHTML, /data-field="coiling"/);
    }, () => ({ mode: 'dual', stored: {}, effective: {}, forecast: {} }));
  }
  const other = { id: 'plain', cableId: globalCable.id, section: 1.5, color: 'blue', length: '1000', coiling: true, breakdowns: '50' };
  const state = { ...initialState(), rules: { ...DEFAULT_RULES }, jobs: [], planJobs: [], drums: [other] };
  withPlannerHarness(state, ({ planner }) => assert.equal(planner.result(other, 0).coiling, false));
});

test('player uses the last required splitter through a one-extruder drum', () => {
  const cable = optionFor('pv3');
  const state = { ...initialState(), rules:{ ...DEFAULT_RULES }, jobs:[], planJobs:[], drums:[
    { id:'s', cableId:cable.id, section:1, color:'yellow-green', length:'15000', mode:'dual' },
    { id:'one', cableId:cable.id, section:1, color:'blue', length:'15000', mode:'single' },
    { id:'b', cableId:cable.id, section:1, color:'black', length:'15000', mode:'dual' },
  ] };
  const getSetup = (id, section, color, diameter, mode) => setupFor(id, section, {}, color, { mode, finalDiameter:diameter });
  withPlannerHarness(state, ({ planner, element }) => {
    planner.renderQueue();
    assert.equal(planner.result(state.drums[0],0).headChange,false);
    assert.equal(planner.result(state.drums[1],1).headChange,true);
    assert.match(planner.transitionText(state.drums[1],1), /поставити розсікач для суцільного/);
    assert.match(element('plan-summary').innerHTML, /розсікач: <b>1<\/b>/);
    state.drums[2].color='yellow-green';
    assert.equal(planner.result(state.drums[1],1).headChange,false);
  }, getSetup);
});


test('one status button cycles through production and keeps journal numbers when reordered', () => {
  const state = { ...initialState(), rules: { ...DEFAULT_RULES }, journalLast: '100' };
  restorePlanner({ journalLast: '100', drums: [oldDrum({ id: 'a', coreClass: 3 }), oldDrum({ id: 'b', coreClass: 3 }), oldDrum({ id: 'c', coreClass: 5 })] }, state);
  withPlannerHarness(state, ({ planner, element, clickAction }) => {
    planner.renderQueue();
    assert.deepEqual(state.drums.map(d => planner.journalNumber(d)), [101, 102, 103]);
    assert.equal((element('drums').innerHTML.match(/data-action="cycle-status"/g) || []).length, 3);
    assert.match(element('drums').innerHTML, /Жила: 5 клас/);
    clickAction('a', 'cycle-status'); assert.equal(state.drums[0].status, 'active');
    assert.equal(state.drums[0].journalNumber, 101);
    clickAction('a', 'cycle-status'); assert.equal(state.drums[0].status, 'done');
    clickAction('a', 'down');
    assert.deepEqual(state.drums.map(d => [d.id, planner.journalNumber(d)]), [['b', 102], ['a', 101], ['c', 103]]);
    const restored = initialState(); restorePlanner(structuredClone(state), restored);
    assert.equal(restored.journalLast, '100');
    assert.equal(restored.drums.find(d => d.id === 'a').journalNumber, 101);
    clickAction('a', 'cycle-status');
    assert.equal(state.drums.find(d => d.id === 'a').status, 'queued');
    assert.equal(state.drums.find(d => d.id === 'a').journalNumber, undefined);
    assert.deepEqual(state.drums.map(d => planner.journalNumber(d)), [101, 102, 103]);
  });
});

test('legacy fault and joint marks are combined and remain editable', () => {
  const state = { ...initialState(), rules: { ...DEFAULT_RULES } };
  restorePlanner({ drums: [oldDrum({ id: 'legacy', cableId: globalCable.id, section: 2.5, breakdowns: '250', joints: '700', length: '1000' })] }, state);
  assert.equal(state.drums[0].breakdowns, '250; 700');
  assert.equal(state.drums[0].joints, undefined);
  withPlannerHarness(state, ({ planner, element }) => {
    planner.renderQueue();
    assert.match(element('drums').innerHTML, /Пробій \/ з’єднання, м/);
    assert.doesNotMatch(element('drums').innerHTML, /data-field="joints"/);
    assert.equal(planner.result(state.drums[0], 0).splice.label, '(250+450+300)');
    assert.equal(planner.result(state.drums[0], 0).target, 1000);
  });
});


test('numbering starts after the last journal entry and skips previously completed rows', () => {
  const state = { ...initialState(), rules: { ...DEFAULT_RULES } };
  restorePlanner({ journalLast: '100', drums: [oldDrum({ id: 'old', status: 'done' }), oldDrum({ id: 'active', status: 'active' }), oldDrum({ id: 'next' })] }, state);
  withPlannerHarness(state, ({ planner, clickAction }) => {
    planner.renderQueue();
    assert.deepEqual(state.drums.map(drum => planner.journalNumber(drum)), [undefined, 101, 102]);
    clickAction('active', 'cycle-status');
    assert.equal(state.drums[1].journalNumber, 101);
    assert.equal(planner.journalNumber(state.drums[2]), 102);
  });
});

test('ПВС: один неповний замір не створює точку перемикання, практичне значення зберігається', () => {
  const pvs = optionFor('pvs-380--pvs').id;
  const current = oldDrum({ id: 'yg', cableId: pvs, section: 6, color: 'yellow-green', breakdowns: '' });
  const next = oldDrum({ id: 'brown', cableId: pvs, section: 6, color: 'brown', idealColor: true, breakdowns: '' });
  const state = { ...initialState(), jobs: [], planJobs: [], rules: { ...DEFAULT_RULES }, drums: [current, next] };
  const setup = (id, section, color, diameter, mode) => ({ mode: mode ?? 'dual', stored: {} });
  withPlannerHarness(state, ({ planner }) => {
    let result = planner.result(current, 0);
    let first = result.events.find(item => item.extruder === 1);
    assert.equal(first, undefined);
    assert.match(result.warnings.join(' '), /момент перемикання не визначено/);
    next.idealColor = false;
    result = planner.result(current, 0);
    first = result.events.find(item => item.extruder === 1);
    assert.equal(first.at, 14550);
    assert.match(result.warnings.join(' '), /не перевірений замір/);
  }, setup);
  next.idealColor = true;
  withPlannerHarness(state, ({ planner }) => {
    const result = planner.result(current, 0);
    assert.equal(result.events.find(item => item.extruder === 1).at, 14650);
    assert.doesNotMatch(result.warnings.join(' '), /момент перемикання не визначено/);
  }, (id, section, color, diameter, mode) => ({ mode: mode ?? 'dual', stored: color === 'yellow-green' ? { colorLead1: 200 } : {} }));
});

test('other PVS sections do not use an unvalidated lead and show a clear warning', () => {
  const pvs = optionFor('pvs-380--pvs').id;
  const current = oldDrum({ id: 'yg', cableId: pvs, section: 2.5, color: 'yellow-green', breakdowns: '' });
  const next = oldDrum({ id: 'brown', cableId: pvs, section: 2.5, color: 'brown', idealColor: true, breakdowns: '' });
  const state = { ...initialState(), jobs: [], planJobs: [], rules: { ...DEFAULT_RULES }, drums: [current, next] };
  withPlannerHarness(state, ({ planner, element }) => {
    const result = planner.result(current, 0);
    assert.equal(result.events.find(event => event.extruder === 1), undefined);
    planner.renderQueue();
    assert.match(element('drums').innerHTML, /момент перемикання не визначено/);
    assert.match(element('drums').innerHTML, /Перевір зміну барвника/);
  }, (id, section, color, diameter, mode) => ({ mode: mode ?? 'dual', stored: {} }));
});

test('splitter replacement is the fourth step during the stop with bypasses open, before head purge', () => {
  for (const [from, to, expected] of [['yellow-green', 'blue', 'звичайний'], ['brown', 'yellow-green', 'смугастий']]) {
    const state = { ...initialState(), jobs: [], planJobs: [], rules: { ...DEFAULT_RULES }, drums: [
      oldDrum({ id: 'first', cableId: globalCable.id, section: 2.5, color: from, breakdowns: '' }),
      oldDrum({ id: 'next', cableId: globalCable.id, section: 2.5, color: to, breakdowns: '' })
    ] };
    withPlannerHarness(state, ({ planner, element }) => {
      planner.renderQueue();
      const match = element('drums').innerHTML.match(/<ol class="steps">([\s\S]*?)<\/ol>/);
      assert.ok(match);
      const steps = [...match[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(item => item[1]);
      assert.match(steps[0], /барвник №1/);
      assert.match(steps[0], /барвник №2/);
      assert.match(steps[1], /Планова зупинка/);
      assert.match(steps[2], /Відкрити байпаси/);
      assert.match(steps[3], new RegExp('Змінити розсікач на ' + expected));
      assert.match(steps[3], /під час зупинки, поки байпаси відкриті/);
      assert.match(steps[4], /Стравити через основну головку/);
      assert.match(steps[5], /Запустити лінію/);
      assert.match(element('drum-player').innerHTML, /розсікач.*під час зупинки з відкритими байпасами/);
    }, () => ({ mode: 'dual', stored: {} }));
  }
});
