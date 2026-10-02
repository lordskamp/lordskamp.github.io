import { CATALOG_OPTIONS } from './catalog-options.js?v=20';
import { RECIPES } from './data.js';
import { REFERENCE_CARDS } from './reference-data.js?v=20';
import { hasPv3Modes, pv3Recipe, modeFor } from './pv3-modes.js?v=20';

export { CATALOG_OPTIONS };
export const CATALOG_CABLES = CATALOG_OPTIONS;
const canonical = { vvg: 'ВВГ', 'vvgng-p': 'ВВГнг-П', pv1: 'ПВ1', pv3: 'ПВ3', ysly: 'YSLY', 'h05vv-f': 'H05VV-F', 'pvs-shvvp': 'ПВС' };
export const optionFor = id => CATALOG_OPTIONS.find(option => option.id === id) ?? CATALOG_OPTIONS.find(option => option.practicalCableId === id && option.brand === canonical[id]) ?? CATALOG_OPTIONS.find(option => option.practicalCableId === id);
export const referenceCard = option => REFERENCE_CARDS.find(card => card.id === option.cardId);

export function baseFor(optionId, section) {
  const option = optionFor(optionId);
  if (!option || !option.sections.includes(Number(section))) return null;
  const old = RECIPES.find(row => row.cableId === option.practicalCableId && row.section === Number(section));
  // DRAW_6 names H05VV-F specifically; it is not a measurement of (H)05VV-F.
  if (old && !(option.brand === '(H)05VV-F' && old.source === 'DRAW_6.JPG')) return old;
  return {
    id: `${option.id}-${String(section).replace('.', '-')}`, cableId: option.id, section: Number(section),
    dorn: null, matrix: null, sikoraWire: null, sikoraOuter: null,
    extruder1: null, extruder2: null, maxSpeed: null, colorLead1: null, colorLead2: null,
    mode: option.mode ?? 'unknown', source: referenceCard(option).source,
    notes: [], uncertain: [],
  };
}

// Preserve the identifiers of existing measurements and add new reference-based bases.
export const CATALOG_BASES = [...new Map([
  ...RECIPES,
  ...CATALOG_OPTIONS.flatMap(option => option.sections.map(section => baseFor(option.id, section))),
].map(base => [base.id, base])).values()];

export const recipeIdFor = (baseId, color = 'all', optionId, mode) => `${optionId ? `${optionId}::` : ''}${baseId}${mode ? `~${mode}` : color === 'all' ? '' : `~${color}`}`;

// Kept as the shared form/API helper: measurements belong to an extruder mode,
// while the selected colour only determines which mode the operator needs.
export const measurementColor = () => 'all';

export function practicalFor(optionId, section, catalog, mode, color = 'blue') {
  const option = optionFor(optionId);
  const base = baseFor(optionId, section);
  if (!base) return null;
  const applied = [...(catalog?.recipes ?? []), ...(catalog?.calibrations ?? [])].filter(row => !row.deletedAt && !row.withdrawnAt);
  const rows = applied.filter(row => (row.baseId || row.id) === base.id && (!row.optionId || row.optionId === option.id));
  const byLatest = (a, b) => Number(Boolean(b.optionId)) - Number(Boolean(a.optionId)) || String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')) || Number(b.revision ?? 0) - Number(a.revision ?? 0);
  const latestMode = applied.filter(row => row.origin === 'measurement' && !row.deletedAt && ['single', 'dual'].includes(row.mode)
    && (row.optionId === option.id || !row.optionId && (row.cableId === option.id || row.cableId === option.practicalCableId)))
    .sort((a, b) => Number(b.section === Number(section)) - Number(a.section === Number(section)) || byLatest(a, b))[0];
  const normalMode = option.mode !== 'unknown' ? option.mode : applied.some(row => row.origin === 'measurement' && !row.deletedAt && row.mode === 'single'
    && (row.optionId === option.id || !row.optionId && (row.cableId === option.id || row.cableId === option.practicalCableId))) ? 'single' : latestMode?.mode ?? base.mode;
  const desiredMode = mode ?? modeFor(option, color, normalMode);
  const candidates = rows.filter(row => row.origin === 'measurement' && (!['single', 'dual'].includes(desiredMode) || row.mode === desiredMode));
  const geometryRows = rows.filter(row => row.origin === 'measurement' && (row.mode === desiredMode || row.mode === 'unknown')).sort(byLatest);
  const latest = candidates.sort(byLatest)[0] ?? geometryRows[0];
  if (latest) {
    const merged = { ...latest, mode: ['single', 'dual'].includes(desiredMode) ? desiredMode : latest.mode, color: 'all', fieldSources: {} };
    for (const key of ['extruder1', 'extruder2', 'maxSpeed', 'dorn', 'matrix', 'sikoraWire', 'sikoraOuter', 'colorLead1', 'colorLead2']) {
      const geometry = ['dorn', 'matrix', 'sikoraWire', 'sikoraOuter'].includes(key);
      const source = (geometry ? geometryRows : candidates).find(row => (row.mode === merged.mode || geometry && row.mode === 'unknown') && typeof row[key] === 'number' && Number.isFinite(row[key]) && (key.startsWith('colorLead') ? row[key] >= 0 : row[key] > 0));
      merged[key] = source?.[key] ?? null;
      if (source) merged.fieldSources[key] = { measurementId: source.measurementId ?? source.id, source: source.source, updatedAt: source.updatedAt };
    }
    return merged;
  }
  const original = rows.find(row => row.origin !== 'measurement' && row.color === 'all') ?? { ...base, baseId: base.id, color: 'all', origin: 'handwritten', revision: 0 };
  const selectedMode = desiredMode ?? modeFor(option, color, original.mode === 'unknown' ? option.mode : original.mode);
  if (hasPv3Modes(option) && selectedMode) return { ...pv3Recipe(original, selectedMode), color: 'all' };
  if (['single', 'dual'].includes(selectedMode) && selectedMode !== original.mode) {
    return { ...original, mode: selectedMode, extruder1: null, extruder2: null, maxSpeed: null, colorLead1: null, colorLead2: null };
  }
  return original;
}
