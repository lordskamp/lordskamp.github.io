import { CATALOG_OPTIONS } from './catalog-options.js?v=27';
import { COLORS } from './core.js?v=29';
import { parseJobLengths } from './planner.js?v=34';

// The printed total is a cross-check, not another drum.
export function photoLengthStatus(lengthsText, totalText) {
  const lengths = parseJobLengths(String(lengthsText ?? ''));
  const suppliedTotal = String(totalText ?? '').trim();
  const printed = suppliedTotal ? parseJobLengths(suppliedTotal) : null;
  if (!String(lengthsText ?? '').trim()) return { warning: true, message: suppliedTotal ? 'Вкажи довжини барабанів і звір із сумою на фото.' : 'Вкажи довжину кожного барабана.' };
  if (lengths.errors.length || !lengths.lengths.length) return { warning: true, message: 'Перевір довжини барабанів.' };
  const sum = lengths.lengths.reduce((a, b) => a + b, 0);
  const formatted = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 }).format(sum / 1000);
  const text = 'Разом: ' + formatted + ' км на кожен колір';
  if (printed && (printed.errors.length || printed.lengths.length !== 1)) return { warning: true, message: text + ' · перевір суму з фото.' };
  if (printed && printed.lengths[0] !== sum) return { warning: true, message: text + ' · не збігається із сумою на фото.' };
  return { warning: false, message: text + (printed ? ' · збігається з фото' : '') };
}
// Vision output is untrusted: never silently select a cable, colour or length.
export function photoRowsToJobs(rows, makeId = () => crypto.randomUUID()) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) return { jobs: [], errors: ['Немає рядків завдання або їх забагато.'] };
  const jobs = [], errors = [];
  rows.forEach((row, i) => {
    const label = `Рядок ${i + 1}`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push(`${label}: перевір дані.`); return; }
    const option = CATALOG_OPTIONS.find(item => item.id === row.cableId);
    const notation = typeof row.section === 'string' ? row.section.trim().match(/^(\d+(?:[.,]\d+)?)\s*\/\s*([1-6])$/) : null;
    const section = Number(notation ? notation[1].replace(',', '.') : String(row.section ?? '').replace(',', '.'));
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
    const writtenClass = notation ? Number(notation[2]) : null;
    const coreClass = row.coreClass === null || row.coreClass === undefined || row.coreClass === '' ? writtenClass : Number(row.coreClass);
    if (writtenClass !== null && coreClass !== writtenClass) errors.push(`${label}: клас жили не збігається з позначенням перерізу.`);
    if (coreClass !== null && ![1, 2, 3, 4, 5, 6].includes(coreClass)) errors.push(`${label}: уточни клас жили.`);
    if (row.uncertain === true) errors.push(`${label}: перевір нерозбірливий запис.`);
    if (option) jobs.push({ id: makeId(), cableId: option.id, section, colors, cores: colors.length, lengthsText,
      ...(coreClass !== null ? { coreClass } : {}), ...(row.idealColor === true ? { idealColor: true } : {}), ...(row.marking === true ? { marking: true } : {}), urgent: false, batchSize: 3 });
  });
  return { jobs: errors.length ? [] : jobs, errors };
}
