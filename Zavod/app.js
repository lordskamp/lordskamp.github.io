import { CATALOG_CABLES as CABLES, CATALOG_BASES as RECIPES, optionFor, baseFor, recipeIdFor } from './catalog-base.js?v=21';
import { COLORS, DEFAULT_RULES, number, fmt, colorName, dyePlan, spliceTarget } from './core.js?v=21';
import { createPlannerUI, restorePlanner } from './plan-ui.js?v=21';
import { drumStatus } from './planner.js?v=21';
import { initTelegram, haptic, openSource, setBackHandler } from './telegram.js';
import { FIELDS, cachedCatalog, loadCatalog, api } from './store.js?v=21';
import { setupFor, tableSetups, metricValues, VALUE_LABELS } from './setup-data.js?v=21';
import { SOURCE_ANNOTATIONS } from './reference-data.js?v=21';
import { initSplicePlanner } from './splice-ui.js?v=21';
import { inferMeasurementMode, measurementRecords, measurementSignature, refreshPendingMeasurements } from './measurement-input.js?v=21';
import { SPEED_STORAGE, speedKey, speedLimit, speedSetup } from './speed-override.js?v=21';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const STORAGE = 'zavod-workbook-v1';
const DRAFT = 'zavod-measurement-draft-v1';
const DRAFTS = 'zavod-measurement-drafts-v3';
const LEGACY_DRAFTS = 'zavod-measurement-drafts-v2';
const RULES = [['bath', 'У ванні, м'], ['reserve', 'Запас до перекидання, м'], ['lead2', 'Барвник №2 — за, м'], ['lead1', 'Барвник №1 — за, м'], ['splice', 'Запас для скрутки, м']];
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
const cableLabel = id => optionFor(id)?.label ?? id;
const colorLabel = id => id === 'all' ? '' : colorName(id);
const date = value => value ? new Date(value).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' }) : '';
const cableOptions = () => CABLES.map(row => `<option value="${row.id}">${esc(row.label)}</option>`).join('');
const colorOptions = selected => COLORS.map(row => `<option value="${row.id}" ${row.id === selected ? 'selected' : ''}>${esc(row.label)}</option>`).join('');
const sectionOptions = id => CABLES.find(row => row.id === id).sections.map(value => `<option value="${value}">${fmt(value)}</option>`).join('');

function restore() {
  const state = { version: 1, cableId: optionFor('vvgng-p').id, section: 1.5, color: 'blue', rules: { ...DEFAULT_RULES }, overrides: {}, currentTarget: '15000', drums: ['blue', 'brown', 'yellow-green'].map((color, i) => ({ id: `drum-${i}`, color, length: '15000', name: '', breakdowns: '' })) };
  const saved = read(STORAGE);
  if (saved?.version !== 1) { restorePlanner(null, state); return state; }
  const cable = optionFor(saved.cableId);
  if (cable) { state.cableId = cable.id; state.section = cable.sections.includes(saved.section) ? saved.section : cable.sections[0]; }
  if (COLORS.some(row => row.id === saved.color)) state.color = saved.color;
  for (const [key] of RULES) if (Number.isInteger(number(saved.rules?.[key])) && number(saved.rules[key]) >= 0) state.rules[key] = number(saved.rules[key]);
  if (saved.overrides && typeof saved.overrides === 'object') state.overrides = saved.overrides;
  if (typeof saved.currentTarget === 'string') state.currentTarget = saved.currentTarget.slice(0, 20);
  restorePlanner(saved, state);
  return state;
}
const state = restore();
let catalog = cachedCatalog();
let view = 'setup', toastTimer, syncing = false, catalogRequest = null, authorized = false, authenticating = false;
let formReady = false, formMode = null, formDraftContext = null, expectedRevision = 0, pendingSave = null, journal = [], nextJournal = null, busy = false;
let deletedMeasurement = null;
let setupFromPlan = false;
const savedSpeeds = read(SPEED_STORAGE);
const localSpeeds = savedSpeeds && typeof savedSpeeds === 'object' && !Array.isArray(savedSpeeds) ? savedSpeeds : {};
let speedEditContext = null;
const localSetup = (cableId, section, color) => {
  const original = setupFor(cableId, section, catalog, color), selected = localSpeeds[speedKey(original)];
  return selected == null ? original : speedSetup(original, selected).info;
};
const setup = (color = state.color) => localSetup(state.cableId, state.section, color);
const recipe = color => {
  const result = setup(color);
  return { ...result.stored, ...result.effective, color: state.color, mode: result.mode, maxSpeed: result.effective.workingSpeed, optionId: result.option.id };
};
const display = value => typeof value === 'string' && number(value) === null ? esc(value) : fmt(value);
const persist = () => { if (!write(STORAGE, state)) toast('План не зберігся на пристрої. Скопіюй його перед закриттям.'); };
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
initSplicePlanner({ toast, initialDraft: read(STORAGE)?.splicePlan });
const planner = createPlannerUI({ state, getSetup: localSetup, persist, toast, haptic, onCableInfo: drum => {
  state.cableId = drum.cableId; state.section = drum.section; state.color = drum.color;
  setupFromPlan = true; persist(); renderSelectors(); showView('setup');
} });

function showView(next) {
  if (next === 'table' && view === 'setup') $('table-filter').value = state.cableId;
  view = next;
  if (next !== 'setup') setupFromPlan = false;
  $('return-to-plan').hidden = next !== 'setup' || !setupFromPlan;
  for (const name of ['setup', 'plan', 'table', 'admin']) $('view-' + name).hidden = next !== name;
  document.querySelectorAll('[data-view]').forEach(button => button.toggleAttribute('data-active', button.dataset.view === next));
  setBackHandler(next === 'setup' ? setupFromPlan ? () => showView('plan') : null : () => showView('setup'));
  if (next === 'setup') renderSetup();
  if (next === 'plan') { planner.syncSelection(); renderPlan(); }
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
  const info = setup(), r = recipe();
  $('open-splice').textContent = `Вхідний закінчився · +${fmt(state.rules.splice)} м`;
  const dyes = dyePlan(state.color, r.mode);
  const extra = item => item.value == null ? '' : `<p class="metric-extra">${esc(item.label)}: <b>${item.confirmed ? 'підтверджено' : display(item.value)}</b></p>`;
  const value = key => info.manualSpeed && ['extruder1', 'extruder2'].includes(key)
    ? `<strong>${display(info.effective[key])}</strong><small class="value-kind">Орієнтовно · за твоєю швидкістю</small>`
    : metricValues(info, key).filter((item, index) => index === 0 || item.value != null).map((item, index) => index === 0 ? `<strong>${display(item.value)}</strong>${item.value == null ? '' : `<small class="value-kind">${esc(item.label)}</small>`}` : extra(item)).join('');
  const speeds = info.stages;
  const matrix = number(info.effective.matrix), outer = number(info.effective.sikoraOuter);
  const sikoraOffset = matrix !== null && outer !== null ? Math.round((outer - matrix) * 100) / 100 : null;
  const sikoraGuide = sikoraOffset !== null
    ? `${info.sources.sikoraOuter === 'practical' ? 'За заміром' : 'Орієнтир'}: матриця ${sikoraOffset < 0 ? '−' : '+'} ${fmt(Math.abs(sikoraOffset))} мм`
    : typeof info.effective.matrix === 'string' ? 'Парні розміри наведено за довідкою.' : 'Середня поправка для 2,5 мм²: +0,15 мм; для тонших жил — менша.';
  $('values').innerHTML = `<section class="production"><h1>Оберти шнека <span>об/хв</span></h1>
      <div class="pair extruders">
        <div class="extruder ${r.mode === 'dual' ? dyes?.first === 'Біла основа' ? 'base-white' : dyes?.first === 'Жовтий' ? 'base-yellow' : '' : ''}"><span>Екструдер №1</span>${value('extruder1')}</div>
        <div class="extruder ${r.mode === 'single' ? 'is-off' : ''}"><span>Екструдер №2</span>${r.mode === 'single' ? `<span class="off-icon" aria-hidden="true">⏻</span><strong class="off">Вимкнено</strong>${extra({ label: VALUE_LABELS.reference, value: info.reference.extruder2 })}` : value('extruder2')}</div>
      </div>${info.forecast.reason && info.effective.extruder1 == null ? '<p class="rpm-help">Прогнозу ще немає — потрібен практичний замір.</p>' : ''}</section>
    <section class="card readings"><h2>SIKORA <small>мм</small></h2><div class="pair"><div><span>1 · Діаметр жили</span>${value('sikoraWire')}</div><div><span>2 · З ізоляцією</span>${value('sikoraOuter')}</div></div><p class="reference">${esc(sikoraGuide)}</p>
      <details class="sikora-help"><summary>Які це діаметри?</summary><p>Перше число — фактичний діаметр жили. Друге у записах — діаметр з ізоляцією. Номінальний діаметр із довідки показано окремо; він не підставляється замість налаштування SIKORA.</p><p>На <a class="source-link" href="./Screen.JPG">фото головного екрана</a> є «Гор. Ø» і окреме поле «Допуск». Це інша пара полів. Допуск у записах не вказаний.</p><p>За твоїми замірами середня поправка до матриці для 2,5 мм² — близько +0,15 мм, для тоншої жили менша. Без практичного значення прогноз враховує вибрану матрицю, переріз і доступні заміри.</p></details></section>
    <section class="card tool-row"><div><img src="./DORN.svg" alt=""><span>Дорн</span><div class="tool-values">${value('dorn')}</div></div><div><img src="./MATRIX.svg" alt=""><span>Матриця</span><div class="tool-values">${value('matrix')}</div></div><small>мм</small></section>
    <section class="card speeds"><h2>Швидкості <small>м/хв</small></h2><div class="speed-stages"><div><span>1 · Запуск</span><strong>${fmt(speeds.first)}</strong><small>40 або 80</small></div><div><span>2 · Проміжна</span><strong>${fmt(speeds.second)}</strong><small>Між запуском і робочою</small></div><div><span>3 · Робоча</span><button type="button" id="edit-working-speed" class="speed-edit" aria-label="Змінити робочу швидкість"><strong>${fmt(speeds.working)}</strong><span aria-hidden="true">✎</span></button><small>${speeds.source === 'manual' ? 'Твоя швидкість' : VALUE_LABELS[speeds.source] ?? 'Ще не визначено'} · змінити</small></div></div>${info.manualSpeed ? '' : metricValues(info, 'workingSpeed').slice(1).filter(item => item.value != null).map(item => `<p class="speed-extra">${esc(item.label)}: <b>${item.confirmed ? 'підтверджено' : fmt(item.value) + ' м/хв'}</b></p>`).join('')}</section>
    ${r.mode === 'dual' ? '<p class="quiet forecast-note">Спільні налаштування для роботи двох екструдерів, незалежно від кольору.</p>' : ''}
    ${Object.values(info.sources).includes('forecast') ? '<p class="quiet forecast-note">Прогнозовані значення ще не перевірені на лінії.</p>' : ''}
    ${!dyes?.valid ? `<p class="notice">${esc(dyes?.note)}</p>` : ''}`;
  $('source-content').innerHTML = sourceContent(r);
}
function previewWorkingSpeed() {
  if (!speedEditContext) return;
  const { info, error } = speedSetup(speedEditContext.info, $('working-speed-input').value);
  $('working-speed-message').textContent = error ?? '';
  $('working-speed-message').hidden = !error;
  $('working-speed-preview').textContent = error ? '—' : `№1: ${fmt(info.effective.extruder1)}${info.mode === 'dual' ? ` · №2: ${fmt(info.effective.extruder2)}` : ' · №2 вимкнено'} об/хв`;
  $('apply-working-speed').disabled = Boolean(error);
}
function openWorkingSpeed() {
  const info = setupFor(state.cableId, state.section, catalog, state.color);
  speedEditContext = { info, key: speedKey(info) };
  $('working-speed-input').value = String(localSpeeds[speedEditContext.key] ?? info.effective.workingSpeed ?? '');
  const limit = speedLimit(info);
  $('working-speed-limit').textContent = limit === null ? '' : `До ${fmt(limit)} м/хв за наявними записами. Початкова: ${fmt(info.effective.workingSpeed)} м/хв.`;
  $('reset-working-speed').hidden = localSpeeds[speedEditContext.key] == null;
  previewWorkingSpeed(); $('working-speed-dialog').showModal();
  $('working-speed-input').focus(); $('working-speed-input').select();
}
function saveWorkingSpeed(reset = false) {
  if (!speedEditContext) return;
  const speed = number($('working-speed-input').value);
  if (!reset && speedSetup(speedEditContext.info, speed).error) { previewWorkingSpeed(); return; }
  if (reset || speed === number(speedEditContext.info.effective.workingSpeed)) delete localSpeeds[speedEditContext.key];
  else localSpeeds[speedEditContext.key] = speed;
  const saved = write(SPEED_STORAGE, localSpeeds);
  $('working-speed-dialog').close(); renderSetup();
  if (view === 'plan') renderPlan();
  toast(saved ? reset ? 'Початкову швидкість повернуто' : 'Швидкість та оберти перераховано' : 'Швидкість застосовано. Не вдалося зберегти її на пристрої.');
  haptic();
}
function sourceContent(r) {
  const original = RECIPES.find(row => row.id === (r.baseId || r.id));
  const info = setupFor(r.optionId || optionFor(r.cableId)?.id || state.cableId, r.section, catalog, r.color && r.color !== 'all' ? r.color : 'blue', { mode: r.mode }), references = [info.card];
  const photos = new Set([info.card.source, r.source, ...info.practicalSources]);
  const annotations = SOURCE_ANNOTATIONS.filter(([photo,,section]) => photos.has(photo) && (section === r.section || section === null));
  const rowNotes = [
    info.row.dornAlternative ? `Альтернативний довідковий дорн: ${fmt(info.row.dornAlternative)} мм.` : '',
    info.row.speedAlternative ? `У довідці записані дві швидкості: ${info.row.speedAlternative} м/хв; умови не уточнені.` : '',
    info.row.construction ? `Конструкція жили за довідкою: ${info.row.construction}.` : '',
    info.row.note,
  ].filter(Boolean);
  const practicalDetails = [r.origin === 'measurement' ? 'адмінські заміри' : '', date(r.updatedAt), ...info.practicalSources.map(source => `<a class="source-link" href="./${esc(source)}">Фото запису</a>`)].filter(Boolean);
  const rpmConflict = info.rpmConflict ? `<p>У вихідних записах різниця обертів №2 і №1 — ${fmt(info.rpmConflict.difference)} об/хв, більше 40. Значення залишено за джерелом; варто уточнити цей запис.</p>` : '';
  const notes = r.origin === 'measurement' && !authorized ? [] : [...(r.notes || []), ...(r.uncertain || [])];
  return `<p>Довідкові · <a class="source-link" href="./${esc(info.card.source)}">Фото</a></p>${Object.values(info.practical).some(value=>value!=null) ? `<p>Практичні${practicalDetails.length ? ' · ' + practicalDetails.join(' · ') : ''}</p>` : '<p>Практичні значення ще не визначено.</p>'}
    ${notes.map(note => `<p>${esc(note.replace(/максимальна швидкість/gi, 'робоча швидкість'))}</p>`).join('')}
    ${r.origin === 'measurement' && original ? `<details><summary>Початковий рукописний запис</summary>${numbersList(original)}${[...original.notes, ...original.uncertain].map(note => `<p>${esc(note)}</p>`).join('')}</details>` : ''}
    ${rpmConflict}${forecastContent(info.forecast)}${annotations.length ? `<details><summary>Приписки на фото</summary>${annotations.map(([photo,brand,,label,value,note]) => `<p><b>${esc(brand)} · ${esc(label)}: ${display(value)}</b><br>${esc(note)} · <a class="source-link" href="./${esc(photo)}">Фото</a></p>`).join('')}</details>` : ''}<details><summary>Примітки до довідкових карт</summary>${rowNotes.map(note => `<p>${esc(note)}</p>`).join('')}${references.map(card => `<p><b>${esc(info.option.label)}</b> · <a class="source-link" href="./${esc(card.source)}">Фото</a></p>${card.notes.map(note => `<p>${esc(note)}</p>`).join('')}`).join('')}</details>`;
}
function forecastContent(forecast) {
  const methods = forecast.fieldMethods || {};
  if (!forecast.method && !Object.keys(methods).length) return forecast.reason ? `<p>${esc(forecast.reason)}</p>` : '';
  const sections = [...new Set((forecast.anchors || []).map(anchor => number(anchor.section)).filter(section => section !== null))].sort((a, b) => a - b);
  const borrowed = (forecast.borrowedFrom || []).map(row => typeof row === 'string' ? optionFor(row)?.label || row : row.label || row.brand || optionFor(row.optionId)?.label).filter(Boolean);
  const confidenceLabels = { high: 'висока', medium: 'середня', low: 'низька' };
  const methodLabel = method => ({
    interpolation: 'Між практичними замірами',
    'measured-value': 'За заміром цього перерізу',
    'geometry-calibrated': 'Розміри уточнено за власними замірами',
    'related-geometry': 'Розміри за схожими кабелями',
    'nominal-geometry': 'За конструкцією жили',
    'matrix-measured-allowance': 'Матриця та поправка власних замірів',
    'matrix-related-allowance': 'Матриця та поправка схожих кабелів',
    'matrix-default-allowance': 'Матриця та поправка за перерізом жили',
    'load-extrapolation': 'Навантаження та швидкості схожих кабелів',
    'related-load': 'Швидкості схожих кабелів',
    'annular-flow': 'Площа ізоляції та швидкість лінії',
    'empirical-extrapolation': 'Продовження власної практичної кривої',
    'related-empirical': 'Практичні оберти схожих кабелів',
    'measured-lead': 'Практичне випередження зміни барвника',
    'default-lead': 'Стандартна поправка',
  })[method?.replace('-at-selected-speed', '')] ?? 'За практичними замірами й конструкцією жили';
  const details = Object.entries(methods).map(([key, value]) => {
    const field = FIELDS.find(([field]) => field === (key === 'workingSpeed' ? 'maxSpeed' : key));
    if (!field) return '';
    const method = typeof value === 'string' ? value : value?.method;
    const confidence = typeof value === 'object' ? value?.confidence : forecast.fieldConfidence?.[key] ?? (typeof forecast.confidence === 'object' ? forecast.confidence?.[key] : null);
    return `<div><dt>${esc(field[1])}</dt><dd>${esc(methodLabel(method))}${confidenceLabels[confidence] ? ` · впевненість ${confidenceLabels[confidence]}` : ''}</dd></div>`;
  }).filter(Boolean);
  return `<p>Прогноз спирається на практичні заміри та конструкцію жили. Кожен новий збережений замір уточнює розрахунок.</p>${sections.length ? `<p>Використані перерізи: ${sections.map(section => fmt(section)).join(', ')} мм².</p>` : ''}${borrowed.length ? `<p>Записи споріднених проводів: ${esc([...new Set(borrowed)].join(', '))}.</p>` : ''}${confidenceLabels[forecast.confidence] ? `<p>Впевненість у прогнозі: ${confidenceLabels[forecast.confidence]}.</p>` : ''}${details.length ? `<details><summary>Як отримано прогноз</summary><dl class="forecast-methods">${details.join('')}</dl></details>` : ''}`;
}
async function syncCatalog(notify = false) {
  if (syncing) return catalogRequest.then(() => true, () => false);
  syncing = true;
  try {
    catalogRequest = loadCatalog(); catalog = await catalogRequest;
    $('connection').textContent = 'Спільна таблиця · оновлено ' + new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    $('table-status').textContent = 'Збережені адмінські заміри відображаються тут як практичні значення.';
    if (notify) toast('Таблицю оновлено');
    return true;
  } catch {
    const snapshotDate = /^\d{4}-\d{2}-\d{2}$/.test(catalog.calibrationSnapshot?.retrievedOn ?? '')
      ? new Date(catalog.calibrationSnapshot.retrievedOn + 'T12:00:00').toLocaleDateString('uk-UA') : null;
    $('connection').textContent = catalog.source === 'snapshot' ? snapshotDate ? `Без зв’язку · заміри станом на ${snapshotDate}` : 'Без зв’язку · показано початкові записи' : 'Без зв’язку · показано останню збережену таблицю';
    $('table-status').textContent = $('connection').textContent;
    if (notify) toast('Немає зв’язку. Показано збережені значення.');
    return false;
  } finally {
    syncing = false; renderSetup(); if (view === 'table') renderTable(); if (view === 'plan') renderPlan();
  }
}

function renderTable() {
  const filter = $('table-filter').value;
  const rows = tableSetups(catalog, filter);
  $('table-count').textContent = `Перерізів: ${new Set(rows.map(info => `${info.option.id}:${info.row.section}`)).size}`;
  $('table-body').innerHTML = rows.map(info => {
    const cell = key => {
      if (key === 'extruder2' && info.mode === 'single') return '<span class="table-value table-off">Вимк.</span>';
      const main = metricValues(info, key)[0], value = info.effective[key] ?? main?.value;
      if (value == null) return '—';
      const source = info.sources[key] ?? main?.source;
      return `<span class="table-value">${display(value)}</span>${VALUE_LABELS[source] ? `<small class="table-source" data-source="${source}">${esc(VALUE_LABELS[source])}</small>` : ''}`;
    };
    const stage = value => value == null ? '—' : `<span class="table-value">${fmt(value)}</span>${VALUE_LABELS[info.stages.source] ? `<small class="table-source" data-source="${info.stages.source}" title="Розраховано за робочою швидкістю">${esc(VALUE_LABELS[info.stages.source])}</small>` : ''}`;
    return `<tr class="table-effective"><th scope="row">${esc(info.option.label)}<small class="table-mode">${info.mode === 'dual' ? '№1 + №2' : info.mode === 'single' ? 'Тільки №1' : 'Режим не визначено'}</small></th><td>${fmt(info.row.section)}</td><td>${cell('extruder1')}</td><td>${cell('extruder2')}</td>${['sikoraWire','sikoraOuter','dorn','matrix'].map(key=>`<td>${cell(key)}</td>`).join('')}<td>${stage(info.stages.first)}</td><td>${stage(info.stages.second)}</td><td>${cell('workingSpeed')}</td><td><button type="button" class="back" data-record="${esc(info.option.id)}|${info.row.section}|${info.mode}|${info.color || 'blue'}">Фото ↗</button></td></tr>`;
  }).join('');
}
function numbersList(row) { return `<dl class="numbers-list">${FIELDS.map(([key, label]) => `<div><dt>${esc(label)}</dt><dd>${key === 'extruder2' && row.mode === 'single' ? 'Вимк.' : fmt(row[key])}</dd></div>`).join('')}</dl>`; }
function openRecord(id) {
  const [optionId,section,mode,selectedColor = 'blue'] = id.split('|'), info = setupFor(optionId,Number(section),catalog, selectedColor, { mode }), row = { ...info.stored, mode: info.mode, optionId, color: selectedColor };
  const recipeId = recipeIdFor(info.base.id, 'all', optionId, mode);
  $('record-content').innerHTML = `<p><b>${esc(info.option.label)} ${fmt(row.section)} мм²</b> · ${mode === 'dual' ? '№1 + №2' : mode === 'single' ? '№1' : 'Режим не визначено'}</p>${sourceContent(row)}${authorized ? `<div class="actions"><button class="primary" type="button" data-edit="${esc(info.base.id)}" data-option="${esc(info.option.id)}" data-mode="${mode}" data-color="${selectedColor}">Записати новий замір</button><button class="secondary" type="button" data-history="${esc(recipeId)}">Історія змін</button></div><div id="record-history"></div>` : ''}`;
  $('record-dialog').showModal();
}

function renderPlan() {
  planner.render();
  $('rules').innerHTML = RULES.map(([key, label]) => `<label>${esc(label)}<input data-rule="${key}" inputmode="numeric" value="${esc(state.rules[key])}" maxlength="8"></label>`).join('');
  const r = recipe();
  const leads = [1,2].filter(n => number(r['colorLead' + n]) != null).map(n => `№${n} — за ${fmt(r['colorLead' + n])} м`);
  if (leads.length) $('rules').insertAdjacentHTML('beforeend', `<p class="quiet">Практичні поправки ${esc(cableLabel(state.cableId))}: ${leads.join('; ')}. Застосовуються до барабанів цього режиму автоматично.</p>`);
}
function renderOutputs() { planner.renderOutputs(); }
function renderSplice() { const result = spliceTarget(state.currentTarget, state.rules.splice); $('splice-result').textContent = result === null ? 'Введи цілі метри' : fmt(result) + ' м'; }
async function copyPlan() {
  const lines = ['План барабанів · довжини кожного кольору окремо'];
  state.drums.forEach((drum, i) => {
    const result = planner.result(drum, i), info = planner.setup(drum), r = { mode: info.mode };
    const labeled = key => `${display(info.effective[key])} (${info.sources[key] === 'manual' ? 'орієнтовно · за твоєю швидкістю' : VALUE_LABELS[info.sources[key]] ?? 'ще не визначено'})`;
    lines.push(`\nБарабан ${i + 1}${drum.name ? ' №' + drum.name : ''}: ${planner.drumTitle(drum)} · ${colorName(drum.color)}, ${drum.length} м.`, `Оберти шнека №1 ${labeled('extruder1')}, №2 ${r.mode === 'single' ? 'вимк.' : labeled('extruder2')} об/хв. Сікора ${labeled('sikoraWire')} / ${labeled('sikoraOuter')}. Дорн ${labeled('dorn')}, матриця ${labeled('matrix')}. Швидкості: 1 — ${fmt(info.stages.first)}, 2 — ${fmt(info.stages.second)}, робоча — ${labeled('workingSpeed')} м/хв.`, `Стан: ${drumStatus(drum) === 'done' ? 'готово' : drumStatus(drum) === 'active' ? 'в роботі' : 'у черзі'}. ${result.target > 0 ? `На екрані: ${fmt(result.target)} м.` : 'Завдання зупинки потребує уточнення.'}`, ...result.errors, ...(result.warnings || []), ...result.events.map(e => `≈ ${fmt(e.at)} м: барвник №${e.extruder} — ${e.dye}.`));
    if (result.transition) lines.push('Стравити та перекинути вручну за потрібним кольором у 4-му рядку ванни.');
    if (result.setupChange) lines.push(planner.transitionText(drum, i));
    if (result.splice.spliceCount && !result.splice.errors.length) lines.push('На лейбл: ' + result.splice.label);
  });
  try { await navigator.clipboard.writeText(lines.join('\n')); toast('План скопійовано'); } catch { toast('Копіювання недоступне. Скористайся кнопкою «Друк».'); }
}

async function enterAdmin() {
  const prepared = prepareAdminMeasurement(), initialForm = formReady ? JSON.stringify(formValues()) : null;
  if (authorized || authenticating) return;
  authenticating = true;
  try {
    const auth = await api('/admin/auth', { method: 'POST', admin: true });
    authorized = true; $('admin-gate').hidden = true; $('admin-content').hidden = false; $('admin-who').textContent = '@' + auth.username;
    await syncCatalog();
    if (view === 'admin' && prepared === 'new' && initialForm === JSON.stringify(formValues())) newMeasurement();
    $('import-old').hidden = !Object.keys(state.overrides).length;
  } catch (error) { $('admin-message').textContent = error.message; }
  finally { authenticating = false; }
}
function selectedBase() { return baseFor($('measure-cable').value, Number($('measure-section').value)); }
function exactRevision(baseId, color, optionId, mode) {
  const id = recipeIdFor(baseId, color, optionId, mode);
  return catalog.recipes.find(row => row.id === id)?.revision ?? catalog.recipeRevisions?.[id] ?? 0;
}
const draftKey = row => `${row.optionId || optionFor(row.cableId)?.id}|${row.section ?? RECIPES.find(base => base.id === row.baseId)?.section}|${row.mode || 'unknown'}`;
function draftFor(optionId, section, mode) {
  const drafts = read(DRAFTS) || {}, context = draftKey({ optionId, section, mode });
  return [read(DRAFT), drafts[context], ...Object.values(drafts).reverse(), ...Object.values(read(LEGACY_DRAFTS) || {}).reverse()].find(row => row
    && (row.optionId || optionFor(row.cableId)?.id) === optionId
    && baseFor(optionId, section)?.id === row.baseId);
}
function prepareAdminMeasurement() {
  if (busy) return;
  const info = setup();
  if (formReady && $('measure-cable').value === state.cableId && Number($('measure-section').value) === state.section) return;
  saveDraft();
  const draft = draftFor(state.cableId, state.section, info.mode);
  if (draft && baseFor(draft.optionId || state.cableId, state.section)?.id === draft.baseId) {
    fillMeasurement(draft, draft.expectedRevision);
    if ((draft.pendingSave?.id || draft.pendingSave?.entries?.length) && draft.pendingSave?.signature) pendingSave = draft.pendingSave;
    $('save-message').textContent = 'Відновлено незавершений замір для цього проводу.';
    return 'draft';
  }
  newMeasurement(info); return 'new';
}
function newMeasurement(info = setup()) { fillMeasurement({ ...info.stored, mode: info.mode, optionId: info.option.id, color: info.color || state.color, note: '' }); }
function fillMeasurement(row, revision) {
  const base = RECIPES.find(r => r.id === row.baseId || r.id === row.id);
  if (!base) return;
  $('measurement-form').hidden = false; $('journal').hidden = true;
  const option = row.optionId ? optionFor(row.optionId) : optionFor(base.cableId);
  $('measure-cable').innerHTML = cableOptions(); $('measure-cable').value = option.id;
  $('measure-section').innerHTML = sectionOptions(option.id); $('measure-section').value = String(base.section);
  formMode = row.mode || 'unknown';
  formDraftContext = draftKey({ ...row, optionId: option.id, section: base.section });
  const fieldOrder = ['extruder1', 'extruder2', 'sikoraWire', 'sikoraOuter', 'dorn', 'matrix', 'colorLead1', 'colorLead2', 'maxSpeed'];
  $('measurement-fields').innerHTML = fieldOrder.map(key => {
    const label = FIELDS.find(([field]) => field === key)[1], lead = key.startsWith('colorLead');
    const heading = key === 'colorLead1' ? '<div class="measurement-color-heading"><h3>Зміна барвника</h3></div>' : '';
    const rpm = key.startsWith('extruder');
    const title = rpm ? `№${key.at(-1)}` : lead ? `№${key.at(-1)} — за, м` : label;
    return `${heading}<label${key === 'maxSpeed' ? ' class="measurement-speed"' : ''}>${rpm ? `<span data-rpm-label="${key}">${esc(title)}</span>` : esc(title)}<input name="${key}" inputmode="${rpm ? 'text' : lead ? 'numeric' : 'decimal'}"${rpm ? ' aria-describedby="measurement-rpm-help"' : ''} autocomplete="off" value="${row[key] == null ? key === 'extruder2' && row.mode === 'single' ? '0' : '' : esc(row[key])}" placeholder="${rpm ? key === 'extruder2' ? '0 або 53,7/72,2' : '75' : 'Не записано'}" maxlength="${rpm ? 25 : 12}"></label>`;
  }).join('');
  updateMeasurementControls();
  $('measure-note').value = row.note || '';
  if ($('measurement-note')) $('measurement-note').open = Boolean(row.note);
  expectedRevision = row.mode === formMode && revision != null ? revision : exactRevision(base.id, 'all', option.id, formMode);
  pendingSave = null; formReady = true; $('save-message').textContent = '';
  $('refresh-measurement').hidden = true;
}
function formValues() {
  const values = { baseId: selectedBase().id, optionId: $('measure-cable').value, section: Number($('measure-section').value), color: 'all', note: $('measure-note').value };
  for (const [key] of FIELDS) values[key] = $('measurement-form').elements.namedItem(key).value;
  values.mode = inferMeasurementMode(values);
  return values;
}
function saveDraft() {
  if (!formReady || !selectedBase()) return;
  const draft = { ...formValues(), publish: true, expectedRevision, pendingSave }, drafts = read(DRAFTS) || {};
  const context = draftKey(draft);
  if (formDraftContext && formDraftContext !== context) delete drafts[formDraftContext];
  formDraftContext = context;
  drafts[context] = draft; write(DRAFTS, drafts); write(DRAFT, draft);
}
function updateMeasurementControls() {
  const form = $('measurement-form');
  const mode = inferMeasurementMode({ extruder1: form.elements.namedItem('extruder1')?.value, extruder2: form.elements.namedItem('extruder2')?.value });
  if (formMode !== mode) {
    formMode = mode;
    expectedRevision = exactRevision(selectedBase().id, 'all', $('measure-cable').value, mode);
  }
  const input = form.elements.namedItem('colorLead2');
  if (input) input.disabled = mode === 'single';
}
function loadSelectedMeasurement(mode, restoreDraft = false) {
  const optionId = $('measure-cable').value;
  const section = Number($('measure-section').value);
  const info = setupFor(optionId, section, catalog, state.color, { mode: typeof mode === 'string' ? mode : undefined });
  const selectedMode = typeof mode === 'string' ? mode : info.mode;
  if (restoreDraft) {
    const draft = draftFor(optionId, section, selectedMode);
    if (draft && baseFor(optionId, section)?.id === draft.baseId) {
      fillMeasurement(draft, draft.expectedRevision);
      if ((draft.pendingSave?.id || draft.pendingSave?.entries?.length) && draft.pendingSave?.signature) pendingSave = draft.pendingSave;
      saveDraft(); return 'draft';
    }
  }
  const values = { ...info.stored, mode: selectedMode, optionId, color: 'all', note: '' };
  if (selectedMode === 'unknown') for (const key of ['extruder1', 'extruder2', 'maxSpeed', 'colorLead1', 'colorLead2']) values[key] = null;
  fillMeasurement(values); saveDraft(); return 'new';
}
async function saveMeasurement(event) {
  event.preventDefault();
  if (busy) return;
  const raw = formValues();
  let inputs;
  try { inputs = measurementRecords(raw); } catch (error) { $('save-message').textContent = error.message; return; }
  const signature = measurementSignature(inputs);
  if (measurementSignature(pendingSave?.signature) !== signature || !pendingSave?.entries?.length) pendingSave = { signature, entries: inputs.map(input => ({
    mode: input.mode, id: inputs.length === 1 && measurementSignature(pendingSave?.signature) === signature && pendingSave.id ? pendingSave.id : crypto.randomUUID(), expectedRevision: input.mode === raw.mode ? expectedRevision : exactRevision(input.baseId, input.color, input.optionId, input.mode), recorded: false, published: false,
  })) };
  pendingSave.signature = signature;
  saveDraft();
  busy = true; $('save-measurement').disabled = true; $('save-message').textContent = 'Зберігаю…';
  $('measurement-form').querySelectorAll('input, select, textarea').forEach(control => { control.disabled = true; });
  let activeEntry = null;
  try {
    for (const input of inputs) {
      const entry = pendingSave.entries.find(row => row.mode === input.mode);
      if (entry.published) continue;
      activeEntry = entry;
      // Recheck every unfinished snapshot, including retries recorded by an
      // older API that may have omitted a newly supported field. This POST is
      // idempotent; changed snapshots require explicit refresh and a new ID.
      await api('/admin/measurements', { method: 'POST', admin: true, body: { ...input, id: entry.id } });
      entry.recorded = true; saveDraft();
      const id = recipeIdFor(input.baseId, input.color, input.optionId, input.mode);
      const result = await api('/admin/recipes/' + encodeURIComponent(id), { method: 'PUT', admin: true, body: { measurementId: entry.id, expectedRevision: entry.expectedRevision } });
      catalog.recipes = [...catalog.recipes.filter(row => row.id !== result.recipe.id), result.recipe];
      catalog.recipeRevisions = { ...(catalog.recipeRevisions || {}), [result.recipe.id]: result.recipe.revision };
      entry.published = true; entry.expectedRevision = result.recipe.revision;
      if (input.mode === raw.mode) expectedRevision = result.recipe.revision;
      saveDraft(); renderSetup();
    }
    const refreshed = await syncCatalog();
    $('save-message').textContent = refreshed ? `${inputs.length > 1 ? 'Обидва режими збережено.' : 'Збережено.'} Практичні значення й прогнози оновлено для всіх користувачів.` : 'Замір збережено. Онови таблицю після відновлення зв’язку, щоб отримати перераховані прогнози.';
    $('refresh-measurement').hidden = true;
    const drafts = read(DRAFTS) || {}; delete drafts[draftKey(raw)]; write(DRAFTS, drafts);
    write(DRAFT, null); pendingSave = null; haptic('success');
  } catch (error) {
    if (error.status === 409 && activeEntry) { activeEntry.conflict = true; saveDraft(); }
    const recorded = pendingSave.entries.some(entry => entry.recorded), completed = pendingSave.entries.filter(entry => entry.published).length;
    if (recorded) await syncCatalog();
    const conflictMessage = error.message === 'Запис із цим номером уже існує.'
      ? 'Збережений раніше запис відрізняється від введених значень. Онови таблицю та збережи їх як новий замір; усі поля залишилися у формі.'
      : 'Інший замір змінив цей режим. Онови таблицю, перевір свої значення та збережи їх як новий замір.';
    $('save-message').textContent = (completed ? 'Один режим збережено. Другий ще не завершено; введені значення залишилися у формі. ' : error.status !== 409 && recorded ? 'Замір уже доповнює практичні значення. Оновлення основного запису ще не підтверджено. ' : '') + (error.status === 409 ? conflictMessage : error.message);
    $('refresh-measurement').hidden = !recorded && !activeEntry?.conflict;
    saveDraft(); haptic('error');
  } finally {
    busy = false; $('save-measurement').disabled = false;
    $('measurement-form').querySelectorAll('input, select, textarea').forEach(control => { control.disabled = false; });
    updateMeasurementControls();
  }
}
async function showJournal(more = false) {
  $('measurement-form').hidden = true; $('journal').hidden = false;
  if (!more) { journal = []; $('journal-list').textContent = 'Завантажую…'; }
  $('more-journal').disabled = true;
  try {
    const result = await api('/admin/measurements' + (more && nextJournal ? '?before=' + encodeURIComponent(nextJournal) : ''), { admin: true });
    journal.push(...result.measurements); nextJournal = result.next;
    $('journal-list').innerHTML = journal.length ? journal.map(row => `<article class="card journal-entry"><h2>${esc(cableLabel(row.optionId || row.cableId))} ${fmt(row.section)}${row.color === 'all' ? '' : ' · ' + esc(colorLabel(row.color))}</h2><p class="quiet">${esc(date(row.createdAt))} · ${row.mode === 'dual' ? '№1 + №2' : row.mode === 'single' ? '№1' : 'Режим не вказано'}</p>${row.note ? `<p>${esc(row.note)}</p>` : ''}<details><summary>Значення</summary>${numbersList(row)}</details><div class="journal-actions"><button class="back" type="button" data-reuse="${esc(row.id)}">Взяти за основу →</button><button class="back delete-measurement" type="button" data-delete-measurement="${esc(row.id)}">Видалити</button></div></article>`).join('') : '<p class="card">Поки немає замірів. Натисни «Новий замір».</p>';
    $('more-journal').hidden = !nextJournal;
  } catch (error) { if (!more) $('journal-list').textContent = error.message; else toast(error.message); }
  finally { $('more-journal').disabled = false; }
}
async function deleteMeasurement(id) {
  if (busy) return;
  busy = true; $('journal-message').textContent = 'Видаляю…';
  try {
    await api('/admin/measurements/' + encodeURIComponent(id), { method: 'DELETE', admin: true });
    deletedMeasurement = id; $('undo-delete-measurement').hidden = false;
    const refreshed = await syncCatalog(); await showJournal();
    const values = formReady ? formValues() : null;
    if (values) expectedRevision = exactRevision(values.baseId, values.color, values.optionId, values.mode);
    $('journal-message').textContent = refreshed ? 'Замір видалено. Налаштування та прогноз перераховано за рештою записів.' : 'Замір видалено на сервері. Не вдалося оновити налаштування на цьому пристрої — онови таблицю після відновлення зв’язку.';
    haptic('success');
  } catch (error) { $('journal-message').textContent = error.message; haptic('error'); }
  finally { busy = false; }
}
async function undoDeleteMeasurement() {
  if (busy || !deletedMeasurement) return;
  busy = true; $('undo-delete-measurement').disabled = true;
  try {
    await api('/admin/measurements/' + encodeURIComponent(deletedMeasurement) + '/restore', { method: 'POST', admin: true });
    deletedMeasurement = null; $('undo-delete-measurement').hidden = true; await showJournal();
    await syncCatalog();
    $('journal-message').textContent = 'Замір повернуто в журнал. Щоб знову використати його налаштування, візьми за основу й збережи.';
  } catch (error) { $('journal-message').textContent = error.message; }
  finally { busy = false; $('undo-delete-measurement').disabled = false; }
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
  if (target.id === 'edit-working-speed') openWorkingSpeed();
  if (target.dataset.edit) { const base = RECIPES.find(r => r.id === target.dataset.edit); const info = setupFor(target.dataset.option, base.section, catalog, target.dataset.color || 'blue', { mode: target.dataset.mode }); $('record-dialog').close(); showView('admin'); fillMeasurement({ ...info.stored, mode: info.mode, color: 'all', optionId: target.dataset.option, note: '' }); }
  if (target.dataset.history) void showHistory(target.dataset.history);
  if (target.dataset.reuse) { fillMeasurement(journal.find(row => row.id === target.dataset.reuse)); saveDraft(); }
  if (target.dataset.deleteMeasurement) void deleteMeasurement(target.dataset.deleteMeasurement);
  if (target.dataset.old) {
    const [id, mode, color] = target.dataset.old.split(':'); const row = RECIPES.find(r => r.id === id);
    fillMeasurement({ ...row, ...(mode !== row.mode ? { extruder1: null, extruder2: null, maxSpeed: null } : {}), ...state.overrides[target.dataset.old], baseId: id, mode, color, note: 'Уточнення, збережене на цьому пристрої' });
    $('record-dialog').close(); saveDraft();
  }
});
for (const id of ['cable', 'section', 'color']) $(id).addEventListener('change', () => {
  if (id === 'cable') { state.cableId = $('cable').value; if (!CABLES.find(c => c.id === state.cableId).sections.includes(state.section)) state.section = CABLES.find(c => c.id === state.cableId).sections[0]; }
  if (id === 'section') state.section = Number($('section').value);
  if (id === 'color') state.color = $('color').value;
  persist(); renderSelectors(); renderSetup(); haptic();
});
$('open-plan').addEventListener('click', () => showView('plan'));
$('return-to-plan').addEventListener('click', () => showView('plan'));
$('open-splice').addEventListener('click', () => { $('current-target').value = state.currentTarget; renderSplice(); $('splice-dialog').showModal(); });
$('current-target').addEventListener('input', () => { state.currentTarget = $('current-target').value; persist(); renderSplice(); });
$('rules').addEventListener('input', event => { if (!event.target.dataset.rule) return; state.rules[event.target.dataset.rule] = event.target.value; persist(); renderOutputs(); });
$('copy-plan').addEventListener('click', () => void copyPlan()); $('print-plan').addEventListener('click', () => window.print());
$('table-filter').innerHTML = '<option value="">Усі проводи</option>' + cableOptions(); $('table-filter').value = state.cableId;
$('table-filter').addEventListener('change', renderTable); $('refresh-table').addEventListener('click', () => void syncCatalog(true));
$('retry-admin').addEventListener('click', () => void enterAdmin());
$('new-measurement').addEventListener('click', () => {
  if (busy) return;
  if (formReady) {
    loadSelectedMeasurement(formValues().mode);
  } else newMeasurement();
  saveDraft();
});
$('show-journal').addEventListener('click', () => { saveDraft(); void showJournal(); }); $('more-journal').addEventListener('click', () => void showJournal(true));
$('undo-delete-measurement').addEventListener('click', () => void undoDeleteMeasurement());
$('refresh-measurement').addEventListener('click', async () => {
  if (busy) return;
  const refreshed = await syncCatalog();
  if (!refreshed) { $('save-message').textContent = 'Не вдалося оновити таблицю. Введені значення залишилися у формі.'; return; }
  const input = formValues(); expectedRevision = exactRevision(input.baseId, input.color, input.optionId, input.mode);
  const renewed = refreshPendingMeasurements(pendingSave, { revisionFor: mode => exactRevision(input.baseId, input.color, input.optionId, mode), createId: () => crypto.randomUUID() });
  saveDraft();
  $('refresh-measurement').hidden = true;
  $('save-message').textContent = renewed ? 'Таблицю оновлено. Перевір свої значення й натисни «Зберегти замір»: незавершений режим буде записано як новий замір. Уже збережений режим не дублюється.' : 'Таблицю оновлено. Введені значення залишилися у формі — перевір їх і натисни «Зберегти замір».';
});
$('import-old').addEventListener('click', importOld);
$('measure-cable').addEventListener('change', () => { $('measure-section').innerHTML = sectionOptions($('measure-cable').value); loadSelectedMeasurement(); });
$('measure-section').addEventListener('change', loadSelectedMeasurement);
$('measurement-form').addEventListener('input', event => {
  if (event.target.tagName === 'SELECT') return;
  if (['extruder1', 'extruder2'].includes(event.target.name)) updateMeasurementControls();
  saveDraft();
});
$('measurement-form').addEventListener('submit', event => void saveMeasurement(event));
$('working-speed-input').addEventListener('input', previewWorkingSpeed);
$('working-speed-form').addEventListener('submit', event => { event.preventDefault(); saveWorkingSpeed(); });
$('reset-working-speed').addEventListener('click', () => saveWorkingSpeed(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden) void syncCatalog(); });
function startTelegram() { initTelegram(); if (window.Telegram?.WebApp?.initDataUnsafe?.start_param === 'admin' && view === 'setup') showView('admin'); }
renderSelectors(); renderSetup(); renderTable(); startTelegram();
window.addEventListener('load', startTelegram, { once: true });
if (new URLSearchParams(window.location.search).get('admin') === '1') showView('admin');
else if (new URLSearchParams(window.location.search).get('plan') === '1') showView('plan');
void syncCatalog();
