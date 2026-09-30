import { CABLES, RECIPES } from './data.js';
import { COLORS, DEFAULT_RULES, number, fmt, outerEstimate, colorName, dyePlan, planDrum, spliceTarget, parseBreakdowns } from './core.js';
import { initTelegram, haptic, openSource, setBackHandler } from './telegram.js';
import { FIELDS, cachedCatalog, loadCatalog, findRecipe, api, csv } from './store.js?v=5';
import { referenceFor } from './reference-data.js?v=5';
import { trialRpm, additionalRpm, handwrittenAlternatives } from './rpm.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const STORAGE = 'zavod-workbook-v1';
const DRAFT = 'zavod-measurement-draft-v1';
const RULES = [['bath', 'У ванні, м'], ['reserve', 'Запас до перекидання, м'], ['lead2', 'Барвник №2 — за, м'], ['lead1', 'Барвник №1 — за, м'], ['splice', 'Запас для скрутки, м']];
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
const cableLabel = id => CABLES.find(row => row.id === id)?.label ?? id;
const colorLabel = id => id === 'all' ? 'Усі кольори' : colorName(id);
const date = value => value ? new Date(value).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' }) : '';
const cableOptions = () => CABLES.map(row => `<option value="${row.id}">${esc(row.label)}</option>`).join('');
const colorOptions = (selected, all = false) => (all ? '<option value="all">Усі кольори</option>' : '') + COLORS.map(row => `<option value="${row.id}" ${row.id === selected ? 'selected' : ''}>${esc(row.label)}</option>`).join('');
const sectionOptions = id => CABLES.find(row => row.id === id).sections.map(value => `<option value="${value}">${fmt(value)}</option>`).join('');

function restore() {
  const state = { version: 1, cableId: 'vvgng-p', section: 1.5, color: 'blue', rules: { ...DEFAULT_RULES }, overrides: {}, currentTarget: '15000', drums: ['blue', 'brown', 'yellow-green'].map((color, i) => ({ id: `drum-${i}`, color, length: '15000', name: '', breakdowns: '' })) };
  const saved = read(STORAGE);
  if (saved?.version !== 1) return state;
  const cable = CABLES.find(row => row.id === saved.cableId);
  if (cable) { state.cableId = cable.id; state.section = cable.sections.includes(saved.section) ? saved.section : cable.sections[0]; }
  if (COLORS.some(row => row.id === saved.color)) state.color = saved.color;
  for (const [key] of RULES) if (Number.isInteger(number(saved.rules?.[key])) && number(saved.rules[key]) >= 0) state.rules[key] = number(saved.rules[key]);
  if (saved.overrides && typeof saved.overrides === 'object') state.overrides = saved.overrides;
  if (typeof saved.currentTarget === 'string') state.currentTarget = saved.currentTarget.slice(0, 20);
  const drums = Array.isArray(saved.drums) ? saved.drums.filter(d => d && COLORS.some(c => c.id === d.color)).slice(0, 50) : [];
  if (drums.length) state.drums = drums.map((d, i) => ({ id: `drum-${i}`, color: d.color, length: String(d.length ?? '').slice(0, 20), name: String(d.name ?? '').slice(0, 80), breakdowns: String(d.breakdowns ?? '').slice(0, 2000) }));
  return state;
}
const state = restore();
let catalog = cachedCatalog();
let view = 'setup', toastTimer, syncing = false, authorized = false, authenticating = false, trialSpeed = '';
let formReady = false, expectedRevision = 0, pendingSave = null, journal = [], nextJournal = null, busy = false;
const recipe = (color = state.color) => findRecipe(catalog, state.cableId, state.section, color);
const persist = () => { if (!write(STORAGE, state)) toast('План не зберігся на пристрої. Скопіюй його перед закриттям.'); };
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }

function showView(next) {
  view = next;
  for (const name of ['setup', 'plan', 'table', 'admin']) $('view-' + name).hidden = next !== name;
  document.querySelectorAll('[data-view]').forEach(button => button.toggleAttribute('data-active', button.dataset.view === next));
  setBackHandler(next === 'setup' ? null : () => showView('setup'));
  if (next === 'setup') renderSetup();
  if (next === 'plan') renderPlan();
  if (next === 'table') renderTable();
  if (next === 'admin') void enterAdmin();
  window.scrollTo({ top: 0, behavior: 'instant' });
  haptic();
}
function renderSelectors() {
  $('cable').innerHTML = cableOptions(); $('cable').value = state.cableId;
  $('section').innerHTML = sectionOptions(state.cableId); $('section').value = String(state.section);
  $('color').innerHTML = colorOptions(state.color);
}
function renderSetup() {
  document.documentElement.dataset.wireColor = state.color;
  const r = recipe();
  $('open-splice').textContent = `Вхідний закінчився · +${fmt(state.rules.splice)} м`;
  const dyes = dyePlan(state.color, r.mode);
  const value = key => `<strong>${fmt(r[key])}</strong>`;
  const more = extruder => {
    const forecast = extruder === 2 && r.mode === 'single' ? '' : `<p class="rpm-forecast">Прогноз: <b id="forecast-rpm${extruder}">—</b></p>`;
    const extra = additionalRpm(r, extruder).map(item => `<p>${esc(item.label)}: <b title="${esc(item.source)}">${fmt(item.value)}</b></p>`).join('');
    return forecast || extra ? `<div class="rpm-more">${forecast}${extra}</div>` : '';
  };
  const alternatives = handwrittenAlternatives(r);
  const missing = ['extruder1', 'sikoraWire', 'sikoraOuter', 'dorn', 'matrix', 'maxSpeed', ...(r.mode === 'single' ? [] : ['extruder2'])].some(key => r[key] == null);
  $('values').innerHTML = `<section class="production"><h1>Оберти шнека <span>об/хв</span></h1><div class="pair"><div><span>Екструдер №1</span>${value('extruder1')}<small>${esc(dyes?.first)}</small>${more(1)}</div><div><span>Екструдер №2</span>${r.mode === 'single' ? '<strong class="off">Вимк.</strong>' : value('extruder2')}<small>${esc(dyes?.second)}</small>${more(2)}</div></div><label class="trial-speed"><span>Швидкість для прогнозу, <span class="unit">м/хв</span></span><input id="trial-speed" type="text" inputmode="decimal" autocomplete="off" value="${esc(trialSpeed)}" aria-describedby="forecast-help"></label><p id="forecast-help" class="rpm-help" role="status"></p>${alternatives ? `<p class="rpm-alternatives">Інші рукописні: ${esc(alternatives)}. Режими ще не уточнені.</p>` : ''}</section>
    <section class="card readings"><h2>Сікора <small>мм</small></h2><div class="pair"><div><span>1 · Дріт</span>${value('sikoraWire')}</div><div><span>2 · Ізоляція</span>${value('sikoraOuter')}</div></div><p class="reference">Матриця + 0,15 ≈ ${fmt(outerEstimate(r.matrix))} <span>· орієнтир</span></p></section>
    <section class="card tool-row"><div><img src="./DORN.svg" alt=""><span>Дорн</span>${value('dorn')}</div><div><img src="./MATRIX.svg" alt=""><span>Матриця</span>${value('matrix')}</div><small>мм</small></section>
    <div class="speed-row"><span>Макс. швидкість</span><div>${value('maxSpeed')} <span>м/хв</span></div></div>
    ${missing || !dyes?.valid ? `<p class="notice">${r.mode === 'unknown' ? 'Режим ще не уточнений. ' : ''}${!dyes?.valid && r.mode !== 'unknown' ? esc(dyes.note) : missing ? '«—» — значення ще треба уточнити.' : ''}</p>` : ''}
    ${r.cableId === 'pv3' && r.mode === 'dual' && r.origin !== 'measurement' ? '<p class="notice">Пара №1/№2 — з рукопису. Для якого кольору вона потрібна, ще не уточнено.</p>' : ''}`;
  $('source-content').innerHTML = sourceContent(r);
  renderForecast();
}
function renderForecast() {
  const result = trialRpm(recipe(), trialSpeed, state.color);
  for (const [extruder, key] of [[1, 'first'], [2, 'second']]) {
    const target = $('forecast-rpm' + extruder);
    if (target) target.textContent = result[key] == null ? '—' : '≈ ' + fmt(result[key], 1);
  }
  $('forecast-help').textContent = trialSpeed.trim() ? result.message : 'Орієнтир для проби за незмінних умов.';
}
function sourceContent(r) {
  const original = RECIPES.find(row => row.id === (r.baseId || r.id));
  const references = referenceFor(r.cableId);
  return `<p>${r.origin === 'measurement' ? 'Власний замір' : 'Рукописний запис'} · ${esc(date(r.updatedAt))}</p><p><a class="source-link" href="./${esc(r.source)}">Відкрити фото ${esc(r.source)}</a></p>
    ${[...(r.notes || []), ...(r.uncertain || [])].map(note => `<p>${esc(note)}</p>`).join('')}
    ${r.cableId === 'pv3' ? '<p>ПВ3: один екструдер — основний режим за уточненням оператора. Пари значень у записі можуть стосуватися жовто-зеленого кольору; це ще не підтверджено.</p>' : ''}
    ${r.origin === 'measurement' && original ? `<details><summary>Початковий рукописний запис</summary>${numbersList(original)}${[...original.notes, ...original.uncertain].map(note => `<p>${esc(note)}</p>`).join('')}</details>` : ''}
    <details><summary>Примітки до довідкових карт</summary>${references.map(card => `<p><b>${esc(card.label)}</b> · <a href="./${esc(card.source)}">Фото</a></p>${card.notes.map(note => `<p>${esc(note)}</p>`).join('')}`).join('')}</details>`;
}
async function syncCatalog(notify = false) {
  if (syncing) return;
  syncing = true;
  try {
    catalog = await loadCatalog();
    $('connection').textContent = 'Спільна таблиця · оновлено ' + new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    $('table-status').textContent = 'Зміни з адмін-панелі зберігаються у цій таблиці.';
    if (notify) toast('Таблицю оновлено');
  } catch {
    $('connection').textContent = catalog.source === 'snapshot' ? 'Без зв’язку · показано початкові записи' : 'Без зв’язку · показано останню збережену таблицю';
    $('table-status').textContent = $('connection').textContent;
    if (notify) toast('Немає зв’язку. Показано збережені значення.');
  } finally {
    syncing = false; renderSetup(); if (view === 'table') renderTable(); if (view === 'plan') renderPlan();
  }
}

function renderTable() {
  const filter = $('table-filter').value;
  const rows = catalog.recipes.filter(row => !filter || row.cableId === filter).sort((a, b) => CABLES.findIndex(c => c.id === a.cableId) - CABLES.findIndex(c => c.id === b.cableId) || a.section - b.section || a.color.localeCompare(b.color));
  $('table-count').textContent = `Рядків: ${rows.length}`;
  $('table-body').innerHTML = rows.map(row => `<tr><th scope="row">${esc(cableLabel(row.cableId))}</th><td>${fmt(row.section)}</td><td>${esc(colorLabel(row.color))}</td><td>${fmt(row.extruder1)}</td><td>${row.mode === 'single' ? 'Вимк.' : fmt(row.extruder2)}</td>${['sikoraWire', 'sikoraOuter', 'dorn', 'matrix', 'maxSpeed'].map(key => `<td>${fmt(row[key])}</td>`).join('')}<td><button type="button" class="back" data-record="${esc(row.id)}">${row.origin === 'measurement' ? 'Замір' : 'Запис'} ↗</button></td></tr>`).join('');
}
function numbersList(row) { return `<dl class="numbers-list">${FIELDS.map(([key, label]) => `<div><dt>${esc(label)}</dt><dd>${key === 'extruder2' && row.mode === 'single' ? 'Вимк.' : fmt(row[key])}</dd></div>`).join('')}</dl>`; }
function openRecord(id) {
  const row = catalog.recipes.find(r => r.id === id);
  if (!row) return;
  $('record-content').innerHTML = `<p><b>${esc(cableLabel(row.cableId))} ${fmt(row.section)} мм² · ${esc(colorLabel(row.color))}</b></p>${sourceContent(row)}${authorized ? `<div class="actions"><button class="primary" type="button" data-edit="${esc(id)}">Записати новий замір</button><button class="secondary" type="button" data-history="${esc(id)}">Історія змін</button></div><div id="record-history"></div>` : ''}`;
  $('record-dialog').showModal();
}

function drumResult(drum, i) {
  const r = recipe(drum.color), next = state.drums[i + 1];
  const mode = next && recipe(next.color).mode !== r.mode ? 'unknown' : r.mode;
  return planDrum(drum, next, mode, { ...state.rules });
}
function drumOutput(drum, i) {
  const result = drumResult(drum, i), log = parseBreakdowns(drum.breakdowns);
  if (result.errors.length) return `<p class="error">${result.errors.map(esc).join('<br>')}</p>`;
  return `<div class="target"><span>Довжина на екрані</span><strong>${fmt(result.target)} <small>м</small></strong></div>
    ${result.transition ? `<ol class="steps">${result.events.map(event => `<li><b>≈ ${fmt(event.at)} м</b> — барвник №${event.extruder}: ${esc(event.dye.toLowerCase())}</li>`).join('')}<li>Стравити. Коли ${esc(colorName(result.nextColor).toLowerCase())} з’явиться у 4-му рядку ванни — перекинути вручну.</li></ol><p class="quiet formula">${esc(result.formula)}</p>` : '<p class="quiet">Без поправки на зміну кольору.</p>'}
    ${result.warnings.map(w => `<p class="error">${esc(w)}</p>`).join('')}${log.error ? `<p class="error">${esc(log.error)}</p>` : log.values.length ? `<p>На ярлик — пробій: <b>${log.values.map(v => fmt(v) + ' м').join('; ')}</b></p>` : ''}`;
}
function renderPlan() {
  $('plan-title').textContent = `${cableLabel(state.cableId)} · ${fmt(state.section)} мм² · план зберігається на цьому пристрої`;
  $('drums').innerHTML = state.drums.map((drum, i) => `<article class="card drum" data-drum="${drum.id}"><div class="drum-heading"><h2>Барабан ${i + 1}</h2><div><button type="button" class="icon-button" data-action="up" aria-label="Барабан ${i + 1} вгору" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="icon-button" data-action="down" aria-label="Барабан ${i + 1} вниз" ${i === state.drums.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="icon-button" data-action="remove" aria-label="Прибрати барабан ${i + 1}" ${state.drums.length === 1 ? 'disabled' : ''}>×</button></div></div><div class="form-grid"><label>Колір<select data-field="color">${colorOptions(drum.color)}</select></label><label>Потрібна довжина, м<input data-field="length" inputmode="numeric" value="${esc(drum.length)}" maxlength="20"></label></div><div data-output="${drum.id}">${drumOutput(drum, i)}</div><details class="extra"><summary>Номер барабана та пробої</summary><div class="form-grid"><label>Номер барабана<input data-field="name" maxlength="80" value="${esc(drum.name)}"></label><label>Пробій на метрі<input data-field="breakdowns" inputmode="text" maxlength="2000" placeholder="3682; 9240" value="${esc(drum.breakdowns)}"></label></div></details></article>`).join('');
  $('rules').innerHTML = RULES.map(([key, label]) => `<label>${esc(label)}<input data-rule="${key}" inputmode="numeric" value="${esc(state.rules[key])}" maxlength="8"></label>`).join('');
  const r = recipe();
  if (r.colorLead2) $('rules').insertAdjacentHTML('beforeend', `<p class="quiet">У записі для цього проводу: зміна кольору №2 за ${fmt(r.colorLead2)} м. <button class="back" type="button" id="use-source-lead">Взяти це значення</button></p>`);
}
function renderOutputs() { state.drums.forEach((drum, i) => { document.querySelector(`[data-output="${drum.id}"]`).innerHTML = drumOutput(drum, i); }); }
function renderSplice() { const result = spliceTarget(state.currentTarget, state.rules.splice); $('splice-result').textContent = result === null ? 'Введи цілі метри' : fmt(result) + ' м'; }
async function copyPlan() {
  const lines = [`${cableLabel(state.cableId)} ${fmt(state.section)} мм²`];
  state.drums.forEach((drum, i) => {
    const result = drumResult(drum, i), r = recipe(drum.color);
    lines.push(`\nБарабан ${i + 1}${drum.name ? ' №' + drum.name : ''}: ${colorName(drum.color)}, ${drum.length} м.`, `Оберти шнека №1 ${fmt(r.extruder1)}, №2 ${r.mode === 'single' ? 'вимк.' : fmt(r.extruder2)} об/хв. Сікора ${fmt(r.sikoraWire)} / ${fmt(r.sikoraOuter)}. Дорн ${fmt(r.dorn)}, матриця ${fmt(r.matrix)}. Макс. ${fmt(r.maxSpeed)} м/хв.`, `На екрані: ${fmt(result.target)} м.`, ...result.errors, ...(result.warnings || []), ...result.events.map(e => `≈ ${fmt(e.at)} м: барвник №${e.extruder} — ${e.dye}.`));
    if (result.transition) lines.push('Стравити та перекинути вручну за потрібним кольором у 4-му рядку ванни.');
    if (drum.breakdowns) lines.push('Пробої: ' + drum.breakdowns);
  });
  try { await navigator.clipboard.writeText(lines.join('\n')); toast('План скопійовано'); } catch { toast('Копіювання недоступне. Скористайся кнопкою «Друк».'); }
}

async function enterAdmin() {
  if (authorized || authenticating) return;
  authenticating = true;
  try {
    const auth = await api('/admin/auth', { method: 'POST', admin: true });
    authorized = true; $('admin-gate').hidden = true; $('admin-content').hidden = false; $('admin-who').textContent = '@' + auth.username;
    await syncCatalog();
    if (!formReady) {
      const draft = read(DRAFT);
      if (draft && RECIPES.some(r => r.id === draft.baseId) && ['all', ...COLORS.map(c => c.id)].includes(draft.color)) {
        fillMeasurement(draft, draft.expectedRevision);
        if (draft.pendingSave?.id && draft.pendingSave?.signature) pendingSave = draft.pendingSave;
        $('save-message').textContent = 'Відновлено незавершений замір.';
      } else newMeasurement();
    }
    $('import-old').hidden = !Object.keys(state.overrides).length;
  } catch (error) { $('admin-message').textContent = error.message; }
  finally { authenticating = false; }
}
function selectedBase() { return RECIPES.find(row => row.cableId === $('measure-cable').value && row.section === Number($('measure-section').value)); }
function exactRevision(baseId, color) { return catalog.recipes.find(row => row.baseId === baseId && row.color === color)?.revision ?? 0; }
function newMeasurement(row = recipe()) { fillMeasurement({ ...row, color: row.color === 'all' ? state.color : row.color, note: '' }); }
function fillMeasurement(row, revision) {
  const base = RECIPES.find(r => r.id === row.baseId || r.id === row.id);
  if (!base) return;
  $('measurement-form').hidden = false; $('journal').hidden = true;
  $('measure-cable').innerHTML = cableOptions(); $('measure-cable').value = base.cableId;
  $('measure-section').innerHTML = sectionOptions(base.cableId); $('measure-section').value = String(base.section);
  $('measure-color').innerHTML = colorOptions(row.color, true); $('measure-color').value = row.color;
  $('measure-mode').value = row.mode;
  $('measurement-fields').innerHTML = FIELDS.map(([key, label]) => `<label>${esc(label)}<input name="${key}" inputmode="decimal" autocomplete="off" value="${row[key] == null ? '' : esc(row[key])}" placeholder="Не записано" maxlength="12" ${key === 'extruder2' && row.mode === 'single' ? 'disabled' : ''}></label>`).join('');
  $('measure-note').value = row.note || '';
  $('publish-measurement').checked = false;
  expectedRevision = revision ?? exactRevision(base.id, row.color);
  pendingSave = null; formReady = true; $('save-message').textContent = '';
}
function formValues() {
  const values = { baseId: selectedBase().id, color: $('measure-color').value, mode: $('measure-mode').value, note: $('measure-note').value };
  for (const [key] of FIELDS) values[key] = $('measurement-form').elements.namedItem(key).value;
  return values;
}
function saveDraft() { if (formReady) write(DRAFT, { ...formValues(), expectedRevision, pendingSave }); }
function loadSelectedMeasurement() {
  const base = selectedBase(), color = $('measure-color').value;
  const row = findRecipe(catalog, base.cableId, base.section, color);
  fillMeasurement({ ...row, color, note: '' }); saveDraft();
}
async function saveMeasurement(event) {
  event.preventDefault();
  if (busy) return;
  const input = formValues();
  for (const [key, label] of FIELDS) {
    const raw = input[key]; input[key] = number(raw);
    if (String(raw).trim() && (input[key] === null || input[key] <= 0)) { $('save-message').textContent = `${label}: введи додатне число або залиш поле порожнім.`; return; }
  }
  if (input.mode === 'single') input.extruder2 = null;
  const publish = $('publish-measurement').checked;
  if (publish && input.mode === 'unknown') { $('save-message').textContent = 'Для калькулятора треба обрати, які екструдери працюють.'; return; }
  const signature = JSON.stringify(input);
  if (pendingSave?.signature !== signature) pendingSave = { signature, id: crypto.randomUUID() };
  saveDraft();
  busy = true; $('save-measurement').disabled = true; $('save-message').textContent = 'Зберігаю…';
  $('measurement-form').querySelectorAll('input, select, textarea').forEach(control => { control.disabled = true; });
  let recorded = false;
  try {
    await api('/admin/measurements', { method: 'POST', admin: true, body: { ...input, id: pendingSave.id } });
    recorded = true;
    if (publish) {
      const id = input.color === 'all' ? input.baseId : `${input.baseId}~${input.color}`;
      const result = await api('/admin/recipes/' + encodeURIComponent(id), { method: 'PUT', admin: true, body: { measurementId: pendingSave.id, expectedRevision } });
      catalog.recipes = [...catalog.recipes.filter(row => row.id !== id), result.recipe];
      expectedRevision = result.recipe.revision; renderSetup();
      await syncCatalog();
    }
    $('save-message').textContent = publish ? 'Збережено. Калькулятор уже показує ці значення.' : 'Замір збережено в журналі.';
    write(DRAFT, null); haptic('success');
  } catch (error) {
    $('save-message').textContent = (recorded ? 'Замір є в журналі. Застосування не підтверджено. ' : '') + error.message;
    saveDraft(); haptic('error');
  } finally {
    busy = false; $('save-measurement').disabled = false;
    $('measurement-form').querySelectorAll('input, select, textarea').forEach(control => { control.disabled = control.name === 'extruder2' && $('measure-mode').value === 'single'; });
  }
}
async function showJournal(more = false) {
  $('measurement-form').hidden = true; $('journal').hidden = false;
  if (!more) { journal = []; $('journal-list').textContent = 'Завантажую…'; }
  $('more-journal').disabled = true;
  try {
    const result = await api('/admin/measurements' + (more && nextJournal ? '?before=' + encodeURIComponent(nextJournal) : ''), { admin: true });
    journal.push(...result.measurements); nextJournal = result.next;
    $('journal-list').innerHTML = journal.length ? journal.map(row => `<article class="card journal-entry"><h2>${esc(cableLabel(row.cableId))} ${fmt(row.section)} · ${esc(colorLabel(row.color))}</h2><p class="quiet">${esc(date(row.createdAt))}</p>${row.note ? `<p>${esc(row.note)}</p>` : ''}<details><summary>Значення</summary>${numbersList(row)}</details><button class="back" type="button" data-reuse="${esc(row.id)}">Взяти за основу нового заміру →</button></article>`).join('') : '<p class="card">Поки немає замірів. Натисни «Новий замір».</p>';
    $('more-journal').hidden = !nextJournal;
  } catch (error) { if (!more) $('journal-list').textContent = error.message; else toast(error.message); }
  finally { $('more-journal').disabled = false; }
}
async function showHistory(id) {
  const target = $('record-history'); target.textContent = 'Завантажую…';
  try {
    const { history } = await api('/admin/history/' + encodeURIComponent(id), { admin: true });
    target.innerHTML = history.length ? history.map(row => `<details class="extra"><summary>${esc(date(row.updatedAt))} · версія ${row.revision}</summary>${numbersList(row)}${(row.notes || []).map(note => `<p>${esc(note)}</p>`).join('')}</details>`).join('') : '<p>Цей рядок ще не змінювали.</p>';
  } catch (error) { target.textContent = error.message; }
}
function importOld() {
  const entries = Object.entries(state.overrides).filter(([key]) => RECIPES.some(row => key.startsWith(row.id + ':')));
  $('record-content').innerHTML = '<p>Старі уточнення з цього пристрою. Обери запис, перевір його й збережи як замір.</p>' + entries.map(([key]) => { const [id, mode, color] = key.split(':'); const row = RECIPES.find(r => r.id === id); return `<p><button type="button" class="secondary" data-old="${esc(key)}">${esc(cableLabel(row.cableId))} ${fmt(row.section)} · ${esc(colorLabel(color))} · ${mode === 'single' ? '№1' : '№1 і №2'}</button></p>`; }).join('');
  $('record-dialog').showModal();
}

document.addEventListener('click', event => {
  const target = event.target.closest('button, a'); if (!target) return;
  if (busy && (target.dataset.edit || target.dataset.reuse || target.dataset.old)) return;
  if (target.dataset.view) showView(target.dataset.view);
  if (target.dataset.close) $(target.dataset.close).close();
  if (target.classList.contains('source-link')) { event.preventDefault(); openSource(target.href); }
  if (target.dataset.record) openRecord(target.dataset.record);
  if (target.dataset.edit) { const row = catalog.recipes.find(r => r.id === target.dataset.edit); $('record-dialog').close(); showView('admin'); fillMeasurement({ ...row, note: '' }); }
  if (target.dataset.history) void showHistory(target.dataset.history);
  if (target.dataset.reuse) { fillMeasurement(journal.find(row => row.id === target.dataset.reuse)); saveDraft(); }
  if (target.dataset.old) {
    const [id, mode, color] = target.dataset.old.split(':'); const row = RECIPES.find(r => r.id === id);
    fillMeasurement({ ...row, ...(mode !== row.mode ? { extruder1: null, extruder2: null, maxSpeed: null } : {}), ...state.overrides[target.dataset.old], baseId: id, mode, color, note: 'Уточнення, збережене на цьому пристрої' });
    $('record-dialog').close(); saveDraft();
  }
  if (target.id === 'use-source-lead') { state.rules.lead2 = recipe().colorLead2; persist(); renderPlan(); }
});
for (const id of ['cable', 'section', 'color']) $(id).addEventListener('change', () => {
  if (id === 'cable') { state.cableId = $('cable').value; if (!CABLES.find(c => c.id === state.cableId).sections.includes(state.section)) state.section = CABLES.find(c => c.id === state.cableId).sections[0]; }
  if (id === 'section') state.section = Number($('section').value);
  if (id === 'color') state.color = $('color').value;
  trialSpeed = ''; persist(); renderSelectors(); renderSetup(); haptic();
});
$('open-plan').addEventListener('click', () => showView('plan'));
$('open-splice').addEventListener('click', () => { $('current-target').value = state.currentTarget; renderSplice(); $('splice-dialog').showModal(); });
$('current-target').addEventListener('input', () => { state.currentTarget = $('current-target').value; persist(); renderSplice(); });
$('add-drum').addEventListener('click', () => { if (state.drums.length >= 50) return toast('У плані вже 50 барабанів.'); state.drums.push({ id: crypto.randomUUID(), color: state.color, length: '15000', name: '', breakdowns: '' }); persist(); renderPlan(); });
$('drums').addEventListener('input', event => { const card = event.target.closest('[data-drum]'); if (!card || !event.target.dataset.field) return; const drum = state.drums.find(d => d.id === card.dataset.drum); drum[event.target.dataset.field] = event.target.value; persist(); renderOutputs(); });
$('drums').addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (!button) return; const i = state.drums.findIndex(d => d.id === button.closest('[data-drum]').dataset.drum); if (button.dataset.action === 'remove' && state.drums.length > 1) state.drums.splice(i, 1); else { const j = i + (button.dataset.action === 'up' ? -1 : 1); if (j >= 0 && j < state.drums.length) [state.drums[i], state.drums[j]] = [state.drums[j], state.drums[i]]; } persist(); renderPlan(); });
$('rules').addEventListener('input', event => { if (!event.target.dataset.rule) return; state.rules[event.target.dataset.rule] = event.target.value; persist(); renderOutputs(); });
$('copy-plan').addEventListener('click', () => void copyPlan()); $('print-plan').addEventListener('click', () => window.print());
$('table-filter').innerHTML = '<option value="">Усі проводи</option>' + cableOptions();
$('table-filter').addEventListener('change', renderTable); $('refresh-table').addEventListener('click', () => void syncCatalog(true));
$('export-table').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([csv(catalog)], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'Обпресування.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); });
$('retry-admin').addEventListener('click', () => void enterAdmin());
$('new-measurement').addEventListener('click', () => {
  if (busy) return;
  if (formReady) {
    const base = selectedBase(), color = $('measure-color').value;
    fillMeasurement({ ...findRecipe(catalog, base.cableId, base.section, color), color, note: '' });
  } else newMeasurement();
  saveDraft();
});
$('show-journal').addEventListener('click', () => { saveDraft(); void showJournal(); }); $('more-journal').addEventListener('click', () => void showJournal(true));
$('import-old').addEventListener('click', importOld);
$('measure-cable').addEventListener('change', () => { $('measure-section').innerHTML = sectionOptions($('measure-cable').value); loadSelectedMeasurement(); });
for (const id of ['measure-section', 'measure-color']) $(id).addEventListener('change', loadSelectedMeasurement);
$('values').addEventListener('input', event => { if (event.target.id === 'trial-speed') { trialSpeed = event.target.value; renderForecast(); } });
$('measure-mode').addEventListener('change', () => { for (const key of ['extruder1', 'extruder2', 'maxSpeed']) $('measurement-form').elements.namedItem(key).value = ''; $('measurement-form').elements.namedItem('extruder2').disabled = $('measure-mode').value === 'single'; $('save-message').textContent = 'Режим змінено. Вкажи оберти й швидкість для нього.'; saveDraft(); });
$('measurement-form').addEventListener('input', saveDraft); $('measurement-form').addEventListener('submit', event => void saveMeasurement(event));
document.addEventListener('visibilitychange', () => { if (!document.hidden) void syncCatalog(); });
function startTelegram() { initTelegram(); if (window.Telegram?.WebApp?.initDataUnsafe?.start_param === 'admin' && view === 'setup') showView('admin'); }
renderSelectors(); renderSetup(); renderTable(); startTelegram();
window.addEventListener('load', startTelegram, { once: true });
if (new URLSearchParams(window.location.search).get('admin') === '1') showView('admin');
void syncCatalog();
