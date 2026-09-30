import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
import { REFERENCE_CARDS, SOURCE_ANNOTATIONS } from '../../Zavod/reference-data.js';
import { CABLES, RECIPES } from '../../Zavod/data.js';

const out = path.dirname(fileURLToPath(import.meta.url));
const downloads = path.resolve(out, '../../Zavod/downloads');
await fs.mkdir(downloads, { recursive: true });
const label = id => CABLES.find(c=>c.id===id)?.label ?? id;
const mode = value => ({single:'Тільки №1',dual:'№1 і №2',unknown:'Не уточнено'})[value] ?? null;
const comparison = [];
const parameters = [
  ['dorn','Дорн','мм','dorn'],['matrix','Матриця','мм','matrix'],['maxSpeed','Макс. швидкість','м/хв','maxSpeed'],
  [null,'Сікора 1 — фактична жила','мм','sikoraWire'],[null,'Сікора 2 — установка ізоляції','мм','sikoraOuter'],
  ['rpm1','Оберти шнека №1','об/хв','extruder1'],['rpm2','Оберти шнека №2','об/хв','extruder2'],
  [null,'Кількість екструдерів','режим','mode'],
];
for (const card of REFERENCE_CARDS) for (const printed of card.rows) {
  const targets = card.cableIds.length ? card.cableIds : [null];
  for (const cableId of targets) {
    const hand = RECIPES.find(r=>r.cableId===cableId&&r.section===printed.section);
    const compatible = card.id==='ysly-shared' || ['pv1','pv3','pvs-380'].includes(card.id) ? 'Кандидат для зіставлення; умови звірити' : card.id==='h07v-u' ? 'ПВ1 / H07V-U: споріднена марка; клас 1' : hand ? 'Інша специфікація / карта; не об’єднувати' : 'Рукописної пари немає';
    for (const [refKey,parameter,unit,handKey] of parameters) {
      let note = printed.note || '';
      if (parameter.startsWith('Оберти')) note += ' Одиниця однакова: об/хв. Зіставляти лише за сумісних умов і швидкості; довідкові оберти потребують підбору.';
      if (parameter.startsWith('Сікора')) note += ' Номінальна геометрія є на аркуші «Довідкові»: це не готова установка Сікори.';
      if (hand?.cableId==='pv3') note += ' ПВ3: основний режим один за оператором; пари можуть бути для жовто-зеленого, але це не підтверджено.';
      if (printed.speedAlternative && refKey==='maxSpeed') note += ` Альтернативи джерела: ${printed.speedAlternative}.`;
      if (printed.dornAlternative && refKey==='dorn') note += ` Альтернативний дорн: ${printed.dornAlternative}.`;
      if (handKey==='extruder2'&&hand?.mode==='single') note += ' №2 вимкнений; порожнє число не означає нуль.';
      comparison.push([cableId?label(cableId):card.label,printed.section,printed.conductorClass??card.conductorClass??null,parameter,refKey?printed[refKey]:null,handKey==='mode'?mode(hand?.mode):handKey?hand?.[handKey]??null:null,null,unit,card.id,card.source,hand?.source??null,compatible,note.trim()]);
    }
  }
}
const referenceHeaders = ['Карта','Марка / варіант','мм²','Клас жили','Напруга','Жила мін., мм','Жила ном., мм','Жила макс., мм','Товщина мін., мм','Товщина ном., мм','Ізоляція мін., мм','Ізоляція ном., мм','Ізоляція макс., мм','Дорн, мм','Матриця, мм','Швидкість, м/хв','Шнек №1, об/хв','Шнек №2, об/хв','Випробування, кВ','Конструкція / плоскі розміри','Альтернативи / примітки','Фото'];
const referenceRows = REFERENCE_CARDS.flatMap(card=>card.rows.map(r=>[
  card.id,r.brand??card.label,r.section,r.conductorClass??card.conductorClass??null,card.voltage??null,r.wireMin??null,r.wireNom,r.wireMax??null,r.thicknessMin,r.thicknessNom,r.outerMin,r.outerNom,r.outerMax,r.dorn,r.matrix,r.maxSpeed,r.rpm1,r.rpm2,r.testKV,
  [r.construction,r.outerMinText&&`Ізоляція мін. ${r.outerMinText}`,r.outerNomText&&`Ізоляція ном. ${r.outerNomText}`,r.dornText&&`Дорн ${r.dornText}`,r.matrixText&&`Матриця ${r.matrixText}`].filter(Boolean).join('; '),
  [r.note,r.dornAlternative&&`Дорн у дужках ${r.dornAlternative}`,r.speedAlternative&&`Швидкість ${r.speedAlternative}`,r.pvcKgKm!=null&&`ПВХ ${r.pvcKgKm} кг/км`].filter(Boolean).join('; '),card.source,
]));
const handRows = RECIPES.map(r=>[r.id,label(r.cableId),r.section,mode(r.mode),r.dorn,r.matrix,r.sikoraWire,r.sikoraOuter,r.extruder1,r.extruder2,r.maxSpeed,r.colorLead2??null,r.source,[...r.notes,...r.uncertain].join(' ')]);
const notesRows = REFERENCE_CARDS.flatMap(card=>card.notes.map((note,i)=>[card.id,card.label,i+1,note,card.source]));
notesRows.push(['operator','Уточнення оператора',1,'Рукописні дані основні. Матриця + 0,15 мм — приблизний орієнтир поруч; якщо рукопис відрізняється, зберігати рукопис. ВВГ з DRAW_3 дозволено для ВВГнг-П. Максимум ВВГ 1,5: 800 м/хв.','Чат 29–30.09.2026']);
notesRows.push(['operator','Уточнення оператора',2,'ПВ3: основний режим один екструдер. Пари в рукописі, можливо, означають жовто-зелений колір, який робиться двома екструдерами; оператор не впевнений. Не вважати це встановленим правилом.','Чат 30.09.2026']);
notesRows.push(['operator','Довжина й зміна кольору',3,'Вхідний барабан закінчився: поточне число на екрані +30 м; позначку пробою з екрана записати на ярлик final.jpg.','Чат / SCREEN.JPG / final.jpg']);
notesRows.push(['operator','Довжина й зміна кольору',4,'При переході кольору: установка довжини L − 150 м ванни + 1000 м запасу від автоматичного перекидання. Для 15000 м — 15850 м. Перекинути вручну, коли потрібний колір з’явиться у 4-му рядку ванни. E2 змінювати приблизно за 2000 м, E1 — за 300 м; числа приблизні й залежать від режиму. Потім стравити.','Чат']);
notesRows.push(['operator','Барвники',5,'E1 — основа, переважно біла; для жовто-зеленого — жовта. E2 — верхній колір; для жовто-зеленого — зелений. За одного екструдера всі барвники використовують у E1.','Чат']);

const prompt = `# Промпт для нового чату

Проаналізуй прикріплену таблицю ділянки обпресування. Я хочу отримати обережні оцінки для порожніх полів «Прогноз», спираючись на відмінності між довідковими та рукописними даними.

1. Спочатку прочитай примітки, альтернативи й уточнення оператора. Рукописні заміри мають пріоритет. Не змінюй їх і не заповнюй прогноз там, де вже є однозначне рукописне значення.
2. Зіставляй тільки однакові показники з однаковими одиницями й сумісними умовами: марка, переріз, клас жили, напруга, товщина ізоляції, матеріал, колір і кількість екструдерів. Карти однієї марки з різними специфікаціями аналізуй окремо. Повтори DRAW_3 для ВВГ/ВВГнг-П та DRAW_4 для YSLY/H05VV-F — ті самі спостереження, не незалежні заміри.
3. Оператор підтвердив: значення на екрані екструдерів — оберти шнека, об/хв. Це та сама одиниця, що в довідці. Не перенось оберти між різними умовами. Для того самого режиму можна показати пробний перерахунок: записані оберти × нова швидкість ÷ записана швидкість. Межа 10% зміни швидкості в останньому файлі — обмеження сценарію, а не допуск обладнання. Номінальний діаметр із карти не є готовою установкою Сікори. Розміри плоскої матриці «×» не є круглим діаметром.
4. Для ПВ3 основний режим — один екструдер за поясненням оператора. Пари 50/130, 80/100 та інші можуть бути для жовто-зеленого кольору, але це не підтверджено. Не призначай їм колір і не змішуй один та два екструдери без уточнення.
5. Перевір, чи достатньо зіставних пар, щоб оцінити залежність. Не застосовуй один коефіцієнт до всіх марок і параметрів. Перевіряй метод на відомих парах, по можливості залишаючи одну пару для перевірки; наведи помилку, кількість незалежних пар і межі застосування. Якщо даних бракує, залишай прогноз порожнім і пиши «потрібен замір».
6. Матриця + 0,15 мм — приблизний орієнтир другої Сікори, а не перевірений прогноз. Позначай його окремо. Врахуй обмеження товщини/діаметра з конкретної карти; вони різняться між джерелами. Не усереднюй суперечності й не вигадуй нечіткі цифри.
7. Поверни заповнену таблицю зі збереженими вихідними значеннями й окремими колонками: прогноз, діапазон, метод, використані джерела, впевненість, що треба уточнити. Чітко познач прогнози як неперевірені оцінки для пробного заміру, а не готові налаштування виробництва.

Пиши українською, коротко й зрозуміло оператору. Спочатку покажи, які параметри можна оцінити, а для яких даних недостатньо.
`;
const guide = [
  ['Що в таблиці','Друковані карти з усіх 15 фотографій IMG_3848–IMG_3862, рукописні рецепти, приписки та умови. Дата 30.09.2026.'],
  ['Прогноз','Усі клітинки прогнозу порожні навмисно. Вихідні дані не замінені розрахунками.'],
  ['Порівняння','Один рядок = один параметр для конкретної карти / марки / перерізу. Фільтр дозволяє залишити потрібний провід.'],
  ['Довідкові','Повна геометрія друкованих карт, класи жили, напруга, товщина, оберти, конструкція. Номінальна геометрія не є установками Сікори.'],
  ['Рукописні','37 рядків калькулятора, включно з порожніми. Один і той самий рукопис повторений для підтверджених марок; не рахувати повтори як незалежні заміри.'],
  ['Приписки','Числа на полях та виправлення на друкованих фото. Неоднозначні значення лишаються текстом.'],
  ['Примітки','Умови над і під таблицями та пояснення оператора. Фото з однаковою маркою можуть описувати різні специфікації.'],
  ['Одиниці','Діаметри — мм, переріз — мм², швидкість — м/хв. Значення на екрані екструдерів і в довідці — оберти шнека, об/хв; підтверджено оператором.'],
  ['Проба за швидкістю','Для того самого режиму: записані оберти × нова швидкість ÷ записана швидкість. Межа 10% у файлі оператора — обмеження сценарію, а не допуск обладнання.'],
  ['ПВ3','Один екструдер — основний режим за оператором. Два можуть бути для жовто-зеленого, але це не підтверджено. Пари збережено дослівно.'],
  ['Порожня клітинка','Немає значення або його не можна надійно прочитати. Це не нуль. E2 у режимі «Тільки №1» вимкнений.'],
  ['Сікорa','Рукописна установка основна; матриця + 0,15 мм лише приблизний орієнтир. Друковані номінальні діаметри зберігаються окремо.'],
  ['Новий чат','Прикріпи цей Excel або текстову таблицю zavod-comparison.md і встав промпт prompt.md.'],
];
const datasets = [
  ['Як читати',['Пункт','Пояснення'],guide,[220,890]],
  ['Порівняння',['Провід','мм²','Клас','Параметр','Довідкове','Рукописне','Прогноз','Одиниця','Карта','Фото довідки','Фото рукопису','Сумісність','Пояснення'],comparison,[180,65,65,245,105,115,115,150,150,140,140,245,440]],
  ['Довідкові',referenceHeaders,referenceRows,[160,320,65,65,110,105,105,105,115,115,120,120,120,90,100,120,130,130,135,360,370,145]],
  ['Рукописні',['ID','Провід','мм²','Режим','Дорн, мм','Матриця, мм','Сікора 1, мм','Сікора 2, мм','Оберти №1, об/хв','Оберти №2, об/хв','Швидкість, м/хв','Зміна кольору E2, м','Фото','Примітки'],handRows,[155,170,65,150,95,105,120,120,155,155,135,160,145,600]],
  ['Приписки',['Фото','Марка','мм²','Показник','Дослівне значення','Пояснення'],SOURCE_ANNOTATIONS,[150,180,65,220,240,600]],
  ['Примітки',['Карта','Марка / умова','№','Примітка','Джерело'],notesRows,[160,340,60,900,220]],
];
assert.equal(new Set(REFERENCE_CARDS.map(c=>c.source)).size,15);
assert.equal(RECIPES.length,37);
assert(comparison.every(r=>r[6]===null));
assert.equal(REFERENCE_CARDS.find(c=>c.id==='ysly-shared').rows.at(-1).matrix,4.2);
assert.equal(REFERENCE_CARDS.find(c=>c.id==='h05-en').rows.at(-1).matrix,null);
assert.equal(REFERENCE_CARDS.find(c=>c.id==='pvs-380').rows[0].rpm1,84);
assert(comparison.some(r=>r[8]==='pvs-380'&&r[3]==='Оберти шнека №1'&&r[4]===84));
const wb = Workbook.create();
const col = n => { let s=''; for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s; };
for (const [name,headers,values,widths] of datasets) {
  const s=wb.worksheets.add(name);s.showGridLines=false;
  const last=col(headers.length-1),end=values.length+4;
  s.getRange(`A1:${last}${end}`).format.font={name:'Calibri',size:11,color:'#24333F'};
  s.getRange(`A1:${last}1`).format.fill='#173C55';s.getRange('A1').values=[[name]];
  s.getRange(`A1:${last}1`).format.font={name:'Calibri',size:20,bold:true,color:'#FFFFFF'};
  s.getRange('A1').format.rowHeight=38;
  s.getRange('A2').values=[[name==='Порівняння'?'Прогноз — порожня колонка G.':'Джерела й пояснення збережено.']];
  s.getRange('A2').format.font={name:'Calibri',size:11,color:'#657586'};
  s.getRange(`A4:${last}${end}`).values=[headers,...values];
  s.getRange(`A4:${last}4`).format.fill='#DCE7EF';s.getRange(`A4:${last}4`).format.font={name:'Calibri',size:11,bold:true,color:'#173C55'};
  s.getRange(`A4:${last}${end}`).format.wrapText=true;s.getRange(`A4:${last}${end}`).format.verticalAlignment='center';
  s.getRange(`A4:${last}4`).format.rowHeight=44;
  s.getRange(`A5:${last}${end}`).format.rowHeight=name==='Примітки'?76:name==='Як читати'?65:name==='Приписки'?60:name==='Порівняння'?70:65;
  widths.forEach((width,i)=>s.getRange(`${col(i)}1:${col(i)}${end}`).format.columnWidthPx=width);
  for(let r=5;r<=end;r+=2)s.getRange(`A${r}:${last}${r}`).format.fill='#F1F5F8';
  s.tables.add(`A4:${last}${end}`,true,`ZavodTable${datasets.findIndex(d=>d[0]===name)+1}`);
  s.freezePanes.freezeRows(4);
  if(name!=='Як читати')s.freezePanes.freezeColumns(name==='Порівняння'?4:2);
  if(name==='Порівняння') {
    s.getRange(`E5:F${end}`).setNumberFormat('General');
    s.getRange(`G4:G${end}`).format.fill='#FFF2CA';s.getRange(`G5:G${end}`).setNumberFormat('General');
  }
  s.tabColor=name==='Порівняння'?'#D8A025':'#173C55';
}
wb.recalculate();
await fs.writeFile(path.join(out,'inspection.json'),JSON.stringify(await wb.inspect({kind:'sheet,table',maxChars:3500,tableMaxRows:3,tableMaxCols:8})));
for (const [name,headers,values] of datasets) {
  const s=wb.worksheets.getItem(name);
  assert(!s.getRange(`A4:${col(headers.length-1)}${values.length+4}`).values.flat().some(v=>typeof v==='string'&&/^#(REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|NULL!)/.test(v)));
  const preview = await wb.render({sheetName:name,range:`A1:${name==='Порівняння'?'H':name==='Довідкові'?'J':name==='Рукописні'?'J':col(headers.length-1)}${name==='Як читати'?17:10}`,scale:1,format:'png'});
  await fs.writeFile(path.join(out,`preview-${name}.png`),new Uint8Array(await preview.arrayBuffer()));
}
assert(wb.worksheets.getItem('Порівняння').getRange(`G5:G${comparison.length+4}`).values.flat().every(v=>v==null||v===''));
await (await SpreadsheetFile.exportXlsx(wb)).save(path.join(out,'zavod-comparison.xlsx'));
const cell=v=>String(v??'').replaceAll('|','\\|').replaceAll('\n',' ');
const md=datasets.map(([name,headers,values])=>`## ${name}\n\n| ${headers.map(cell).join(' | ')} |\n| ${headers.map(()=>'---').join(' | ')} |\n${values.map(row=>`| ${row.map(cell).join(' | ')} |`).join('\n')}`).join('\n\n');
await fs.writeFile(path.join(downloads,'zavod-comparison.md'),`# Обпресування — дані для зіставлення\n\nДата: 30.09.2026. Усі поля прогнозу порожні.\n\n${md}\n`);
await fs.writeFile(path.join(downloads,'prompt.md'),prompt);
await fs.writeFile(path.join(downloads,'zavod-comparison.json'),JSON.stringify({date:'2026-09-30',referenceCards:REFERENCE_CARDS,handwritten:RECIPES,annotations:SOURCE_ANNOTATIONS,comparison:{headers:datasets[1][1],rows:comparison}},null,2));
console.log(JSON.stringify({printedRows:referenceRows.length,comparisonRows:comparison.length,handwrittenRows:handRows.length,notes:notesRows.length,xlsx:path.join(out,'zavod-comparison.xlsx')}));
