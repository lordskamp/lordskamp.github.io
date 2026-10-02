import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { CATALOG_OPTIONS, baseFor } from '../Zavod/catalog-base.js';
import { RECIPES } from '../Zavod/data.js';
import { setupFor, tableSetups } from '../Zavod/setup-data.js';

const fixture=JSON.parse(readFileSync(new URL('../tests/fixtures/zavod-h07-calibrations.json',import.meta.url),'utf8'));
const catalog={recipes:RECIPES.map(row=>({...row,baseId:row.id,origin:'handwritten',color:'all'})),calibrations:fixture.measurements.map(row=>({...row,id:`admin-${row.section}`,baseId:baseFor(fixture.optionId,row.section).id,optionId:fixture.optionId,mode:fixture.mode,origin:'measurement',color:'all'}))};
const started=performance.now(),missing=[];
let count=0;
for(const option of CATALOG_OPTIONS) for(const section of option.sections) for(const color of ['blue','black','yellow-green']) {
  const info=setupFor(option.id,section,catalog,color);count++;
  for(const key of ['extruder1','extruder2','workingSpeed','sikoraWire','sikoraOuter','dorn','matrix']) {
    if(key==='extruder2'&&info.mode==='single') continue;
    const value=info.effective[key];
    if(!(typeof value==='number'&&Number.isFinite(value)&&value>0||typeof value==='string'&&value.trim())) missing.push({id:option.id,section,color,mode:info.mode,key,value});
  }
}
const rows=tableSetups(catalog);
console.log(JSON.stringify({count,tableRows:rows.length,elapsedMs:Math.round(performance.now()-started),missing},null,2));
