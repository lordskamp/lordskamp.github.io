import { COLORS, number, splitterFor } from './core.js';
import { dyeRequirements, dyeMode, normalizeDyeSlots, EMPTY_DYE } from './dye-slots.js';

export const MAX_DRUMS = 500;

const validColors = new Set(COLORS.map(color => color.id));
const unique = values => [...new Set(values)];
const validStatuses = new Set(['queued', 'active', 'done']);
const isThread = record => typeof record?.cableId === 'string' && record.cableId.trim() === 'thread-bundle';
const blankDiameter = value => value === null || value === undefined || typeof value === 'string' && !value.trim();
const validDiameter = value => blankDiameter(value) || (typeof value === 'number'
  || typeof value === 'string' && /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(value.trim())) && number(value) > 0;
const finalDiameter = record => isThread(record) ? number(record.finalDiameter) : null;
const sameDiameter = (a, b) => !isThread(b) || validDiameter(a?.finalDiameter) && finalDiameter(a) === finalDiameter(b);
const conductorClass = record => !isThread(record) && [1, 2, 3, 4, 5, 6].includes(number(record?.coreClass)) ? number(record.coreClass) : null;
const sameClass = (a, b) => conductorClass(a) === conductorClass(b);

/** Older saved drums without a status are still waiting in the queue. */
export function drumStatus(drum) {
  return validStatuses.has(drum?.status) ? drum.status : 'queued';
}

/** Explicit status updates are immutable; starting a drum stops the previous one. */
export function setDrumStatus(drums, id, status) {
  if (!Array.isArray(drums)) return [];
  if (!validStatuses.has(status) || typeof id !== 'string' || !id || !drums.some(drum => drum?.id === id)) return [...drums];
  return drums.map(drum => {
    if (drum?.id === id) return drumStatus(drum) === status && drum.status === status ? drum : { ...drum, status };
    if (status === 'active' && drumStatus(drum) === 'active') return { ...drum, status: 'queued' };
    return drum;
  });
}

/** Lengths are entered in kilometres; repeat counts apply to every selected color. */
export function parseJobLengths(text) {
  const input = typeof text === 'string' ? text.trim() : '';
  if (!input) return { lengths: [], errors: ['Вкажіть довжини в кілометрах, наприклад 3×15,0 + 3×15,0 + 11,0.'] };
  // Commas belong to decimal lengths, never to separators between drums.
  const parts = input.split(/[+;]|\r\n?|\n/).map(part => part.trim());
  if (parts.some(part => !part)) return { lengths: [], errors: ['Між роздільниками має бути довжина барабана.'] };
  const lengths = [];
  const errors = [];
  for (const part of parts) {
    const match = part.match(/^(?:(\d+)\s*[×xх*]\s*)?(\d+(?:[.,]\d+)?)\s*(?:км|km)?$/iu);
    if (!match) {
      errors.push(`Не вдалося прочитати «${part}». Формат: 3×15,0 + 11,0 км.`);
      continue;
    }
    const count = match[1] === undefined ? 1 : Number(match[1]);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_DRUMS || lengths.length + count > MAX_DRUMS) {
      errors.push(`Кількість барабанів одного кольору має бути від 1 до ${MAX_DRUMS}.`);
      continue;
    }
    const [whole, fraction = ''] = match[2].replace(',', '.').split('.');
    // Work in exact decimal metres: floating point rounding must never turn a
    // fractional metre into an accepted production instruction.
    if (fraction.slice(3).replace(/0/g, '')) {
      errors.push(`Довжина «${part}» має давати ціле число метрів.`);
      continue;
    }
    const metres = Number(whole) * 1000 + Number(fraction.slice(0, 3).padEnd(3, '0'));
    if (!Number.isSafeInteger(metres) || metres <= 0) {
      errors.push(`Довжина «${part}» має бути більшою за нуль і давати безпечне ціле число метрів.`);
      continue;
    }
    for (let index = 0; index < count; index++) lengths.push(metres);
  }
  if (!Number.isSafeInteger(lengths.reduce((sum, length) => sum + length, 0))) errors.push('Загальна довжина завдання завелика.');
  return { lengths: errors.length ? [] : lengths, errors: unique(errors) };
}

function validateJobs(jobs) {
  if (!Array.isArray(jobs) || !jobs.length) return { jobs: [], errors: ['Додайте хоча б одне завдання.'] };
  if (jobs.length > MAX_DRUMS) return { jobs: [], errors: [`У плані може бути не більше ${MAX_DRUMS} барабанів.`] };
  const errors = [];
  const ids = new Set();
  const validated = [];
  let count = 0;
  let totalMetres = 0;
  jobs.forEach((source, index) => {
    const prefix = `Завдання ${index + 1}: `;
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      errors.push(prefix + 'не вдалося прочитати дані.');
      return;
    }
    const id = typeof source.id === 'string' ? source.id : '';
    const cableId = typeof source.cableId === 'string' ? source.cableId.trim() : '';
    const section = number(source.section);
    // The colour is an internal queue marker for undyed thread, not another
    // strand to produce. Older saved tasks can still contain three colours.
    const thread = isThread(source);
    const colors = thread ? ['white'] : Array.isArray(source.colors) ? [...source.colors] : [];
    const cores = colors.length;
    const batchSize = source.batchSize === undefined ? 3 : number(source.batchSize);
    const diameter = finalDiameter(source);
    if (!id.trim() || ids.has(id)) errors.push(prefix + 'ідентифікатор має бути непорожнім і унікальним.');
    ids.add(id);
    if (!cableId) errors.push(prefix + 'оберіть тип кабелю.');
    if (isThread(source) && !validDiameter(source.finalDiameter)) errors.push(prefix + 'вкажіть кінцевий діаметр джгута додатним числом у мм або залиште поле порожнім.');
    if (section === null || section <= 0) errors.push(prefix + 'переріз має бути числом, більшим за нуль.');
    if (!Number.isSafeInteger(cores) || cores < 1) errors.push(prefix + 'кількість жил має бути цілим числом, більшим за нуль.');
    if (!colors.length || colors.some(color => !validColors.has(color)) || unique(colors).length !== colors.length) errors.push(prefix + 'оберіть різні відомі кольори жил.');
    if (!thread && !blankDiameter(source.coreClass) && conductorClass(source) === null) errors.push(prefix + 'клас жили має бути від 1 до 6.');
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_DRUMS) errors.push(prefix + `розмір першої партії має бути від 1 до ${MAX_DRUMS} барабанів.`);
    const parsed = parseJobLengths(source.lengthsText);
    errors.push(...parsed.errors.map(error => prefix + error));
    count += parsed.lengths.length * colors.length;
    totalMetres += parsed.lengths.reduce((sum, length) => sum + length, 0) * colors.length;
    validated.push({ ...source, id, cableId, section, cores, colors, batchSize, lengths: parsed.lengths, urgent: !thread && source.urgent === true,
      ...(thread ? { finalDiameter: diameter } : {}) });
  });
  if (count > MAX_DRUMS) errors.push(`У плані ${count} барабанів. Максимум — ${MAX_DRUMS}, разом для всіх кольорів і кабелів.`);
  if (!Number.isSafeInteger(totalMetres)) errors.push('Загальна довжина плану завелика.');
  return { jobs: errors.length ? [] : validated, errors: unique(errors) };
}

function expandValidated(jobs) {
  return jobs.flatMap(job => job.colors.flatMap(color => job.lengths.map((length, index) => ({
    id: `${job.id}:${color}:${index}`,
    jobId: job.id,
    cableId: job.cableId,
    section: job.section,
    ...(conductorClass(job) !== null ? { coreClass: conductorClass(job) } : {}),
    ...(isThread(job) ? { finalDiameter: job.finalDiameter } : {}),
    ...(isThread(job) ? { mode: 'single' } : ['black', 'yellow-green'].includes(color) ? { mode: 'dual' } : ['single', 'dual'].includes(job.mode) ? { mode: job.mode } : {}),
    color,
    length: String(length),
    name: '',
    breakdowns: '',
    ...(job.coiling === true ? { coiling: true } : {})
  }))));
}

export function expandJobs(jobs) {
  const validated = validateJobs(jobs);
  return { drums: expandValidated(validated.jobs), errors: validated.errors };
}

function generatedIndex(drum) {
  const prefix = `${drum.jobId}:${drum.color}:`;
  if (typeof drum.id !== 'string' || !drum.id.startsWith(prefix)) return null;
  const suffix = drum.id.slice(prefix.length);
  return /^\d+$/.test(suffix) && Number.isSafeInteger(Number(suffix)) ? Number(suffix) : null;
}

/**
 * Group waiting metallic drums by splitter, colour and then conductor.
 * Started/completed drums, invalid records and thread bundles stay at their positions: thread
 * splitter requirements are not known. Within each block the encounter order
 * is retained as the tie-breaker, making repeated recommendations stable.
 */
export function recommendOrder(drums, options = {}) {
  if (!Array.isArray(drums)) return [];
  const result = [...drums], slots = normalizeDyeSlots(options?.slots);
  const modeOf = dyeMode;
  const headOf = drum => splitterFor(drum.color, modeOf(drum)) ?? 'any';
  const slotMatches = drum => dyeRequirements(drum).reduce((count, color, extruder) => count + (color && slots.slice(extruder * 2, extruder * 2 + 2).includes(color) ? 1 : 0), 0);
  const useSlots = drum => dyeRequirements(drum).forEach((color, extruder) => {
    if (!color) return;
    const offset = extruder * 2, pair = slots.slice(offset, offset + 2);
    if (pair.includes(color) || pair.includes('')) return;
    const index = pair.indexOf(EMPTY_DYE);
    slots[offset + (index < 0 ? 0 : index)] = color;
  });
  let start = 0;
  while (start < result.length) {
    if (drumStatus(result[start]) !== 'queued' || isThread(result[start]) || !validColors.has(result[start]?.color)) { start++; continue; }
    let end = start;
    while (end < result.length && drumStatus(result[end]) === 'queued' && !isThread(result[end]) && validColors.has(result[end]?.color)) end++;
    const block = result.slice(start, end);
    const previous = start > 0 && !isThread(result[start - 1]) && validColors.has(result[start - 1]?.color) ? result[start - 1] : null;
    const hasAny = block.some(d => headOf(d) === 'any');
    const heads = unique(block.map(headOf).filter(head => head !== 'any'));
    // A previous single-extruder drum does not tell us which splitter is mounted.
    let previousHead = null;
    for (let i = start - 1; i >= 0 && !isThread(result[i]); i--) {
      const candidate = headOf(result[i]);
      if (candidate !== 'any') { previousHead = candidate; break; }
    }
    const initialHead = previousHead ?? 'striped';
    if (!previousHead && slots.some(Boolean)) heads.sort((a,b) => Math.max(...block.filter(d => headOf(d) === b).map(slotMatches)) - Math.max(...block.filter(d => headOf(d) === a).map(slotMatches)) || (a === initialHead ? -1 : 1));
    else if (heads.includes(initialHead)) heads.sort((a,b) => a === initialHead ? -1 : b === initialHead ? 1 : 0);
    if (hasAny) {
      const anyScore = Math.max(...block.filter(d => headOf(d) === 'any').map(slotMatches));
      const firstScore = heads.length ? Math.max(...block.filter(d => headOf(d) === heads[0]).map(slotMatches)) : -1;
      if (previous && modeOf(previous) === 'single' || !previous && slots.some(Boolean) && anyScore > firstScore) heads.unshift('any');
      else heads.push('any');
    }
    const ordered = [];
    for (const head of heads) {
      const pool = block.filter(drum => headOf(drum) === head);
      while (pool.length) {
        const prior = ordered.at(-1) ?? previous;
        const candidates = unique(pool.map(drum => JSON.stringify([drum.color, modeOf(drum)]))).map(key => pool.find(drum => JSON.stringify([drum.color, modeOf(drum)]) === key));
        candidates.sort((a,b) => {
          const sameColor = d => prior && prior.color === d.color ? 1 : 0;
          const nextHead = heads[heads.indexOf(head) + 1];
          // Put black at the plain/striped boundary, even when other plain
          // colours also use two extruders or already have dyes loaded.
          const boundary = d => head !== 'plain' ? 0
            : nextHead === 'striped' ? (d.color === 'black' ? -1 : 0)
              : prior && headOf(prior) === 'striped' ? (d.color === 'black' ? 1 : 0) : 0;
          const desiredMode = prior ? modeOf(prior) : nextHead === 'striped' ? 'single' : null;
          const sameMode = d => desiredMode && modeOf(d) === desiredMode ? 1 : 0;
          return boundary(b) - boundary(a) || sameColor(b) - sameColor(a) || sameMode(b) - sameMode(a) || (slots.some(Boolean) ? slotMatches(b) - slotMatches(a) : 0);
        });
        const first = candidates[0], matching = pool.filter(drum => drum.color === first.color && modeOf(drum) === modeOf(first));
        const keys = unique(matching.map(drum => JSON.stringify([drum.cableId, number(drum.section), conductorClass(drum)])));
        const priorKey = prior && JSON.stringify([prior.cableId, number(prior.section), conductorClass(prior)]);
        if (keys.includes(priorKey)) keys.sort((a,b) => a === priorKey ? -1 : b === priorKey ? 1 : 0);
        for (const key of keys) for (const drum of matching.filter(d => JSON.stringify([d.cableId, number(d.section), conductorClass(d)]) === key)) { ordered.push(drum); pool.splice(pool.indexOf(drum), 1); }
        useSlots(first);
      }
    }
    result.splice(start, end - start, ...ordered);
    start = end;
  }
  return result;
}

export function scheduleJobs(jobs, existingDrums = [], options = {}) {
  const validated = validateJobs(jobs);
  if (validated.errors.length) return { drums: [], errors: validated.errors, warnings: [] };
  const existing = new Map((Array.isArray(existingDrums) ? existingDrums : []).filter(drum => drum && typeof drum === 'object').map(drum => [drum.id, drum]));
  let resetStarted = false;
  const retained = new Set();
  const drums = expandValidated(validated.jobs).map(drum => {
    let saved = existing.get(drum.id);
    if (!saved && isThread(drum)) {
      const previousRows = [...existing.values()].filter(row => row.jobId === drum.jobId && isThread(row) && generatedIndex(row) === generatedIndex(drum));
      // A single old colour marker can be renamed safely; several physical
      // drums with that index must not be merged into one production record.
      if (previousRows.length === 1) saved = previousRows[0];
    }
    if (saved) retained.add(saved.id);
    const unchanged = saved?.cableId === drum.cableId && number(saved?.section) === drum.section && (isThread(drum) || saved?.color === drum.color)
      && number(saved?.length) === number(drum.length) && sameDiameter(saved, drum) && sameClass(saved, drum);
    const status = unchanged ? drumStatus(saved) : 'queued';
    if (saved && drumStatus(saved) !== 'queued' && !unchanged) resetStarted = true;
    const mode = isThread(drum) ? 'single' : ['black', 'yellow-green'].includes(drum.color) ? 'dual'
      : unchanged && ['single', 'dual'].includes(saved?.mode) ? saved.mode : drum.mode;
    const restored = { ...saved, ...drum, name: saved?.name ?? '', breakdowns: saved?.breakdowns ?? '', status };
    if (!drum.coiling) delete restored.coiling;
    if (!Object.hasOwn(drum, 'coreClass')) delete restored.coreClass;
    if (['single', 'dual'].includes(mode)) restored.mode = mode; else delete restored.mode;
    return restored;
  });
  const warnings = resetStarted ? ['Позначки «В роботі» та «Готово» скинуто для барабанів зі зміненим типом кабелю, перерізом, класом жили, кінцевим діаметром, кольором або довжиною.'] : [];
  const threadJobs = new Set(validated.jobs.filter(isThread).map(job => job.id));
  if ([...existing.values()].some(drum => threadJobs.has(drum.jobId) && isThread(drum) && !retained.has(drum.id) && drumStatus(drum) !== 'queued')) {
    warnings.push('Новий план джгутів має один потік без кольорів. Старі розпочаті барабани, яких немає в новому плані, не перенесено; перевір їх перед заміною черги.');
  }
  const positions = new Map((Array.isArray(existingDrums) ? existingDrums : []).map((drum, index) => [drum?.id, index]));
  drums.sort((left, right) => (positions.get(left.id) ?? Infinity) - (positions.get(right.id) ?? Infinity));
  return { drums: recommendOrder(drums, options), errors: [], warnings };
}

/** targetIndex is the desired final zero-based position, clamped to the array. */
export function moveDrum(drums, id, targetIndex) {
  if (!Array.isArray(drums)) return [];
  const moved = [...drums];
  const sourceIndex = moved.findIndex(drum => drum?.id === id);
  if (sourceIndex < 0 || !Number.isSafeInteger(targetIndex)) return moved;
  const target = Math.max(0, Math.min(moved.length - 1, targetIndex));
  const [drum] = moved.splice(sourceIndex, 1);
  moved.splice(target, 0, drum);
  return moved;
}

/** Readiness is the minimum accumulated metres across all colors of a cable. */
export function planSummary(drums, jobs = []) {
  return summarizePlan(drums, jobs, drums);
}

function summarizePlan(drums, jobs, plannedDrums) {
  const items = Array.isArray(drums) ? drums : [];
  const planned = Array.isArray(plannedDrums) ? plannedDrums : [];
  const summary = { drumCount: items.length, totalMetres: 0, headChanges: 0, colorChanges: 0, cableChanges: 0, ready: [], errors: [], warnings: [] };
  if (!Array.isArray(drums)) summary.errors.push('Не вдалося прочитати план барабанів.');
  if (items.length > MAX_DRUMS) summary.errors.push(`У плані може бути не більше ${MAX_DRUMS} барабанів.`);
  const ids = new Set();
  let mountedHead = null;
  items.forEach((drum, index) => {
    const length = number(drum?.length);
    if (!drum || !validColors.has(drum.color)) summary.errors.push(`Барабан ${index + 1}: оберіть відомий колір.`);
    if (!Number.isSafeInteger(length) || length <= 0) summary.errors.push(`Барабан ${index + 1}: довжина має бути цілим числом метрів, більшим за нуль.`);
    else summary.totalMetres += length;
    if (isThread(drum) && !validDiameter(drum.finalDiameter)) summary.errors.push(`Барабан ${index + 1}: вкажіть кінцевий діаметр джгута додатним числом у мм або залиште поле порожнім.`);
    if (typeof drum?.id !== 'string' || !drum.id || ids.has(drum.id)) summary.errors.push(`Барабан ${index + 1}: ідентифікатор має бути непорожнім і унікальним.`);
    ids.add(drum?.id);
    const previous = items[index - 1];
    if (drum && isThread(drum)) mountedHead = null;
    else if (drum && validColors.has(drum.color)) {
      const required = splitterFor(drum.color, dyeMode(drum));
      if (required && mountedHead && required !== mountedHead) summary.headChanges++;
      if (required) mountedHead = required;
    }
    if (!drum || !previous) return;
    if (validColors.has(drum.color) && validColors.has(previous.color)) {
      if (!isThread(drum) && !isThread(previous) && drum.color !== previous.color) summary.colorChanges++;
    }
    if (drum.cableId !== previous.cableId || number(drum.section) !== number(previous.section) || !sameDiameter(previous, drum) || !sameClass(previous, drum)) summary.cableChanges++;
  });
  if (!Number.isSafeInteger(summary.totalMetres)) summary.errors.push('Загальна довжина плану завелика.');
  const provided = Array.isArray(jobs) && jobs.length > 0;
  const validated = provided ? validateJobs(jobs) : { jobs: [], errors: [] };
  summary.errors.push(...validated.errors);
  const definitions = provided ? validated.jobs : unique(planned.filter(drum => drum?.jobId).map(drum => drum.jobId)).map(id => {
    const group = planned.filter(drum => drum?.jobId === id);
    const thread = isThread(group[0]);
    const colors = thread ? ['white'] : unique(group.map(drum => drum.color).filter(color => validColors.has(color)));
    const perColor = colors.map(color => group.filter(drum => thread || drum.color === color).reduce((sum, drum) => sum + (number(drum.length) ?? 0), 0));
    return { id, cableId: group[0]?.cableId, section: number(group[0]?.section), colors, lengths: [Math.max(0, ...perColor)],
      ...(conductorClass(group[0]) !== null ? { coreClass: conductorClass(group[0]) } : {}),
      ...(isThread(group[0]) ? { finalDiameter: finalDiameter(group[0]) } : {}) };
  });
  const knownJobs = new Set(definitions.map(job => job.id));
  if (provided && items.some(drum => drum && !knownJobs.has(drum.jobId))) summary.warnings.push('У плані є барабани, не прив’язані до поточних завдань. Їх не враховано в готовності на скрутку.');
  for (const job of definitions) {
    const totalMetres = job.lengths.reduce((sum, length) => sum + length, 0);
    const progress = { jobId: job.id, cableId: job.cableId, section: job.section, colors: [...job.colors], totalMetres, readyMetres: 0, firstReadyAt: null, fullyReadyAt: null, complete: false, milestones: [],
      ...(isThread(job) ? { finalDiameter: finalDiameter(job) } : {}) };
    const totals = new Map(job.colors.map(color => [color, 0]));
    let producedMetres = 0;
    items.forEach((drum, index) => {
      if (drum?.jobId !== job.id) return;
      const length = number(drum.length);
      if (!Number.isSafeInteger(length) || length <= 0) return;
      producedMetres += length;
      const color = isThread(job) ? 'white' : drum.color;
      if (!totals.has(color)) return;
      // A differently configured cable cannot supply this job's twisting step.
      if (drum.cableId !== job.cableId || number(drum.section) !== job.section || !sameDiameter(drum, job) || !sameClass(drum, job)) return;
      totals.set(color, totals.get(color) + length);
      const readyMetres = Math.min(...totals.values());
      if (readyMetres > progress.readyMetres) {
        progress.readyMetres = readyMetres;
        progress.firstReadyAt ??= index + 1;
        if (readyMetres >= totalMetres) progress.fullyReadyAt ??= index + 1;
        progress.milestones.push({ afterDrum: index + 1, drumId: drum.id, readyMetres, producedMetres });
      }
    });
    progress.complete = job.colors.length > 0 && totalMetres > 0 && progress.readyMetres >= totalMetres;
    if (isThread(job) && items.some(drum => drum?.jobId === job.id && !sameDiameter(drum, job))) {
      summary.warnings.push(`Завдання ${definitions.indexOf(job) + 1}: кінцевий діаметр джгута на барабані відрізняється від завдання. Його не враховано в готовності на скрутку.`);
    }
    if (provided) {
      for (const color of job.colors) {
        const actual = totals.get(color);
        if (actual !== totalMetres) summary.warnings.push(`Завдання ${definitions.indexOf(job) + 1}${isThread(job) ? '' : `, ${COLORS.find(item => item.id === color)?.label ?? color}`}: у плані ${actual} м, у завданні ${totalMetres} м.`);
      }
      if (!isThread(job) && items.some(drum => drum?.jobId === job.id && !job.colors.includes(drum.color))) summary.warnings.push(`Завдання ${definitions.indexOf(job) + 1}: у плані є колір, якого немає в завданні.`);
      if (items.some(drum => drum?.jobId === job.id && (drum.cableId !== job.cableId || number(drum.section) !== job.section || !sameClass(drum, job)))) summary.warnings.push(`Завдання ${definitions.indexOf(job) + 1}: тип кабелю, переріз або клас жили барабана відрізняється від завдання.`);
    }
    summary.ready.push(progress);
  }
  summary.errors = unique(summary.errors);
  summary.warnings = unique(summary.warnings);
  return summary;
}

/** Actual twisting readiness counts completed work only, never planned or running drums. */
export function productionSummary(drums, jobs = []) {
  const items = Array.isArray(drums) ? drums : [];
  const done = items.filter(drum => drumStatus(drum) === 'done');
  // Legacy saved queues can lack job definitions. Their required colors still
  // come from the full queue, so one completed color cannot count as a full set.
  const completed = summarizePlan(done, jobs, items);
  return {
    queuedCount: items.filter(drum => drumStatus(drum) === 'queued').length,
    activeCount: items.filter(drum => drumStatus(drum) === 'active').length,
    doneCount: done.length,
    doneMetres: completed.totalMetres,
    ready: completed.ready,
    errors: completed.errors,
    warnings: completed.warnings
  };
}
