import { CATALOG_OPTIONS } from './catalog-options.js?v=9';
import { RECIPES } from './data.js';
import { REFERENCE_CARDS } from './reference-data.js?v=9';
import { hasPv3Modes, pv3Recipe } from './pv3-modes.js?v=9';

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
    extruder1: null, extruder2: null, maxSpeed: null, colorLead2: null,
    mode: option.mode ?? 'unknown', source: referenceCard(option).source,
    notes: [], uncertain: [],
  };
}

// Preserve the identifiers of existing measurements and add new reference-based bases.
export const CATALOG_BASES = [...new Map([
  ...RECIPES,
  ...CATALOG_OPTIONS.flatMap(option => option.sections.map(section => baseFor(option.id, section))),
].map(base => [base.id, base])).values()];

export const measurementColor = (optionId, mode) => hasPv3Modes(optionFor(optionId)) && mode === 'dual' ? 'yellow-green' : 'all';

export function practicalFor(optionId, section, catalog, mode) {
  const splitModes = hasPv3Modes(optionFor(optionId)) && mode;
  const base = baseFor(optionId, section);
  if (!base) return null;
  const rows = (catalog?.recipes ?? []).filter(row => (row.baseId || row.id) === base.id);
  // PV3 has separate single/dual measurements. Other colours share one setup.
  const latest = rows.filter(row => row.origin === 'measurement' && (!splitModes || row.mode === mode)).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) || b.revision - a.revision)[0];
  if (latest) return latest;
  const original = rows.find(row => row.origin !== 'measurement' && row.color === 'all') ?? { ...base, baseId: base.id, color: 'all', origin: 'handwritten', revision: 0 };
  return splitModes ? pv3Recipe(original, mode) : original;
}
