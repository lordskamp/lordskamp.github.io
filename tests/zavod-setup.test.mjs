import assert from 'node:assert/strict';
import test from 'node:test';
import { RECIPES } from '../Zavod/data.js';
import { CATALOG_OPTIONS, baseFor, practicalFor, measurementColor } from '../Zavod/catalog-base.js';
import { setupFor, tableSetups, metricValues, VALUE_LABELS } from '../Zavod/setup-data.js';

const catalog = () => ({ recipes: RECIPES.map(record => ({ ...record, baseId: record.id, origin: 'handwritten', color: 'all', revision: 1, updatedAt: '2026-09-29T00:00:00Z' })) });
const option = (cardId, brand) => CATALOG_OPTIONS.find(candidate => candidate.cardId === cardId && candidate.brand === brand);
const setup = (cardId, brand, section, records = catalog()) => setupFor(option(cardId, brand).id, section, records);

test('reference specifications do not borrow practical values from similarly named cards', () => {
  const h05 = setup('h05-en', 'H05VV-F', .75);
  assert.equal(h05.practical.extruder1, null);
  assert.equal(h05.practical.extruder2, null);
  assert.equal(h05.forecast.extruder1, null);
  assert.equal(h05.effective.extruder1, 92);
  assert.equal(h05.sources.extruder1, 'reference');
  assert.equal(h05.stages.working, 500);
  assert.equal(h05.stages.second, 240);
  const ysly = setup('ysly-1000', 'YSLY-JZ', 2.5);
  assert.equal(ysly.practical.extruder1, null);
  assert.equal(ysly.effective.extruder1, 87);
  assert.equal(ysly.effective.extruder2, 100);
  assert.equal(ysly.sources.workingSpeed, 'reference');
});

test('known practical settings remain primary while reference and forecast stay available', () => {
  const result = setup('pv1', 'ПВ1', 1.5);
  assert.equal(result.effective.extruder1, 75);
  assert.equal(result.sources.extruder1, 'practical');
  assert.equal(result.practical.workingSpeed, 320);
  assert.equal(result.reference.workingSpeed, 300);
  assert.equal(result.forecast.extruder1, 70);
  assert.equal(result.forecast.workingSpeed, 320);
  assert.deepEqual(metricValues(result, 'extruder1').map(item => [item.source, item.value]), [['practical',75], ['reference',null], ['forecast',70]]);
  assert.deepEqual(metricValues(result, 'workingSpeed').map(item => [item.source, item.value]), [['practical',320], ['reference',300], ['forecast',320]]);
  const sikora = metricValues(result, 'sikoraOuter');
  assert.equal(sikora[0].source, 'practical');
  assert.equal(sikora[1].source, 'reference');
  assert.equal(sikora[1].value, result.row.outerNom);
  assert(sikora[1].label.includes('номінальний'));
  assert.equal(sikora[2].source, 'forecast');
  assert.equal(result.mode, 'single');
  assert.deepEqual(result.stages, { first: 20, second: 160, working: 320, source: 'practical' });
});

test('an unmeasured section gets labelled forecasts without any speed input', () => {
  const result = setup('pvs-380', 'ПВС', 1);
  assert.deepEqual([result.practical.extruder1, result.practical.extruder2, result.practical.workingSpeed], [null, null, null]);
  assert.deepEqual([result.forecast.extruder1, result.forecast.extruder2, result.forecast.workingSpeed], [65, 103, 512]);
  assert.equal(result.sources.extruder1, 'forecast');
  assert.equal(result.sources.workingSpeed, 'forecast');
  assert.deepEqual(result.stages, { first: 20, second: 240, working: 512, source: 'forecast' });
  assert.deepEqual(metricValues(result, 'extruder1').map(item => [item.source,item.value]), [['forecast',65], ['reference',117]]);
  assert.deepEqual(VALUE_LABELS, { practical: 'Практичні', reference: 'Довідкові', forecast: 'Прогнозовані' });
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
  for (const color of ['blue','brown','white','green']) {
    const result = setupFor('pv3',.75,catalog(),color);
    assert.equal(result.mode, 'single');
    assert.deepEqual([result.effective.extruder1,result.effective.extruder2,result.effective.workingSpeed], [68,null,350]);
    assert.equal(result.sources.extruder1,'practical');
    assert.equal(result.sources.workingSpeed,'practical');
  }
  const striped = setupFor('pv3',.75,catalog(),'yellow-green');
  assert.equal(striped.mode, 'dual');
  assert.deepEqual([striped.effective.extruder1,striped.effective.extruder2,striped.effective.workingSpeed], [65,85,350]);
  assert.deepEqual([setupFor('pv3',6,catalog(),'blue').effective.workingSpeed,setupFor('pv3',6,catalog(),'yellow-green').effective.workingSpeed], [120,130]);
  for (const [color, pair] of [['blue',[74,null]],['yellow-green',[64,80]]]) {
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
  assert.equal(measurementColor('pv3','dual'),'yellow-green');
  assert.equal(measurementColor('pv3','single'),'all');
  assert.equal(measurementColor('vvg','dual'),'all');
});

test('equal values are confirmed only by a real practical value of the same metric', () => {
  const result = setup('pv3','ПВ3',1.5);
  assert(metricValues(result,'workingSpeed').filter(item=>item.source!=='practical').every(item=>item.confirmed));
  assert.equal(metricValues(result,'matrix').find(item=>item.source==='reference').confirmed,true);
  assert.equal(metricValues(result,'sikoraWire').find(item=>item.source==='reference').confirmed,true);
  assert.equal(metricValues(result,'sikoraOuter').find(item=>item.source==='reference').confirmed,false);
  assert.equal(metricValues(result,'extruder1').find(item=>item.source==='reference').confirmed,false);
  const unmeasured = setup('pvs-380','ПВС',1);
  assert(metricValues(unmeasured,'extruder1').every(item=>!item.confirmed));
});

test('forecast RPM for a partial measurement is scaled to its measured working speed', () => {
  const records = catalog();
  const base = baseFor(option('pvs-380', 'ПВС').id, 1);
  records.recipes = records.recipes.filter(record => record.id !== base.id);
  records.recipes.push({ ...base, baseId: base.id, origin: 'measurement', color: 'all', mode: 'dual', maxSpeed: 200, revision: 2, updatedAt: '2026-09-30T12:00:00Z' });
  const result = setup('pvs-380', 'ПВС', 1, records);
  assert.equal(result.practical.workingSpeed, 200);
  assert.equal(result.forecast.workingSpeed, 512);
  assert.deepEqual([result.forecast.extruder1, result.forecast.extruder2], [65, 103]);
  assert.deepEqual([result.effective.extruder1, result.effective.extruder2], [25, 40]);
  assert.deepEqual(metricValues(result, 'extruder1').map(item => [item.value,item.label]), [[25,'Прогнозовані · для 200 м/хв'], [117,'Довідкові'], [65,'Прогнозовані · для 512 м/хв']]);
  assert.deepEqual(result.stages, { first: 20, second: 100, working: 200, source: 'practical' });
});

test('new measurements calibrate their option while leaving siblings untouched', () => {
  const records = catalog();
  const own = option('pv1', 'ПВ1нг');
  for (const [section, speed] of [[1.5, 300], [2.5, 200]]) {
    const base = baseFor(own.id, section);
    records.recipes.push({ ...base, baseId: base.id, origin: 'measurement', color: 'all', mode: 'single', extruder1: 100, maxSpeed: speed, revision: 2, updatedAt: '2026-09-30T12:00:00Z' });
  }
  const ownResult = setup('pv1', 'ПВ1нг', 1, records);
  assert.equal(ownResult.forecast.workingSpeed, 350);
  assert.equal(ownResult.forecast.anchors.find(anchor => anchor.section === 1.5).extruder1, 100);
  const basic = setup('pv1', 'ПВ1', 1, records);
  const sibling = setup('pv1', 'ПВ1нгд', 1, records);
  assert.equal(basic.forecast.workingSpeed, 373);
  assert.equal(sibling.forecast.workingSpeed, 373);
  assert.equal(sibling.practical.extruder1, null);
});

test('applied values are independent of dye colour and latest measurements win', () => {
  const records = catalog();
  const selected = option('pv1', 'ПВ1');
  const base = baseFor(selected.id, 1.5);
  records.recipes.push({ ...base, id: `${base.id}~blue`, baseId: base.id, color: 'blue', origin: 'measurement', extruder1: 85, revision: 2, updatedAt: '2026-09-30T12:00:00Z' });
  assert.equal(practicalFor(selected.id, 1.5, records).extruder1, 85);
  assert.equal(setupFor(selected.id, 1.5, records).effective.extruder1, 85);
});

test('the H05-specific DRAW_6 does not become practical or calibration data for (H)05', () => {
  const h05 = setup('ysly-shared', 'H05VV-F', 1.5);
  const common = setup('ysly-shared', '(H)05VV-F', 1.5);
  assert.equal(h05.practical.extruder1, 70);
  assert.equal(h05.practical.workingSpeed, 325);
  assert.equal(common.practical.extruder1, null);
  assert.equal(common.practical.workingSpeed, null);
  assert.equal(common.forecast.workingSpeed, 439);
  assert(!common.forecast.anchors.some(anchor => anchor.source === 'DRAW_6.JPG'));
});

test('Speaker handwritten pairs remain practical only for their named brand', () => {
  const speaker = setup('speaker', 'Speaker cable', .75);
  assert.deepEqual([speaker.practical.extruder1, speaker.practical.extruder2], [60, 40]);
  assert.equal(speaker.mode, 'dual');
  assert.equal(speaker.sources.extruder1, 'practical');
  assert.equal(speaker.sources.workingSpeed, 'reference');
  assert.equal(speaker.stages.second, 80);
  assert.equal(speaker.effective.matrix, '2,5×5,2');
  assert.equal(speaker.forecast.sikoraOuter, undefined);
  for (const brand of ['NYFAZ', 'LFZ-XY', 'LSZ-XY']) {
    const other = setup('speaker', brand, .75);
    assert.equal(other.practical.extruder1, null, brand);
    assert.equal(other.practical.extruder2, null, brand);
  }
});

test('every selectable reference row is present, with both PV3 modes and no all-colours column', () => {
  const records = tableSetups(catalog());
  assert.equal(records.length, CATALOG_OPTIONS.reduce((count, item) => count + item.sections.length * (item.practicalCableId === 'pv3' ? 2 : 1), 0));
  assert.equal(new Set(records.map(record=>`${record.option.id}:${record.row.section}`)).size, CATALOG_OPTIONS.reduce((count,item)=>count+item.sections.length,0));
  assert(records.every(record => record.option && record.row && record.stages.first === 20));
  assert(records.every(record => !Object.hasOwn(record, 'color')));
});
