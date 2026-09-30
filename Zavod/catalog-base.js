import { CATALOG_OPTIONS } from './catalog-options.js';
import { RECIPES } from './data.js';
import { REFERENCE_CARDS } from './reference-data.js';

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

export function practicalFor(optionId, section, catalog) {
  const base = baseFor(optionId, section);
  if (!base) return null;
  const rows = (catalog?.recipes ?? []).filter(row => (row.baseId || row.id) === base.id);
  // Colours affect the dye only. Applied measurements take priority for every colour.
  const latest = rows.filter(row => row.origin === 'measurement').sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) || b.revision - a.revision)[0];
  return latest ?? rows.find(row => row.color === 'all') ?? { ...base, baseId: base.id, color: 'all', origin: 'handwritten', revision: 0 };
}
