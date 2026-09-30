import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
import { REFERENCE_CARDS } from '../../Zavod/reference-data.js';
import { CATALOG_OPTIONS } from '../../Zavod/catalog-options.js';
import { setupFor } from '../../Zavod/setup-data.js';

const out = path.dirname(fileURLToPath(import.meta.url));
const wb = Workbook.create();
const sheet = wb.worksheets.add('Налаштування');
const headers = ['Кабель / карта', 'Переріз, мм²', 'Значення', 'Оберти №1, об/хв', 'Оберти №2, об/хв', 'Робоча швидкість, м/хв', '1-ша швидкість, м/хв', '2-га швидкість, м/хв', 'Дорн, мм', 'Матриця, мм', 'Сікора 1, мм', 'Сікора 2, мм', 'Джерело'];
const values = [];
const records = [];
const compactLabel = card => ({
  'ysly-shared': 'YSLY / MYYS / (H)05VV-F / Z-FLEX CLASSIC',
  'xymm': 'XYMM, 450/750 В',
  'vvg3': 'ВВГз та споріднені марки, клас 3, 0,66 кВ',
})[card.id] || card.label;

// Brand variants do not duplicate the same printed observations.
for (const card of REFERENCE_CARDS) {
  const options = CATALOG_OPTIONS.filter(option => option.cardId === card.id);
  for (const row of card.rows) {
    const matchingOptions = options.filter(option => option.sections.includes(row.section));
    const option = matchingOptions.find(item => item.practicalCableId) || matchingOptions[0];
    assert(option, `Немає марки для карти ${card.id}, ${row.section} мм²`);
    const setup = setupFor(option.id, row.section);
    for (const [category, raw, source] of [
      ['Довідкові', setup.reference, card.source],
      ['Практичні', setup.practical, setup.practicalSources.join(', ') || null],
      ['Прогнозовані', setup.forecast, null],
    ]) {
      const data = raw || {};
      const mode = data.mode || setup.mode;
      const rpm2 = mode === 'single' ? null : data.extruder2 ?? null;
      const forecastSource = category === 'Прогнозовані' ? [...new Set((data.anchors || []).map(anchor => anchor.source).filter(Boolean))].join(', ') || null : null;
      values.push([
        compactLabel(card), row.section, category,
        data.extruder1 ?? null, rpm2, data.workingSpeed ?? null, 20, null,
        data.dornText || (data.dorn ?? null), data.matrixText || (data.matrix ?? null),
        // Printed nominal geometry is not a measured Sikora setting.
        category === 'Довідкові' ? null : data.sikoraWire ?? null,
        category === 'Довідкові' ? null : data.sikoraOuter ?? null,
        source || forecastSource,
      ]);
      records.push({ cardId: card.id, section: row.section, category, data, mode });
    }
  }
}

assert.equal(values.length, REFERENCE_CARDS.reduce((sum, card) => sum + card.rows.length * 3, 0));
assert(values.every(row => row[6] === 20));
const last = values.length + 6;
sheet.showGridLines = false;
sheet.tabColor = '#254B67';
sheet.getRange(`A1:M${last}`).format.font = { name: 'Arial', size: 11, color: '#26333D' };
sheet.getRange(`A1:M${last}`).format.verticalAlignment = 'center';
sheet.getRange('A2').values = [['Обпресування — налаштування на 30.09.2026']];
sheet.getRange('A2').format.font = { name: 'Arial', size: 16, bold: true, color: '#254B67' };
sheet.getRange('A2').format.rowHeight = 27;
sheet.getRange('A3').values = [['Довідкові — з друкованої карти. Практичні — з рукописів. Прогнозовані — розрахунок для проби.']];
sheet.getRange('A4').values = [['1-ша швидкість — 20. 2-га — половина робочої, округлена до цілого. Порожня клітинка означає, що значення ще не з’ясували.']];
sheet.getRange('A3:A4').format.font = { name: 'Arial', size: 11, color: '#5E6A74' };
sheet.getRange('A3:A4').format.rowHeight = 22;
sheet.getRange('A5:M5').format.borders = { bottom: { style: 'thin', color: '#9AAEBE' } };
sheet.getRange(`A6:M${last}`).values = [headers, ...values];
sheet.getRange(`A6:M${last}`).format.rowHeight = 25;
sheet.getRange('A6:M6').format.fill = '#254B67';
sheet.getRange('A6:M6').format.font = { name: 'Arial', size: 11, bold: true, color: '#FFFFFF' };
sheet.getRange('A6:M6').format.wrapText = true;
sheet.getRange('A6:M6').format.horizontalAlignment = 'center';
sheet.getRange('A6:M6').format.rowHeight = 46;
sheet.getRange(`A7:C${last}`).format.horizontalAlignment = 'left';
sheet.getRange(`B7:B${last}`).setNumberFormat('General');
sheet.getRange(`D7:H${last}`).setNumberFormat('0');
sheet.getRange(`I7:L${last}`).setNumberFormat('General');
sheet.getRange(`D7:L${last}`).format.horizontalAlignment = 'right';
sheet.getRange(`M7:M${last}`).format.font = { name: 'Arial', size: 11, color: '#64717D' };
sheet.getRange(`M7:M${last}`).format.borders = { left: { style: 'thin', color: '#B4C6D3' } };
const widths = [410, 95, 130, 110, 110, 125, 105, 105, 100, 120, 105, 105, 230];
widths.forEach((width, index) => sheet.getRange(`${String.fromCharCode(65 + index)}1:${String.fromCharCode(65 + index)}${last}`).format.columnWidthPx = width);

for (let index = 0; index < records.length; index++) {
  const rowNumber = index + 7;
  const record = records[index];
  sheet.getRange(`H${rowNumber}`).formulas = [[`=IF(F${rowNumber}="","",ROUND(F${rowNumber}/2,0))`]];
  if (record.category === 'Практичні') sheet.getRange(`C${rowNumber}:F${rowNumber}`).format.fill = '#E8F2E8';
  if (record.category === 'Прогнозовані') sheet.getRange(`C${rowNumber}:F${rowNumber}`).format.fill = '#FFF0CE';
  if (record.category === 'Довідкові') sheet.getRange(`A${rowNumber}:M${rowNumber}`).format.borders = { top: { style: 'thin', color: '#D8E0E6' } };
  const hasPracticalValue = ['extruder1','extruder2','workingSpeed','dorn','matrix','sikoraWire','sikoraOuter'].some(key => record.data[key] != null);
  if (record.category === 'Практичні' && !hasPracticalValue) sheet.getRange(`M${rowNumber}`).values = [['Ще немає заміру']];
  if (record.category === 'Прогнозовані' && !record.data.extruder1 && !record.data.workingSpeed) {
    const practical = records[index - 1]?.data;
    const known = practical?.extruder1 != null && practical?.workingSpeed != null;
    sheet.getRange(`M${rowNumber}`).values = [[record.data.sikoraOuter != null ? 'Матриця + 0,15' : known ? 'Є практичні значення' : 'Недостатньо даних']];
  }
}

sheet.tables.add(`A6:M${last}`, true, 'ZavodSettings');
sheet.freezePanes.freezeRows(6);
sheet.freezePanes.freezeColumns(3);
const notes = [
  ['Практичні', 'Установка з рукопису має пріоритет. Порожня практика означає відсутність заміру, а не відсутність кабелю.'],
  ['Прогнозовані', 'Оцінка за практичними режимами тієї самої карти. Інша специфікація потребує власного заміру.'],
  ['Сікора', 'Довідковий номінальний діаметр не є готовою установкою Сікори. Матриця + 0,15 мм — приблизний орієнтир.'],
  ['Один екструдер', 'Порожні оберти №2 у режимі одного екструдера означають: №2 вимкнений.'],
  ['ПВ3', 'Пари обертів у рукописах можуть належати іншому режиму. Їх не змішано з режимом одного екструдера.'],
  ['Друковані карти', 'IMG_3848.JPG–IMG_3862.JPG. Умови під таблицями збережені на сайті в довідці кожної карти.'],
];
const noteStart = last + 3;
sheet.getRange(`A${noteStart}:B${noteStart + notes.length - 1}`).values = notes;
for (let index = 0; index < notes.length; index++) sheet.mergeCells(`B${noteStart + index}:H${noteStart + index}`);
sheet.getRange(`A${noteStart}:H${noteStart + notes.length - 1}`).format.font = { name: 'Arial', size: 11, color: '#5E6A74' };
sheet.getRange(`A${noteStart}:H${noteStart + notes.length - 1}`).format.rowHeight = 30;
sheet.getRange(`B${noteStart}:H${noteStart + notes.length - 1}`).format.wrapText = true;

wb.recalculate();
const renderedValues = sheet.getRange(`A7:M${last}`).values;
for (let index = 0; index < renderedValues.length; index++) {
  const row = renderedValues[index];
  assert.equal(row[7], row[5] == null || row[5] === '' ? '' : Math.round(row[5] / 2));
  assert(!row.some(value => typeof value === 'string' && /^#(REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|NULL!|SPILL!|CALC!)/.test(value)));
}
const inspection = await wb.inspect({ kind: 'table', range: 'Налаштування!A6:H18', include: 'values,formulas', tableMaxRows: 13, tableMaxCols: 8, maxChars: 5000 });
await fs.writeFile(path.join(out, 'inspection.json'), JSON.stringify(inspection));
for (const [file, range] of [
  ['preview-compact-main.png', 'A1:H18'],
  ['preview-compact-tools.png', 'I6:M18'],
  ['preview-compact-notes.png', `A${noteStart}:H${noteStart + notes.length - 1}`],
]) {
  const preview = await wb.render({ sheetName: sheet.name, range, scale: 1, format: 'png' });
  await fs.writeFile(path.join(out, file), new Uint8Array(await preview.arrayBuffer()));
}
for (const cardId of ['ysly-shared', 'speaker']) {
  const start = records.findIndex(record => record.cardId === cardId) + 7;
  for (const [part, columns] of [['main',['A','H']],['tools',['I','M']]]) {
    const preview = await wb.render({ sheetName: sheet.name, range: `${columns[0]}${start - 1}:${columns[1]}${start + 8}`, scale: 1, format: 'png' });
    await fs.writeFile(path.join(out, `preview-compact-${cardId}-${part}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
}
await (await SpreadsheetFile.exportXlsx(wb)).save(path.join(out, 'zavod-comparison.xlsx'));
console.log(JSON.stringify({ worksheets: 1, printedRows: REFERENCE_CARDS.reduce((sum, card) => sum + card.rows.length, 0), rows: values.length, columns: headers.length, xlsx: path.join(out, 'zavod-comparison.xlsx') }));
