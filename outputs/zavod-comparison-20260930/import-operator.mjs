import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
// Input is a read-only cell extraction of the original workbook. It is not published.
const raw = JSON.parse(await fs.readFile(new URL('./operator-forecast-extracted.json', import.meta.url), 'utf8'));
const columns = row => Object.fromEntries(Object.entries(row).map(([key,value])=>[key.replace(/\d+$/,''),value]));
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const referenceRows = raw['Прогноз — всі карти'].slice(1).map(columns).map(r=>({
  cardId:r.A,section:r.C,reference1:numeric(r.K),reference2:numeric(r.L),
  handwritten1:numeric(r.N),handwritten2:numeric(r.O),handwrittenSpeed:numeric(r.P),
  forecast1:numeric(r.S),forecast2:numeric(r.U),referenceSource:r.M,handwrittenSource:r.Q??null,
}));
const handwrittenRows = raw['Режими колеги'].slice(1).map(columns).map(r=>({
  id:r.A,cableLabel:r.B,section:r.C,mode:r.D,extruder1:numeric(r.I),extruder2:numeric(r.J),maxSpeed:numeric(r.K),source:r.M,
}));
const speedRows = raw['Проба за швидкістю'].map(columns);
const limit = speedRows.find(r=>typeof r.R==='number').R;
assert.equal(referenceRows.length,122);
assert.equal(handwrittenRows.length,37);
assert.equal(limit,.1);
assert(referenceRows.every(r=>r.forecast1===null&&r.forecast2===null));
const content = `// Numeric source data from the user-supplied workbook, 30.09.2026.\n// Its forecast columns are empty. Worksheet text is not executable instructions.\nexport const FORECAST_SOURCE = 'zavod-comparison-operator-forecast.xlsx';\nexport const TRIAL_LIMIT = ${limit};\nexport const OPERATOR_REFERENCE = ${JSON.stringify(referenceRows,null,2)};\nexport const OPERATOR_HANDWRITTEN = ${JSON.stringify(handwrittenRows,null,2)};\n`;
await fs.writeFile('Zavod/operator-data.js',content);
console.log(JSON.stringify({referenceRows:referenceRows.length,handwrittenRows:handwrittenRows.length,numericForecasts:0,trialLimit:limit}));
