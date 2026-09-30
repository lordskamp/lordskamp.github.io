import { CATALOG_OPTIONS, optionFor, referenceCard, baseFor, practicalFor } from './catalog-base.js?v=9';
import { RECIPES } from './data.js';
import { SOURCE_ANNOTATIONS } from './reference-data.js?v=9';
import { forecastFor } from './forecast.js?v=9';
import { number, secondSpeed, fmt } from './core.js?v=9';
import { hasPv3Modes, pv3Mode, operatingRecords } from './pv3-modes.js?v=9';

export const VALUE_LABELS = { practical: 'Практичні', reference: 'Довідкові', forecast: 'Прогнозовані' };
const metric = row => ({
  extruder1: number(row?.extruder1), extruder2: number(row?.extruder2), workingSpeed: number(row?.maxSpeed),
  dorn: number(row?.dorn), matrix: number(row?.matrix), sikoraWire: number(row?.sikoraWire), sikoraOuter: number(row?.sikoraOuter),
});
export function speedStages(workingSpeed, source) {
  const working = number(workingSpeed);
  return { first: 20, second: secondSpeed(working), working, source };
}

export function metricValues(info, key) {
  const nominal = key === 'sikoraWire' ? info.row.wireNom : key === 'sikoraOuter' ? info.row.outerNom : null;
  const reference = info.reference[key] ?? nominal ?? null;
  const referenceLabel = info.reference[key] == null && nominal != null ? 'Довідкові · номінальний' : VALUE_LABELS.reference;
  const source = info.sources[key] ?? 'reference';
  const adjustedRpm = ['extruder1','extruder2'].includes(key) && info.practical.workingSpeed != null && info.forecast.workingSpeed != null && info.practical.workingSpeed !== info.forecast.workingSpeed;
  const mainLabel = source === 'reference' ? referenceLabel : source === 'forecast' && adjustedRpm ? `Прогнозовані · для ${fmt(info.practical.workingSpeed)} м/хв` : VALUE_LABELS[source];
  const main = { source, value: source === 'reference' ? reference : info.effective[key], label: mainLabel };
  const forecastLabel = adjustedRpm ? `Прогнозовані · для ${fmt(info.forecast.workingSpeed)} м/хв` : VALUE_LABELS.forecast;
  return [main,
    ...(source === 'reference' ? [] : [{ source: 'reference', value: reference, label: referenceLabel }]),
    ...(source === 'forecast' && main.value === info.forecast[key] || info.forecast[key] == null ? [] : [{ source: 'forecast', value: info.forecast[key], label: forecastLabel }]),
  ].map((item, index) => ({ ...item, confirmed: index > 0 && info.practical[key] != null && item.value === info.practical[key] && !(item.source === 'forecast' && adjustedRpm) }));
}

export function setupFor(optionId, section, catalog, color = 'blue') {
  const option = optionFor(optionId), card = referenceCard(option), row = card.rows.find(row => row.section === Number(section));
  const selectedMode = hasPv3Modes(option) ? pv3Mode(color) : undefined;
  const base = baseFor(option.id, section), stored = practicalFor(option.id, section, catalog, selectedMode);
  const practical = metric(stored);
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
  const mode = selectedMode ?? (stored.origin === 'measurement' ? stored.mode : handwrittenAnnotation ? 'dual' : stored.mode !== 'unknown' ? stored.mode : option.mode ?? 'unknown');
  const all = operatingRecords([...RECIPES.filter(record => record.cableId === 'pv3'), ...(catalog?.recipes ?? RECIPES)]);
  // Keep modes independent, but never count colour duplicates as new anchors.
  const anchors = [...new Map([...all].sort((a,b) => String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? ''))).map(record => [`${record.baseId || record.id}:${record.mode}`, record])).values()];
  const direct = anchors.filter(record => record.cableId === option.id).map(record => ({ ...record, referenceCardId: card.id }));
  const forecast = forecastFor(card, row, [...anchors.filter(record => record.cableId !== option.id), ...direct], { mode: mode === 'unknown' ? undefined : mode, cableId: option.brand === '(H)05VV-F' && card.id === 'ysly-shared' ? 'ysly' : option.practicalCableId });
  // Keep estimates available for comparison; effective values still prefer practice.
  if (number(practical.matrix ?? reference.matrix) !== null) forecast.sikoraOuter = Math.round((number(practical.matrix ?? reference.matrix) + .15) * 100) / 100;
  const effective = {}, sources = {};
  for (const key of Object.keys(reference)) {
    const predicted = key === 'workingSpeed' ? forecast.workingSpeed : forecast[key];
    const choices = [['practical', practical[key]], ['forecast', predicted], ['reference', reference[key]]];
    const chosen = choices.find(([,value]) => value !== null && value !== undefined && value !== '');
    sources[key] = chosen?.[0] ?? null; effective[key] = chosen?.[1] ?? null;
    if (sources[key] === 'forecast' && ['extruder1','extruder2'].includes(key) && practical.workingSpeed != null && forecast.workingSpeed > 0) effective[key] = Math.round(effective[key] * practical.workingSpeed / forecast.workingSpeed);
  }
  return { option, card, row, base, stored, practical, practicalSources: [...practicalSources].filter(Boolean), reference, forecast, effective, sources,
    mode: mode === 'unknown' ? forecast.mode ?? 'unknown' : mode,
    stages: speedStages(effective.workingSpeed, sources.workingSpeed) };
}

export function tableSetups(catalog, selected = '') {
  return CATALOG_OPTIONS.filter(option => !selected || option.id === selected).flatMap(option => option.sections.flatMap(section =>
    (hasPv3Modes(option) ? ['blue', 'yellow-green'] : ['blue']).map(color => setupFor(option.id, section, catalog, color))));
}
