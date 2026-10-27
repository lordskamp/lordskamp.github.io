import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendOrder, scheduleJobs, planSummary } from '../Zavod/planner.js';
import { dyeRequirements, normalizeDyeSlots, planDyeSlots } from '../Zavod/dye-slots.js';

const id = 'h07v-k--h05v-k';
const drum = (color, mode = 'single') => ({ id:color, cableId:id, section:.5, color, mode, status:'queued', length:'15000' });

test('striped and black two-extruder drums are adjacent before single-extruder colors', () => {
  const rows = ['blue','brown','black','yellow-green'].map(color => drum(color));
  assert.deepEqual(recommendOrder(rows).map(row => row.color), ['yellow-green','black','blue','brown']);
  const job = { id:'j', cableId:id, section:.5, colors:['blue','brown','black','yellow-green'], lengthsText:'15', mode:'single' };
  assert.deepEqual(scheduleJobs([job]).drums.map(row=>row.color), ['yellow-green','black','blue','brown']);
});

test('loaded dyes affect the first splitter and color; completed and active rows remain fixed', () => {
  const rows = ['blue','brown','black','yellow-green'].map(color => drum(color, 'dual'));
  const ordered = recommendOrder(rows, { slots:['white','red','black','red'] });
  assert.equal(ordered.at(-1).color,'yellow-green');
  assert.equal(ordered.at(-2).color,'black');
  const plain = recommendOrder(rows.filter(row => row.color !== 'yellow-green'), { slots:['white','red','black','red'] });
  assert.equal(plain[0].color,'black');
  rows[0].status='active'; rows[1].status='done';
  const fixed = recommendOrder(rows, { slots:['white','red','black','blue'] });
  assert.deepEqual(fixed.slice(0,2).map(row=>row.id), ['blue','brown']);
});

test('slot planning distinguishes loaded, empty and unknown and never invents the active slot', () => {
  assert.deepEqual(normalizeDyeSlots(['white','fake','empty']), ['white','','empty','']);
  assert.deepEqual(dyeRequirements(drum('yellow-green')), ['yellow','green']);
  assert.deepEqual(dyeRequirements(drum('blue','dual')), ['white','blue']);
  const plan = planDyeSlots([drum('blue','dual')], ['white','red','empty','black'])[0];
  assert.deepEqual(plan.steps.map(step => [step.extruder,step.slot,step.kind]), [[1,1,'available'],[2,1,'load']]);
  const unknown = planDyeSlots([drum('blue','dual')], ['','','black',''])[0];
  assert.deepEqual(unknown.steps.map(step=>step.kind), ['unknown','unknown']);
  assert(unknown.steps.every(step => step.slot === undefined));
});

test('loaded dyes do not put single-extruder colors between black and striped', () => {
  const rows = ['blue','brown','black','yellow-green'].map(color => drum(color));
  const ordered = recommendOrder(rows, { slots:['white','red','black','blue'] });
  const colors = ordered.map(row => row.color);
  assert.equal(Math.abs(colors.indexOf('black') - colors.indexOf('yellow-green')), 1);
});


test('task generation keeps black by striped even when ordinary colors use two extruders', () => {
  const job = { id:'dual', cableId:id, section:.5, colors:['blue','brown','yellow-green','black'], lengthsText:'2×15', mode:'dual' };
  const result = scheduleJobs([job]);
  assert.deepEqual(result.errors, []);
  const colors = result.drums.map(row => row.color);
  assert.deepEqual(colors, ['yellow-green','yellow-green','black','black','blue','blue','brown','brown']);
  const saved = result.drums.map(row => ({ ...row, mode: 'dual' })).reverse();
  const refreshed = scheduleJobs([job], saved, { slots:['white','red','black','blue'] });
  const reordered = refreshed.drums.map(row=>row.color);
  const striped = reordered.map((color,i) => color === 'yellow-green' ? i : -1).filter(i=>i >= 0);
  const black = reordered.map((color,i) => color === 'black' ? i : -1).filter(i=>i >= 0);
  assert(striped.at(-1) + 1 === black[0] || black.at(-1) + 1 === striped[0]);
});

test('single-extruder drums keep either splitter and do not cause extra changes', () => {
  const striped = { ...drum('yellow-green','dual'), id:'striped' };
  const single = { ...drum('blue','single'), id:'single' };
  const black = { ...drum('black','dual'), id:'black' };
  const stripedAgain = { ...striped, id:'striped-again' };
  assert.equal(planSummary([striped, single, black]).headChanges, 1);
  assert.equal(planSummary([striped, single, stripedAgain]).headChanges, 0);
  const ordinary = { ...drum('brown','dual'), id:'plain' };
  assert.equal(planSummary([ordinary, single, black]).headChanges, 0);
  const ordered = recommendOrder([single, black, striped]);
  assert.equal(planSummary(ordered).headChanges, 1);
  assert.equal(Math.abs(ordered.findIndex(d=>d.id==='striped') - ordered.findIndex(d=>d.id==='black')), 1);
});
