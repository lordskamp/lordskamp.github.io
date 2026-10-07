import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_DRUMS,
  drumStatus,
  expandJobs,
  moveDrum,
  parseJobLengths,
  planSummary,
  productionSummary,
  recommendOrder,
  scheduleJobs,
  setDrumStatus
} from '../Zavod/planner.js';

const job = (overrides = {}) => ({ id: 'job-1', cableId: 'vvgng-p', section: 2.5, cores: 3, colors: ['yellow-green', 'blue', 'brown'], lengthsText: '3×15,0 + 3×15,0 + 11,0', urgent: false, batchSize: 3, ...overrides });
const group = drums => drums.reduce((groups, drum) => {
  const last = groups.at(-1);
  if (last?.color === drum.color && last.length === drum.length) last.count++;
  else groups.push({ color: drum.color, length: drum.length, count: 1 });
  return groups;
}, []);
const threadJob = overrides => job({ cableId: 'thread-bundle', section: 1, lengthsText: '15', ...overrides });

test('thread final diameter from the task expands to all colours and remains an optional decimal millimetre value', () => {
  for (const value of ['2,5', ' 2.50 ', 2.5, '.5', '0,5']) {
    const result = expandJobs([threadJob({ finalDiameter: value })]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.drums.length, 3);
    assert(result.drums.every(drum => drum.finalDiameter === Number(String(value).trim().replace(',', '.'))));
  }
  for (const finalDiameter of [undefined, null, '', '   ']) {
    const result = scheduleJobs([threadJob({ finalDiameter })]);
    assert.deepEqual(result.errors, []);
    assert(result.drums.every(drum => drum.finalDiameter === null));
    assert.equal(planSummary(result.drums, [threadJob({ finalDiameter })]).ready[0].finalDiameter, null);
  }
  const metal = expandJobs([job({ finalDiameter: 'not applicable' })]);
  assert.deepEqual(metal.errors, []);
  assert(metal.drums.every(drum => !Object.hasOwn(drum, 'finalDiameter')));
});

test('invalid nonempty final diameter never generates a partial thread plan', () => {
  for (const finalDiameter of [0, -2.5, '0', '-2,5', 'wrong', '2,5,1', Infinity, NaN, 'Infinity', '1e2', '0x10', true, [], {}]) {
    for (const operation of [expandJobs, scheduleJobs]) {
      const result = operation([threadJob({ finalDiameter })]);
      assert.deepEqual(result.drums, []);
      assert(result.errors.some(error => error.includes('кінцевий діаметр джгута')), String(finalDiameter));
    }
  }
});

test('thread regeneration preserves completion for equal diameters and resets real diameter changes', () => {
  const task = threadJob({ finalDiameter: '2,5' });
  const saved = scheduleJobs([task]).drums.map((drum, index) => ({ ...drum, finalDiameter: '2,50', status: index === 0 ? 'active' : 'done',
    name: `Б-${index}`, breakdowns: '6838' }));
  const before = structuredClone(saved);
  const same = scheduleJobs([{ ...task, finalDiameter: 2.5 }], saved);
  assert.deepEqual(same.warnings, []);
  for (const drum of same.drums) assert.equal(drum.status, saved.find(source => source.id === drum.id).status);
  for (const diameter of [2.6, '', undefined]) {
    const result = scheduleJobs([{ ...task, finalDiameter: diameter }], saved);
    assert(result.drums.every(drum => drum.status === 'queued'));
    assert(result.warnings.some(warning => warning.includes('кінцевим діаметром')));
    for (const drum of result.drums) {
      const original = saved.find(source => source.id === drum.id);
      assert.equal(drum.name, original.name);
      assert.equal(drum.breakdowns, original.breakdowns);
    }
  }
  assert.deepEqual(saved, before);
  const old = scheduleJobs([threadJob()]).drums.map(drum => { const legacy = { ...drum, status: 'done' }; delete legacy.finalDiameter; return legacy; });
  assert(scheduleJobs([threadJob({ finalDiameter: '' })], old).drums.every(drum => drum.status === 'done'));
  assert(scheduleJobs([threadJob({ finalDiameter: 2.5 })], old).drums.every(drum => drum.status === 'queued'));
});

test('thread readiness retains target diameter and excludes another or unrecorded diameter', () => {
  const task = threadJob({ finalDiameter: '2,5' });
  const original = scheduleJobs([task]).drums.map(drum => ({ ...drum, status: 'done', finalDiameter: '2.50' }));
  for (const operation of [planSummary, productionSummary]) {
    const complete = operation(original, [task]);
    assert.equal(complete.ready[0].finalDiameter, 2.5);
    assert.equal(complete.ready[0].readyMetres, 15000);
    assert.equal(complete.ready[0].complete, true);
    for (const finalDiameter of [2.6, null, undefined, '', 'bad']) {
      const edited = original.map(drum => drum.color === 'blue' ? { ...drum, finalDiameter } : drum);
      const summary = operation(edited, [task]);
      assert.equal(summary.ready[0].readyMetres, 0, String(finalDiameter));
      assert.equal(summary.ready[0].complete, false);
      assert(summary.warnings.some(warning => warning.includes('кінцевий діаметр')));
    }
  }
  const legacy = productionSummary(original);
  assert.equal(legacy.ready[0].finalDiameter, 2.5);
  assert.equal(legacy.ready[0].readyMetres, 15000);
  const mixed = productionSummary(original.map(drum => drum.color === 'blue' ? { ...drum, finalDiameter: 3 } : drum));
  assert.equal(mixed.ready[0].readyMetres, 0);
  assert.equal(mixed.ready[0].complete, false);
});

test('kilometre notation expands repeats exactly for each decimal and separator style', () => {
  for (const text of ['3×15,0 + 3x15.0 + 11,0', '3х15,0; 3*15,0;11,0км', '3 × 15\n3 X 15\n11 km', '3×15\r\n3×15\r\n11']) {
    assert.deepEqual(parseJobLengths(text), { lengths: [15000, 15000, 15000, 15000, 15000, 15000, 11000], errors: [] }, text);
  }
  assert.deepEqual(parseJobLengths('0,001 + 1,234000'), { lengths: [1, 1234], errors: [] });
  assert.equal(parseJobLengths('500x0,001').lengths.length, MAX_DRUMS);
});

test('invalid lengths and excessive counts never yield a partial production plan', () => {
  for (const text of ['', ' ', null, 15000, '0', '-15', '3×0', '0×15', '1.5×15', '15,,0', '3×15 +', '3×15;;11', '15,0001', '0,0005', 'abc', 'Infinity', '501x15', '500x15+11', '999999999999999999999×15', '9007199254741']) {
    const result = parseJobLengths(text);
    assert.deepEqual(result.lengths, [], String(text));
    assert.ok(result.errors.length, String(text));
  }
});

test('the boss example creates seven drums for each selected color with deterministic ids', () => {
  const result = expandJobs([job()]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.drums.length, 21);
  assert.deepEqual(result.drums[0], { id: 'job-1:yellow-green:0', jobId: 'job-1', cableId: 'vvgng-p', section: 2.5, color: 'yellow-green', length: '15000', name: '', breakdowns: '' });
  for (const color of job().colors) assert.deepEqual(result.drums.filter(drum => drum.color === color).map(drum => drum.length), ['15000', '15000', '15000', '15000', '15000', '15000', '11000']);
  assert.deepEqual(expandJobs([job()]), result);
});

test('normal scheduling matches the operator order and exposes readiness before completion', () => {
  const tasks = [job()];
  const { drums, errors } = scheduleJobs(tasks);
  assert.deepEqual(errors, []);
  assert.deepEqual(group(drums), [
    { color: 'yellow-green', length: '15000', count: 6 },
    { color: 'blue', length: '15000', count: 3 },
    { color: 'brown', length: '15000', count: 6 },
    { color: 'brown', length: '11000', count: 1 },
    { color: 'blue', length: '15000', count: 3 },
    { color: 'blue', length: '11000', count: 1 },
    { color: 'yellow-green', length: '11000', count: 1 }
  ]);
  const summary = planSummary(drums, tasks);
  assert.equal(summary.drumCount, 21);
  assert.equal(summary.totalMetres, 303000);
  assert.equal(summary.headChanges, 2);
  assert.equal(summary.colorChanges, 4);
  assert.equal(summary.cableChanges, 0);
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.warnings, []);
  assert.equal(summary.ready[0].totalMetres, 101000);
  assert.equal(summary.ready[0].readyMetres, 101000);
  assert.equal(summary.ready[0].firstReadyAt, 10);
  assert.equal(summary.ready[0].fullyReadyAt, 21);
  assert.equal(summary.ready[0].complete, true);
  assert.ok(summary.ready[0].milestones.some(milestone => milestone.afterDrum < drums.length && milestone.readyMetres > 0));
  assert.deepEqual(summary.ready[0].milestones[0], { afterDrum: 10, drumId: 'job-1:brown:0', readyMetres: 15000, producedMetres: 150000 });
});

test('urgent scheduling supplies the first twisting length earlier while keeping all work', () => {
  const normal = job(), urgent = job({ urgent: true });
  const normalDrums = scheduleJobs([normal]).drums;
  const urgentDrums = scheduleJobs([urgent]).drums;
  assert.deepEqual(urgentDrums.slice(0, 9).map(drum => drum.color), [...Array(3).fill('yellow-green'), ...Array(3).fill('blue'), ...Array(3).fill('brown')]);
  assert.deepEqual(urgentDrums.map(drum => drum.id).sort(), normalDrums.map(drum => drum.id).sort());
  const normalReady = planSummary(normalDrums, [normal]).ready[0];
  const urgentReady = planSummary(urgentDrums, [urgent]).ready[0];
  assert.equal(urgentReady.firstReadyAt, 7);
  assert.ok(urgentReady.firstReadyAt < normalReady.firstReadyAt);
  assert.equal(urgentReady.readyMetres, 101000);
  assert.equal(urgentDrums.at(-1).color, 'yellow-green');
  const singleBatch = job({ lengthsText: '15 + 11', urgent: true });
  const singleDrums = scheduleJobs([singleBatch]).drums;
  assert.equal(singleDrums[0].color, 'yellow-green');
  assert.equal(planSummary(singleDrums, [singleBatch]).ready[0].complete, true);
});

test('multiple cable tasks retain a striped head boundary and count section changes', () => {
  const tasks = [job(), job({ id: 'job-2', section: 1.5, cores: 2, colors: ['yellow-green', 'blue'], lengthsText: '3×15,0 + 11,0' })];
  const { drums, errors } = scheduleJobs(tasks);
  assert.deepEqual(errors, []);
  assert.equal(drums[20].color, 'yellow-green');
  assert.equal(drums[21].color, 'yellow-green');
  const summary = planSummary(drums, tasks);
  assert.equal(summary.drumCount, 29);
  assert.equal(summary.totalMetres, 415000);
  assert.equal(summary.headChanges, 4);
  assert.equal(summary.cableChanges, 1);
  assert.deepEqual(summary.ready.map(progress => progress.readyMetres), [101000, 56000]);
});

test('solid-only following tasks start with the previous ending color where available', () => {
  const tasks = [job({ cores: 2, colors: ['blue', 'brown'], lengthsText: '6×15' }), job({ id: 'job-2', cores: 2, colors: ['brown', 'blue'], lengthsText: '4×10' })];
  const { drums } = scheduleJobs(tasks);
  assert.equal(drums[11].color, 'blue');
  assert.equal(drums[12].color, 'blue');
  assert.equal(planSummary(drums, tasks).colorChanges, 4);
});

test('arbitrary colors and one- or two-core cables lose no drums', () => {
  const variations = [
    { colors: ['yellow-green'], lengthsText: '11' },
    { colors: ['yellow-green', 'red'], lengthsText: '15' },
    { colors: ['black', 'white'], lengthsText: '4×15 + 11' },
    { colors: ['yellow-green', 'red', 'black', 'white'], lengthsText: '4×15 + 11' },
    { colors: ['red'], lengthsText: '4×15 + 11' }
  ];
  for (const settings of variations) for (const urgent of [true, false]) {
    const task = job({ ...settings, cores: settings.colors.length, urgent });
    const expanded = expandJobs([task]);
    const scheduled = scheduleJobs([task]);
    assert.deepEqual(scheduled.errors, []);
    assert.deepEqual(scheduled.drums.map(drum => drum.id).sort(), expanded.drums.map(drum => drum.id).sort());
    assert.equal(planSummary(scheduled.drums, [task]).ready[0].complete, true);
  }
  const equalLengths = scheduleJobs([job({ lengthsText: '2×15' })]).drums;
  assert.deepEqual(equalLengths.slice(0, 2).map(drum => drum.color), ['yellow-green', 'yellow-green']);
  assert.equal(equalLengths.at(-1).color, 'brown');
});

test('job validation rejects ambiguous colors, quantities, cable settings and total cap', () => {
  const cases = [
    [], null, [null], [job({ id: '' })], [job(), job()],
    [job({ cableId: ' ' })], [job({ section: 0 })], [job({ section: Infinity })],
    [job({ cores: 2 })], [job({ cores: 1.5 })],
    [job({ colors: [] })], [job({ colors: ['blue', 'blue', 'brown'] })],
    [job({ colors: ['blue', 'brown', 'unknown'] })],
    [job({ batchSize: 0 })], [job({ batchSize: 1.5 })], [job({ batchSize: 501 })],
    [job({ lengthsText: '167×15' })],
    [job({ id: 'first', cores: 1, colors: ['blue'], lengthsText: '300×15' }), job({ id: 'second', cores: 1, colors: ['red'], lengthsText: '201×15' })]
  ];
  for (const tasks of cases) {
    for (const operation of [expandJobs, scheduleJobs]) {
      const result = operation(tasks);
      assert.deepEqual(result.drums, []);
      assert.ok(result.errors.length, JSON.stringify(tasks));
    }
  }
  const maximum = scheduleJobs([job({ cores: 2, colors: ['blue', 'brown'], lengthsText: '250×0,001' })]);
  assert.equal(maximum.drums.length, MAX_DRUMS);
  assert.deepEqual(maximum.errors, []);
  assert.deepEqual(scheduleJobs([job({ batchSize: undefined, section: '2,5', cores: '3' })]).errors, []);
});

test('regeneration retains operator metadata by stable id and applies new generated fields', () => {
  const tasks = [job()];
  const original = scheduleJobs(tasks).drums;
  const annotated = original.map(drum => Object.freeze({ ...drum, name: `Б-${drum.id}`, breakdowns: '3682; 9240', operatorNote: 'перевірено' }));
  const generated = scheduleJobs([job({ lengthsText: '6×14 + 11' })], Object.freeze(annotated));
  assert.equal(generated.drums[0].length, '14000');
  for (const drum of generated.drums) {
    assert.equal(drum.name, `Б-${drum.id}`);
    assert.equal(drum.breakdowns, '3682; 9240');
    assert.equal(drum.operatorNote, 'перевірено');
  }
  assert.equal(annotated[0].length, '15000');
});

test('reordering is immutable, clamps final positions and handles invalid targets', () => {
  const drums = Object.freeze(scheduleJobs([job()]).drums.map(Object.freeze));
  const id = drums[0].id;
  const moved = moveDrum(drums, id, 8);
  assert.equal(moved[8], drums[0]);
  assert.equal(drums[0].id, id);
  assert.equal(moveDrum(drums, id, 999).at(-1), drums[0]);
  assert.equal(moveDrum(drums, drums.at(-1).id, -5)[0], drums.at(-1));
  for (const target of [NaN, 1.5, '8']) assert.deepEqual(moveDrum(drums, id, target), drums);
  assert.deepEqual(moveDrum(drums, 'missing', 2), drums);
  assert.notEqual(moveDrum(drums, id, 0), drums);
  assert.deepEqual(moveDrum(null, id, 0), []);
});

test('restore order preserves current edits, deleted drums, extra drums and object identity', () => {
  const tasks = [job()];
  const original = scheduleJobs(tasks).drums;
  const deletedId = original[0].id;
  const actual = original.filter(drum => drum.id !== deletedId).map(drum => drum.id === 'job-1:blue:0' ? { ...drum, color: 'red', length: '14000', name: 'new' } : drum).reverse();
  const extra = { id: 'manual', color: 'black', length: '12000', name: 'manual' };
  const malformed = { id: 'malformed', jobId: 'job-1', length: '12000' };
  actual.push(extra, malformed);
  const restored = recommendOrder(Object.freeze(actual), tasks);
  assert.equal(restored.length, actual.length);
  assert.equal(restored.at(-1), extra);
  assert.ok(restored.includes(malformed));
  assert.ok(restored.includes(actual.find(drum => drum.id === 'job-1:blue:0')));
  assert.ok(restored.every(drum => actual.includes(drum)));
  assert.ok(restored.every(drum => drum.id !== deletedId));
  assert.deepEqual(recommendOrder(moveDrum(original, original[0].id, 16), tasks).map(drum => drum.id), original.map(drum => drum.id));
});

test('readiness reports overlapping metres rather than claiming whole matched drum sets', () => {
  const task = job({ cores: 2, colors: ['blue', 'brown'], lengthsText: '15 + 11' });
  const drums = expandJobs([task]).drums;
  const reordered = [drums[1], drums[2], drums[0], drums[3]];
  const summary = planSummary(reordered, [task]);
  assert.equal(summary.ready[0].firstReadyAt, 2);
  assert.equal(summary.ready[0].milestones[0].readyMetres, 11000);
  assert.equal(summary.ready[0].fullyReadyAt, 4);
});

test('manual edits and missing required colors warn and cannot claim full twisting readiness', () => {
  const tasks = [job()];
  const original = scheduleJobs(tasks).drums;
  const edited = original.map(drum => drum.id === 'job-1:yellow-green:0' ? { ...drum, cableId: 'pv3' } : drum);
  const summary = planSummary(edited, tasks);
  assert.equal(summary.ready[0].readyMetres, 86000);
  assert.equal(summary.ready[0].complete, false);
  assert.equal(summary.ready[0].fullyReadyAt, null);
  assert.ok(summary.warnings.some(warning => warning.includes('переріз')));
  assert.ok(summary.warnings.some(warning => warning.includes('86000')));
  const removedColor = planSummary(original.filter(drum => drum.color !== 'brown'), tasks);
  assert.equal(removedColor.ready[0].firstReadyAt, null);
  assert.equal(removedColor.ready[0].readyMetres, 0);
  assert.ok(removedColor.warnings.some(warning => warning.includes('Коричневий')));
  const invalid = planSummary([...original, { id: original[0].id, color: 'unknown', length: '-1' }], tasks);
  assert.ok(invalid.errors.length >= 3);
  assert.ok(invalid.warnings.some(warning => warning.includes('не прив’язані')));
  assert.deepEqual(planSummary(null).ready, []);
  assert.ok(planSummary(null).errors.length);
});

test('summary works without job definitions, counts actual transitions and remains pure', () => {
  const original = Object.freeze(scheduleJobs([job()]).drums.map(Object.freeze));
  const summary = planSummary(original);
  assert.equal(summary.ready[0].readyMetres, 101000);
  assert.equal(summary.totalMetres, 303000);
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.warnings, []);
  const moved = moveDrum(original, original.at(-1).id, 9);
  assert.equal(planSummary(moved).headChanges, 3);
  assert.equal(planSummary(original).headChanges, 2);
  assert.deepEqual(recommendOrder(original).map(drum => drum.id), original.map(drum => drum.id));
});

test('explicit status updates are immutable, exclusive when starting, and never toggle implicitly', () => {
  const drums = Object.freeze([
    Object.freeze({ id: 'first', status: 'active', name: 'Б-1', length: '15000' }),
    Object.freeze({ id: 'second', name: 'Б-2', length: '11000' }),
    Object.freeze({ id: 'third', status: 'done', length: '15000' })
  ]);
  const started = setDrumStatus(drums, 'second', 'active');
  assert.deepEqual(started.map(drumStatus), ['queued', 'active', 'done']);
  assert.equal(drums[0].status, 'active');
  assert.equal(drums[1].status, undefined);
  assert.equal(started[0].name, 'Б-1');
  assert.equal(started[1].length, '11000');
  assert.equal(started[2], drums[2]);
  assert.notEqual(started, drums);

  const startedAgain = setDrumStatus(started, 'second', 'active');
  assert.deepEqual(startedAgain.map(drumStatus), ['queued', 'active', 'done']);
  assert.equal(startedAgain[1], started[1]);
  const done = setDrumStatus(startedAgain, 'second', 'done');
  assert.deepEqual(done.map(drumStatus), ['queued', 'done', 'done']);
  assert.equal(done[0], startedAgain[0], 'completing work must not automatically start a different drum');
  assert.deepEqual(setDrumStatus(done, 'second', 'queued').map(drumStatus), ['queued', 'queued', 'done']);

  for (const [id, status] of [['missing', 'active'], ['second', 'unknown'], ['second', null], [undefined, 'done']]) {
    const unchanged = setDrumStatus(drums, id, status);
    assert.deepEqual(unchanged, drums);
    assert.notEqual(unchanged, drums);
  }
  assert.deepEqual(setDrumStatus(null, 'first', 'active'), []);
  for (const value of [null, undefined, {}, { status: 'unknown' }, { status: true }]) assert.equal(drumStatus(value), 'queued');
  assert.equal(drumStatus({ status: 'active' }), 'active');
  assert.equal(drumStatus({ status: 'done' }), 'done');
});

test('regeneration retains normalized status and operator annotations by stable drum id', () => {
  const original = scheduleJobs([job({ lengthsText: '15 + 11' })]).drums;
  const saved = Object.freeze(original.map((drum, index) => Object.freeze({
    ...drum, status: index === 0 ? 'done' : index === 1 ? 'active' : index === 2 ? 'unsupported' : 'queued',
    name: `Б-${index}`, breakdowns: `${index + 10}`, note: 'для зміни'
  })));
  const generated = scheduleJobs([job({ lengthsText: '15 + 12 + 11' })], saved).drums;
  const byId = new Map(generated.map(drum => [drum.id, drum]));
  for (const drum of saved) {
    const restored = byId.get(drum.id);
    assert.equal(restored.status, drumStatus(drum));
    assert.equal(restored.name, drum.name);
    assert.equal(restored.breakdowns, drum.breakdowns);
    assert.equal(restored.note, drum.note);
  }
  assert.equal(saved[2].status, 'unsupported', 'normalization must not rewrite the saved input');
  for (const drum of generated.filter(drum => !saved.some(source => source.id === drum.id))) assert.equal(drum.status, 'queued');
  assert.equal(byId.get('job-1:blue:1').length, '12000', 'new job lengths still take effect');
});

test('regeneration resets started work when the same stable id now describes a different physical drum', () => {
  const task = job({ lengthsText: '1' });
  const original = scheduleJobs([task]).drums.map((drum, index) => ({ ...drum, status: index === 0 ? 'active' : 'done', name: `Б-${index}`, breakdowns: '10; 20' }));
  const unchanged = scheduleJobs([task], original);
  for (const drum of unchanged.drums) assert.equal(drum.status, original.find(source => source.id === drum.id).status);
  assert.deepEqual(unchanged.warnings, []);

  for (const change of [{ lengthsText: '2' }, { cableId: 'pv3' }, { section: 1.5 }]) {
    const changed = scheduleJobs([job({ ...task, ...change })], original);
    assert.ok(changed.drums.every(drum => drum.status === 'queued'));
    assert.equal(productionSummary(changed.drums, [job({ ...task, ...change })]).ready[0].readyMetres, 0);
    assert.ok(changed.warnings.length);
    for (const drum of changed.drums) {
      const source = original.find(item => item.id === drum.id);
      assert.equal(drum.name, source.name);
      assert.equal(drum.breakdowns, source.breakdowns);
    }
  }
  const editedColor = original.map(drum => drum.color === 'blue' ? { ...drum, color: 'red' } : drum);
  const colorRegenerated = scheduleJobs([task], editedColor);
  assert.equal(colorRegenerated.drums.find(drum => drum.id === 'job-1:blue:0').status, 'queued');
  assert.equal(original[0].status, 'active', 'regeneration cannot rewrite production history in the saved input');
});

test('recommended order rearranges waiting slots while retaining started work at its position', () => {
  const task = job({ lengthsText: '15 + 11' });
  const reversed = scheduleJobs([task]).drums.reverse().map((drum, index) => ({ ...drum, status: index === 1 ? 'done' : index === 4 ? 'active' : 'queued' }));
  const fixed = Object.freeze(reversed.map(Object.freeze));
  const waiting = recommendOrder(fixed.filter(drum => drumStatus(drum) === 'queued'), [task]);
  for (const definitions of [[task], []]) {
    const restored = recommendOrder(fixed, definitions);
    assert.equal(restored[1], fixed[1]);
    assert.equal(restored[4], fixed[4]);
    assert.deepEqual(restored.filter(drum => drumStatus(drum) === 'queued').map(drum => drum.id), waiting.map(drum => drum.id));
    assert.equal(restored.length, fixed.length);
    assert.ok(restored.every(drum => fixed.includes(drum)));
  }
  assert.equal(fixed[1].status, 'done');
  assert.equal(fixed[4].status, 'active');
});

test('actual production readiness excludes queued and active drums until every required color is completed', () => {
  const task = job({ cores: 2, colors: ['blue', 'brown'], lengthsText: '2×1' });
  const original = scheduleJobs([task]).drums;
  const untouched = productionSummary(original, [task]);
  assert.equal(untouched.queuedCount, 4);
  assert.equal(untouched.activeCount, 0);
  assert.equal(untouched.doneCount, 0);
  assert.equal(untouched.doneMetres, 0);
  assert.equal(untouched.ready[0].readyMetres, 0);
  assert.equal(untouched.ready[0].complete, false);

  const oneColorDone = original.map(drum => ({ ...drum, status: drum.color === 'blue' ? 'done' : 'active' }));
  const blocked = productionSummary(oneColorDone, [task]);
  assert.equal(blocked.queuedCount, 0);
  assert.equal(blocked.activeCount, 2);
  assert.equal(blocked.doneCount, 2);
  assert.equal(blocked.doneMetres, 2000);
  assert.equal(blocked.ready[0].readyMetres, 0);
  const firstPair = oneColorDone.map(drum => drum.id === 'job-1:brown:0' ? { ...drum, status: 'done' } : drum);
  assert.equal(productionSummary(firstPair, [task]).ready[0].readyMetres, 1000);
  assert.equal(productionSummary(firstPair, [task]).ready[0].complete, false);
  const finished = productionSummary(original.map(drum => ({ ...drum, status: 'done' })), [task]);
  assert.equal(finished.doneCount, 4);
  assert.equal(finished.doneMetres, 4000);
  assert.equal(finished.ready[0].readyMetres, 2000);
  assert.equal(finished.ready[0].complete, true);
});

test('completed drums with another cable or section cannot supply twisting readiness', () => {
  const task = job({ cores: 2, colors: ['blue', 'brown'], lengthsText: '1' });
  const drums = scheduleJobs([task]).drums.map(drum => ({ ...drum, status: 'done' }));
  for (const mismatch of [{ cableId: 'pv3' }, { section: 1.5 }]) {
    const edited = drums.map(drum => drum.color === 'brown' ? { ...drum, ...mismatch } : drum);
    const summary = productionSummary(edited, [task]);
    assert.equal(summary.doneCount, 2);
    assert.equal(summary.doneMetres, 2000);
    assert.equal(summary.ready[0].readyMetres, 0);
    assert.equal(summary.ready[0].complete, false);
    assert.ok(summary.warnings.some(warning => warning.includes('переріз')));
  }
});

test('legacy queues infer required twisting colors from the full queue rather than completed colors alone', () => {
  const task = job({ cores: 2, colors: ['blue', 'brown'], lengthsText: '2×1' });
  const original = scheduleJobs([task]).drums;
  const oneColor = original.map(drum => ({ ...drum, status: drum.color === 'blue' ? 'done' : 'queued' }));
  const summary = productionSummary(oneColor);
  assert.deepEqual(summary.ready[0].colors, ['blue', 'brown']);
  assert.equal(summary.ready[0].totalMetres, 2000);
  assert.equal(summary.ready[0].readyMetres, 0);
  assert.equal(summary.ready[0].complete, false);
  const onePair = oneColor.map(drum => drum.id === 'job-1:brown:0' ? { ...drum, status: 'done' } : drum);
  assert.equal(productionSummary(onePair).ready[0].readyMetres, 1000);
  assert.equal(productionSummary(original.map(drum => ({ ...drum, status: 'done' }))).ready[0].complete, true);
  const mismatched = original.map(drum => ({ ...drum, status: 'done', ...(drum.color === 'brown' ? { cableId: 'pv3' } : {}) }));
  assert.equal(productionSummary(mismatched).ready[0].readyMetres, 0);
});
