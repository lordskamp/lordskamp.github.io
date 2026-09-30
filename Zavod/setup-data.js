import { CATALOG_OPTIONS, optionFor, referenceCard, baseFor, practicalFor } from './catalog-base.js';
import { RECIPES } from './data.js';
import { SOURCE_ANNOTATIONS } from './reference-data.js';
import { forecastFor } from './forecast.js';
import { number } from './core.js';

export const VALUE_LABELS = { practical: 'Практичні', reference: 'Довідкові', forecast: 'Прогнозовані' };
const metric = row => ({
  extruder1: number(row?.extruder1), extruder2: number(row?.extruder2), workingSpeed: number(row?.maxSpeed),
  dorn: number(row?.dorn), matrix: number(row?.matrix), sikoraWire: number(row?.sikoraWire), sikoraOuter: number(row?.sikoraOuter),
});
export function speedStages(workingSpeed, source) {
  const working = number(workingSpeed);
  return { first: 20, second: working === null ? null : Math.round(working / 2), working, source };
}

export function setupFor(optionId, section, catalog) {
  const option = optionFor(optionId), card = referenceCard(option), row = card.rows.find(row => row.section === Number(section));
  const base = baseFor(option.id, section), stored = practicalFor(option.id, section, catalog);
  const practical = metric(stored);
  const ambiguousPv3 = option.practicalCableId === 'pv3' && stored.origin !== 'measurement' && stored.mode !== 'single';
  if (ambiguousPv3) { practical.extruder1 = null; practical.extruder2 = null; practical.workingSpeed = null; }
  const reference = { extruder1: row.rpm1, extruder2: row.rpm2, workingSpeed: row.maxSpeed,
    dorn: row.dornText ?? row.dorn, matrix: row.matrixText ?? row.matrix, sikoraWire: null, sikoraOuter: null };
  const annotations = SOURCE_ANNOTATIONS.filter(annotation => annotation[0] === card.source && annotation[2] === Number(section) && (annotation[1] === option.brand || annotation[1] === 'ПВС / ШВВП' && ['ПВС','ШВВП'].includes(option.brand)));
  const practicalSources = new Set(Object.values(practical).some(value => value != null) ? [stored.source] : []);
  for (const annotation of annotations) {
    const key = annotation[3] === 'Дорн, мм' ? 'dorn' : annotation[3] === 'Діаметр жили, мм' ? 'sikoraWire' : null;
    if (key && practical[key] == null && typeof annotation[4] === 'number') { practical[key] = annotation[4]; practicalSources.add(annotation[0]); }
  }
  const handwrittenAnnotation = annotations.find(annotation => annotation[3].startsWith('Шнек'));
  if (handwrittenAnnotation && stored.origin !== 'measurement') {
    [practical.extruder1, practical.extruder2] = String(handwrittenAnnotation[4]).split('/').map(number);
    practicalSources.add(handwrittenAnnotation[0]);
  }
  const mode = stored.origin === 'measurement' ? stored.mode : handwrittenAnnotation ? 'dual' : ambiguousPv3 ? 'single' : stored.mode !== 'unknown' ? stored.mode : option.mode ?? 'unknown';
  const all = catalog?.recipes ?? RECIPES;
  // Keep only the newest applied record per base; never count colour duplicates as new anchors.
  const anchors = [...new Map([...all].sort((a,b) => String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? ''))).map(record => [(record.baseId || record.id), record])).values()];
  const direct = anchors.filter(record => record.cableId === option.id).map(record => ({ ...record, referenceCardId: card.id }));
  const forecast = forecastFor(card, row, [...anchors.filter(record => record.cableId !== option.id), ...direct], { mode: mode === 'unknown' ? undefined : mode, cableId: option.brand === '(H)05VV-F' && card.id === 'ysly-shared' ? 'ysly' : option.practicalCableId });
  if (practical.workingSpeed != null && forecast.workingSpeed > 0) {
    for (const key of ['extruder1', 'extruder2']) if (forecast[key] != null) forecast[key] = Math.round(forecast[key] * practical.workingSpeed / forecast.workingSpeed);
  }
  // A calculated nominal model must not compete with an already measured value.
  for (const key of ['extruder1', 'extruder2', 'workingSpeed']) if (practical[key] != null) forecast[key] = null;
  if (practical.sikoraOuter == null && number(practical.matrix ?? reference.matrix) !== null) forecast.sikoraOuter = Math.round((number(practical.matrix ?? reference.matrix) + .15) * 100) / 100;
  const effective = {}, sources = {};
  for (const key of Object.keys(reference)) {
    const predicted = key === 'workingSpeed' ? forecast.workingSpeed : forecast[key];
    const choices = [['practical', practical[key]], ['forecast', predicted], ['reference', reference[key]]];
    const chosen = choices.find(([,value]) => value !== null && value !== undefined && value !== '');
    sources[key] = chosen?.[0] ?? null; effective[key] = chosen?.[1] ?? null;
  }
  return { option, card, row, base, stored, practical, practicalSources: [...practicalSources].filter(Boolean), reference, forecast, effective, sources,
    mode: mode === 'unknown' ? forecast.mode ?? 'unknown' : mode,
    stages: speedStages(effective.workingSpeed, sources.workingSpeed), ambiguousPv3 };
}

export function tableSetups(catalog, selected = '') {
  return CATALOG_OPTIONS.filter(option => !selected || option.id === selected).flatMap(option => option.sections.map(section => setupFor(option.id, section, catalog)));
}
