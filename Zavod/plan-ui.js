import { COLORS, colorName, fmt, number, planDrum, planSplices } from './core.js?v=28';
import { MAX_DRUMS, parseJobLengths, scheduleJobs, recommendOrder, moveDrum, planSummary, drumStatus, setDrumStatus, productionSummary } from './planner.js?v=28';
import { CATALOG_CABLES, optionFor } from './catalog-base.js?v=27';
import { SHIFT_DEFAULTS, shiftSettings, coreClass, conductorRequirements, estimateShift, requiredTools } from './plan-resources.js?v=28';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const palette = ['yellow-green', 'blue', 'brown', 'black', 'gray', 'white', 'red', 'green', 'yellow'];
const copy = value => JSON.parse(JSON.stringify(value));
const savedId = value => typeof value === 'string' && value.trim() && value.length <= 300 ? value : crypto.randomUUID();
const cableLabel = id => optionFor(id)?.label ?? id;
const isThread = id => optionFor(id)?.coreKind === 'thread';
const diameterLabel = value => number(value) > 0 ? ` Ø${fmt(number(value), 3)} мм` : '';
const savedDiameter = value => typeof value === 'number' || value === null ? value : String(value ?? '').slice(0, 12);
const streamLabel = drum => isThread(drum.cableId) ? 'Без барвника' : colorName(drum.color);
const productLabel = (id, section) => `${cableLabel(id)}${isThread(id) ? '' : ` ${fmt(section)} мм²`}`;
const requestedMode = drum => isThread(drum.cableId) ? 'single' : ['black', 'yellow-green'].includes(drum.color) ? 'dual' : ['single', 'dual'].includes(drum.mode) ? drum.mode : undefined;
const modePicker = drum => !isThread(drum.cableId) && !['black', 'yellow-green'].includes(drum.color);
const preference = (state, cableId) => !isThread(cableId) && ['single', 'dual'].includes(state.modePreferences?.[cableId]) ? { mode: state.modePreferences[cableId] } : {};
const options = selected => CATALOG_CABLES.map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
const sections = (id, selected) => (optionFor(id)?.sections ?? []).map(s => `<option value="${s}" ${Number(selected) === s ? 'selected' : ''}>${isThread(id) ? 'Нитка' : fmt(s)}</option>`).join('');
const colorOptions = selected => COLORS.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.label}</option>`).join('');
const swatch = color => `<span class="color-dot" data-color="${esc(color)}" style="--swatch:${COLORS.find(c => c.id === color)?.hex ?? '#aaa'}" aria-hidden="true"></span>`;
const classOptions = selected => `<option value="">Обери клас</option>${[1, 2, 3, 4, 5, 6].map(value => `<option value="${value}" ${coreClass(selected) === value ? 'selected' : ''}>${value}</option>`).join('')}`;
const classLabel = item => coreClass(item.coreClass) ? ` · ${coreClass(item.coreClass)} клас` : '';
const timeLabel = minutes => `${Math.floor(Math.ceil(minutes) / 60)} год ${Math.ceil(minutes) % 60} хв`;
const shiftLabels = { lunch: 'Обід', alarms: 'Повітряні тривоги', breaks: 'Перекури й перерви', startup: 'Запуск зміни', drum: 'Заміна барабана', tooling: 'Зміна інструмента / режиму', conductor: 'Зміна марки, перерізу чи класу', color: 'Зміна / стравлення кольору' };

export function newJob(cableId, section, extra = {}) {
  const { mode, coreClass: savedClass, ...fields } = extra;
  const colors = Array.isArray(fields.colors) ? [...fields.colors] : palette.slice(0, 3);
  return { id: crypto.randomUUID(), cableId, section, lengthsText: '', urgent: false, batchSize: 3, ...fields,
    colors, cores: colors.length,
    ...(!isThread(cableId) && coreClass(savedClass) ? { coreClass: coreClass(savedClass) } : {}),
    ...(!isThread(cableId) && ['single', 'dual'].includes(mode) ? { mode } : {}),
    ...(isThread(cableId) ? { finalDiameter: extra.finalDiameter ?? '', cores: 1, colors: ['white'], urgent: false } : {}) };
}

export function duplicateJob(previous) {
  return newJob(previous.cableId, previous.section, { ...copy(previous), id: crypto.randomUUID() });
}

/** Follow the main selection only while the initial task has not been edited. */
export function syncPlannerSelection(state) {
  const job = state.jobs?.[0], cable = optionFor(state.cableId);
  if (!cable || state.jobs.length !== 1 || state.planJobs?.length || state.planDirty || state.manualOrder || !job ||
      String(job.lengthsText ?? '').trim() || coreClass(job.coreClass) || Number(job.cores) !== (isThread(job.cableId) ? 1 : 3) || job.urgent || Number(job.batchSize) !== 3 ||
      JSON.stringify(job.colors) !== JSON.stringify(isThread(job.cableId) ? ['white'] : palette.slice(0, 3))) return false;
  const section = cable.sections.includes(Number(state.section)) ? Number(state.section) : cable.sections[0];
  const finalDiameter = String(state.finalDiameter ?? '').slice(0, 12);
  const mode = preference(state, cable.id).mode;
  if (job.cableId === cable.id && Number(job.section) === section && job.mode === mode && (!isThread(cable.id) || String(job.finalDiameter ?? '') === finalDiameter)) return false;
  job.cableId = cable.id; job.section = section;
  if (mode) job.mode = mode; else delete job.mode;
  job.cores = isThread(cable.id) ? 1 : 3; job.colors = isThread(cable.id) ? ['white'] : palette.slice(0, 3);
  if (isThread(cable.id)) job.finalDiameter = finalDiameter;
  return true;
}

/** Keep the old locally saved queue, labels and faults when adding task planning. */
export function restorePlanner(saved, state) {
  state.shiftSettings = shiftSettings(saved?.shiftSettings);
  state.coreStock = Object.fromEntries(Object.entries(saved?.coreStock ?? {}).filter(([key, entry]) => /^\d+(?:\.\d+)?:[1-6?]$/u.test(key) && entry && typeof entry === 'object')
    .slice(0, 200).map(([key, entry]) => [key, { ...(entry.fullLengthKm === undefined ? {} : { fullLengthKm: String(entry.fullLengthKm).slice(0, 20) }), piecesText: String(entry.piecesText ?? '').slice(0, 2000) }]));
  const restoreJobs = rows => (Array.isArray(rows) ? rows : []).slice(0, 50).filter(j => j && optionFor(j.cableId)).map(j => {
    const cable = optionFor(j.cableId);
    return newJob(cable.id, cable.sections.includes(Number(j.section)) ? Number(j.section) : cable.sections[0], {
      id: savedId(j.id),
      cores: j.cores ?? 3, colors: Array.isArray(j.colors) ? j.colors.filter(c => COLORS.some(row => row.id === c)) : [],
      ...(coreClass(j.coreClass) ? { coreClass: coreClass(j.coreClass) } : {}),
      lengthsText: String(j.lengthsText ?? '').slice(0, 2000).replaceAll('*', '×'), urgent: j.urgent === true, batchSize: j.batchSize ?? 3,
      ...(['single', 'dual'].includes(j.mode) ? { mode: j.mode } : {}),
      ...(isThread(cable.id) ? { finalDiameter: savedDiameter(j.finalDiameter) } : {})
    });
  });
  state.jobs = restoreJobs(saved?.jobs);
  if (!state.jobs.length) state.jobs = [newJob(state.cableId, state.section, { ...preference(state, state.cableId), ...(isThread(state.cableId) ? { finalDiameter: String(state.finalDiameter ?? '') } : {}) })];
  state.planJobs = restoreJobs(saved?.planJobs);
  state.planDirty = saved?.planDirty === true;
  state.manualOrder = saved?.manualOrder === true;
  const validDrums = rows => {
    let active = false;
    return (Array.isArray(rows) ? rows : []).filter(d => d && COLORS.some(c => c.id === d.color)).slice(0, MAX_DRUMS).map((d, i) => {
    const cable = optionFor(d.cableId) ?? optionFor(state.cableId);
    let status = drumStatus(d);
    if (status === 'active') { if (active) status = 'queued'; else active = true; }
    return { id: typeof d.id === 'string' && d.id.trim() && d.id.length <= 400 ? d.id : `drum-${i}`,
      jobId: typeof d.jobId === 'string' ? d.jobId : '', cableId: cable.id,
      section: cable.sections.includes(Number(d.section)) ? Number(d.section) : cable.sections.includes(state.section) ? state.section : cable.sections[0],
      ...(!isThread(cable.id) && coreClass(d.coreClass) ? { coreClass: coreClass(d.coreClass) } : {}),
      color: d.color, length: String(d.length ?? '').slice(0, 20), name: String(d.name ?? '').slice(0, 80), breakdowns: String(d.breakdowns ?? '').slice(0, 2000), status,
      ...(['single', 'dual'].includes(d.mode) ? { mode: d.mode } : {}),
      ...(isThread(cable.id) ? { finalDiameter: savedDiameter(d.finalDiameter) } : {}) };
    });
  };
  if (Array.isArray(saved?.drums)) state.drums = validDrums(saved.drums);
  else state.drums = validDrums(state.drums);
  const seen = new Set();
  for (const drum of state.drums) { if (seen.has(drum.id)) drum.id = crypto.randomUUID(); seen.add(drum.id); }
  state.previousPlan = saved?.previousPlan && Array.isArray(saved.previousPlan.drums) ? {
    drums: validDrums(saved.previousPlan.drums), planJobs: restoreJobs(saved.previousPlan.planJobs), manualOrder: saved.previousPlan.manualOrder === true,
    reason: ['clear', 'status', 'edit'].includes(saved.previousPlan.reason) ? saved.previousPlan.reason : 'edit'
  } : null;
}

export function createPlannerUI({ state, getSetup, persist, toast, haptic, onCableInfo }) {
  let drag = null, scrollFrame = null;
  const setupCache = new Map();

  state.shiftSettings ??= shiftSettings(); state.coreStock ??= {};
  const jobTitle = job => isThread(job.cableId) ? cableLabel(job.cableId) + diameterLabel(job.finalDiameter) : `${cableLabel(job.cableId)} ${fmt(job.colors.length)}×${fmt(job.section)}${classLabel(job)}`;
  const drumTitle = drum => {
    const job = state.planJobs.find(j => j.id === drum.jobId);
    return isThread(drum.cableId) ? cableLabel(drum.cableId) + diameterLabel(drum.finalDiameter) : `${cableLabel(drum.cableId)} ${job ? fmt(job.colors.length) + '×' : ''}${fmt(drum.section)}${classLabel(drum)}`;
  };
  const setup = drum => {
    const mode = requestedMode(drum);
    const key = JSON.stringify([drum.cableId, drum.section, drum.color, drum.finalDiameter, mode]);
    if (!setupCache.has(key)) setupCache.set(key, getSetup(drum.cableId, drum.section, drum.color, drum.finalDiameter, mode));
    return setupCache.get(key);
  };
  function result(drum, i) {
    const info = setup(drum), next = drumStatus(drum) === 'done' ? null : nextDrum(i);
    const nextInfo = next ? setup(next) : null;
    const rules = { ...state.rules };
    for (const [field, rule] of [['colorLead1', 'lead1'], ['colorLead2', 'lead2']]) {
      const modeled = ['operator-anchor', 'operator-interpolation'].includes(info.forecast?.fieldMethods?.[field]);
      const lead = [info.practical?.[field], info.stored?.[field], ...(modeled ? [info.effective?.[field]] : [])]
        .map(number).find(value => value !== null && value >= 0);
      if (lead !== null && lead >= 0) rules[rule] = lead;
    }
    const splice = planSplices(drum.length, drum.breakdowns, rules.splice);
    const planned = planDrum({ ...drum, length: splice.target ?? drum.length, mode: info.mode, noDye: info.noDye }, next ? { ...next, mode: nextInfo.mode, noDye: nextInfo.noDye } : null, info.mode, rules);
    const errors = [...new Set([...planned.errors, ...splice.errors])];
    return { ...planned, errors, target: errors.length ? null : planned.target, splice };
  }
  const nextDrum = i => state.drums.slice(i + 1).find(d => drumStatus(d) !== 'done');
  function transitionText(drum, i) {
    const next = nextDrum(i), r = result(drum, i);
    if (!next || drumStatus(drum) === 'done') return '';
    if (r.errors.length) return r.errors.join(' ');
    let colorTransition = '';
    if (r.transition) {
      const events = r.events.map(e => `Барвник №${e.extruder} — за ${fmt(e.lead)} м до кінця, на ${fmt(e.at)} м.`);
      colorTransition = `Далі — ${colorName(next.color).toLowerCase()}. Екран: ${r.formula}. ${events.join(' ')}${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}`.trim();
    }
    if (!r.setupChange) return colorTransition;
    const changes = [];
    if (r.headChange) changes.push(next.color === 'yellow-green' ? 'поставити розсікач для жовто-зеленого' : 'поставити розсікач для суцільного кольору');
    if (r.cableChange) changes.push(`перейти на ${drumTitle(next)}`);
    if (r.modeChange) changes.push('змінити режим екструдерів');
    if (r.matrixChange) changes.push(`змінити матрицю на ${fmt(setup(next).effective.matrix, 3)} мм`);
    if (next.color !== drum.color && !r.transition && !isThread(next.cableId)) changes.push(`налаштувати ${colorName(next.color).toLowerCase()}`);
    const core = isThread(drum.cableId) ? 'нитки' : 'жили';
    const stop = r.cableChange && r.target > 0 ? `Зупинка на ${fmt(r.length - r.target)} м раніше для зміни ${core}` : r.cableChange && r.target === 0 ? `Для зміни ${core} потрібен окремий план зупинки` : 'Далі — зупинка';
    return `${colorTransition ? colorTransition + ' ' : ''}${stop}: ${changes.join('; ')}.`;
  }
  function output(drum, i) {
    const r = result(drum, i);
    if (r.errors.length) return `<p class="error">${r.errors.map(esc).join('<br>')}</p>`;
    const supply = isThread(drum.cableId) ? '' : `<p class="drum-supply quiet">Жили на цей барабан: <b>${fmt(number(drum.length) / 1000, 3)} км</b>${esc(classLabel(drum))}. Технологічні втрати окремо.</p>`;
    return `${supply}${r.target > 0 ? `<div class="target"><span>Довжина на екрані</span><strong>${fmt(r.target)} <small>м</small></strong></div>` : ''}
      ${r.transition ? `<ol class="steps">${r.events.map(e => `<li><b>≈ ${fmt(e.at)} м</b> — барвник №${e.extruder}: ${esc(e.dye.toLowerCase())} (за ${fmt(e.lead)} м до кінця)</li>`).join('')}<li>Стравити. Коли ${esc(colorName(r.nextColor).toLowerCase())} з’явиться у 4-му рядку ванни — перекинути вручну.</li>${r.setupChange ? '<li>Розсікач або режим екструдерів змінити після зупинки.</li>' : ''}</ol><p class="quiet formula">${esc(r.formula)}</p>` : `<p class="quiet">${r.cableChange ? `Зупинися раніше: решта ${isThread(drum.cableId) ? 'нитки' : 'жили'} вже у ванні. Резерв зміни кольору не додається.` : r.setupChange ? isThread(drum.cableId) ? 'Перехід після зупинки. Без барвника.' : 'Перехід після зупинки. Випередження зміни барвника не розраховується.' : isThread(drum.cableId) ? 'Без барвника.' : 'Без поправки на зміну кольору.'}</p>${r.cableChange ? `<p class="quiet formula">${esc(r.formula)}</p>` : ''}`}
      ${r.warnings.map(w => `<p class="error">${esc(w)}</p>`).join('')}${r.splice.spliceCount ? `<p class="drum-splice-label">На лейбл: <b data-splice-label>${esc(r.splice.label)}</b></p><p class="quiet">З’єднань: ${r.splice.spliceCount} · +${fmt(r.splice.target - r.splice.length)} м тільки на екрані.</p>` : ''}`;
  }
  function jobTotal(job) {
    if (!String(job.lengthsText ?? '').trim()) return 'Вкажи довжини із завдання.';
    const parsed = parseJobLengths(job.lengthsText);
    if (parsed.errors.length) return parsed.errors.join(' ');
    const metres = parsed.lengths.reduce((sum, length) => sum + length, 0);
    if (isThread(job.cableId)) return `${parsed.lengths.length} барабанів · ${fmt(metres / 1000, 3)} км · без барвника`;
    return `${job.colors.length} кольорів · ${parsed.lengths.length * job.colors.length} барабанів · ${fmt(metres / 1000, 3)} км / колір · жили разом ${fmt(metres * job.colors.length / 1000, 3)} км${!job.colors.length ? ' · обери хоча б один колір' : ''}`;
  }
  function renderJobs() {
    $('jobs').innerHTML = state.jobs.map((job, i) => `<article class="job-card" data-job="${esc(job.id)}">
      <div class="job-heading"><h2>Провід ${i + 1}</h2><div><button type="button" class="icon-button" data-job-action="up" aria-label="Провід ${i + 1} вгору" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-job-action="down" aria-label="Провід ${i + 1} вниз" ${i === state.jobs.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="icon-button" data-job-action="remove" aria-label="Прибрати провід ${i + 1}" ${state.jobs.length === 1 ? 'disabled' : ''}>×</button></div></div>
      <div class="job-fields form-grid"><label>Марка<select data-job-field="cableId">${options(job.cableId)}</select></label><label ${isThread(job.cableId) ? 'hidden' : ''}>Переріз жили, мм²<select data-job-field="section">${sections(job.cableId, job.section)}</select></label>${isThread(job.cableId) ? `<label>Фінальний діаметр, мм<input data-job-field="finalDiameter" inputmode="decimal" maxlength="12" value="${esc(job.finalDiameter)}" placeholder="Із завдання"></label>` : `<label>Клас жили<select data-job-field="coreClass">${classOptions(job.coreClass)}</select></label>`}<label class="job-lengths">${isThread(job.cableId) ? 'Довжини барабанів' : 'Довжини кожного кольору'}, км<input data-job-field="lengthsText" maxlength="2000" value="${esc(job.lengthsText)}" placeholder="3×15 + 3×15 + 11"></label></div>
      <fieldset class="job-colors" ${isThread(job.cableId) ? 'hidden' : ''}><legend>Кольори жил</legend>${COLORS.map(c => `<label class="color-choice" title="${c.label}"><input type="checkbox" data-job-color="${c.id}" aria-label="${c.label}" ${job.colors.includes(c.id) ? 'checked' : ''}>${swatch(c.id)}</label>`).join('')}</fieldset>
      <label class="check job-priority" ${isThread(job.cableId) ? 'hidden' : ''}><input type="checkbox" data-job-field="urgent" ${job.urgent ? 'checked' : ''}>Скрутка чекає — підготувати всі кольори раніше</label>
      <label class="job-batch" ${isThread(job.cableId) ? 'hidden' : ''}>Перша партія: барабанів / колір<input type="number" data-job-field="batchSize" min="1" max="${MAX_DRUMS}" inputmode="numeric" value="${esc(job.batchSize)}"></label>
      <p class="job-total quiet" data-job-total="${esc(job.id)}">${esc(jobTotal(job))}</p></article>`).join('');
  }
  function resourceData() {
    const draft = state.planDirty ? scheduleJobs(state.jobs) : null;
    const drums = draft ? draft.drums : state.drums;
    return { drums, draft, stock: conductorRequirements(drums, state.coreStock), shift: estimateShift(drums, setup, state.shiftSettings), tools: requiredTools(drums, setup) };
  }
  const stockTitle = group => `${fmt(group.section)} мм² · ${group.coreClass ? group.coreClass + ' клас' : 'клас не вказано'}`;
  function stockResult(group) {
    if (group.errors.length) return `<p class="error">${group.errors.map(esc).join(' ')}</p>`;
    return `<div class="resource-total"><strong>${fmt(group.totalMetres / 1000, 3)} <small>км жили на завдання</small></strong><span>${group.fullDrums === null ? 'Вкажи довжину повного барабана' : group.fullDrums === 0 ? 'Залишків вистачає' : `До залишків ще <b>${group.fullDrums}</b> повних барабанів`}</span></div>
      <p class="quiet">Повний: ${group.fullMetres === null ? 'не вказано' : fmt(group.fullMetres / 1000, 3) + ' км'} · залишки: ${fmt(group.piecesMetres / 1000, 3)} км${group.leftover !== null ? ` · лишиться ≈ ${fmt(group.leftover / 1000, 3)} км` : ''}. У черзі ще ${fmt(group.remainingMetres / 1000, 3)} км.</p>`;
  }
  function shiftResult(shift) {
    if (!shift.pendingCount) return '<p class="quiet">Немає барабанів, які залишилось виготовити.</p>';
    return `<div class="resource-total"><strong>≈ ${fmt(shift.possibleMetres / 1000, 3)} <small>км за зміну</small></strong><span>${shift.completedDrums} / ${shift.pendingCount} барабанів повністю</span></div>
      ${shift.partial ? `<p class="quiet">Наступний барабан: ≈ ${fmt(shift.partial.metres / 1000, 3)} з ${fmt(shift.partial.length / 1000, 3)} км.</p>` : ''}
      <p class="resource-verdict">${shift.blocked ? 'Прогноз обмежено: далі в черзі немає швидкості або коректної довжини.' : shift.fits ? 'Решта завдання орієнтовно поміщається в одну зміну.' : `Уся решта потребує ≈ ${timeLabel(shift.requiredMinutes)} робочого часу${shift.minimumShifts === null ? '' : ` · щонайменше ${shift.minimumShifts} змін`}.`}</p>
      <p class="quiet">Після обіду, тривог і перерв: ${timeLabel(shift.available)}. ${shift.blocked ? 'Відома частина' : 'На решту завдання'}: хід лінії ${timeLabel(shift.runningMinutes)} + запуск і переходи ${timeLabel(shift.setupMinutes)}.</p>
      ${shift.fallbackSpeeds ? '<p class="quiet">Де немає довідкової швидкості, використано робочу або прогнозовану з налаштувань.</p>' : ''}`;
  }
  function renderResources() {
    const container = $('plan-resources'); if (!container) return;
    const opened = new Map(['shift', 'stock', 'tools'].map(name => [name, container.querySelector(`[data-resource-panel="${name}"]`)?.open]));
    const data = resourceData();
    if (data.draft?.errors.length) {
      container.innerHTML = '<p class="quiet">Заповни довжини й кольори завдання — з’являться оцінка зміни, потреба в жилі та інструмент.</p>'; return;
    }
    const toolValue = (value, source) => value === null ? 'Немає даних' : `${source === 'forecast' ? '≈ ' : ''}${typeof value === 'number' ? fmt(value, 3) : esc(value)}`;
    container.innerHTML = `<p class="resource-context quiet">${state.planDirty ? 'Попередній розрахунок за завданням. Склади чергу, щоб застосувати зміни.' : 'Прогноз зміни — на решту черги. Жила й інструмент — на все завдання.'}</p>
      <details class="card resource-panel" data-resource-panel="shift" ${opened.get('shift') !== false ? 'open' : ''}><summary>За зміну <span>12 годин</span></summary><div data-shift-result aria-live="polite">${shiftResult(data.shift)}</div>
        <details class="resource-settings"><summary>Поправки часу, хв</summary><p class="quiet">Обід — 60 хв. Решта — початкові припущення, підлаштуй під свою зміну. Переходи додаються за порядком барабанів.</p><div class="form-grid">${Object.entries(SHIFT_DEFAULTS).map(([key]) => `<label>${shiftLabels[key]}${['drum', 'tooling', 'conductor', 'color'].includes(key) ? ', за раз' : ''}<input data-shift-field="${key}" type="number" inputmode="numeric" min="0" max="720" value="${state.shiftSettings[key]}"></label>`).join('')}</div></details>
        <p class="quiet resource-footnote">Орієнтир із фото: ПВ3 2,5 / 4 / 6 — 40,71 км. Точних тривалостей простоїв немає, тому поправки часу не є виміряною статистикою. Барабан у роботі рахується повністю.</p></details>
      <details class="card resource-panel" data-resource-panel="stock" ${opened.get('stock') !== false ? 'open' : ''}><summary>Потрібна жила <span>${data.stock.length} типів</span></summary>
        ${data.stock.map(group => `<section class="stock-group" data-stock-key="${esc(group.key)}"><h3>${esc(stockTitle(group))}</h3><div class="form-grid"><label>Повний барабан жили, км<input data-stock-field="fullLengthKm" inputmode="decimal" maxlength="20" placeholder="Вкажи місткість" value="${esc(group.fullLengthKm)}"></label><label>Наявні залишки, м<input data-stock-field="piecesText" inputmode="text" maxlength="2000" placeholder="3200, 5400" value="${esc(group.piecesText)}"></label></div>${group.key === '6:3' ? '<p class="quiet">Зазвичай 8 км; якщо барабани на 7,2 — зміни значення вище.</p>' : ''}${!group.coreClass ? '<p class="error">Вкажи клас у проводі або барабані. Різні класи мають окремі запаси.</p>' : ''}<div data-stock-result>${stockResult(group)}</div></section>`).join('') || '<p class="quiet">Жила для джгутів не розраховується.</p>'}
        <p class="quiet resource-footnote">Залишки введи один раз на переріз і клас, через кому в метрах. Після них добираємо повні барабани. Метраж за завданням, без технологічних втрат; з’єднання залишків перевір окремо.</p></details>
      <details class="card resource-panel" data-resource-panel="tools" ${opened.get('tools') ? 'open' : ''}><summary>Інструмент на завдання <span>${data.tools.length} наборів</span></summary>
        <div class="resource-table-wrap"><table class="resource-table"><thead><tr><th>Провід</th><th>Дорн, мм</th><th>Матриця, мм</th></tr></thead><tbody>${data.tools.map(item => `<tr><th scope="row">${esc(productLabel(item.cableId, item.section))}${isThread(item.cableId) ? esc(diameterLabel(item.finalDiameter)) : esc(classLabel(item))}<small>${item.drumCount} барабанів</small></th><td>${toolValue(item.dorn, item.dornSource)}</td><td>${toolValue(item.matrix, item.matrixSource)}</td></tr>`).join('')}</tbody></table></div>
        <p class="quiet resource-footnote">Інструмент із налаштувань марки та перерізу. Окремих замірів за класами немає — звір дорн із фактичним діаметром жили. ≈ — прогноз.</p></details>`;
  }
  $('plan-resources')?.addEventListener('input', event => {
    const shiftField = event.target.dataset.shiftField, stockField = event.target.dataset.stockField;
    if (shiftField && Object.hasOwn(SHIFT_DEFAULTS, shiftField)) {
      const value = number(event.target.value), valid = value !== null && value >= 0 && value <= 720;
      event.target.setAttribute('aria-invalid', String(!valid));
      if (!valid) return;
      state.shiftSettings[shiftField] = value;
      persist(); $('plan-resources').querySelector('[data-shift-result]').innerHTML = shiftResult(resourceData().shift);
    } else if (['fullLengthKm', 'piecesText'].includes(stockField)) {
      const groupElement = event.target.closest('[data-stock-key]'), key = groupElement?.dataset.stockKey;
      if (!key) return;
      state.coreStock[key] = { ...state.coreStock[key], [stockField]: event.target.value };
      persist(); const group = resourceData().stock.find(item => item.key === key);
      if (group) groupElement.querySelector('[data-stock-result]').innerHTML = stockResult(group);
    }
  });
  function resourcesText() {
    const data = resourceData(), lines = [];
    if (data.draft?.errors.length) return ['Розрахунки завдання: перевір довжини та кольори.'];
    const shift = data.shift;
    lines.push(`За зміну 12 год: ≈ ${fmt(shift.possibleMetres / 1000, 3)} км, ${shift.completedDrums} повних барабанів. ${shift.blocked ? 'Далі бракує швидкості або довжини.' : `Хід лінії ${timeLabel(shift.runningMinutes)}, запуск і переходи ${timeLabel(shift.setupMinutes)}.`}`);
    lines.push(`Поправки, хв: ${Object.entries(shift.settings).map(([key, value]) => `${shiftLabels[key]}: ${value}`).join(', ')}.`);
    for (const group of data.stock) lines.push(`Жила ${stockTitle(group)}: на все завдання ${fmt(group.totalMetres / 1000, 3)} км, залишилось ${fmt(group.remainingMetres / 1000, 3)} км; залишки ${group.piecesText || 'немає'} м; повний барабан ${group.fullLengthKm || 'не вказано'} км; ще повних барабанів: ${group.fullDrums ?? 'уточни дані'}.${group.errors.length ? ' ' + group.errors.join(' ') : ''}`);
    lines.push('Інструмент на все завдання:');
    for (const item of data.tools) lines.push(`${productLabel(item.cableId, item.section)}${classLabel(item)}${isThread(item.cableId) ? diameterLabel(item.finalDiameter) : ''}: дорн ${item.dorn ?? 'немає даних'}, матриця ${item.matrix ?? 'немає даних'} мм.`);
    lines.push('Інструмент за класом окремо не виміряний; перевір фактичний діаметр жили. Метраж без технологічних втрат.');
    return lines;
  }
  function renderSummary() {
    renderResources();
    const s = planSummary(state.drums, state.planJobs), progress = productionSummary(state.drums, state.planJobs);
    const completed = state.drums.filter(d => drumStatus(d) === 'done');
    const pending = state.drums.filter(d => drumStatus(d) !== 'done');
    const remaining = planSummary([...completed, ...pending], state.planJobs);
    const readinessOpen = $('plan-summary').querySelector('.twist-status')?.open ?? false;
    const available = progress.ready.filter(r => r.readyMetres > 0);
    const onlyThread = s.ready.length > 0 && s.ready.every(item => isThread(item.cableId));
    const readyLabel = available.length === 1 ? `${fmt(available[0].readyMetres / 1000, 3)} км (${isThread(available[0].cableId) ? cableLabel(available[0].cableId) + diameterLabel(available[0].finalDiameter) : fmt(available[0].section) + ' мм²'})` : available.length > 1 ? `${available.length} проводів підготовлено` : onlyThread ? 'ще немає готових барабанів' : 'ще немає комплекту кольорів';
    $('plan-summary').innerHTML = `<div class="queue-progress"><div><b>${progress.doneCount} / ${s.drumCount} готово</b><span>${progress.activeCount ? '1 в роботі · ' : ''}${pending.length} залишилось · ${fmt(s.totalMetres / 1000, 3)} км</span></div><progress value="${progress.doneCount}" max="${s.drumCount || 1}" aria-label="Виконання черги"></progress></div>
      ${s.ready.length ? `<details class="twist-status" ${readinessOpen ? 'open' : ''}><summary>${onlyThread ? 'Готовність' : 'Для скрутки'}: ${readyLabel}</summary><ul class="twist-ready twist-readiness">${s.ready.map(item => {
        const job = state.planJobs.find(j => j.id === item.jobId);
        const actual = progress.ready.find(r => r.jobId === item.jobId)?.readyMetres ?? 0;
        const title = job ? jobTitle(job) : productLabel(item.cableId, item.section) + (isThread(item.cableId) ? diameterLabel(item.finalDiameter) : '');
        if (isThread(item.cableId)) {
          const hint = actual >= item.totalMetres ? 'Завдання виконано' : `Залишилось ${fmt(Math.max(0, item.totalMetres - actual) / 1000, 3)} км`;
          return `<li><b>${esc(title)}</b><span>Готово: <strong>${fmt(actual / 1000, 3)} км</strong></span><small>${hint}</small></li>`;
        }
        if (!job) return `<li><b>${esc(title)}</b><span>${fmt(actual / 1000, 3)} км / колір</span><small>Перевір склад завдання.</small></li>`;
        const batch = parseJobLengths(job.lengthsText).lengths.slice(0, Number(job.batchSize)).reduce((sum, length) => sum + length, 0);
        const first = remaining.ready.find(r => r.jobId === item.jobId)?.milestones.find(m => m.readyMetres >= batch);
        const count = first ? Math.max(0, first.afterDrum - completed.length) : null;
        const hint = actual >= batch ? 'Перша партія готова' : count !== null ? `Партія ${fmt(batch / 1000, 3)} км / колір: ще ${count} барабанів` : 'У черзі бракує першої партії';
        return `<li><b>${esc(title)}</b><span><strong>${fmt(actual / 1000, 3)} км</strong> / колір</span><small>${hint}</small></li>`;
      }).join('')}</ul></details>` : ''}
      <details class="plan-overview"><summary>Переходи: ${s.headChanges} розсікач · ${s.colorChanges} колір</summary><p class="quiet">Між проводами: ${s.cableChanges}. Початкове налаштування не враховано.</p></details>
      ${[...s.errors, ...s.warnings].map(w => `<p class="error">${esc(w)}</p>`).join('')}`;
    $('plan-order-status').hidden = !state.planDirty && !state.manualOrder;
    $('plan-order-status').textContent = state.planDirty ? 'Завдання змінено — склади чергу.' : 'Ручний порядок збережено';
    $('undo-plan').hidden = !state.previousPlan;
    $('restore-cleared-plan').hidden = !state.previousPlan;
    $('restore-cleared-plan').textContent = state.previousPlan?.reason === 'clear' ? 'Повернути очищену чергу' : 'Скасувати дію';
    $('restore-plan-order').disabled = pending.length < 2;
    $('clear-plan').disabled = !state.drums.length;
  }
  function compact(drum, i) {
    const r = result(drum, i), status = drumStatus(drum);
    const screen = r.target !== number(drum.length) && status !== 'done' && r.target > 0 ? `<small>Екран ${fmt(r.target)} м</small>` : '';
    const title = isThread(drum.cableId) ? cableLabel(drum.cableId) + diameterLabel(drum.finalDiameter) : `${optionFor(drum.cableId)?.brand ?? cableLabel(drum.cableId)} ${fmt(drum.section)}${classLabel(drum)}`;
    const cue = status === 'done' ? '' : r.errors.length ? 'Перевір довжину' : r.target === 0 ? 'Перевір зупинку' : r.transition ? r.events.map(event => `№${event.extruder}: ${fmt(event.at)} м`).join(' · ') + (r.setupChange ? ' · стоп' : '') : r.cableChange ? isThread(drum.cableId) ? 'Зміна нитки' : 'Зміна жили' : r.headChange ? 'Змінити розсікач' : r.modeChange ? 'Перемкнути екструдери' : r.matrixChange ? 'Змінити матрицю' : '';
    return `${isThread(drum.cableId) ? '' : swatch(drum.color)}<span class="sr-only">${streamLabel(drum)}. </span><span class="drum-title"><b>${esc(title)}</b>${cue ? `<small class="queue-alert">${r.transition ? 'Барвник ' : ''}${esc(cue)}</small>` : ''}</span><span class="drum-length"><b>${fmt(number(drum.length) === null ? null : number(drum.length) / 1000, 3)} км</b>${screen}</span>`;
  }
  function neighborIndex(i, direction) {
    const target = i + direction;
    return target >= 0 && target < state.drums.length ? target : -1;
  }
  function cardMarkup(drum, i, opened) {
    const status = drumStatus(drum), locked = status !== 'queued' ? 'disabled' : '';
    const label = `${drumTitle(drum)}, ${streamLabel(drum).toLowerCase()}, ${fmt(drum.length)} м`;
    const modeField = `<label class="drum-mode-picker" data-mode-picker ${modePicker(drum) ? '' : 'hidden'}>Екструдери<select data-field="mode" ${locked}><option value="" ${!drum.mode ? 'selected' : ''}>Авто</option><option value="single" ${drum.mode === 'single' ? 'selected' : ''}>1</option><option value="dual" ${drum.mode === 'dual' ? 'selected' : ''}>2</option></select></label><label data-class-picker ${isThread(drum.cableId) ? 'hidden' : ''}>Клас жили<select data-field="coreClass" ${locked}>${classOptions(drum.coreClass)}</select></label>`;
    return `<article class="card drum queue-card ${status === 'active' ? 'is-active' : status === 'done' ? 'is-done' : ''}" data-drum="${esc(drum.id)}" data-status="${status}" data-color="${esc(drum.color)}" style="--done-color:${COLORS.find(c => c.id === drum.color)?.hex ?? '#aaa'}">
      <div class="queue-row"><button class="drag-handle icon-button" type="button" data-drag-handle aria-label="Перетягнути: ${esc(label)}. Стрілки переміщують вгору та вниз.">☰</button>
      <details class="drum-details" data-details="${esc(drum.id)}" ${opened.has(drum.id) ? 'open' : ''}><summary class="drum-summary">${compact(drum, i)}</summary><div class="drum-fields"><div class="form-grid"><label>Провід<select data-field="cableId" ${locked}>${options(drum.cableId)}</select></label><label ${isThread(drum.cableId) ? 'hidden' : ''}>Переріз, мм²<select data-field="section" ${locked}>${sections(drum.cableId, drum.section)}</select></label><label data-diameter-picker ${isThread(drum.cableId) ? '' : 'hidden'}>Фінальний діаметр, мм<input data-field="finalDiameter" inputmode="decimal" maxlength="12" value="${esc(drum.finalDiameter)}" placeholder="Із завдання" ${locked}></label><label data-color-picker ${isThread(drum.cableId) ? 'hidden' : ''}>Колір<select data-field="color" ${locked}>${colorOptions(drum.color)}</select></label>${modeField}<label>Потрібна довжина, м<input data-field="length" inputmode="numeric" value="${esc(drum.length)}" maxlength="20" ${locked}></label><label>Номер барабана<input data-field="name" maxlength="80" value="${esc(drum.name)}"></label><label>Пробій на метрі<input data-field="breakdowns" maxlength="2000" placeholder="3682; 9240" value="${esc(drum.breakdowns)}"></label></div><div data-output="${esc(drum.id)}">${output(drum, i)}</div><p class="drum-transition" data-transition="${esc(drum.id)}" ${transitionText(drum, i) ? '' : 'hidden'}>${esc(transitionText(drum, i))}</p>${locked ? '<p class="quiet">Для редагування поверни запис до черги.</p>' : ''}</div></details></div>
      <div class="drum-actions">${status !== 'done' ? `<button type="button" class="queue-status" data-action="active" aria-pressed="${status === 'active'}" title="${status === 'active' ? 'Повернути до черги' : 'Почати цей барабан'}">В роботі</button>` : ''}<button type="button" class="queue-status" data-action="done" aria-pressed="${status === 'done'}" title="${status === 'done' ? 'Повернути до черги' : 'Позначити виконаним'}">${status === 'done' ? 'Не готово' : 'Готово'}</button><button type="button" class="cable-info icon-button" data-action="info" aria-label="Налаштування: ${esc(label)}" title="Налаштування проводу">ⓘ</button><details class="queue-more"><summary aria-label="Інші дії" title="Інші дії">⋯</summary><div class="order-controls"><button type="button" class="icon-button" data-action="up" aria-label="Перемістити вгору" ${neighborIndex(i, -1) < 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-action="down" aria-label="Перемістити вниз" ${neighborIndex(i, 1) < 0 ? 'disabled' : ''}>↓</button><button type="button" class="icon-button" data-action="remove" aria-label="Прибрати запис">×</button></div></details></div>
      </article>`;
  }
  function renderQueue() {
    setupCache.clear();
    const opened = new Set([...$('drums').querySelectorAll('.drum-details[open]')].map(el => el.dataset.details));
    renderSummary();
    $('drums').innerHTML = state.drums.map((drum, i) => cardMarkup(drum, i, opened)).join('') || '<div class="empty-queue"><p>Черга порожня.</p><button class="primary" type="button" data-generate-queue>Скласти із завдання</button></div>';
  }
  function renderOutputs() {
    setupCache.clear(); renderSummary();
    state.drums.forEach((drum, i) => {
      const card = $('drums').querySelector(`[data-drum="${window.CSS.escape(drum.id)}"]`);
      if (!card) return;
      card.querySelector('.drum-summary').innerHTML = compact(drum, i);
      const label = `${drumTitle(drum)}, ${streamLabel(drum).toLowerCase()}, ${fmt(drum.length)} м`;
      card.querySelector('[data-action="info"]').setAttribute('aria-label', `Налаштування: ${label}`);
      card.querySelector('[data-drag-handle]')?.setAttribute('aria-label', `Перетягнути: ${label}. Стрілки переміщують вгору та вниз.`);
      card.querySelector('[data-output]').innerHTML = output(drum, i);
      const note = card.querySelector('[data-transition]');
      note.textContent = transitionText(drum, i); note.hidden = !note.textContent;
    });
  }
  function render() {
    $('plan-title').textContent = 'План барабанів';
    renderJobs(); renderQueue();
  }
  function savePrevious(reason = 'edit') { state.previousPlan = copy({ drums: state.drums, planJobs: state.planJobs, manualOrder: state.manualOrder, reason }); }
  function reordered(id, targetIndex, focus = false) {
    const from = state.drums.findIndex(d => d.id === id);
    if (from < 0 || from === targetIndex) return;
    savePrevious(); state.drums = moveDrum(state.drums, id, targetIndex); state.manualOrder = true;
    persist(); renderQueue(); haptic();
    $('plan-live').textContent = `Барабан ${from + 1} переміщено на позицію ${targetIndex + 1}.`;
    if (focus) $('drums').querySelector(`[data-drum="${window.CSS.escape(id)}"] [data-drag-handle]`)?.focus({ preventScroll: true });
  }
  function generate() {
    const planned = scheduleJobs(state.jobs, state.drums);
    if (planned.errors.length) { $('job-message').textContent = planned.errors.join('\n'); return; }
    savePrevious(); state.drums = planned.drums; state.planJobs = copy(state.jobs); state.planDirty = false; state.manualOrder = false;
    persist(); renderQueue(); $('job-builder').open = false;
    $('job-message').textContent = `Складено ${state.drums.length} барабанів. ${planned.warnings?.join(' ') ?? ''}`;
    if (planned.warnings?.length) toast(planned.warnings.join(' '));
    $('plan-summary').scrollIntoView({ block: 'start' });
    haptic();
  }
  function updateJob(event) {
    const card = event.target.closest('[data-job]');
    if (!card) return;
    const job = state.jobs.find(j => j.id === card.dataset.job), field = event.target.dataset.jobField;
    if (field === 'lengthsText' && event.target.value.includes('*')) {
      const { selectionStart, selectionEnd, selectionDirection } = event.target;
      event.target.value = event.target.value.replaceAll('*', '×');
      if (selectionStart !== null && selectionStart !== undefined) event.target.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
    }
    if (event.target.dataset.jobColor) {
      const color = event.target.dataset.jobColor;
      job.colors = event.target.checked ? [...new Set([...job.colors, color])] : job.colors.filter(c => c !== color);
      job.cores = job.colors.length;
    } else if (field) {
      if (field === 'urgent') job.urgent = event.target.checked;
      else if (['section', 'batchSize'].includes(field)) job[field] = number(event.target.value);
      else if (field === 'coreClass') { if (coreClass(event.target.value)) job.coreClass = coreClass(event.target.value); else delete job.coreClass; }
      else job[field] = event.target.value;
      if (field === 'cableId') { const cable = optionFor(job.cableId); if (!cable.sections.includes(Number(job.section))) job.section = cable.sections[0];
        const mode = preference(state, job.cableId).mode; if (mode) job.mode = mode; else delete job.mode;
        if (isThread(job.cableId)) { job.cores = 1; job.colors = ['white']; job.urgent = false; delete job.coreClass; }
        else if (job.cores === 1 && JSON.stringify(job.colors) === JSON.stringify(['white'])) { job.cores = 3; job.colors = palette.slice(0, 3); }
      }
      job.cores = job.colors.length;
    } else return;
    state.planDirty = true; persist(); $('job-message').textContent = '';
    if (field === 'cableId') renderJobs();
    else card.querySelector('[data-job-total]').textContent = jobTotal(job);
    renderSummary();
  }
  $('jobs').addEventListener('input', updateJob);
  $('jobs').addEventListener('click', event => {
    const button = event.target.closest('[data-job-action]'); if (!button) return;
    const i = state.jobs.findIndex(j => j.id === button.closest('[data-job]').dataset.job);
    if (button.dataset.jobAction === 'remove' && state.jobs.length > 1) state.jobs.splice(i, 1);
    else { const next = i + (button.dataset.jobAction === 'up' ? -1 : 1); if (next >= 0 && next < state.jobs.length) [state.jobs[i], state.jobs[next]] = [state.jobs[next], state.jobs[i]]; }
    state.planDirty = true; persist(); renderJobs(); renderSummary();
  });
  $('add-job').addEventListener('click', () => {
    if (state.jobs.length >= 50) return toast('У завданні вже 50 проводів.');
    state.jobs.push(state.jobs.length ? duplicateJob(state.jobs.at(-1)) : newJob(state.cableId, state.section, { ...preference(state, state.cableId), ...(isThread(state.cableId) ? { finalDiameter: String(state.finalDiameter ?? '') } : {}) })); state.planDirty = true; persist(); renderJobs(); renderSummary();
  });
  $('load-plan-example').addEventListener('click', () => {
    const cableId = optionFor('vvgng-p').id;
    state.jobs = [newJob(cableId, 2.5, { ...preference(state, cableId), lengthsText: '3×15,0 + 3×15,0 + 11,0' }), newJob(cableId, 1.5, { ...preference(state, cableId), cores: 2, colors: ['yellow-green', 'blue'], lengthsText: '3×15,0 + 11,0' })];
    state.planDirty = true; persist(); renderJobs(); renderSummary();
    $('job-message').textContent = 'Приклад із фото заповнено. Кожен колір: 101 км для 3×2,5 та 56 км для 2×1,5. Натисни «Скласти чергу».';
  });
  $('generate-plan').addEventListener('click', generate);
  $('restore-plan-order').addEventListener('click', () => {
    savePrevious(); state.drums = recommendOrder(state.drums, state.planJobs); state.manualOrder = false; persist(); renderQueue(); haptic();
  });
  function undo() {
    if (!state.previousPlan) return;
    const previous = state.previousPlan;
    state.drums = previous.drums; state.planJobs = previous.planJobs; state.manualOrder = previous.manualOrder;
    state.previousPlan = null;
    state.planDirty = JSON.stringify(state.jobs) !== JSON.stringify(state.planJobs);
    persist(); renderQueue(); toast(previous.reason === 'clear' ? 'Чергу повернуто.' : 'Дію скасовано.');
  }
  function syncSelection() {
    const changed = syncPlannerSelection(state);
    if (changed) persist();
    return changed;
  }
  $('undo-plan').addEventListener('click', undo);
  $('restore-cleared-plan').addEventListener('click', undo);
  $('clear-plan').addEventListener('click', () => {
    if (!state.drums.length) return;
    savePrevious('clear'); state.drums = []; state.planJobs = []; state.manualOrder = false; state.planDirty = false;
    persist(); renderQueue(); toast('Чергу очищено. Можна повернути її кнопкою вище.');
  });
  $('add-drum').addEventListener('click', () => {
    if (state.drums.length >= MAX_DRUMS) return toast(`У плані вже ${MAX_DRUMS} барабанів.`);
    savePrevious(); state.drums.push({ id: crypto.randomUUID(), jobId: '', cableId: state.cableId, section: state.section, color: state.color, length: '15000', name: '', breakdowns: '', status: 'queued', ...preference(state, state.cableId), ...(isThread(state.cableId) ? { finalDiameter: String(state.finalDiameter ?? '') } : {}) });
    state.manualOrder = true; persist(); renderQueue();
  });
  $('drums').addEventListener('input', event => {
    const card = event.target.closest('[data-drum]'), field = event.target.dataset.field;
    if (!card || !field) return;
    const drum = state.drums.find(d => d.id === card.dataset.drum);
    drum[field] = field === 'section' ? Number(event.target.value) : event.target.value;
    if (field === 'coreClass') { if (coreClass(event.target.value)) drum.coreClass = coreClass(event.target.value); else delete drum.coreClass; }
    if (field === 'mode' && !['single', 'dual'].includes(drum.mode)) delete drum.mode;
    if (field === 'cableId') {
      const cable = optionFor(drum.cableId); if (!cable.sections.includes(drum.section)) drum.section = cable.sections[0];
      const select = card.querySelector('[data-field="section"]'); select.innerHTML = sections(drum.cableId, drum.section);
      select.closest('label').hidden = isThread(drum.cableId);
      card.querySelector('[data-diameter-picker]').hidden = !isThread(drum.cableId);
      card.querySelector('[data-color-picker]').hidden = isThread(drum.cableId);
      card.querySelector('[data-class-picker]').hidden = isThread(drum.cableId);
      if (isThread(drum.cableId)) delete drum.coreClass;
      card.querySelector('[data-field="coreClass"]').value = String(coreClass(drum.coreClass) ?? '');
    }
    if (field === 'cableId' || field === 'color') card.querySelector('[data-mode-picker]').hidden = !modePicker(drum);
    state.manualOrder = true; persist(); renderOutputs();
  });
  $('drums').addEventListener('click', event => {
    if (event.target.closest('[data-generate-queue]')) { generate(); return; }
    const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
    const i = state.drums.findIndex(d => d.id === button.closest('[data-drum]').dataset.drum);
    if (i < 0) return;
    if (button.dataset.action === 'info') { onCableInfo?.(state.drums[i]); return; }
    if (['active', 'done'].includes(button.dataset.action)) {
      const drum = state.drums[i], desired = button.dataset.action;
      savePrevious('status'); state.drums = setDrumStatus(state.drums, drum.id, drumStatus(drum) === desired ? 'queued' : desired);
      persist(); renderQueue(); haptic();
      $('plan-live').textContent = `${drumTitle(drum)}, ${streamLabel(drum)}: ${drumStatus(state.drums[i]) === 'done' ? 'готово' : drumStatus(state.drums[i]) === 'active' ? 'в роботі' : 'повернуто до черги'}.`;
      const focusId = drumStatus(state.drums[i]) === 'done' ? (nextDrum(i) ?? state.drums.find(d => drumStatus(d) !== 'done'))?.id : drum.id;
      if (focusId) $('drums').querySelector(`[data-drum="${window.CSS.escape(focusId)}"] [data-action="active"]`)?.focus({ preventScroll: true });
      else $('drums').querySelector(`[data-drum="${window.CSS.escape(drum.id)}"] [data-action="done"]`)?.focus({ preventScroll: true });
      return;
    }
    if (button.dataset.action === 'remove') { savePrevious(); state.drums.splice(i, 1); state.manualOrder = true; persist(); renderQueue(); }
    else { const target = neighborIndex(i, button.dataset.action === 'up' ? -1 : 1); if (target >= 0) reordered(state.drums[i].id, target, true); }
  });
  $('drums').addEventListener('keydown', event => {
    if (!event.target.matches('[data-drag-handle]') || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const id = event.target.closest('[data-drum]').dataset.drum, i = state.drums.findIndex(d => d.id === id);
    const next = neighborIndex(i, event.key === 'ArrowUp' ? -1 : 1);
    if (next >= 0 && next < state.drums.length) reordered(id, next, true);
  });
  function markDrop() {
    if (!drag?.started) return;
    $('drums').querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    const cards = [...$('drums').querySelectorAll('[data-drum]')];
    const element = document.elementFromPoint(drag.x, drag.y)?.closest('[data-drum]');
    const hovered = cards.includes(element) ? element : null;
    const card = hovered ?? cards.find(el => el.getBoundingClientRect().bottom > drag.y) ?? cards.at(-1);
    if (!card) return;
    const rect = card.getBoundingClientRect(), index = state.drums.findIndex(d => d.id === card.dataset.drum), after = drag.y > rect.top + rect.height / 2;
    const insertion = index + (after ? 1 : 0);
    drag.target = Math.max(0, Math.min(state.drums.length - 1, insertion - (drag.from < insertion ? 1 : 0)));
    if (drag.target !== drag.from) card.classList.add(after ? 'drop-after' : 'drop-before');
  }
  function scrollDrag() {
    if (!drag?.started) return;
    const edge = 85, height = window.innerHeight;
    const amount = drag.y < edge ? -Math.ceil((edge - drag.y) / 5) : drag.y > height - edge ? Math.ceil((drag.y - height + edge) / 5) : 0;
    if (amount) { window.scrollBy(0, amount); markDrop(); }
    scrollFrame = window.requestAnimationFrame(scrollDrag);
  }
  function cancelDrag() {
    if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
    $('drums').querySelectorAll('.is-dragging,.drop-before,.drop-after').forEach(el => el.classList.remove('is-dragging', 'drop-before', 'drop-after'));
    const previous = drag; drag = null;
    if (previous?.handle.hasPointerCapture(previous.pointer)) previous.handle.releasePointerCapture(previous.pointer);
  }
  $('drums').addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-drag-handle]');
    if (!handle || event.button !== 0 || drag) return;
    event.preventDefault(); handle.focus({ preventScroll: true });
    const card = handle.closest('[data-drum]'), from = state.drums.findIndex(d => d.id === card.dataset.drum);
    drag = { id: card.dataset.drum, from, target: from, handle, card, pointer: event.pointerId, x: event.clientX, y: event.clientY, startY: event.clientY, started: false };
    handle.setPointerCapture(event.pointerId);
  });
  $('drums').addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.started && Math.abs(drag.y - drag.startY) > 5) { drag.started = true; drag.card.classList.add('is-dragging'); haptic(); scrollDrag(); }
    markDrop();
  });
  $('drums').addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { id, target, started } = drag; cancelDrag(); if (started) reordered(id, target, true);
  });
  $('drums').addEventListener('pointercancel', cancelDrag);
  $('drums').addEventListener('lostpointercapture', () => { if (drag) cancelDrag(); });
  document.addEventListener('keydown', event => { if (drag && event.key === 'Escape') { event.preventDefault(); cancelDrag(); } });
  window.addEventListener('blur', cancelDrag);
  let printOpened = null;
  window.addEventListener('beforeprint', () => {
    if (printOpened !== null) return;
    printOpened = [...$('drums').querySelectorAll('details:not([open])'), ...($('plan-resources')?.querySelectorAll('.resource-panel:not([open])') ?? [])];
    printOpened.forEach(el => { el.open = true; });
  });
  window.addEventListener('afterprint', () => { printOpened?.forEach(el => { el.open = false; }); printOpened = null; });
  if (state.planJobs.length && !state.planDirty) $('job-builder').open = false;
  return { render, renderQueue, renderOutputs, result, transitionText, setup, drumTitle, syncSelection, resourcesText };
}
