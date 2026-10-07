import { COLORS, colorName, fmt, number, planDrum, planSplices } from './core.js?v=23';
import { MAX_DRUMS, parseJobLengths, scheduleJobs, recommendOrder, moveDrum, planSummary, drumStatus, setDrumStatus, productionSummary } from './planner.js?v=23';
import { CATALOG_CABLES, optionFor } from './catalog-base.js?v=23';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const palette = ['yellow-green', 'blue', 'brown', 'black', 'gray', 'white', 'red', 'green', 'yellow'];
const copy = value => JSON.parse(JSON.stringify(value));
const savedId = value => typeof value === 'string' && value.trim() && value.length <= 300 ? value : crypto.randomUUID();
const cableLabel = id => optionFor(id)?.label ?? id;
const isThread = id => optionFor(id)?.coreKind === 'thread';
const productLabel = (id, section) => `${cableLabel(id)}${isThread(id) ? '' : ` ${fmt(section)} мм²`}`;
const options = selected => CATALOG_CABLES.map(c => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
const sections = (id, selected) => (optionFor(id)?.sections ?? []).map(s => `<option value="${s}" ${Number(selected) === s ? 'selected' : ''}>${isThread(id) ? 'Нитка' : fmt(s)}</option>`).join('');
const colorOptions = selected => COLORS.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.label}</option>`).join('');
const swatch = color => `<span class="color-dot" data-color="${esc(color)}" style="--swatch:${COLORS.find(c => c.id === color)?.hex ?? '#aaa'}" aria-hidden="true"></span>`;

export function newJob(cableId, section, extra = {}) {
  return { id: crypto.randomUUID(), cableId, section, cores: 3, colors: palette.slice(0, 3), lengthsText: '', urgent: false, batchSize: 3, ...extra };
}

/** Follow the main selection only while the initial task has not been edited. */
export function syncPlannerSelection(state) {
  const job = state.jobs?.[0], cable = optionFor(state.cableId);
  if (!cable || state.jobs.length !== 1 || state.planJobs?.length || state.planDirty || state.manualOrder || !job ||
      String(job.lengthsText ?? '').trim() || Number(job.cores) !== 3 || job.urgent || Number(job.batchSize) !== 3 ||
      JSON.stringify(job.colors) !== JSON.stringify(palette.slice(0, 3))) return false;
  const section = cable.sections.includes(Number(state.section)) ? Number(state.section) : cable.sections[0];
  if (job.cableId === cable.id && Number(job.section) === section) return false;
  job.cableId = cable.id; job.section = section;
  return true;
}

/** Keep the old locally saved queue, labels and faults when adding task planning. */
export function restorePlanner(saved, state) {
  const restoreJobs = rows => (Array.isArray(rows) ? rows : []).slice(0, 50).filter(j => j && optionFor(j.cableId)).map(j => {
    const cable = optionFor(j.cableId);
    return newJob(cable.id, cable.sections.includes(Number(j.section)) ? Number(j.section) : cable.sections[0], {
      id: savedId(j.id),
      cores: j.cores ?? 3, colors: Array.isArray(j.colors) ? j.colors.filter(c => COLORS.some(row => row.id === c)) : [],
      lengthsText: String(j.lengthsText ?? '').slice(0, 2000).replaceAll('*', '×'), urgent: j.urgent === true, batchSize: j.batchSize ?? 3
    });
  });
  state.jobs = restoreJobs(saved?.jobs);
  if (!state.jobs.length) state.jobs = [newJob(state.cableId, state.section)];
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
      color: d.color, length: String(d.length ?? '').slice(0, 20), name: String(d.name ?? '').slice(0, 80), breakdowns: String(d.breakdowns ?? '').slice(0, 2000), status };
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

  const jobTitle = job => isThread(job.cableId) ? cableLabel(job.cableId) : `${cableLabel(job.cableId)} ${fmt(job.cores)}×${fmt(job.section)}`;
  const drumTitle = drum => {
    const job = state.planJobs.find(j => j.id === drum.jobId);
    return isThread(drum.cableId) ? cableLabel(drum.cableId) : `${cableLabel(drum.cableId)} ${job ? fmt(job.cores) + '×' : ''}${fmt(drum.section)}`;
  };
  const setup = drum => {
    const key = JSON.stringify([drum.cableId, drum.section, drum.color]);
    if (!setupCache.has(key)) setupCache.set(key, getSetup(drum.cableId, drum.section, drum.color));
    return setupCache.get(key);
  };
  function result(drum, i) {
    const info = setup(drum), next = drumStatus(drum) === 'done' ? null : nextDrum(i);
    const nextInfo = next ? setup(next) : null;
    const rules = { ...state.rules };
    for (const [field, rule] of [['colorLead1', 'lead1'], ['colorLead2', 'lead2']]) {
      const lead = number(info.stored?.[field]);
      if (lead !== null && lead >= 0) rules[rule] = lead;
    }
    const splice = planSplices(drum.length, drum.breakdowns, rules.splice);
    const planned = planDrum({ ...drum, length: splice.target ?? drum.length, mode: info.mode }, next ? { ...next, mode: nextInfo.mode } : null, info.mode, rules);
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
    if (next.color !== drum.color && !r.transition) changes.push(`налаштувати ${colorName(next.color).toLowerCase()}`);
    const core = isThread(drum.cableId) ? 'нитки' : 'жили';
    const stop = r.cableChange && r.target > 0 ? `Зупинка на ${fmt(r.length - r.target)} м раніше для зміни ${core}` : r.cableChange && r.target === 0 ? `Для зміни ${core} потрібен окремий план зупинки` : 'Далі — зупинка';
    return `${colorTransition ? colorTransition + ' ' : ''}${stop}: ${changes.join('; ')}.`;
  }
  function output(drum, i) {
    const r = result(drum, i);
    if (r.errors.length) return `<p class="error">${r.errors.map(esc).join('<br>')}</p>`;
    return `${r.target > 0 ? `<div class="target"><span>Довжина на екрані</span><strong>${fmt(r.target)} <small>м</small></strong></div>` : ''}
      ${r.transition ? `<ol class="steps">${r.events.map(e => `<li><b>≈ ${fmt(e.at)} м</b> — барвник №${e.extruder}: ${esc(e.dye.toLowerCase())} (за ${fmt(e.lead)} м до кінця)</li>`).join('')}<li>Стравити. Коли ${esc(colorName(r.nextColor).toLowerCase())} з’явиться у 4-му рядку ванни — перекинути вручну.</li>${r.setupChange ? '<li>Розсікач або режим екструдерів змінити після зупинки.</li>' : ''}</ol><p class="quiet formula">${esc(r.formula)}</p>` : `<p class="quiet">${r.cableChange ? `Зупинися раніше: решта ${isThread(drum.cableId) ? 'нитки' : 'жили'} вже у ванні. Резерв зміни кольору не додається.` : r.setupChange ? 'Перехід після зупинки. Випередження зміни барвника не розраховується.' : 'Без поправки на зміну кольору.'}</p>${r.cableChange ? `<p class="quiet formula">${esc(r.formula)}</p>` : ''}`}
      ${r.warnings.map(w => `<p class="error">${esc(w)}</p>`).join('')}${r.splice.spliceCount ? `<p class="drum-splice-label">На лейбл: <b>${esc(r.splice.label)}</b></p><p class="quiet">З’єднань: ${r.splice.spliceCount} · +${fmt(r.splice.target - r.splice.length)} м тільки на екрані.</p>` : ''}`;
  }
  function jobTotal(job) {
    if (!String(job.lengthsText ?? '').trim()) return 'Впиши довжини із завдання. Приклад у полі — лише підказка.';
    const parsed = parseJobLengths(job.lengthsText);
    if (parsed.errors.length) return parsed.errors.join(' ');
    const metres = parsed.lengths.reduce((sum, length) => sum + length, 0);
    return `${parsed.lengths.length} барабанів · ${fmt(metres / 1000, 3)} км кожного кольору · ${fmt(metres * job.colors.length / 1000, 3)} км разом${job.colors.length !== Number(job.cores) ? isThread(job.cableId) ? ' · перевір кількість кольорів' : ' · кількість кольорів має відповідати жилам' : ''}`;
  }
  function renderJobs() {
    $('jobs').innerHTML = state.jobs.map((job, i) => `<article class="job-card" data-job="${esc(job.id)}">
      <div class="job-heading"><h2>Провід ${i + 1}</h2><div><button type="button" class="icon-button" data-job-action="up" aria-label="Провід ${i + 1} вгору" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-job-action="down" aria-label="Провід ${i + 1} вниз" ${i === state.jobs.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="icon-button" data-job-action="remove" aria-label="Прибрати провід ${i + 1}" ${state.jobs.length === 1 ? 'disabled' : ''}>×</button></div></div>
      <div class="job-fields form-grid"><label>Марка<select data-job-field="cableId">${options(job.cableId)}</select></label><label ${isThread(job.cableId) ? 'hidden' : ''}>Переріз жили, мм²<select data-job-field="section">${sections(job.cableId, job.section)}</select></label><label>${isThread(job.cableId) ? 'Кількість кольорів' : 'Кількість жил'}<select data-job-field="cores">${palette.map((_, n) => `<option value="${n + 1}" ${Number(job.cores) === n + 1 ? 'selected' : ''}>${n + 1}</option>`).join('')}</select></label><label class="job-lengths">Довжини кожного кольору, км<input data-job-field="lengthsText" maxlength="2000" value="${esc(job.lengthsText)}" placeholder="3×15 + 3×15 + 11"></label></div>
      <fieldset class="job-colors"><legend>${isThread(job.cableId) ? 'Кольори' : 'Кольори жил'}</legend>${COLORS.map(c => `<label class="color-choice" title="${c.label}"><input type="checkbox" data-job-color="${c.id}" aria-label="${c.label}" ${job.colors.includes(c.id) ? 'checked' : ''}>${swatch(c.id)}</label>`).join('')}</fieldset>
      <label class="check job-priority"><input type="checkbox" data-job-field="urgent" ${job.urgent ? 'checked' : ''}>Скрутка чекає — підготувати всі кольори раніше</label>
      <label class="job-batch">Перша партія для скрутки: барабанів кожного кольору<input type="number" data-job-field="batchSize" min="1" max="${MAX_DRUMS}" inputmode="numeric" value="${esc(job.batchSize)}"></label>
      <p class="quiet">Наприклад, 3 — підготувати по 3 барабани кожного кольору. Познач «Скрутка чекає», щоб отримати цю партію раніше; решта довжин залишиться в черзі.</p>
      <p class="job-total quiet" data-job-total="${esc(job.id)}">${esc(jobTotal(job))}</p></article>`).join('');
  }
  function renderSummary() {
    const s = planSummary(state.drums, state.planJobs), progress = productionSummary(state.drums, state.planJobs);
    const completed = state.drums.filter(d => drumStatus(d) === 'done');
    const pending = state.drums.filter(d => drumStatus(d) !== 'done');
    const remaining = planSummary([...completed, ...pending], state.planJobs);
    const readinessOpen = $('plan-summary').querySelector('.twist-status')?.open ?? false;
    const available = progress.ready.filter(r => r.readyMetres > 0);
    const readyLabel = available.length ? available.map(r => `${fmt(r.readyMetres / 1000, 3)} км (${isThread(r.cableId) ? cableLabel(r.cableId) : fmt(r.section) + ' мм²'})`).join(' · ') : 'ще немає комплекту кольорів';
    $('plan-summary').innerHTML = `<div class="queue-progress"><div><b>${progress.doneCount} із ${s.drumCount} готово</b><span>${progress.activeCount ? '1 в роботі · ' : ''}${pending.length} залишилось</span></div><progress value="${progress.doneCount}" max="${s.drumCount || 1}" aria-label="Виконання черги"></progress></div>
      ${s.ready.length ? `<details class="twist-status" ${readinessOpen ? 'open' : ''}><summary>Для скрутки: ${readyLabel}</summary><ul class="twist-ready twist-readiness">${s.ready.map(item => {
        const job = state.planJobs.find(j => j.id === item.jobId);
        const actual = progress.ready.find(r => r.jobId === item.jobId)?.readyMetres ?? 0;
        const title = job ? jobTitle(job) : productLabel(item.cableId, item.section);
        if (!job) return `<li><b>${esc(title)}</b><span>Для скрутки: ${fmt(actual / 1000, 3)} км кожного кольору. Перевір склад завдання.</span></li>`;
        const batch = parseJobLengths(job.lengthsText).lengths.slice(0, Number(job.batchSize)).reduce((sum, length) => sum + length, 0);
        const first = remaining.ready.find(r => r.jobId === item.jobId)?.milestones.find(m => m.readyMetres >= batch);
        const count = first ? Math.max(0, first.afterDrum - completed.length) : null;
        const hint = actual >= batch ? 'Перша партія готова' : count !== null ? `До перших ${fmt(batch / 1000, 3)} км кожного кольору — ще ${count} барабанів` : 'Для першої партії бракує барабанів у черзі';
        return `<li><b>${esc(title)}</b><span>Для скрутки: <strong>${fmt(actual / 1000, 3)} км</strong> кожного кольору</span><small>${hint}</small></li>`;
      }).join('')}</ul></details>` : ''}
      <details class="plan-overview"><summary>${s.drumCount} барабанів · ${fmt(s.totalMetres / 1000, 3)} км · ${s.headChanges} змін розсікача</summary><p class="quiet">Змін кольору: ${s.colorChanges}. Переходів між проводами: ${s.cableChanges}. Початкове налаштування не враховано.</p></details>
      ${[...s.errors, ...s.warnings].map(w => `<p class="error">${esc(w)}</p>`).join('')}`;
    $('plan-order-status').hidden = !state.planDirty && !state.manualOrder;
    $('plan-order-status').textContent = state.planDirty ? 'Завдання змінено. Склади чергу, щоб застосувати зміни.' : 'Порядок змінено вручну · збережено';
    $('undo-plan').hidden = !state.previousPlan;
    $('restore-cleared-plan').hidden = !state.previousPlan;
    $('restore-cleared-plan').textContent = state.previousPlan?.reason === 'clear' ? 'Повернути очищену чергу' : 'Скасувати дію';
    $('restore-plan-order').disabled = pending.length < 2;
    $('clear-plan').disabled = !state.drums.length;
  }
  function compact(drum, i) {
    const r = result(drum, i), status = drumStatus(drum);
    const screen = r.target !== number(drum.length) && status !== 'done' ? r.target > 0 ? `<small>Екран ${fmt(r.target)} м</small>` : '<small>Перевір план зупинки</small>' : '';
    return `${swatch(drum.color)}<span class="sr-only">${colorName(drum.color)}. </span><span class="drum-title"><b>${esc(drumTitle(drum))}</b>${drum.name ? `<small>№${esc(drum.name)}</small>` : ''}${r.splice.spliceCount && !r.splice.errors.length ? `<small class="drum-splice-parts" data-splice-label>${esc(r.splice.label)}</small>` : ''}</span><span class="drum-length"><b>${fmt(number(drum.length) === null ? null : number(drum.length) / 1000, 3)} км</b>${screen}</span>`;
  }
  function neighborIndex(i, direction) {
    const target = i + direction;
    return target >= 0 && target < state.drums.length ? target : -1;
  }
  function cardMarkup(drum, i, opened) {
    const status = drumStatus(drum), locked = status !== 'queued' ? 'disabled' : '';
    const label = `${drumTitle(drum)}, ${colorName(drum.color).toLowerCase()}, ${fmt(drum.length)} м`;
    return `<article class="card drum queue-card ${status === 'active' ? 'is-active' : status === 'done' ? 'is-done' : ''}" data-drum="${esc(drum.id)}" data-status="${status}" data-color="${esc(drum.color)}" style="--done-color:${COLORS.find(c => c.id === drum.color)?.hex ?? '#aaa'}">
      <div class="queue-row"><button class="drag-handle icon-button" type="button" data-drag-handle aria-label="Перетягнути: ${esc(label)}. Стрілки переміщують вгору та вниз.">☰</button>
      <details class="drum-details" data-details="${esc(drum.id)}" ${opened.has(drum.id) ? 'open' : ''}><summary class="drum-summary">${compact(drum, i)}</summary><div class="drum-fields"><div class="form-grid"><label>Провід<select data-field="cableId" ${locked}>${options(drum.cableId)}</select></label><label ${isThread(drum.cableId) ? 'hidden' : ''}>Переріз, мм²<select data-field="section" ${locked}>${sections(drum.cableId, drum.section)}</select></label><label>Колір<select data-field="color" ${locked}>${colorOptions(drum.color)}</select></label><label>Потрібна довжина, м<input data-field="length" inputmode="numeric" value="${esc(drum.length)}" maxlength="20" ${locked}></label><label>Номер барабана<input data-field="name" maxlength="80" value="${esc(drum.name)}"></label><label>Пробій на метрі<input data-field="breakdowns" maxlength="2000" placeholder="3682; 9240" value="${esc(drum.breakdowns)}"></label></div><div data-output="${esc(drum.id)}">${output(drum, i)}</div>${locked ? '<p class="quiet">Для зміни проводу або довжини поверни запис до черги кнопкою стану.</p>' : ''}</div></details></div>
      <div class="drum-actions">${status !== 'done' ? `<button type="button" class="queue-status" data-action="active" aria-pressed="${status === 'active'}" title="${status === 'active' ? 'Повернути до черги' : 'Почати цей барабан'}">В роботі</button>` : ''}<button type="button" class="queue-status" data-action="done" aria-pressed="${status === 'done'}" title="${status === 'done' ? 'Повернути до черги' : 'Позначити виконаним'}">${status === 'done' ? 'Не готово' : 'Готово'}</button><button type="button" class="cable-info icon-button" data-action="info" aria-label="Налаштування: ${esc(label)}" title="Налаштування проводу">ⓘ</button><details class="queue-more"><summary aria-label="Інші дії" title="Інші дії">⋯</summary><div class="order-controls"><button type="button" class="icon-button" data-action="up" aria-label="Перемістити вгору" ${neighborIndex(i, -1) < 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-action="down" aria-label="Перемістити вниз" ${neighborIndex(i, 1) < 0 ? 'disabled' : ''}>↓</button><button type="button" class="icon-button" data-action="remove" aria-label="Прибрати запис">×</button></div></details></div>
      <p class="drum-transition" data-transition="${esc(drum.id)}" ${transitionText(drum, i) ? '' : 'hidden'}>${esc(transitionText(drum, i))}</p><span class="status-label">${status === 'active' ? 'В роботі' : status === 'done' ? 'Готово' : 'У черзі'}</span></article>`;
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
      const label = `${drumTitle(drum)}, ${colorName(drum.color).toLowerCase()}, ${fmt(drum.length)} м`;
      card.querySelector('[data-action="info"]').setAttribute('aria-label', `Налаштування: ${label}`);
      card.querySelector('[data-drag-handle]')?.setAttribute('aria-label', `Перетягнути: ${label}. Стрілки переміщують вгору та вниз.`);
      card.querySelector('[data-output]').innerHTML = output(drum, i);
      const note = card.querySelector('[data-transition]');
      note.textContent = transitionText(drum, i); note.hidden = !note.textContent;
    });
  }
  function render() {
    $('plan-title').textContent = 'Заплануй, виконай, познач готове.';
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
    } else if (field) {
      if (field === 'urgent') job.urgent = event.target.checked;
      else if (['cores', 'section', 'batchSize'].includes(field)) job[field] = number(event.target.value);
      else job[field] = event.target.value;
      if (field === 'cableId') { const cable = optionFor(job.cableId); if (!cable.sections.includes(Number(job.section))) job.section = cable.sections[0]; }
      if (field === 'cores') job.colors = [...job.colors, ...palette.filter(c => !job.colors.includes(c))].slice(0, job.cores);
    } else return;
    state.planDirty = true; persist(); $('job-message').textContent = '';
    if (field === 'cableId' || field === 'cores') renderJobs();
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
    state.jobs.push(newJob(state.cableId, state.section)); state.planDirty = true; persist(); renderJobs(); renderSummary();
  });
  $('load-plan-example').addEventListener('click', () => {
    const cableId = optionFor('vvgng-p').id;
    state.jobs = [newJob(cableId, 2.5, { lengthsText: '3×15,0 + 3×15,0 + 11,0' }), newJob(cableId, 1.5, { cores: 2, colors: ['yellow-green', 'blue'], lengthsText: '3×15,0 + 11,0' })];
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
    savePrevious(); state.drums.push({ id: crypto.randomUUID(), jobId: '', cableId: state.cableId, section: state.section, color: state.color, length: '15000', name: '', breakdowns: '', status: 'queued' });
    state.manualOrder = true; persist(); renderQueue();
  });
  $('drums').addEventListener('input', event => {
    const card = event.target.closest('[data-drum]'), field = event.target.dataset.field;
    if (!card || !field) return;
    const drum = state.drums.find(d => d.id === card.dataset.drum);
    drum[field] = field === 'section' ? Number(event.target.value) : event.target.value;
    if (field === 'cableId') {
      const cable = optionFor(drum.cableId); if (!cable.sections.includes(drum.section)) drum.section = cable.sections[0];
      const select = card.querySelector('[data-field="section"]'); select.innerHTML = sections(drum.cableId, drum.section);
      select.closest('label').hidden = isThread(drum.cableId);
    }
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
      $('plan-live').textContent = `${drumTitle(drum)}, ${colorName(drum.color)}: ${drumStatus(state.drums[i]) === 'done' ? 'готово' : drumStatus(state.drums[i]) === 'active' ? 'в роботі' : 'повернуто до черги'}.`;
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
    printOpened = [...$('drums').querySelectorAll('details:not([open])')];
    printOpened.forEach(el => { el.open = true; });
  });
  window.addEventListener('afterprint', () => { printOpened?.forEach(el => { el.open = false; }); printOpened = null; });
  if (state.planJobs.length && !state.planDirty) $('job-builder').open = false;
  return { render, renderQueue, renderOutputs, result, transitionText, setup, drumTitle, syncSelection };
}
