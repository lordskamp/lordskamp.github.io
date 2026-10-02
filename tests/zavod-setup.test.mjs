import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { RECIPES } from '../Zavod/data.js';
import { CATALOG_OPTIONS, baseFor, practicalFor, measurementColor, recipeIdFor } from '../Zavod/catalog-base.js';
import { setupFor, tableSetups, metricValues, VALUE_LABELS } from '../Zavod/setup-data.js';
import { modeFor, supportsSingleColorMode } from '../Zavod/pv3-modes.js';

const catalog = () => ({ recipes: RECIPES.map(record => ({ ...record, baseId: record.id, origin: 'handwritten', color: 'all', revision: 1, updatedAt: '2026-09-29T00:00:00Z' })) });
const option = (cardId, brand) => CATALOG_OPTIONS.find(candidate => candidate.cardId === cardId && candidate.brand === brand);
const setup = (cardId, brand, section, records = catalog()) => setupFor(option(cardId, brand).id, section, records,
  /^(?:pv[135]|h07v-[urk])$/.test(cardId) ? 'brown' : 'blue');

test('public admin measurements are practical without a matching published recipe and update independently by field', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/zavod-h07-calibrations.json', import.meta.url), 'utf8'));
  const records = catalog();
  records.calibrations = fixture.measurements.map(row => ({ ...row, id: `admin-${row.section}`, baseId: baseFor(fixture.optionId,row.section).id,
    optionId:fixture.optionId, mode:fixture.mode, origin:'measurement', color:'all' }));
  for (const color of ['blue','yellow-green']) {
    const result = setupFor(fixture.optionId,6,records,color);
    assert.equal(result.mode,'dual');
    assert.deepEqual([result.effective.extruder1,result.effective.extruder2,result.effective.workingSpeed],[59,95,120]);
    for (const key of ['extruder1','extruder2','workingSpeed','dorn','matrix','sikoraWire','sikoraOuter']) assert.equal(result.sources[key],'practical');
  }
  records.calibrations.push({...records.calibrations[2],id:'new-partial',extruder1:61,extruder2:null,maxSpeed:null,dorn:null,matrix:null,sikoraWire:null,sikoraOuter:null,updatedAt:'2026-10-02T13:00:00Z'});
  const result = setupFor(fixture.optionId,6,records);
  assert.deepEqual([result.practical.extruder1,result.practical.extruder2,result.practical.workingSpeed],[61,95,120]);
});

test('unknown-mode admin geometry is practical while unconfirmed RPM cannot cross extruder modes', () => {
  const id = 'h07v-k--h07v-k', records = catalog(), base = baseFor(id,6);
  records.calibrations = [{id:'unknown-geometry',baseId:base.id,optionId:id,section:6,mode:'unknown',origin:'measurement',sikoraWire:3.07,matrix:4.7,extruder1:999,maxSpeed:999,updatedAt:'2026-10-02T12:00:00Z'}];
  const result = setupFor(id,6,records,'black');
  assert.equal(result.practical.sikoraWire,3.07);
  assert.equal(result.practical.matrix,4.7);
  assert.equal(result.practical.extruder1,null);
  assert.equal(result.practical.workingSpeed,null);
  records.calibrations[0].withdrawnAt = '2026-10-02T13:00:00Z';
  assert.equal(setupFor(id,6,records,'black').practical.sikoraWire,null);
});

test('reference specifications do not borrow practical values from similarly named cards', () => {
  const h05 = setup('h05-en', 'H05VV-F', .75);
  assert.equal(h05.practical.extruder1, null);
  assert.equal(h05.practical.extruder2, null);
  assert(h05.forecast.extruder1 > 0);
  assert(h05.forecast.borrowedFrom.length > 0);
  assert.equal(h05.effective.extruder1, 92);
  assert.equal(h05.sources.extruder1, 'reference');
  assert.equal(h05.stages.working, 500);
  assert.equal(h05.stages.second, 300);
  const ysly = setup('ysly-1000', 'YSLY-JZ', 2.5);
  assert.equal(ysly.practical.extruder1, null);
  assert.equal(ysly.effective.extruder1, 87);
  assert.equal(ysly.effective.extruder2, 100);
  assert.equal(ysly.sources.workingSpeed, 'reference');
});

test('SIKORA uses the selected matrix while nominal outside diameters stay comparison values', () => {
  const result = setup('pvs-380', 'ПВСнг', 2.5);
  assert.equal(result.practical.sikoraOuter, null);
  assert.equal(result.effective.matrix, 3.4);
  assert(result.row.outerNom < result.effective.matrix, 'the printed nominal was the old incorrect primary value');
  assert.equal(result.sources.sikoraOuter, 'forecast');
  assert(result.effective.sikoraOuter > result.effective.matrix);
  const values = metricValues(result, 'sikoraOuter');
  assert.equal(values[0].value, result.effective.sikoraOuter);
  const nominal = values.find(value => value.source === 'reference');
  assert.equal(nominal.value, 3.37);
  assert.match(nominal.label, /номінальний діаметр/);
  const records = catalog(), id = result.option.id, base = baseFor(id, 2.5);
  records.calibrations = [{ id: 'custom-matrix', baseId: base.id, optionId: id, section: 2.5,
    origin: 'measurement', mode: result.mode, matrix: 4.1, updatedAt: '2026-10-02T16:00:00Z' }];
  const changed = setupFor(id, 2.5, records);
  assert.equal(changed.effective.matrix, 4.1);
  assert(changed.effective.sikoraOuter > 4.1);
  records.calibrations[0].sikoraOuter = 4.21;
  assert.equal(setupFor(id, 2.5, records).effective.sikoraOuter, 4.21, 'admin measurement remains authoritative');
});

test('catalogue main SIKORA values remain above numeric matrices without substituting nominal specifications', () => {
  const records = catalog();
  for (const cable of CATALOG_OPTIONS) for (const section of cable.sections) for (const color of ['blue','black']) {
    const result = setupFor(cable.id, section, records, color);
    const outer = result.effective.sikoraOuter, matrix = result.effective.matrix;
    if (typeof outer === 'number' && typeof matrix === 'number') assert(outer > matrix,
      `${cable.brand} ${section} ${color}: ${outer} <= ${matrix}`);
    if (typeof outer === 'number' && result.practical.sikoraOuter == null) assert.equal(result.sources.sikoraOuter, 'forecast');
  }
});

test('known practical settings remain primary while reference and forecast stay available', () => {
  const result = setup('pv1', 'ПВ1', 1.5);
  assert.equal(result.effective.extruder1, 75);
  assert.equal(result.sources.extruder1, 'practical');
  assert.equal(result.practical.workingSpeed, 320);
  assert.equal(result.reference.workingSpeed, 300);
  assert.equal(result.forecast.extruder1, 75);
  assert.equal(result.forecast.workingSpeed, 320);
  assert.deepEqual(metricValues(result, 'extruder1').map(item => [item.source, item.value]), [['practical',75], ['forecast',75]]);
  assert.deepEqual(metricValues(result, 'workingSpeed').map(item => [item.source, item.value]), [['practical',320], ['reference',300], ['forecast',320]]);
  const sikora = metricValues(result, 'sikoraOuter');
  assert.equal(sikora[0].source, 'practical');
  assert.equal(sikora[1].source, 'reference');
  assert.equal(sikora[1].value, result.row.outerNom);
  assert(sikora[1].label.includes('номінальний'));
  assert.equal(sikora[2].source, 'forecast');
  assert.equal(result.mode, 'single');
  assert.equal(result.forecast.sikoraOuter, result.practical.sikoraOuter);
  assert.deepEqual(result.stages, { first: 80, second: 200, working: 320, source: 'practical' });
});

test('reference values stay primary where practical values are absent and forecasts remain visible', () => {
  const result = setup('pvs-380', 'ПВС', 1);
  assert.deepEqual([result.practical.extruder1, result.practical.extruder2, result.practical.workingSpeed], [null, null, null]);
  assert.deepEqual([result.forecast.extruder1, result.forecast.extruder2, result.forecast.workingSpeed], [60.3, 95.4, 500]);
  assert.equal(result.forecast.rpmWorkingSpeed,450);
  assert.equal(result.sources.extruder1, 'reference');
  assert.equal(result.sources.workingSpeed, 'reference');
  assert.deepEqual(result.stages, { first: 80, second: 260, working: 450, source: 'reference' });
  assert.deepEqual(metricValues(result, 'extruder1').map(item => [item.source,item.value]), [['reference',117], ['forecast',60.3]]);
  assert.deepEqual(VALUE_LABELS, { practical: 'Практичні', reference: 'Довідкові', forecast: 'Прогнозовані', manual: 'Орієнтовно · за твоєю швидкістю' });
});

test('PV3 pairs supply dual RPM without becoming practical single-extruder RPM', () => {
  for (const [section, working, pair] of [[1, 300, [50,130]], [2.5, 210, [80,100]]]) {
    const result = setup('pv3', 'ПВ3', section);
    assert.equal(result.mode, 'single');
    assert.equal(result.practical.extruder1, null);
    assert.equal(result.practical.extruder2, null);
    assert.equal(result.practical.workingSpeed, working);
    assert(result.effective.extruder1 > 0);
    assert.equal(result.sources.extruder1, 'forecast');
    assert.equal(result.effective.extruder2, null);
    assert.equal(result.effective.workingSpeed, working);
    assert.equal(result.sources.workingSpeed, 'practical');
    const dual = setupFor('pv3',section,catalog(),'yellow-green');
    assert.equal(dual.mode, 'dual');
    assert.deepEqual([dual.practical.extruder1,dual.practical.extruder2], pair);
  }
});

test('PV3 0.75 uses 68 or 65/85 at working speed 350; section 6 uses its two recorded speeds', () => {
  for (const color of ['black','brown','white','green']) {
    const result = setupFor('pv3',.75,catalog(),color);
    assert.equal(result.mode, 'single');
    assert.deepEqual([result.effective.extruder1,result.effective.extruder2,result.effective.workingSpeed], [68,null,350]);
    assert.equal(result.sources.extruder1,'practical');
    assert.equal(result.sources.workingSpeed,'practical');
  }
  const striped = setupFor('pv3',.75,catalog(),'yellow-green');
  assert.equal(striped.mode, 'dual');
  assert.deepEqual([striped.effective.extruder1,striped.effective.extruder2,striped.effective.workingSpeed], [65,85,350]);
  assert.deepEqual([setupFor('pv3',6,catalog(),'brown').effective.workingSpeed,setupFor('pv3',6,catalog(),'blue').effective.workingSpeed], [120,130]);
  for (const [color, pair] of [['brown',[74,null]],['blue',[64,80]]]) {
    const result = setupFor('pv3',4,catalog(),color);
    assert.deepEqual([result.effective.extruder1,result.effective.extruder2], pair);
    assert.equal(result.effective.workingSpeed,150);
  }
});

test('coexisting PV3 measurements and forecast anchors do not overwrite the other mode', () => {
  const records = catalog(), base = baseFor('pv3',.75);
  records.recipes.push({...base,baseId:base.id,origin:'measurement',color:'all',mode:'single',extruder1:82,extruder2:null,maxSpeed:340,revision:2,updatedAt:'2026-09-30T14:00:00Z'});
  records.recipes.push({...base,id:base.id+'~yellow-green',baseId:base.id,origin:'measurement',color:'yellow-green',mode:'dual',extruder1:70,extruder2:90,maxSpeed:300,revision:1,updatedAt:'2026-09-30T15:00:00Z'});
  const single = setupFor('pv3',.75,records,'brown'), dual = setupFor('pv3',.75,records,'yellow-green');
  assert.deepEqual([single.effective.extruder1,single.effective.extruder2,single.effective.workingSpeed],[82,null,340]);
  assert.deepEqual([dual.effective.extruder1,dual.effective.extruder2,dual.effective.workingSpeed],[70,90,300]);
  assert.equal(single.forecast.anchors.find(anchor=>anchor.section===.75).extruder1,82);
  assert.equal(dual.forecast.anchors.find(anchor=>anchor.section===.75).extruder1,70);
  assert.equal(measurementColor('pv3','dual'),'all');
  assert.equal(measurementColor('pv3','dual','all'),'all');
  assert.equal(measurementColor('pv3','dual','black'),'all');
  assert.equal(measurementColor('pv1','unknown','black'),'all');
  assert.equal(measurementColor('pv3','single'),'all');
  assert.equal(measurementColor('vvg','dual'),'all');
});

test('equal values are confirmed only by a real practical value of the same metric', () => {
  const result = setup('pv3','ПВ3',1.5);
  assert(metricValues(result,'workingSpeed').filter(item=>item.source!=='practical').every(item=>item.confirmed));
  assert.equal(metricValues(result,'matrix').find(item=>item.source==='reference').confirmed,true);
  assert.equal(metricValues(result,'sikoraWire').find(item=>item.source==='reference').confirmed,true);
  assert.equal(metricValues(result,'sikoraOuter').find(item=>item.source==='reference').confirmed,false);
  assert.equal(metricValues(result,'extruder1').find(item=>item.source==='reference'),undefined);
  const unmeasured = setup('pvs-380','ПВС',1);
  assert(metricValues(unmeasured,'extruder1').every(item=>!item.confirmed));
});

test('partial speed measurement does not manufacture RPM scaling from printed conditions', () => {
  const records = catalog();
  const base = baseFor(option('pvs-380', 'ПВС').id, 1);
  records.recipes = records.recipes.filter(record => record.id !== base.id);
  records.recipes.push({ ...base, baseId: base.id, origin: 'measurement', color: 'all', mode: 'dual', maxSpeed: 200, revision: 2, updatedAt: '2026-09-30T12:00:00Z' });
  const result = setup('pvs-380', 'ПВС', 1, records);
  assert.equal(result.practical.workingSpeed, 200);
  assert.equal(result.forecast.workingSpeed, 200);
  assert.deepEqual([result.forecast.extruder1, result.forecast.extruder2], [67, 106]);
  assert.deepEqual([result.effective.extruder1, result.effective.extruder2], [117, 233]);
  assert.deepEqual(metricValues(result, 'extruder1').map(item => [item.value,item.label]), [[117,'Довідкові'], [67,'Прогнозовані']]);
  assert.deepEqual(result.stages, { first: 40, second: 120, working: 200, source: 'practical' });
});

test('new measurements calibrate their option while leaving siblings untouched', () => {
  const records = catalog();
  const own = option('pv1', 'ПВ1нг');
  for (const [section, speed] of [[1.5, 300], [6, 120]]) {
    const base = baseFor(own.id, section);
    records.recipes.push({ ...base, baseId: base.id, origin: 'measurement', color: 'all', mode: 'single', extruder1: 100, maxSpeed: speed, revision: 2, updatedAt: '2026-09-30T12:00:00Z' });
  }
  const ownResult = setup('pv1', 'ПВ1нг', 4, records);
  assert.equal(ownResult.forecast.workingSpeed, 200);
  assert.equal(ownResult.forecast.fieldAnchors.extruder1.find(anchor => anchor.section === 1.5).value, 100);
  const basic = setup('pv1', 'ПВ1', 4, records);
  const sibling = setup('pv1', 'ПВ1нгд', 4, records);
  assert(basic.forecast.workingSpeed > 0);
  assert(sibling.forecast.workingSpeed > 0);
  assert.equal(sibling.practical.extruder1, null);
});

test('applied values are independent of dye colour and latest measurements win', () => {
  const records = catalog();
  const selected = option('pv1', 'ПВ1');
  const base = baseFor(selected.id, 1.5);
  records.recipes.push({ ...base, id: `${base.id}~blue`, baseId: base.id, color: 'blue', origin: 'measurement', extruder1: 85, revision: 2, updatedAt: '2026-09-30T12:00:00Z' });
  assert.equal(practicalFor(selected.id, 1.5, records, 'single').extruder1, 85);
  assert.equal(setupFor(selected.id, 1.5, records, 'brown').effective.extruder1, 85);
});

test('the H05-specific DRAW_6 does not become practical or calibration data for (H)05', () => {
  const h05 = setup('ysly-shared', 'H05VV-F', 1.5);
  const common = setup('ysly-shared', '(H)05VV-F', 1.5);
  assert.equal(h05.practical.extruder1, 70);
  assert.equal(h05.practical.workingSpeed, 325);
  assert.equal(common.practical.extruder1, null);
  assert.equal(common.practical.workingSpeed, null);
  assert.equal(common.forecast.workingSpeed, 417);
  assert(!common.forecast.anchors.some(anchor => anchor.source === 'DRAW_6.JPG'));
});

test('Speaker handwritten pairs remain practical only for their named brand', () => {
  const speaker = setup('speaker', 'Speaker cable', .75);
  assert.deepEqual([speaker.practical.extruder1, speaker.practical.extruder2], [60, 40]);
  assert.equal(speaker.mode, 'dual');
  assert.equal(speaker.sources.extruder1, 'practical');
  assert.equal(speaker.sources.workingSpeed, 'reference');
  assert.equal(speaker.stages.second, 100);
  assert.equal(speaker.effective.matrix, '2,5×5,2');
  assert.equal(speaker.forecast.sikoraOuter, null);
  for (const brand of ['NYFAZ', 'LFZ-XY', 'LSZ-XY']) {
    const other = setup('speaker', brand, .75);
    assert.equal(other.practical.extruder1, null, brand);
    assert.equal(other.practical.extruder2, null, brand);
  }
});

test('explicit single mode cannot inherit Speaker dual pairs or dual-source working speed', () => {
  for (const [section,pair] of [[.75,[60,40]],[1.5,[60,35]]]) {
    const single = setupFor('speaker--speaker',section,catalog(),'blue',{mode:'single'});
    assert.equal(single.mode,'single');
    assert.deepEqual([single.practical.extruder1,single.practical.extruder2,single.reference.extruder1,single.reference.extruder2,single.reference.workingSpeed], [null,null,null,null,null]);
    assert(single.effective.extruder1 > 0);
    assert.equal(single.effective.extruder2,null);
    assert(single.effective.workingSpeed > 0);
    assert.equal(single.sources.extruder1,'forecast');
    assert.equal(single.sources.workingSpeed,'forecast');
    assert(single.effective.dorn.includes('×'));
    assert(single.effective.matrix.includes('×'));
    const dual = setupFor('speaker--speaker',section,catalog(),'blue',{mode:'dual'});
    assert.deepEqual([dual.practical.extruder1,dual.practical.extruder2],pair);
    assert(dual.effective.workingSpeed > 0);
  }
  const single = setupFor('pvs-380--pvs',.75,catalog(),'blue',{mode:'single'});
  assert.deepEqual([single.reference.extruder1,single.reference.extruder2,single.reference.workingSpeed], [null,null,null]);
});

test('table includes every reference row with one entry per extruder mode', () => {
  const records = tableSetups(catalog());
  assert.equal(new Set(records.map(record=>`${record.option.id}:${record.row.section}:${record.mode}`)).size, records.length);
  assert.equal(new Set(records.map(record=>`${record.option.id}:${record.row.section}`)).size, CATALOG_OPTIONS.reduce((count,item)=>count+item.sections.length,0));
  assert(records.every(record => record.option && record.row && (record.stages.first === null || record.stages.first <= record.stages.working)));
  assert.deepEqual(records.filter(record=>record.option.id==='pv3--pv3'&&record.row.section===.75).map(record=>[record.color,record.mode]), [['brown','single'],['blue','dual']]);
});

test('every selectable cable, section and production color has sourced values for all applicable fields', () => {
  const records = catalog();
  for (const option of CATALOG_OPTIONS) for (const section of option.sections) for (const color of ['blue','black','yellow-green']) {
    const result = setupFor(option.id,section,records,color);
    assert(['single','dual'].includes(result.mode),`${option.id} ${section}: mode`);
    for (const key of ['extruder1','extruder2','workingSpeed','sikoraWire','sikoraOuter','dorn','matrix']) {
      if (key==='extruder2'&&result.mode==='single') { assert.equal(result.effective[key],null); continue; }
      const value=result.effective[key], label=`${option.id} ${section} ${color} ${key}`;
      assert(typeof value==='number'&&Number.isFinite(value)&&value>0 || ['sikoraOuter','dorn','matrix'].includes(key)&&typeof value==='string'&&value.trim(),label);
      assert(['practical','reference','forecast'].includes(result.sources[key]),label+' source');
    }
    assert(result.stages.first > 0 && result.stages.first <= result.stages.working);
    assert(result.stages.second >= result.stages.first && result.stages.second <= result.stages.working);
  }
});

test('blue uses two extruders and shares practical/forecast values with yellow-green', () => {
  for (const id of ['pv3', 'pv1', 'h07v-u--h07v-u']) {
    const blue = setupFor(id, 1.5, catalog(), 'blue');
    assert.equal(blue.mode, 'dual');
    assert.equal(blue.color, 'blue');
    const striped = setupFor(id, 1.5, catalog(), 'yellow-green');
    assert.deepEqual(blue.effective,striped.effective);
    assert(blue.practical.matrix > 0);
  }
  const records = catalog(), base = baseFor('pv3', .75);
  records.recipes.push({ ...base, baseId: base.id, optionId: 'pv3--pv3', id: recipeIdFor(base.id,'black','pv3--pv3'), origin: 'measurement', color: 'black', mode: 'dual', extruder1: 78, extruder2: 92, maxSpeed: 280, colorLead1: 400, colorLead2: 1800, revision: 1, updatedAt: '2026-10-02T12:00:00Z' });
  const blue = setupFor('pv3', .75, records, 'blue');
  assert.deepEqual([blue.effective.extruder1,blue.effective.extruder2,blue.effective.workingSpeed], [78,92,280]);
  assert.deepEqual([blue.effective.colorLead1,blue.effective.colorLead2], [400,1800]);
  assert.deepEqual([setupFor('pv3',.75,records,'yellow-green').effective.extruder1,setupFor('pv3',.75,records,'black').effective.extruder1], [78,68]);
  assert.deepEqual(setupFor('pv3',.75,records,'yellow-green').effective,blue.effective);
});

test('partial current recipe retains prior applied fields and updates predictions from calibration history', () => {
  const id = 'h07v-k--h07v-k', records = catalog();
  const sample = (section, values, updatedAt) => {
    const base = baseFor(id, section);
    return { ...base, ...values, optionId:id, baseId:base.id, id:recipeIdFor(base.id,'all',id), color:'all', mode:'single', origin:'measurement', revision:1, updatedAt };
  };
  const first = sample(2.5,{extruder1:70,maxSpeed:220},'2026-10-01T12:00:00Z');
  const second = sample(6,{extruder1:56,maxSpeed:80},'2026-10-01T12:00:00Z');
  const partial = sample(6,{extruder1:null,maxSpeed:150},'2026-10-02T12:00:00Z');
  records.recipes.push(first, partial);
  records.calibrations = [first, second, partial];
  const direct = setupFor(id,6,records,'brown');
  assert.deepEqual([direct.practical.extruder1,direct.practical.workingSpeed], [56,150]);
  assert.equal(direct.stored.fieldSources.extruder1.updatedAt, second.updatedAt);
  const forecast = setupFor(id,4,records,'brown');
  assert.equal(forecast.mode,'single');
  assert.equal(forecast.effective.workingSpeed,forecast.forecast.workingSpeed);
  assert.equal(forecast.effective.extruder1,forecast.forecast.extruder1);
  assert.equal(forecast.forecast.rpmWorkingSpeed,forecast.forecast.workingSpeed);
  const blue = setupFor(id,4,records,'blue');
  assert.equal(blue.mode,'dual');
  assert.equal(blue.practical.extruder1,null);
  assert(blue.effective.extruder1 > 0);
  assert.equal(blue.sources.extruder1,'forecast');
});

test('canonical measurements of shared-base labels coexist without replacing each other', () => {
  const records = catalog(), base = baseFor('pv1',1.5);
  for (const [optionId,extruder1] of [['pv1--pv1',85],['h07v-u--h07v-u',95]]) records.recipes.push({ ...base, optionId, baseId:base.id, id:recipeIdFor(base.id,'all',optionId), origin:'measurement', mode:'single', color:'all', extruder1, revision:1, updatedAt:'2026-10-02T12:00:00Z' });
  assert.equal(setupFor('pv1',1.5,records,'brown').practical.extruder1,85);
  assert.equal(setupFor('h07v-u--h07v-u',1.5,records,'brown').practical.extruder1,95);
  assert.notEqual(recipeIdFor(base.id,'all','pv1--pv1'),recipeIdFor(base.id,'all','h07v-u--h07v-u'));
});

test('other cable families keep their established black rule', () => {
  assert.equal(modeFor({mode:'unknown'},'black'),'dual');
  assert.equal(modeFor({mode:'single'},'black'),'dual');
  assert.equal(modeFor({mode:'dual'},'black'),'dual');
  assert.equal(setupFor('h07v-k--h07v-k',4,catalog(),'black').mode,'single');
});

test('all H and ПВ names require dual blue/striped modes and allow single ordinary colours', () => {
  for (const selected of CATALOG_OPTIONS.filter(supportsSingleColorMode)) {
    for (const color of ['blue', 'yellow-green']) assert.equal(modeFor(selected,color,'single'),'dual', `${selected.brand} ${color}`);
    for (const color of ['black', 'brown', 'white', 'gray', 'red', 'green', 'yellow']) {
      assert.equal(modeFor(selected,color,'dual'),'single', `${selected.brand} ${color}`);
    }
  }
  for (const id of ['h07v-k--h07v-k', 'pv1--pv1ng', 'pv3--pv3ngd', 'pv5--pv5', 'h03-en--h-03vv-f', 'pvs-380--pvs']) {
    const selected = CATALOG_OPTIONS.find(item => item.id === id), section = selected.sections[0], records = catalog();
    const blue = setupFor(id,section,records,'blue'), striped = setupFor(id,section,records,'yellow-green');
    assert.equal(blue.mode,'dual');
    assert.deepEqual(blue.effective,striped.effective);
    assert.equal(setupFor(id,section,records,'black').mode,'single');
    assert.equal(setupFor(id,section,records,'black').effective.extruder2,null);
    assert.deepEqual(new Set(tableSetups(records,id).filter(row=>row.row.section===section).map(row=>row.mode)), new Set(['single','dual']));
  }
});

test('allowing ordinary H colours one extruder does not relabel printed dual RPM', () => {
  const single = setupFor('h05-en--h05vv-f',.75,catalog(),'brown');
  const dual = setupFor('h05-en--h05vv-f',.75,catalog(),'blue');
  assert.equal(single.mode,'single');
  assert.equal(single.reference.extruder1,null);
  assert.equal(single.reference.extruder2,null);
  assert.equal(single.reference.workingSpeed,null);
  assert.equal(single.effective.extruder2,null);
  assert.equal(single.sources.extruder1,'forecast');
  assert.equal(dual.reference.extruder1,92);
  assert.equal(dual.mode,'dual');
});

test('a new partial dual measurement never inherits operating fields from an older single measurement', () => {
  const id = 'h07v-k--h07v-k', records = catalog(), base = baseFor(id,6);
  const single = { ...base, optionId:id, baseId:base.id, id:'old-single', color:'all', mode:'single', origin:'measurement', extruder1:56, maxSpeed:80, updatedAt:'2026-10-01T12:00:00Z' };
  const dual = { ...base, optionId:id, baseId:base.id, id:recipeIdFor(base.id,'all',id), color:'all', mode:'dual', origin:'measurement', extruder1:null, extruder2:90, maxSpeed:null, updatedAt:'2026-10-02T12:00:00Z' };
  records.recipes.push(dual);
  records.calibrations = [single, dual];
  const result = setupFor(id,6,records,'blue',{mode:'dual'});
  assert.equal(result.normalMode,'single');
  assert.equal(result.mode,'dual');
  assert.deepEqual([result.practical.extruder1,result.practical.extruder2,result.practical.workingSpeed], [null,90,null]);
  assert.equal(practicalFor(id,6,records,'dual').extruder1,null);
  assert.equal(practicalFor(id,6,records,'dual').mode,'dual');
  assert.equal(setupFor(id,4,records).normalMode,'single');
  assert.equal(practicalFor(id,4,records,'dual').mode,'dual');
  assert.equal(setupFor(id,6,records,'blue').practical.extruder2,90);
  assert.equal(setupFor(id,6,records,'black').practical.extruder1,56);
});

test('partial measurements merge previous colours only within the same extruder mode', () => {
  const records = catalog(), optionId = 'pv3--pv3', base = baseFor(optionId,.75);
  const shared = { ...base, optionId, baseId:base.id, color:'yellow-green', mode:'dual', origin:'measurement', extruder1:70, extruder2:90, maxSpeed:300, colorLead1:400, colorLead2:1800, updatedAt:'2026-10-01T12:00:00Z' };
  const partial = { ...base, optionId, baseId:base.id, color:'black', mode:'dual', origin:'measurement', extruder1:null, extruder2:100, maxSpeed:null, updatedAt:'2026-10-02T12:00:00Z' };
  const single = { ...base, optionId, baseId:base.id, color:'blue', mode:'single', origin:'measurement', extruder1:82, extruder2:null, maxSpeed:340, updatedAt:'2026-10-03T12:00:00Z' };
  records.recipes.push(partial,single);
  records.calibrations = [shared,partial,single];
  for (const color of ['blue','yellow-green']) {
    const result = setupFor(optionId,.75,records,color);
    assert.deepEqual([result.practical.extruder1,result.practical.extruder2,result.practical.workingSpeed,result.practical.colorLead1,result.practical.colorLead2], [70,100,300,400,1800]);
  }
  assert.deepEqual([setupFor(optionId,.75,records,'black').practical.extruder1,setupFor(optionId,.75,records,'black').practical.workingSpeed], [82,340]);
  assert.equal(recipeIdFor(base.id,'black',optionId,'dual'),recipeIdFor(base.id,'yellow-green',optionId,'dual'));
  assert.notEqual(recipeIdFor(base.id,'all',optionId,'single'),recipeIdFor(base.id,'all',optionId,'dual'));
  assert.equal(recipeIdFor(base.id,'all',optionId,'dual'),`${optionId}::${base.id}~dual`);
});
