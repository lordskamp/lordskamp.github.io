import assert from 'node:assert/strict';
import test from 'node:test';

import { CATALOG_CABLES, optionFor } from '../Zavod/catalog-base.js';
import { createPlannerUI, newJob, restorePlanner, syncPlannerSelection } from '../Zavod/plan-ui.js';
import { DEFAULT_RULES } from '../Zavod/core.js';
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
  const planned = scheduleJobs(state.jobs);
  assert.deepEqual(planned.errors, []);
  state.drums = planned.drums; state.planJobs = structuredClone(state.jobs);
  state.drums.forEach(drum => { drum.status = 'done'; });
  withPlannerHarness(state, ({ planner, element }) => {
    planner.render();
    assert.equal(planner.drumTitle(state.drums[0]), 'Джгути');
    assert.match(element('jobs').innerHTML, /<label hidden>Переріз жили/);
    assert.match(element('jobs').innerHTML, /Кількість кольорів/);
    assert.match(element('drums').innerHTML, /<label hidden>Переріз, мм²/);
    assert.match(element('drums').innerHTML, /<b>Джгути<\/b>/);
    assert.match(element('plan-summary').innerHTML, /15 км \(Джгути\)/);
    assert.doesNotMatch(element('plan-summary').innerHTML, /1 мм²|3×1/);
  }, (id, section, color) => setupFor(id, section, {}, color));
  const restored = { ...initialState(), cableId: 'thread-bundle', section: 1 };
  restorePlanner(structuredClone(state), restored);
  assert.deepEqual(restored.drums, state.drums);
  assert.deepEqual(restored.jobs, state.jobs);
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
  assert.match(total.textContent, /56/);
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
    assert.equal(planner.result(state.drums[0], 0).target, 15060);
    assert.match(element('drums').innerHTML, /data-splice-label>\(5380\+3070\+6550\)/);
    state.rules.splice = 45;
    planner.renderOutputs();
    assert.equal(element('splice-label').textContent, '(6830+4170)');
  });
  const deleted = { ...initialState(), rules: { ...DEFAULT_RULES } };
  restorePlanner({ ...saved, drums: [] }, deleted);
  assert.equal(deleted.splicePlan, undefined);
});

test('splice reserves combine with transitions while labels and production totals use nominal metres', () => {
  const first = oldDrum({ id: 'spliced', cableId: globalCable.id, section: 2.5, breakdowns: '6838' });
  const next = oldDrum({ id: 'next', cableId: globalCable.id, section: 2.5, color: 'brown', breakdowns: '' });
  const state = { ...initialState(), jobs: [], planJobs: [], rules: { ...DEFAULT_RULES }, drums: [first, next] };
  withPlannerHarness(state, ({ planner }) => {
    const transition = planner.result(first, 0);
    assert.equal(transition.splice.label, '(6830+8170)');
    assert.equal(transition.target, 15880);
    assert.equal(transition.events[0].at, 13030);
    assert.equal(first.length, '15000');
    next.section = 1.5;
    assert.equal(planner.result(first, 0).target, 14880);
    first.breakdowns = '5385; 8459';
    assert.equal(planner.result(first, 0).target, 14910);
    first.breakdowns = '8459; 8450';
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

test('compact queue rows always display color transition formula and default dye leads', () => {
  const state = { ...initialState(), jobs: [], planJobs: [], rules: { ...DEFAULT_RULES }, drums: [
    oldDrum({ id: 'blue', cableId: globalCable.id, section: 2.5, name: '', breakdowns: '' }),
    oldDrum({ id: 'brown', cableId: globalCable.id, section: 2.5, color: 'brown', name: '', breakdowns: '' }),
    oldDrum({ id: 'striped', cableId: globalCable.id, section: 2.5, color: 'yellow-green', name: '', breakdowns: '' })
  ] };
  withPlannerHarness(state, ({ planner, element }) => {
    planner.renderQueue();
    const first = planner.transitionText(state.drums[0], 0);
    assert.match(first, /15\s?000 − 150 \+ 1\s?000 = 15\s?850 м/);
    assert.match(first, /№2 — за 2\s?000 м до кінця, на 13\s?000 м/);
    const head = planner.transitionText(state.drums[1], 1);
    assert.match(head, /№1 — за 300 м до кінця, на 14\s?700 м/);
    assert.match(head, /розсікач/);
    assert.ok(element('drums').innerHTML.includes(`<p class="drum-transition" data-transition="blue" >${first}</p>`), 'the countdown is outside the collapsed details');
    assert.ok(element('drums').innerHTML.includes(`<p class="drum-transition" data-transition="brown" >${head}</p>`));
  });
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
    clickAction('striped', 'done');
    assert.deepEqual(state.drums.map(drum => drum.id), initialIds);
    assert.equal(state.drums[2].status, 'done');
    assert.match(element('plan-summary').innerHTML, /15 км \(2,5 мм²\)/);
    clickAction('striped', 'done');
    assert.equal(state.drums[2].status, 'queued');
    assert.deepEqual(state.drums.map(drum => drum.id), initialIds);
    assert.match(element('plan-summary').innerHTML, /ще немає комплекту кольорів/);
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
    getElementById(id) { if (!elements.has(id)) elements.set(id, { addEventListener() {} }); return elements.get(id); },
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
    assert.equal(single.result(drums[0], 0).events[0].at, 14550, 'E1 uses its own practical lead');
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
