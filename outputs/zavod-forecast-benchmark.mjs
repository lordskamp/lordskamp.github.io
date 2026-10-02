import { readFileSync, writeFileSync } from 'node:fs';
import { RECIPES } from '../Zavod/data.js';
import { CATALOG_OPTIONS, baseFor } from '../Zavod/catalog-base.js';
import { REFERENCE_CARDS } from '../Zavod/reference-data.js';
import { forecastFor } from '../Zavod/forecast.js';

const fixture=JSON.parse(readFileSync(new URL('../tests/fixtures/zavod-h07-calibrations.json',import.meta.url),'utf8'));
const held=fixture.measurements.find(row=>row.section===6);
const training=fixture.measurements.filter(row=>row.section!==6).map(row=>({...row,id:`train-${row.section}`,baseId:baseFor(fixture.optionId,row.section).id,optionId:fixture.optionId,cableId:fixture.optionId,mode:fixture.mode,origin:'measurement'}));
const card=REFERENCE_CARDS.find(card=>card.id===CATALOG_OPTIONS.find(option=>option.id===fixture.optionId).cardId);
const result=forecastFor(card,card.rows.find(row=>row.section===6),[...RECIPES,...training],{optionId:fixture.optionId,mode:fixture.mode});
const pairs=[['extruder1','extruder1','Екструдер №1, об/хв'],['extruder2','extruder2','Екструдер №2, об/хв'],['workingSpeed','maxSpeed','Швидкість, м/хв'],['sikoraWire','sikoraWire','Жила, мм'],['sikoraOuter','sikoraOuter','З ізоляцією, мм'],['dorn','dorn','Дорн, мм'],['matrix','matrix','Матриця, мм']];
const comparison=pairs.map(([key,actualKey,label])=>({label,predicted:result[key],actual:held[actualKey],errorPercent:Math.round(Math.abs(result[key]-held[actualKey])/held[actualKey]*1000)/10,method:result.fieldMethods[key]}));
const linear=key=>training[1][key]+(training[1][key]-training[0][key])/(training[1].section-training[0].section)*(6-training[1].section);
const fmt=value=>String(value).replace('.',',');
const md=`# Контрольний прогноз H07V-K 6 мм²\n\nНавчальні заміри: 1,5 та 2,5 мм². Контрольний замір 6 мм² вилучено з усіх вхідних даних прогнозу; він використовується лише в порівнянні. Усі заміри — режим двох екструдерів. Дата отримання публічних даних: ${fixture.retrievedOn}.\n\n| Значення | Прогноз | Замір | Похибка |\n|---|---:|---:|---:|\n${comparison.map(row=>`| ${row.label} | ${fmt(row.predicted)} | ${fmt(row.actual)} | ${fmt(row.errorPercent)}% |`).join('\n')}\n\nЛінійне продовження лише за перерізом дало б №1 ${fmt(Math.round(linear('extruder1')*10)/10)}, №2 ${fmt(Math.round(linear('extruder2')*10)/10)}, швидкість ${fmt(linear('maxSpeed'))}. Обрана модель використовує геометрію, площу ізоляції та швидкість для №1; для №2 — окрему обмежену емпіричну криву; для швидкості — навантаження споріднених практичних серій. Константи під H07V-K 6 мм² не підставлено.\n\nЦей контрольний приклад був використаний для порівняння методів, тому його похибка не є незалежною оцінкою точності всіх майбутніх прогнозів. Нові збережені заміри автоматично уточнюють опорні дані. Прогнози й позичені значення мають відповідні позначки джерел.\n`;
writeFileSync(new URL('../docs/ZAVOD-FORECAST-CHECK.md',import.meta.url),md);
console.log(JSON.stringify({comparison,modelWorkingSpeed:result.modelWorkingSpeed,borrowedFrom:result.borrowedFrom},null,2));
