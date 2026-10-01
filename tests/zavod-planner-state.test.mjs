import assert from 'node:assert/strict';
import test from 'node:test';

import { CATALOG_CABLES, optionFor } from '../Zavod/catalog-base.js';
import { newJob, restorePlanner } from '../Zavod/plan-ui.js';

const globalCable = optionFor('vvgng-p');
const initialState = () => ({
  cableId: globalCable.id,
  section: 1.5,
  drums: [{ id: 'initial-drum', color: 'blue', length: '15000', name: '', breakdowns: '' }]
});
const oldDrum = (overrides = {}) => ({
  id: 'old-drum', color: 'blue', length: '15000', name: 'Барабан № 27', breakdowns: '3682; 9240', ...overrides
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
