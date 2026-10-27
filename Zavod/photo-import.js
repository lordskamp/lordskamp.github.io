import { CATALOG_OPTIONS } from './catalog-options.js?v=27';
import { COLORS } from './core.js?v=29';
import { parseJobLengths } from './planner.js?v=34';

// Vision output is untrusted: never silently select a cable, colour or length.
export function photoRowsToJobs(rows, makeId = () => crypto.randomUUID()) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) return { jobs: [], errors: ['Немає рядків завдання або їх забагато.'] };
  const jobs = [], errors = [];
  rows.forEach((row, i) => {
    const label = `Рядок ${i + 1}`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push(`${label}: перевір дані.`); return; }
    const option = CATALOG_OPTIONS.find(item => item.id === row.cableId);
    const section = Number(row.section);
    const colors = Array.isArray(row.colors) ? row.colors : [];
    const lengthsText = typeof row.lengthsText === 'string' ? row.lengthsText.trim() : '';
    const parsed = parseJobLengths(lengthsText);
    if (!option || option.coreKind === 'thread' || !option.sections.includes(section)) errors.push(`${label}: уточни марку і переріз.`);
    if (!colors.length || colors.some(color => !COLORS.some(item => item.id === color)) || new Set(colors).size !== colors.length) errors.push(`${label}: уточни кольори.`);
    if (parsed.errors.length || !parsed.lengths.length) errors.push(`${label}: уточни довжини барабанів.`);
    if (row.totalKm !== null && row.totalKm !== undefined && String(row.totalKm).trim() !== '') {
      const total = parseJobLengths(String(row.totalKm));
      if (total.errors.length || total.lengths.length !== 1 || total.lengths[0] !== parsed.lengths.reduce((a, b) => a + b, 0)) errors.push(`${label}: загальна довжина не збігається з частинами.`);
    }
    const coreClass = row.coreClass === null || row.coreClass === undefined || row.coreClass === '' ? null : Number(row.coreClass);
    if (coreClass !== null && ![1, 2, 3, 4, 5, 6].includes(coreClass)) errors.push(`${label}: уточни клас жили.`);
    if (row.uncertain === true) errors.push(`${label}: перевір нерозбірливий запис.`);
    if (option) jobs.push({ id: makeId(), cableId: option.id, section, colors, cores: colors.length, lengthsText,
      ...(coreClass !== null ? { coreClass } : {}), urgent: false, batchSize: 3 });
  });
  return { jobs: errors.length ? [] : jobs, errors };
}
