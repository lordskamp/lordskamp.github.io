import { CATALOG_OPTIONS, optionFor, referenceCard, baseFor, practicalFor } from './catalog-base.js?v=23';
import { RECIPES } from './data.js';
import { SOURCE_ANNOTATIONS } from './reference-data.js?v=23';
import { forecastFor } from './forecast.js?v=23';
import { number, firstSpeed, secondSpeed, limitPredictedExtruder2, MAX_EXTRUDER_RPM_DIFFERENCE } from './core.js?v=23';
import { hasPv3Modes, modeFor, supportsSingleColorMode } from './pv3-modes.js?v=23';

export const VALUE_LABELS = { practical: 'Практичні', reference: 'Довідкові', forecast: 'Прогнозовані', manual: 'Орієнтовно · за твоєю швидкістю' };
const metric = row => ({
  extruder1: number(row?.extruder1), extruder2: number(row?.extruder2), workingSpeed: number(row?.maxSpeed),
  dorn: number(row?.dorn), matrix: number(row?.matrix), sikoraWire: number(row?.sikoraWire), sikoraOuter: number(row?.sikoraOuter),
  colorLead1: number(row?.colorLead1), colorLead2: number(row?.colorLead2),
});
export function speedStages(workingSpeed, source) {
  const working = number(workingSpeed);
  return { first: firstSpeed(working), second: secondSpeed(working), working, source };
}

export function metricValues(info, key) {
  const nominal = key === 'sikoraWire' ? info.row.wireNom : key === 'sikoraOuter' ? info.row.outerNomText ?? info.row.outerNom : null;
  const reference = info.reference[key] ?? nominal ?? null;
  const referenceLabel = info.reference[key] == null && nominal != null ? 'Довідкові · номінальний діаметр' : VALUE_LABELS.reference;
  const source = info.sources[key] ?? 'reference';
  const mainLabel = source === 'reference' ? referenceLabel : VALUE_LABELS[source];
  const main = { source, value: source === 'reference' ? reference : info.effective[key], label: mainLabel };
  const forecastLabel = VALUE_LABELS.forecast;
  return [main,
    ...(source === 'reference' || reference == null ? [] : [{ source: 'reference', value: reference, label: referenceLabel }]),
    ...(source === 'forecast' && main.value === info.forecast[key] || info.forecast[key] == null ? [] : [{ source: 'forecast', value: info.forecast[key], label: forecastLabel }]),
  ].map((item, index) => ({ ...item, confirmed: index > 0 && info.practical[key] != null && item.value === info.practical[key] }));
}

export function setupFor(optionId, section, catalog, color = 'blue', options = {}) {
  const option = optionFor(optionId), card = referenceCard(option), row = card.rows.find(row => row.section === Number(section));
  const base = baseFor(option.id, section);
  const ownRecords = [...(catalog?.recipes ?? []), ...(catalog?.calibrations ?? [])].filter(record => !record.deletedAt && !record.withdrawnAt && (!record.optionId || record.optionId === option.id)
    && (record.optionId === option.id || record.cableId === option.id || option.practicalCableId && record.cableId === option.practicalCableId));
  const measured = ownRecords.filter(record => record.origin === 'measurement' && ['single', 'dual'].includes(record.mode))
    .sort((a, b) => Number(b.section === Number(section)) - Number(a.section === Number(section)) || Number(Boolean(b.optionId)) - Number(Boolean(a.optionId))
      || String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')) || Number(b.revision ?? 0) - Number(a.revision ?? 0))[0];
  const normalMode = option.mode !== 'unknown' ? option.mode : ownRecords.some(record => record.origin === 'measurement' && record.mode === 'single') ? 'single' : measured?.mode ?? base.mode;
  const selectedMode = ['single', 'dual'].includes(options.mode) ? options.mode : modeFor(option, color, normalMode);
  const stored = practicalFor(option.id, section, catalog, selectedMode === 'unknown' ? undefined : selectedMode, color);
  const practical = metric(stored);
  const annotations = SOURCE_ANNOTATIONS.filter(annotation => annotation[0] === card.source && annotation[2] === Number(section) && (annotation[1] === option.brand || annotation[1] === 'ПВС / ШВВП' && ['ПВС','ШВВП'].includes(option.brand)));
  const handwrittenAnnotation = annotations.find(annotation => annotation[3].startsWith('Шнек'));
  const reference = { extruder1: row.rpm1, extruder2: row.rpm2, workingSpeed: row.maxSpeed,
    dorn: row.dornText ?? row.dorn, matrix: row.matrixText ?? row.matrix, sikoraWire: null, sikoraOuter: null, colorLead1: null, colorLead2: null };
  // A source with an established extruder mode cannot supply operating values
  // for a different mode. PV3's source has separately confirmed single/dual rows.
  const sourceMode = option.referenceMode ?? option.mode;
  const referenceMode = hasPv3Modes(option) ? selectedMode : sourceMode !== 'unknown' ? sourceMode
    : handwrittenAnnotation || number(row.rpm2) > 0 ? 'dual' : base.cableId === option.id ? sourceMode : base.mode;
  if (['single', 'dual'].includes(selectedMode) && ['single', 'dual'].includes(referenceMode) && selectedMode !== referenceMode) {
    reference.extruder1 = null; reference.extruder2 = null; reference.workingSpeed = null;
  }
  const practicalSources = new Set(Object.values(practical).some(value => value != null) ? [stored.source] : []);
  for (const annotation of annotations) {
    const key = annotation[3] === 'Дорн, мм' ? 'dorn' : annotation[3] === 'Діаметр жили, мм' ? 'sikoraWire' : null;
    if (key && practical[key] == null && typeof annotation[4] === 'number') { practical[key] = annotation[4]; practicalSources.add(annotation[0]); }
  }
  if (handwrittenAnnotation && stored.origin !== 'measurement' && selectedMode !== 'single') {
    [practical.extruder1, practical.extruder2] = String(handwrittenAnnotation[4]).split('/').map(number);
    practicalSources.add(handwrittenAnnotation[0]);
  }
  const mode = selectedMode !== 'unknown' ? selectedMode : stored.origin === 'measurement' ? stored.mode : handwrittenAnnotation ? 'dual' : stored.mode !== 'unknown' ? stored.mode : option.mode ?? 'unknown';
  // A supported admin speed curve is the production setting. The printed
  // maximum remains a comparison value and must not multiply a learned RPM
  // curve to an unrelated speed between the measured sections.
  const learnedSpeedCurve = new Set(ownRecords.filter(record => record.origin === 'measurement' && !record.retired
    && record.mode === mode && number(record.maxSpeed) > 0).map(record => Number(record.section))).size >= 2;
  const forecastRecords = [...RECIPES, ...(catalog?.recipes ?? []), ...(catalog?.calibrations ?? [])];
  const forecastOptions = { optionId: option.id, mode: mode === 'unknown' ? undefined : mode,
    normalMode, color, workingSpeed: practical.workingSpeed ?? (learnedSpeedCurve ? null : reference.workingSpeed), matrix: number(practical.matrix ?? reference.matrix),
    cableId: option.brand === '(H)05VV-F' && card.id === 'ysly-shared' ? 'ysly' : option.practicalCableId };
  let forecast = forecastFor(card, row, forecastRecords, forecastOptions);
  // An equally compatible measured donor curve is also a production speed
  // basis. Do not inflate its RPM back to a printed nominal maximum.
  if (!learnedSpeedCurve && practical.workingSpeed == null && forecast.calibratedSpeedCurve) {
    forecast = forecastFor(card, row, forecastRecords, { ...forecastOptions, workingSpeed: null });
  }
  const calibratedOperatingCurve = learnedSpeedCurve || forecast.calibratedSpeedCurve;
  const effective = {}, sources = {};
  for (const key of Object.keys(reference)) {
    const predicted = key === 'workingSpeed' ? forecast.workingSpeed : forecast[key];
    // A catalogue's nominal outside diameter is a comparison dimension, not
    // the SIKORA setting above the selected matrix. Flat paired dimensions
    // remain their original reference text instead of a circular estimate.
    const nominal = key === 'sikoraWire' ? row.wireNom : key === 'sikoraOuter' ? row.outerNomText : null;
    const operating = ['extruder1', 'extruder2', 'workingSpeed'].includes(key);
    const choices = calibratedOperatingCurve && operating
      ? [['practical', practical[key]], ['forecast', predicted], ['reference', reference[key] ?? nominal]]
      : [['practical', practical[key]], ['reference', reference[key] ?? nominal], ['forecast', predicted]];
    const chosen = choices.find(([,value]) => value !== null && value !== undefined && value !== '');
    sources[key] = chosen?.[0] ?? null; effective[key] = chosen?.[1] ?? null;
  }
  // The effective main RPM can be an exact practical/reference value while
  // the second RPM is estimated. Apply the estimate-only bound to that final
  // pair too; keep recorded second-extruder values untouched.
  if (sources.extruder2 === 'forecast' && number(effective.extruder1) > 0 && number(effective.extruder2) > number(effective.extruder1) + MAX_EXTRUDER_RPM_DIFFERENCE) {
    forecast.rpmLimit = { key: 'extruder2', original: effective.extruder2, maximumDifference: MAX_EXTRUDER_RPM_DIFFERENCE };
    effective.extruder2 = Math.round(limitPredictedExtruder2(effective.extruder1, effective.extruder2) * 10) / 10;
    forecast.extruder2 = effective.extruder2;
    if (!forecast.fieldMethods.extruder2.endsWith('-limited-gap')) forecast.fieldMethods.extruder2 += '-limited-gap';
    forecast.fieldConfidence.extruder2 = 'low';
    forecast.confidence = 'low';
  }
  const rpmConflict = number(effective.extruder1) > 0 && number(effective.extruder2) > number(effective.extruder1) + MAX_EXTRUDER_RPM_DIFFERENCE
    ? { first: number(effective.extruder1), second: number(effective.extruder2), difference: Math.round((number(effective.extruder2) - number(effective.extruder1)) * 10) / 10,
      sources: [sources.extruder1, sources.extruder2] } : null;
  return { option, card, row, base, stored, practical, practicalSources: [...practicalSources].filter(Boolean), reference, forecast, effective, sources, rpmConflict,
    mode: mode === 'unknown' ? forecast.mode ?? 'unknown' : mode, normalMode, color,
    stages: speedStages(effective.workingSpeed, sources.workingSpeed) };
}

export function tableSetups(catalog, selected = '') {
  return CATALOG_OPTIONS.filter(option => !selected || option.id === selected).flatMap(option => option.sections.flatMap(section => {
    const standard = setupFor(option.id, section, catalog, supportsSingleColorMode(option) ? 'brown' : 'blue');
    const modes = new Set([standard.mode]);
    if (supportsSingleColorMode(option) || hasPv3Modes(option) || standard.mode === 'single') modes.add('dual');
    for (const record of [...(catalog?.recipes ?? []), ...(catalog?.calibrations ?? [])]) {
      if (record.origin === 'measurement' && !record.deletedAt && record.section === section && ['single', 'dual'].includes(record.mode)
          && (record.optionId === option.id || !record.optionId && (record.cableId === option.id || record.cableId === option.practicalCableId))) modes.add(record.mode);
    }
    if (modes.size > 1) modes.delete('unknown');
    return [...modes].map(mode => mode === standard.mode ? standard : setupFor(option.id, section, catalog,
      mode === 'single' ? 'brown' : supportsSingleColorMode(option) ? 'blue' : 'black', {mode}));
  }));
}
