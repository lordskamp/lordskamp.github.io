import { number, positive } from './core.js?v=27';

// Operator's approximate advance for EXTRUDER 2, confirmed 19.10.2026.
// No screw RPM or line speeds were supplied for these anchors: do not turn
// them into invented residence-time calibrations or apply them to extruder 1.
export const COLOR_LEAD2_ANCHORS = Object.freeze([
  ...[[1, 1900], [1.5, 1600], [2.5, 1200]].map(([section, lead]) => Object.freeze({ conductorClass: 5, section, lead })),
  ...[[1.5, 1900], [2.5, 1600]].map(([section, lead]) => Object.freeze({ conductorClass: 1, section, lead })),
]);

const empty = reason => ({ value: null, extruder: 2, method: null, source: null, confidence: null, approximate: true, anchors: [], reason });

/** Approximate class/section rule; an exact practical value always wins. */
export function estimateColorLead2({ conductorClass, section, mode = 'dual', coreKind = 'metal', noDye = false, practicalLead = null } = {}) {
  if (coreKind === 'thread' || noDye || mode !== 'dual') return empty('Другий екструдер не подає барвник у цьому режимі.');
  const exact = number(practicalLead);
  if (exact !== null && exact >= 0) return { value: exact, extruder: 2, method: 'measured-value', source: 'practical',
    confidence: 'high', approximate: false, anchors: [], reason: null };
  const target = positive(section), grade = number(conductorClass);
  const anchors = COLOR_LEAD2_ANCHORS.filter(anchor => anchor.conductorClass === grade);
  if (target === null || !anchors.length) return empty('Немає приблизного орієнтира зміни барвника для цього класу жили.');
  const anchor = anchors.find(row => row.section === target);
  if (anchor) return { value: anchor.lead, extruder: 2, method: 'operator-anchor', source: 'forecast', confidence: 'low',
    approximate: true, anchors: [anchor], reason: 'Приблизний орієнтир оператора, перевір за кольором у ванні.' };
  const low = [...anchors].reverse().find(row => row.section < target), high = anchors.find(row => row.section > target);
  if (!low || !high) return { ...empty('Переріз поза діапазоном приблизних орієнтирів. Потрібен замір випередження для цього режиму.'), anchors };
  // Section is the equivalent conductor area. Interpolation is only an
  // empirical hint between the supplied anchors, not a polymer-flow model.
  const weight = (target - low.section) / (high.section - low.section);
  return { value: Math.round(low.lead + (high.lead - low.lead) * weight), extruder: 2, method: 'operator-interpolation',
    source: 'forecast', confidence: 'low', approximate: true, anchors: [low, high],
    reason: 'Приблизно між орієнтирами оператора; фактичний перехід перевір за кольором у ванні.' };
}

/**
 * Rough residence scaling for an ACTUAL lead/RPM/speed measurement.
 * If hold-up and output per turn are unchanged, time ∝ 1/RPM and metres ∝
 * V/RPM. Pigment, viscosity, temperature and stagnant flow can break this
 * approximation; neither source anchors nor unknown RPM are fabricated here.
 * Manufacturer's discussion of colour/purge dependence:
 * https://davis-standard.com/custom_blog/essential-feedscrew-and-barrel-maintenance-iii-purging-part-1-of-3/
 */
export function scaleColorLead({ lead, baseSpeed, baseRpm, speed, rpm, sameMaterial = false, sameExtruder = false } = {}) {
  const original = number(lead), v0 = positive(baseSpeed), n0 = positive(baseRpm), v = positive(speed), n = positive(rpm);
  if (sameMaterial !== true || sameExtruder !== true) return { value: null, method: null, confidence: null,
    approximate: true, reason: 'Перерахунок потребує того самого матеріалу й екструдера.' };
  if (original === null || original < 0 || [v0, n0, v, n].some(value => value === null)) return { value: null, method: null,
    confidence: null, approximate: true, reason: 'Потрібні фактичне випередження, оберти та швидкості початкового й нового режимів.' };
  const value = original * (v / v0) * (n0 / n);
  if (!Number.isFinite(value)) return { value: null, method: null, confidence: null, approximate: true, reason: 'Перевір оберти та швидкості.' };
  return { value: Math.round(value), method: 'residence-speed-rpm', confidence: 'low', approximate: true,
    reason: 'Приблизний перерахунок за відношенням швидкості лінії до обертів. Перевір фактичний вихід кольору.' };
}
