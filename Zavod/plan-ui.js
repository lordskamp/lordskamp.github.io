import { calculateProduction, coilLength, isCoilingBrand } from './coiling.js?v=3';
import { estimateColorLead2 } from './color-lead.js?v=27';
import { applyMarkingSpeed } from './marking.js?v=1';
import { VALUE_LABELS } from './setup-data.js?v=33';
import { normalizeDyeSlots, planDyeSlots, EMPTY_DYE } from './dye-slots.js?v=2';
import { COLORS, colorName, dyePlan, fmt, number, planDrum, splitterFor } from './core.js?v=30';
import { MAX_DRUMS, parseJobLengths, scheduleJobs, recommendOrder, moveDrum, planSummary, drumStatus, setDrumStatus, productionSummary, journalNumbers, lastJournalNumber, nextDrumStatus } from './planner.js?v=35';
import { CATALOG_CABLES, optionFor } from './catalog-base.js?v=27';
import { shiftSettings, coreClass, conductorRequirements, estimateShift, requiredTools } from './plan-resources.js?v=29';

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
const requestedMode = drum => isThread(drum.cableId) ? 'single' : ['black', 'yellow-green'].includes(drum.color) ? 'dual' : drum.idealColor === true ? 'single' : ['single', 'dual'].includes(drum.mode) ? drum.mode : undefined;
const modePicker = drum => !isThread(drum.cableId) && !drum.idealColor && !['black', 'yellow-green'].includes(drum.color);
const preference = (state, cableId) => !isThread(cableId) && ['single', 'dual'].includes(state.modePreferences?.[cableId]) ? { mode: state.modePreferences[cableId] } : {};
const options = selected => CATALOG_CABLES.map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
const sections = (id, selected) => (optionFor(id)?.sections ?? []).map(s => `<option value="${s}" ${Number(selected) === s ? 'selected' : ''}>${isThread(id) ? 'Нитка' : fmt(s)}</option>`).join('');
const colorOptions = selected => COLORS.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.label}</option>`).join('');
const swatch = color => `<span class="color-dot" data-color="${esc(color)}" style="--swatch:${COLORS.find(c => c.id === color)?.hex ?? '#aaa'}" aria-hidden="true"></span>`;
const classOptions = selected => `<option value="">Обери клас</option>${[1, 2, 3, 4, 5, 6].map(value => `<option value="${value}" ${coreClass(selected) === value ? 'selected' : ''}>${value}</option>`).join('')}`;
const classLabel = item => coreClass(item.coreClass) ? ` · ${coreClass(item.coreClass)} клас` : '';
const combinedMarks = drum => [drum.breakdowns, drum.joints].map(value => String(value ?? '').trim()).filter(Boolean).join('; ').slice(0, 4002);
const timeLabel = minutes => `${Math.floor(Math.ceil(minutes) / 60)} год ${Math.ceil(minutes) % 60} хв`;
const pluralRules = new Intl.PluralRules('uk-UA');
const countWord = (count, one, few, many) => ({ one, few, many, other: many })[pluralRules.select(count)];
const shiftLabels = { lunch: 'Обід', alarms: 'Повітряні тривоги', breaks: 'Перекури й перерви', startup: 'Запуск зміни', drum: 'Заміна барабана', tooling: 'Зміна інструмента / режиму', conductor: 'Зміна марки, перерізу чи класу', color: 'Зміна / стравлення кольору' };

export function restartTarget(input) {
  const raw = String(input ?? '').trim();
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value >= 0 && Number.isSafeInteger(value + 170) ? value + 170 : null;
}

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
  state.dyeSlots = normalizeDyeSlots(saved?.dyeSlots);
  state.journalLast = String(saved?.journalLast ?? '').slice(0, 15);
  state.shiftSettings = shiftSettings(saved?.shiftSettings);
  state.coreStock = Object.fromEntries(Object.entries(saved?.coreStock ?? {}).filter(([key, entry]) => /^\d+(?:\.\d+)?:[1-6?]$/u.test(key) && entry && typeof entry === 'object')
    .slice(0, 200).map(([key, entry]) => [key, { ...(entry.fullLengthKm === undefined ? {} : { fullLengthKm: String(entry.fullLengthKm).slice(0, 20) }), piecesText: String(entry.piecesText ?? '').slice(0, 2000) }]));
  const restoreJobs = rows => (Array.isArray(rows) ? rows : []).slice(0, MAX_DRUMS).filter(j => j && optionFor(j.cableId)).map(j => {
    const cable = optionFor(j.cableId);
    return newJob(cable.id, cable.sections.includes(Number(j.section)) ? Number(j.section) : cable.sections[0], {
      id: savedId(j.id),
      cores: j.cores ?? 3, colors: Array.isArray(j.colors) ? j.colors.filter(c => COLORS.some(row => row.id === c)) : [],
      ...(coreClass(j.coreClass) ? { coreClass: coreClass(j.coreClass) } : {}),
      ...(j.coiling === true ? { coiling: true } : {}), ...(j.idealColor === true ? { idealColor: true } : {}), ...(j.marking === true ? { marking: true } : {}), lengthsText: String(j.lengthsText ?? '').slice(0, 2000).replaceAll('*', '×'), urgent: j.urgent === true, batchSize: j.batchSize ?? 3,
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
      color: d.color, length: String(d.length ?? '').slice(0, 20), name: String(d.name ?? '').slice(0, 80), breakdowns: combinedMarks(d), ...(Number.isSafeInteger(d.journalNumber) && d.journalNumber > 0 ? { journalNumber: d.journalNumber } : {}), ...(d.coiling === true ? { coiling: true } : {}), ...(d.idealColor === true ? { idealColor: true } : {}), ...(d.marking === true ? { marking: true } : {}), status,
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
  let drag = null, scrollFrame = null, playerId = null, numbering = new Map();
  const restartCounters = new Map();
  const setupCache = new Map();

  state.shiftSettings ??= shiftSettings(); state.coreStock ??= {}; state.dyeSlots = normalizeDyeSlots(state.dyeSlots);
  const journalInput = $('journal-last'), journalHelp = $('journal-help');
  journalInput.value = state.journalLast ?? '';
  function journalValidity() {
    const invalid = Boolean(journalInput.value.trim()) && lastJournalNumber(journalInput.value) === null;
    journalInput.setAttribute('aria-invalid', String(invalid));
    journalHelp.textContent = invalid ? 'Вкажи цілий невід’ємний номер.' : 'Останній записаний номер. Наступні номери — у черзі.';
    journalHelp.classList.toggle('error', invalid);
  }
  journalValidity();
  journalInput.addEventListener('input', () => {
    state.journalLast = journalInput.value; journalValidity(); persist(); renderQueue();
  });
  const slotPanel = $('dye-slots');
  slotPanel.innerHTML = '<summary>Барвники</summary><div class="dye-slot-panel"><p>Які барвники вже у відсіках?</p><div class="dye-slot-grid">' + state.dyeSlots.map((value, i) => `<label>№${Math.floor(i / 2) + 1} · відсік ${i % 2 + 1}<select data-dye-slot="${i}"><option value="">Невідомо</option><option value="empty" ${value === EMPTY_DYE ? 'selected' : ''}>Порожній</option>${COLORS.filter(color => color.id !== 'yellow-green').map(color => `<option value="${esc(color.id)}" ${color.id === value ? 'selected' : ''}>${esc(color.label)}</option>`).join('')}</select></label>`).join('') + '</div><small>Наявність у відсіку не означає, що він зараз подається.</small><button type="button" class="secondary" data-order-dyes>Перебудувати чергу</button></div>';
  slotPanel.addEventListener('change', event => {
    const index = Number(event.target.dataset.dyeSlot);
    if (!Number.isInteger(index) || index < 0 || index > 3) return;
    state.dyeSlots[index] = normalizeDyeSlots([event.target.value])[0];
    if (!state.manualOrder) state.drums = recommendOrder(state.drums, { slots: state.dyeSlots });
    persist(); renderQueue();
  });
  slotPanel.addEventListener('click', event => {
    if (!event.target.closest('[data-order-dyes]')) return;
    if (state.drums.length > 1) { savePrevious(); state.drums = recommendOrder(state.drums, { slots: state.dyeSlots }); state.manualOrder = false; persist(); renderQueue(); }
    slotPanel.open = false;
  });
  const drumTitle = drum => {
    const job = state.planJobs.find(j => j.id === drum.jobId);
    return isThread(drum.cableId) ? cableLabel(drum.cableId) + diameterLabel(drum.finalDiameter) : `${cableLabel(drum.cableId)} ${job ? fmt(job.colors.length) + '×' : ''}${fmt(drum.section)}${classLabel(drum)}`;
  };
  const setup = drum => {
    const mode = requestedMode(drum);
    const key = JSON.stringify([drum.cableId, drum.section, drum.color, drum.finalDiameter, mode, drum.marking === true]);
    if (!setupCache.has(key)) {
      const info = applyMarkingSpeed(getSetup(drum.cableId, drum.section, drum.color, drum.finalDiameter, mode), drum.marking);
      setupCache.set(key, info);
    }
    return setupCache.get(key);
  };
  function result(drum, i) {
    const info = setup(drum), next = drumStatus(drum) === 'done' ? null : nextDrum(i);
    const nextInfo = next ? setup(next) : null;
    const rules = { ...state.rules };
    let lead2FromStop = false, firstLeadMeasured = false;
    for (const [field, rule] of [['colorLead1', 'lead1'], ['colorLead2', 'lead2']]) {
      const own = [info.practical?.[field], info.stored?.[field]].map(number).find(value => value !== null && value >= 0);
      const explicitClass = coreClass(drum.coreClass);
      const classEstimate = field === 'colorLead2' && explicitClass ? estimateColorLead2({ conductorClass: explicitClass, section: drum.section, mode: info.mode, noDye: info.noDye }) : null;
      const modeled = ['operator-anchor', 'operator-interpolation'].includes(info.forecast?.fieldMethods?.[field]);
      const model = field === 'colorLead2' && explicitClass ? classEstimate?.value : modeled ? number(info.effective?.[field]) : null;
      const lead = own ?? (model !== null && model !== undefined && model >= 0 ? model : null);
      if (field === 'colorLead1') firstLeadMeasured = own !== undefined;
      if (lead !== null && lead >= 0) rules[rule] = lead;
      if (field === 'colorLead2' && own === undefined && model !== null && model !== undefined && model >= 0) lead2FromStop = true;
    }
    // The PVS observation does not establish a stop-relative lead: the actual
    // operating settings and exact stop reading are unknown. Do not schedule
    // a calculated switch until a suitable practical lead is recorded.
    const uncalibratedPvsTransition = optionFor(drum.cableId)?.id === 'pvs-380--pvs'
      && drum.color === 'yellow-green' && next?.color === 'brown' && nextInfo?.mode === 'single' && !firstLeadMeasured;
    if (uncalibratedPvsTransition) rules.lead1 = 0;
    const brand = optionFor(drum.cableId)?.brand;
    const coiling = isCoilingBrand(brand);
    const production = calculateProduction(drum.length, drum.breakdowns, drum.joints, coiling, coilLength(brand, drum.section));
    // A one-extruder drum does not alter the installed splitter. Walk back
    // to the last known dual-extruder requirement; threads break that context.
    let mountedSplitter = null;
    for (let pos = i; pos >= 0; pos--) {
      const earlier = state.drums[pos];
      if (isThread(earlier.cableId)) break;
      const earlierInfo = setup(earlier);
      mountedSplitter = splitterFor(earlier.color, earlierInfo.mode, earlierInfo.noDye);
      if (mountedSplitter) break;
    }
    const planned = planDrum({ ...drum, length: production.target ?? drum.length, mode: info.mode, noDye: info.noDye }, next ? { ...next, mode: nextInfo.mode, noDye: nextInfo.noDye } : null, info.mode, { ...rules, currentSplitter: mountedSplitter });
    const errors = [...new Set([...planned.errors, ...production.errors])];
    if (planned.transition && uncalibratedPvsTransition) {
      planned.events = planned.events.filter(event => event.extruder !== 1);
      planned.warnings.push('Для №1 момент перемикання не визначено: потрібен практичний замір для цього переходу.');
    } else if (planned.transition && planned.events.some(event => event.extruder === 1) && !firstLeadMeasured) {
      planned.warnings.push('Для №1 використано загальне налаштування, а не перевірений замір. Момент перемикання потрібно уточнити.');
    }
    const stopAt = planned.transition ? Math.max(0, planned.length - rules.bath) : null;
    if (lead2FromStop && planned.transition) {
      planned.events = planned.events.flatMap(event => {
        if (event.extruder !== 2) return [event];
        const at = stopAt - event.lead;
        if (at < 0) { planned.warnings.push('Орієнтир барвника №2 раніше початку барабана — потрібен окремий план.'); return []; }
        return [{ ...event, at, fromStop: true }];
      }).sort((a, b) => a.at - b.at);
    }
    return { ...planned, errors, target: errors.length ? null : planned.target, splice: production.splice, production, stopAt, coiling };
  }
  const nextDrum = i => state.drums.slice(i + 1).find(d => drumStatus(d) !== 'done');
  function transitionText(drum, i) {
    const next = nextDrum(i), r = result(drum, i);
    if (!next || drumStatus(drum) === 'done') return '';
    if (r.errors.length) return r.errors.join(' ');
    let colorTransition = '';
    if (r.transition) {
      const events = r.events.map(e => `Барвник №${e.extruder} — ${e.fromStop ? e.lead === 0 ? 'після зупинки' : 'орієнтовно за ' + fmt(e.lead) + ' м до зупинки' : 'за ' + fmt(e.lead) + ' м до кінця (старе налаштування)'}, на ${fmt(e.at)} м.`);
      colorTransition = `Далі — ${colorName(next.color).toLowerCase()}. Екран: ${r.formula}. Планова зупинка: ${fmt(r.stopAt)} м. ${events.join(' ')}${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}`.trim();
    }
    if (!r.setupChange && !r.headUnknown) return colorTransition;
    const changes = [];
    if (r.headChange) changes.push(next.color === 'yellow-green' ? 'поставити розсікач для жовто-зеленого' : 'поставити розсікач для суцільного кольору');
    else if (r.headUnknown) changes.push(next.color === 'yellow-green' ? 'перевірити розсікач для жовто-зеленого' : 'перевірити розсікач для суцільного кольору');
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
      ${r.transition ? `<ol class="steps">${r.events.filter(e => !(e.fromStop && e.lead === 0)).map(e => `<li><b>≈ ${fmt(e.at)} м</b> — барвник №${e.extruder}: ${esc(e.dye.toLowerCase())} (${e.fromStop ? `за ${fmt(e.lead)} м до планової зупинки` : `за ${fmt(e.lead)} м до кінця · старе налаштування`})</li>`).join('')}<li>Планова зупинка — ${fmt(r.stopAt)} м.</li>${r.events.filter(e => e.fromStop && e.lead === 0).map(e => `<li>Після зупинки перемкнути барвник №${e.extruder}: ${esc(e.dye.toLowerCase())}.</li>`).join('')}<li>Стравити через байпас, потім через головку.</li><li>Коли колір придатний, запустити лінію. Після появи якісного кабелю додати 170 м до фактичного показу й встановити перекидання. На вихідному барабані відмотати неякісну ділянку, щоб залишився якісний попередній кабель.</li>${r.setupChange ? '<li>Розсікач або режим екструдерів змінити після зупинки.</li>' : ''}</ol><p class="quiet formula">${esc(r.formula)}</p>` : `<p class="quiet">${r.cableChange ? `Зупинися раніше: решта ${isThread(drum.cableId) ? 'нитки' : 'жили'} вже у ванні. Резерв зміни кольору не додається.` : r.setupChange ? isThread(drum.cableId) ? 'Перехід після зупинки. Без барвника.' : 'Перехід після зупинки. Випередження зміни барвника не розраховується.' : isThread(drum.cableId) ? 'Без барвника.' : 'Без поправки на зміну кольору.'}</p>${r.cableChange ? `<p class="quiet formula">${esc(r.formula)}</p>` : ''}`}
      ${r.warnings.map(w => `<p class="error">${esc(w)}</p>`).join('')}${r.splice?.spliceCount ? `<p class="drum-splice-label">На лейбл: <b data-splice-label>${esc(r.splice.label)}</b></p>` : ''}${r.coiling ? `<p class="drum-splice-label">Бухтовка: <b>${fmt(r.production.coils)} × ${fmt(r.production.size)} м</b>${r.production.remainder ? ` · залишок ${fmt(r.production.remainder)} м` : ''}</p><p class="quiet">Додатково: <b>+${fmt(r.production.waste)} м</b> · потрібна довжина: <b>${fmt(r.production.target)} м</b>. Неповні відрізки до позначок не входять у бухти.</p>` : ''}`;
  }
  function jobTotal(job) {
    if (!String(job.lengthsText ?? '').trim()) return '';
    const parsed = parseJobLengths(job.lengthsText);
    if (parsed.errors.length) return parsed.errors.join(' ');
    const metres = parsed.lengths.reduce((sum, length) => sum + length, 0);
    const count = parsed.lengths.length * (isThread(job.cableId) ? 1 : job.colors.length);
    return count ? `${count} ${countWord(count, 'барабан', 'барабани', 'барабанів')} · ${fmt(metres * (isThread(job.cableId) ? 1 : job.colors.length) / 1000, 3)} км` : 'Обери колір';
  }
  function renderJobs() {
    $('jobs').innerHTML = state.jobs.map((job, i) => `<article class="job-card" data-job="${esc(job.id)}">
      <div class="job-heading"><h2>Провід ${i + 1}</h2><div><button type="button" class="icon-button" data-job-action="up" aria-label="Провід ${i + 1} вгору" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-job-action="down" aria-label="Провід ${i + 1} вниз" ${i === state.jobs.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="icon-button" data-job-action="remove" aria-label="Прибрати провід ${i + 1}" ${state.jobs.length === 1 ? 'disabled' : ''}>×</button></div></div>
      <div class="job-fields form-grid"><label>Марка<select data-job-field="cableId">${options(job.cableId)}</select></label><label ${isThread(job.cableId) ? 'hidden' : ''}>Переріз жили, мм²<select data-job-field="section">${sections(job.cableId, job.section)}</select></label>${isThread(job.cableId) ? `<label>Фінальний діаметр, мм<input data-job-field="finalDiameter" inputmode="decimal" maxlength="12" value="${esc(job.finalDiameter)}" placeholder="Із завдання"></label>` : `<label>Клас жили<select data-job-field="coreClass">${classOptions(job.coreClass)}</select></label>`}<label class="job-lengths">${isThread(job.cableId) ? 'Довжини барабанів' : 'Довжини кожного кольору'}, км<input data-job-field="lengthsText" maxlength="2000" value="${esc(job.lengthsText)}" placeholder="3×15 + 3×15 + 11"></label></div>
      <fieldset class="job-colors" ${isThread(job.cableId) ? 'hidden' : ''}><legend>Кольори жил</legend>${COLORS.map(c => `<label class="color-choice" title="${c.label}"><input type="checkbox" data-job-color="${c.id}" aria-label="${c.label}" ${job.colors.includes(c.id) ? 'checked' : ''}>${swatch(c.id)}</label>`).join('')}</fieldset>
      <div class="job-conditions" ${isThread(job.cableId) ? 'hidden' : ''}><label title="Один екструдер, крім чорного та жовто-зеленого"><input type="checkbox" data-job-field="idealColor" ${job.idealColor ? 'checked' : ''}> Ідеальний колір</label><label title="Принтер, швидкість до 150 м/хв"><input type="checkbox" data-job-field="marking" ${job.marking ? 'checked' : ''}> З маркуванням</label></div><p class="job-conditions-help" ${isThread(job.cableId) ? 'hidden' : ''}><span class="ideal-help">1 екструдер, крім чорного та жовто-зеленого.</span><span class="marking-help">Принтер, швидкість до 150 м/хв.</span></p>
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
    return `<div class="stock-result-line"><strong>${fmt(group.totalMetres / 1000, 3)} <small>км</small></strong><span>${group.fullDrums === null ? 'Вкажи місткість' : group.fullDrums === 0 ? 'Залишків вистачає' : `Ще <b>${group.fullDrums}</b> ${countWord(group.fullDrums, 'повний барабан', 'повні барабани', 'повних барабанів')}`}</span></div>
      ${group.leftover > 0 ? `<p class="quiet">Лишиться ≈ ${fmt(group.leftover / 1000, 3)} км</p>` : ''}`;
  }
  function shiftResult(shift) {
    if (!shift.pendingCount) return '<p class="quiet">Чергу виконано</p>';
    return `<div class="shift-detail"><span>Повністю</span><strong>${shift.completedDrums} / ${shift.pendingCount} барабанів</strong></div>
      ${shift.partial?.metres > 0 ? `<div class="shift-detail"><span>Наступний</span><strong>≈ ${fmt(shift.partial.metres / 1000, 3)} / ${fmt(shift.partial.length / 1000, 3)} км</strong></div>` : ''}
      <p class="quiet">${shift.blocked ? 'Далі бракує швидкості або довжини.' : shift.fits ? 'Завдання поміщається у зміну.' : shift.minimumShifts !== null ? `На все завдання — від ${shift.minimumShifts} змін.` : 'Завдання перевищує зміну.'} Обід і простої враховано.</p>`;
  }
  function renderResources() {
    const container = $('plan-resources'); if (!container) return;
    const opened = new Map(['shift', 'stock', 'tools'].map(name => [name, container.querySelector(`[data-resource-panel="${name}"]`)?.open]));
    const data = resourceData();
    if (data.draft?.errors.length) {
      container.innerHTML = ''; return;
    }
    const toolValue = (value, source) => value === null ? 'Немає даних' : `${source === 'forecast' ? '≈ ' : ''}${typeof value === 'number' ? fmt(value, 3) : esc(value)}`;
    const stockMetres = data.stock.reduce((sum, group) => sum + group.totalMetres, 0);
    const summary = (label, value, unit) => `<span class="resource-heading">${label}</span><strong class="resource-number">${value}<small>${unit}</small></strong>`;
    container.innerHTML = `<div class="plan-metrics" ${state.planDirty ? 'data-draft' : ''}>
      <details class="resource-panel" data-resource-panel="shift" ${opened.get('shift') ? 'open' : ''}><summary>${summary('За 12 годин', data.shift.blocked && !data.shift.rows.length ? '—' : '≈ ' + fmt(data.shift.possibleMetres / 1000, 3), 'км')}</summary><div class="resource-body" data-shift-result>${shiftResult(data.shift)}</div></details>
      ${data.stock.length ? `<details class="resource-panel" data-resource-panel="stock" ${opened.get('stock') ? 'open' : ''}><summary>${summary('Жила на завдання', fmt(stockMetres / 1000, 3), 'км')}</summary><div class="resource-body">
        ${data.stock.map(group => `<section class="stock-group" data-stock-key="${esc(group.key)}"><h3>${esc(stockTitle(group))}</h3><div class="form-grid"><label>Повний барабан, км<input data-stock-field="fullLengthKm" inputmode="decimal" maxlength="20" placeholder="Місткість" value="${esc(group.fullLengthKm)}"></label><label>Залишки, м<input data-stock-field="piecesText" inputmode="text" maxlength="2000" placeholder="3200, 5400" value="${esc(group.piecesText)}"></label></div>${!group.coreClass ? '<p class="error">Обери клас жили</p>' : ''}<div data-stock-result aria-live="polite">${stockResult(group)}</div></section>`).join('')}
        </div></details>` : ''}
      <details class="resource-panel" data-resource-panel="tools" ${opened.get('tools') ? 'open' : ''}><summary>${summary('Інструмент', data.tools.length, countWord(data.tools.length, 'набір', 'набори', 'наборів'))}</summary><div class="resource-body">
        <div class="resource-table-wrap"><table class="resource-table"><thead><tr><th>Провід</th><th>Дорн, мм</th><th>Матриця, мм</th></tr></thead><tbody>${data.tools.map(item => `<tr><th scope="row">${esc(productLabel(item.cableId, item.section))}${isThread(item.cableId) ? esc(diameterLabel(item.finalDiameter)) : esc(classLabel(item))}</th><td>${toolValue(item.dorn, item.dornSource)}</td><td>${toolValue(item.matrix, item.matrixSource)}</td></tr>`).join('')}</tbody></table></div>
        <p class="quiet">Звір дорн із фактичним діаметром жили.</p></div></details></div>`;
  }
  $('plan-resources')?.addEventListener('input', event => {
    const stockField = event.target.dataset.stockField;
    if (['fullLengthKm', 'piecesText'].includes(stockField)) {
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
    const s = planSummary(state.drums.map(drum => ({ ...drum, mode: setup(drum).mode })), state.planJobs), progress = productionSummary(state.drums, state.planJobs);
    const pending = state.drums.filter(d => drumStatus(d) !== 'done');
    $('plan-summary').innerHTML = `${s.drumCount ? `<div class="queue-progress"><div><b>${progress.doneCount} / ${s.drumCount} готово</b><span>${fmt(s.totalMetres / 1000, 3)} км</span></div><progress value="${progress.doneCount}" max="${s.drumCount}" aria-label="Виконання черги"></progress></div>` : ''}
      ${s.drumCount > 1 ? `<p class="queue-changes">Переходи в черзі · розсікач: <b>${s.headChanges}</b> · колір: <b>${s.colorChanges}</b> · жила: <b>${s.cableChanges}</b></p>` : ''}
      ${[...s.errors, ...s.warnings].map(w => `<p class="error">${esc(w)}</p>`).join('')}`;
    $('plan-order-status').hidden = !state.planDirty && !state.manualOrder;
    $('plan-order-status').textContent = state.planDirty ? 'Завдання змінено — онови чергу' : 'Ручний порядок';
    $('undo-plan').hidden = !state.previousPlan;
    $('restore-cleared-plan').hidden = !state.previousPlan;
    $('restore-cleared-plan').textContent = state.previousPlan?.reason === 'clear' ? 'Повернути очищену чергу' : 'Скасувати дію';
    $('restore-plan-order').disabled = pending.length < 2;
    $('clear-plan').disabled = !state.drums.length;
  }
  function compact(drum, i) {
    const r = result(drum, i), status = drumStatus(drum);
    const screen = r.target !== number(drum.length) && status !== 'done' && r.target > 0 ? `<small>Екран ${fmt(r.target)} м</small>` : '';
    const title = isThread(drum.cableId) ? cableLabel(drum.cableId) + diameterLabel(drum.finalDiameter) : `${optionFor(drum.cableId)?.brand ?? cableLabel(drum.cableId)} ${fmt(drum.section)}`;
    const cue = status === 'done' ? '' : r.errors.length ? 'Перевір довжину' : r.target === 0 ? 'Перевір зупинку' : r.transition ? r.events.length ? r.events.map(event => `№${event.extruder}: ${fmt(event.at)} м`).join(' · ') + (r.setupChange ? ' · стоп' : '') : 'Перевір зміну барвника' : r.cableChange ? isThread(drum.cableId) ? 'Зміна нитки' : 'Зміна жили' : r.headChange ? 'Змінити розсікач' : r.modeChange ? 'Перемкнути екструдери' : r.matrixChange ? 'Змінити матрицю' : '';
    const priorClass = coreClass(state.drums[i - 1]?.coreClass), currentClass = coreClass(drum.coreClass);
    const classChange = status !== 'done' && priorClass && currentClass && priorClass !== currentClass ? `Жила: ${currentClass} клас` : '';
    const journal = numbering.get(drum.id);
    const cues = cue ? (r.transition && r.events.length ? 'Барвник ' : '') + cue : '';
    return `${journal == null ? '' : `<span class="journal-number" title="Номер у журналі">№${journal}</span>`}${isThread(drum.cableId) ? '' : swatch(drum.color)}<span class="sr-only">${streamLabel(drum)}. </span><span class="drum-title"><b>${esc(title)}</b>${classChange ? `<small class="queue-class-change">${esc(classChange)}</small>` : ''}${drum.marking ? '<small class="queue-alert">Принтер · до 150 м/хв</small>' : ''}${cues ? `<small class="queue-alert">${esc(cues)}</small>` : ''}</span><span class="drum-length"><b>${fmt(number(drum.length) === null ? null : number(drum.length) / 1000, 3)} км</b>${screen}</span>`;

  }
  function neighborIndex(i, direction) {
    const target = i + direction;
    return target >= 0 && target < state.drums.length ? target : -1;
  }
  function cardMarkup(drum, i, opened) {
    const status = drumStatus(drum), locked = status !== 'queued' ? 'disabled' : '';
    const statusLabel = { queued: 'Не готово', active: 'В роботі', done: 'Готово' }[status];
    const nextLabel = { queued: 'Почати', active: 'Позначити готовим', done: 'Повернути до черги' }[status];
    const label = `${drumTitle(drum)}, ${streamLabel(drum).toLowerCase()}, ${fmt(drum.length)} м`;
    const modeField = `<label class="drum-mode-picker" data-mode-picker ${modePicker(drum) ? '' : 'hidden'}>Екструдери<select data-field="mode" ${locked}><option value="" ${!drum.mode ? 'selected' : ''}>Авто</option><option value="single" ${drum.mode === 'single' ? 'selected' : ''}>1</option><option value="dual" ${drum.mode === 'dual' ? 'selected' : ''}>2</option></select></label><label data-class-picker ${isThread(drum.cableId) ? 'hidden' : ''}>Клас жили<select data-field="coreClass" ${locked}>${classOptions(drum.coreClass)}</select></label>`;
    return `<article class="card drum queue-card ${status === 'active' ? 'is-active' : status === 'done' ? 'is-done' : ''}" data-drum="${esc(drum.id)}" data-status="${status}" data-color="${esc(drum.color)}" style="--done-color:${COLORS.find(c => c.id === drum.color)?.hex ?? '#aaa'}">
      <div class="queue-row"><button class="drag-handle icon-button" type="button" data-drag-handle aria-label="Перетягнути: ${esc(label)}. Стрілки переміщують вгору та вниз.">☰</button>
      <details class="drum-details" data-details="${esc(drum.id)}" ${opened.has(drum.id) ? 'open' : ''}><summary class="drum-summary">${compact(drum, i)}</summary><div class="drum-fields"><div class="form-grid"><label>Провід<select data-field="cableId" ${locked}>${options(drum.cableId)}</select></label><label ${isThread(drum.cableId) ? 'hidden' : ''}>Переріз, мм²<select data-field="section" ${locked}>${sections(drum.cableId, drum.section)}</select></label><label data-diameter-picker ${isThread(drum.cableId) ? '' : 'hidden'}>Фінальний діаметр, мм<input data-field="finalDiameter" inputmode="decimal" maxlength="12" value="${esc(drum.finalDiameter)}" placeholder="Із завдання" ${locked}></label><label data-color-picker ${isThread(drum.cableId) ? 'hidden' : ''}>Колір<select data-field="color" ${locked}>${colorOptions(drum.color)}</select></label>${modeField}<label>Потрібна довжина, м<input data-field="length" inputmode="numeric" value="${esc(drum.length)}" maxlength="20" ${locked}></label><label>Примітка до барабана<input data-field="name" maxlength="80" value="${esc(drum.name)}"></label><label>Пробій / з’єднання, м<input data-field="breakdowns" maxlength="4002" placeholder="3682; 9240" value="${esc(combinedMarks(drum))}"></label></div><p class="quiet">Пробої та з’єднання вказуй за загальним лічильником у метрах, через крапку з комою.</p><div data-output="${esc(drum.id)}">${output(drum, i)}</div><p class="drum-transition" data-transition="${esc(drum.id)}" ${transitionText(drum, i) ? '' : 'hidden'}>${esc(transitionText(drum, i))}</p>${locked ? '<p class="quiet">Для редагування поверни запис до черги.</p>' : ''}</div></details></div>
      <div class="drum-actions"><button type="button" class="queue-status" data-action="cycle-status" data-current-status="${status}" aria-label="${statusLabel}. ${nextLabel}" title="${nextLabel}">${statusLabel}</button><details class="queue-more"><summary aria-label="Інші дії" title="Інші дії">⋯</summary><div class="order-controls"><button type="button" class="cable-info icon-button" data-action="info" aria-label="Налаштування: ${esc(label)}" title="Налаштування проводу">ⓘ</button><button type="button" class="icon-button" data-action="up" aria-label="Перемістити вгору" ${neighborIndex(i, -1) < 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-action="down" aria-label="Перемістити вниз" ${neighborIndex(i, 1) < 0 ? 'disabled' : ''}>↓</button><button type="button" class="icon-button" data-action="remove" aria-label="Прибрати запис">×</button></div></details></div>
      </article>`;
  }
  function renderPlayer() {
    const panel = $('drum-player');
    if (!state.drums.length) { panel.hidden = true; panel.innerHTML = ''; playerId = null; return; }
    panel.hidden = false;
    let index = state.drums.findIndex(drum => drum.id === playerId);
    if (index < 0) {
      index = state.drums.findIndex(drum => drumStatus(drum) === 'active');
      if (index < 0) index = state.drums.findIndex(drum => drumStatus(drum) !== 'done');
      if (index < 0) index = 0;
      playerId = state.drums[index].id;
    }
    const drum = state.drums[index], info = setup(drum), r = result(drum, index);
    const value = key => {
      const v = info.effective?.[key];
      if (v == null) return '—';
      const approximate = ['forecast', 'manual'].includes(info.sources?.[key]);
      return (approximate ? '≈ ' : '') + esc(typeof v === 'string' && number(v) === null ? v : fmt(v, 3));
    };
    const metric = (label, content, unit = '', source = '') => `<div><span>${label}</span><strong>${content}${unit ? `<small> ${unit}</small>` : ''}</strong>${source && VALUE_LABELS[source] ? `<small class="player-value-source">${esc(VALUE_LABELS[source])}</small>` : ''}</div>`;
    const thread = isThread(drum.cableId);
    const dye = dyePlan(drum.color, info.mode, { noDye: info.noDye });
    const status = { queued: 'У черзі', active: 'В роботі', done: 'Готово' }[drumStatus(drum)];
    const screen = r.errors.length ? 'Перевір дані барабана' : r.target > 0 ? `${fmt(r.target)} м` : 'Перевір зупинку';
    const slotPlan = planDyeSlots(state.drums.map(item => ({ ...item, mode: setup(item).mode })), state.dyeSlots);
    const currentSteps = slotPlan.find(item => item.id === drum.id)?.steps ?? [];
    const next = nextDrum(index), nextSteps = slotPlan.find(item => item.id === next?.id)?.steps ?? [];
    const description = (step, after) => {
      const label = colorName(step.color).toLowerCase();
      const event = after ? r.events.find(item => item.extruder === step.extruder) : null;
      const timing = event ? `; орієнтир перемикання — ${fmt(event.at)} м` : '';
      if (step.kind === 'available') return `№${step.extruder}, відсік ${step.slot}: ${label} вже є${timing}; перевір подачу`;
      if (step.kind === 'unknown') return `№${step.extruder}: потрібен ${label}${timing}; перевір невказані відсіки`;
      const when = event ? `до перемикання на ${fmt(event.at)} м` : 'до початку барабана';
      const replace = step.replaces === EMPTY_DYE ? 'порожній відсік' : `замість ${colorName(step.replaces).toLowerCase()}`;
      return `№${step.extruder}, відсік ${step.slot}: підготуй ${label} ${replace} ${when}; перевір активний відсік`;
    };
    const journal = numbering.get(drum.id);
    panel.innerHTML = `<div class="player-top"><span>Барабан ${index + 1} / ${state.drums.length}${journal == null ? '' : ` · журнал №${journal}`}</span><span>${status}</span></div>
      <div class="player-title">${thread ? '' : swatch(drum.color)}<div><h2>${esc(drumTitle(drum))}</h2><p>${esc(streamLabel(drum))} · ${fmt(number(drum.length))} м${drum.name ? ' · №' + esc(drum.name) : ''}</p></div></div>
      <div class="player-grid player-tools">${metric('Розсікач', thread || info.mode === 'unknown' ? 'Уточни' : info.mode === 'single' ? 'Будь-який' : drum.color === 'yellow-green' ? 'Смугастий' : 'Звичайний')}${metric('Дорн', value('dorn'), 'мм', info.sources?.dorn)}${metric('Матриця', value('matrix'), 'мм', info.sources?.matrix)}</div>
      <div class="player-grid">${metric('Шнек №1', value('extruder1'), 'об/хв', info.sources?.extruder1)}${metric('Шнек №2', info.mode === 'single' ? 'Вимкнено' : value('extruder2'), info.mode === 'single' ? '' : 'об/хв', info.mode === 'single' ? '' : info.sources?.extruder2)}${metric('Швидкість', value('workingSpeed'), 'м/хв', info.sources?.workingSpeed)}${thread ? '' : metric('SIKORA · жила', value('sikoraWire'), 'мм', info.sources?.sikoraWire) + metric('SIKORA · ізоляція', value('sikoraOuter'), 'мм', info.sources?.sikoraOuter)}${metric('На екрані', esc(screen))}</div>
      ${drum.marking ? '<p class="player-dye">Маркування: увімкни принтер. Швидкість не більше 150 м/хв.</p>' : ''}
      ${!thread && dye?.valid ? `<p class="player-dye">Барвник: №1 — ${esc(dye.first)} · №2 — ${esc(dye.second)}</p>` : ''}
      ${state.dyeSlots.some(Boolean) && currentSteps.length ? `<div class="dye-cues"><b>На цей барабан</b>${currentSteps.map(step => `<p>${esc(description(step, false))}.</p>`).join('')}${nextSteps.some(step => step.kind === 'load' || r.events.some(event => event.extruder === step.extruder)) ? `<b>Підготувати далі</b>${nextSteps.filter(step => step.kind === 'load' || r.events.some(event => event.extruder === step.extruder)).map(step => `<p>${esc(description(step, true))}.</p>`).join('')}` : ''}<small>Який відсік зараз подає барвник, потрібно перевірити на установці.</small></div>` : ''}
      ${r.errors.length ? `<p class="error">${r.errors.map(esc).join(' · ')}</p>` : ''}
      ${r.coiling && !r.errors.length ? `<p class="player-dye">Бухтовка: ${fmt(r.production.coils)} × ${fmt(r.production.size)} м · додатково ${fmt(r.production.waste)} м</p>` : ''}
      ${transitionText(drum, index) ? `<p class="player-next">${esc(transitionText(drum, index))}</p>` : ''}
      ${r.transition && !r.errors.length ? `<div class="player-restart"><label>Показ після запуску, коли кабель якісний, м<input data-restart-counter inputmode="numeric" maxlength="15" value="${esc(restartCounters.get(drum.id) ?? '')}" placeholder="Наприклад, 14871"></label><p>Перекидання: <strong data-restart-target>—</strong> <small>м · фактичний показ + 170 м</small></p></div>` : ''}
      <p class="player-source">≈ орієнтовне значення · — дані відсутні</p>
      <div class="player-controls"><button type="button" class="secondary" data-player="previous" ${index === 0 ? 'disabled' : ''}>← Попередній</button><button type="button" class="secondary" data-player="next" ${index === state.drums.length - 1 ? 'disabled' : ''}>Наступний →</button></div>`;
    refreshRestart(panel, drum.id);
  }
  function refreshRestart(panel, drumId) {
    const input = panel.querySelector('[data-restart-counter]'), output = panel.querySelector('[data-restart-target]');
    if (!input || !output) return;
    const target = restartTarget(input.value);
    output.textContent = target === null ? '—' : fmt(target);
    restartCounters.set(drumId, input.value);
  }
  $('drum-player').addEventListener('input', event => {
    if (event.target.matches('[data-restart-counter]') && playerId) refreshRestart($('drum-player'), playerId);
  });
  $('drum-player').addEventListener('click', event => {
    const button = event.target.closest('[data-player]');
    if (!button || button.disabled) return;
    const index = state.drums.findIndex(drum => drum.id === playerId);
    const next = index + (button.dataset.player === 'next' ? 1 : -1);
    if (next < 0 || next >= state.drums.length) return;
    playerId = state.drums[next].id;
    renderPlayer();
  });
  function renderQueue() {
    setupCache.clear(); numbering = journalNumbers(state.drums, state.journalLast);
    const opened = new Set([...$('drums').querySelectorAll('.drum-details[open]')].map(el => el.dataset.details));
    renderSummary(); renderPlayer();
    $('drums').innerHTML = state.drums.map((drum, i) => cardMarkup(drum, i, opened)).join('') || '<div class="empty-queue"><p>Черга порожня.</p><button class="primary" type="button" data-generate-queue>Скласти із завдання</button></div>';
  }
  function renderOutputs() {
    setupCache.clear(); numbering = journalNumbers(state.drums, state.journalLast); renderSummary(); renderPlayer();
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
    const planned = scheduleJobs(state.jobs, state.drums, { slots: state.dyeSlots });
    if (planned.errors.length) { $('job-message').textContent = planned.errors.join('\n'); return; }
    savePrevious(); state.drums = planned.drums; state.planJobs = copy(state.jobs); state.planDirty = false; state.manualOrder = false;
    persist(); renderQueue(); $('job-builder').open = false;
    $('job-message').textContent = '';
    if (planned.warnings?.length) toast(planned.warnings.join(' '));
    $('plan-resources').scrollIntoView({ block: 'start' });
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
      if (field === 'urgent' || field === 'coiling') job[field] = event.target.checked;
      else if (['section', 'batchSize'].includes(field)) job[field] = number(event.target.value);
      else if (field === 'idealColor' || field === 'marking') job[field] = event.target.checked;
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
  $('generate-plan').addEventListener('click', generate);
  $('restore-plan-order').addEventListener('click', () => {
    savePrevious(); state.drums = recommendOrder(state.drums, { slots: state.dyeSlots }); state.manualOrder = false; persist(); renderQueue(); haptic();
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
    drum[field] = field === 'section' ? Number(event.target.value) : field === 'coiling' ? event.target.value === 'true' : event.target.value;
    if (field === 'breakdowns') delete drum.joints;
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
    if (button.dataset.action === 'cycle-status') {
      const drum = state.drums[i], desired = nextDrumStatus(drum), assigned = journalNumbers(state.drums, state.journalLast).get(drum.id);
      savePrevious('status'); state.drums = setDrumStatus(state.drums, drum.id, desired);
      const updated = state.drums.find(row => row.id === drum.id);
      if (desired === 'queued') delete updated.journalNumber;
      else if (assigned != null) updated.journalNumber = assigned;
      persist(); renderQueue(); haptic();
      $('plan-live').textContent = `${drumTitle(drum)}, ${streamLabel(drum)}: ${desired === 'done' ? 'готово' : desired === 'active' ? 'в роботі' : 'не готово'}.`;
      $('drums').querySelector(`[data-drum="${window.CSS.escape(drum.id)}"] [data-action="cycle-status"]`)?.focus({ preventScroll: true });
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
    if (drag.preview) {
      drag.preview.style.left = `${Math.min(window.innerWidth - 12, Math.max(12, drag.x))}px`;
      drag.preview.style.top = `${Math.max(10, drag.y - 12)}px`;
      drag.preview.querySelector('small').textContent = `Позиція ${drag.from + 1} → ${drag.target + 1}`;
    }
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
    previous?.preview?.remove();
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
    if (!drag.started && Math.abs(drag.y - drag.startY) > 5) {
      drag.started = true; drag.card.classList.add('is-dragging');
      const drum = state.drums[drag.from], preview = document.createElement('div');
      preview.className = 'drag-preview'; preview.setAttribute('aria-hidden', 'true');
      preview.innerHTML = `${isThread(drum.cableId) ? '' : swatch(drum.color)}<span><b>${esc(drumTitle(drum))}</b><small></small></span>`;
      document.body.append(preview); drag.preview = preview;
      haptic(); scrollDrag();
    }
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
  return { render, renderQueue, renderOutputs, result, transitionText, setup, drumTitle, syncSelection, resourcesText, journalNumber: drum => journalNumbers(state.drums, state.journalLast).get(drum.id) };
}
