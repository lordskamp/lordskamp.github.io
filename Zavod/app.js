import { CABLES, RECIPES } from './data.js';
import { COLORS, DEFAULT_RULES, number, positive, fmt, outerEstimate, colorName, dyePlan, planDrum, spliceTarget, parseBreakdowns } from './core.js';
import { initTelegram, haptic, openSource, setBackHandler } from './telegram.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const STORAGE_KEY = 'zavod-workbook-v1';
const FIELDS = [['extruder1', '№1 · Производство'], ['extruder2', '№2 · Производство'], ['dorn', 'Дорн, мм'], ['matrix', 'Матриця, мм'], ['sikoraWire', 'Сікора · дріт, мм'], ['sikoraOuter', 'Сікора · зовнішній, мм'], ['maxSpeed', 'Макс. швидкість, м/хв']];
const RULE_FIELDS = [['bath', 'Кабель у ванні, м'], ['reserve', 'Запас до перекидання, м'], ['lead2', 'Зміна барвника №2 за, м'], ['lead1', 'Зміна барвника №1 за, м'], ['splice', 'Запас для скрутки, м']];
const defaults = () => ({ version: 1, cableId: 'vvgng-p', section: 1.5, color: 'blue', mode: 'auto', rules: { ...DEFAULT_RULES }, overrides: {}, currentTarget: '15000', drums: ['blue', 'brown', 'yellow-green'].map((color, i) => ({ id: `drum-${i + 1}`, color, length: '15000', name: '', breakdowns: '' })) });

function restore() {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || saved.version !== 1) return base;
    const cable = CABLES.find(item => item.id === saved.cableId);
    if (cable) {
      base.cableId = cable.id;
      if (cable.sections.includes(saved.section)) base.section = saved.section;
      else base.section = cable.sections[0];
    }
    if (COLORS.some(item => item.id === saved.color)) base.color = saved.color;
    if (['auto', 'single', 'dual'].includes(saved.mode)) base.mode = saved.mode;
    if (saved.rules && typeof saved.rules === 'object') {
      for (const [key] of RULE_FIELDS) {
        const value = number(saved.rules[key]);
        if (value !== null && value >= 0 && Number.isInteger(value)) base.rules[key] = value;
      }
    }
    if (saved.overrides && typeof saved.overrides === 'object' && !Array.isArray(saved.overrides)) {
      for (const [key, fields] of Object.entries(saved.overrides)) {
        if (!fields || typeof fields !== 'object') continue;
        const clean = {};
        for (const [field] of FIELDS) if (positive(fields[field]) !== null) clean[field] = positive(fields[field]);
        if (Object.keys(clean).length) base.overrides[key] = clean;
      }
    }
    if (typeof saved.currentTarget === 'string') base.currentTarget = saved.currentTarget.slice(0, 20);
    if (Array.isArray(saved.drums) && saved.drums.length > 0) {
      const drums = saved.drums.slice(0, 50).filter(item => item && COLORS.some(color => color.id === item.color));
      if (drums.length) base.drums = drums.map((item, index) => ({ id: `drum-${index}`, color: item.color, length: String(item.length ?? '').slice(0, 20), name: String(item.name ?? '').slice(0, 80), breakdowns: String(item.breakdowns ?? '').slice(0, 2000) }));
    }
  } catch { /* An unavailable store or invalid save must not prevent opening the page. */ }
  return base;
}

let state = restore();
let view = 'setup';
let toastTimer;

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $('save-status').textContent = 'Збережено на цьому пристрої';
  } catch {
    $('save-status').textContent = 'Збереження недоступне — скопіюйте план перед закриттям';
  }
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

function cable() { return CABLES.find(item => item.id === state.cableId); }
function sourceRecipe() { return RECIPES.find(item => item.cableId === state.cableId && item.section === state.section); }
function currentMode() { return state.mode === 'auto' ? sourceRecipe().mode : state.mode; }
function overrideKey(color = state.color) { return `${sourceRecipe().id}:${currentMode()}:${color}`; }

function recipe(color = state.color) {
  const source = sourceRecipe();
  const selectedMode = currentMode();
  const result = { ...source, mode: selectedMode };
  if (source.mode !== 'unknown' && selectedMode !== source.mode) {
    result.extruder1 = null;
    result.extruder2 = null;
    result.maxSpeed = null;
  }
  return { ...result, ...(state.overrides[overrideKey(color)] ?? {}) };
}

function swatch(color) {
  const item = COLORS.find(entry => entry.id === color);
  return `<span class="swatch ${color === 'yellow-green' ? 'yellow-green' : ''}" style="--swatch:${item?.hex ?? '#ddd'}" aria-hidden="true"></span>`;
}

function showView(next, scroll = true) {
  view = next;
  for (const name of ['setup', 'plan', 'reference']) $('view-' + name).hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(button => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  setBackHandler(view === 'setup' ? null : () => showView('setup'));
  if (view === 'setup') renderSetup();
  if (view === 'plan') renderPlan();
  if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
  haptic();
}

function renderSelectors() {
  $('cable').innerHTML = CABLES.map(item => `<option value="${item.id}">${escape(item.label)}</option>`).join('');
  $('cable').value = state.cableId;
  $('section').innerHTML = cable().sections.map(value => `<option value="${value}">${fmt(value)} мм²</option>`).join('');
  $('section').value = String(state.section);
  $('mode').value = state.mode;
  $('mobile-color').innerHTML = colorOptions(state.color);
  $('colors').innerHTML = COLORS.map(item => `<button class="color-choice" type="button" data-color="${item.id}" aria-pressed="${state.color === item.id}">${swatch(item.id)}<span>${escape(item.label)}</span></button>`).join('');
}

function renderEditor() {
  const values = recipe();
  const overrides = state.overrides[overrideKey()] ?? {};
  $('edit-fields').innerHTML = FIELDS.map(([key, label]) => `<label>${escape(label)}<input name="${key}" inputmode="decimal" autocomplete="off" placeholder="${values[key] === null ? 'Немає даних' : fmt(values[key])}" value="${overrides[key] ?? ''}" ${key === 'extruder2' && currentMode() === 'single' ? 'disabled' : ''}></label>`).join('');
  $('edit-error').textContent = '';
}

function renderSetup() {
  const r = recipe();
  const mode = currentMode();
  const dyes = dyePlan(state.color, mode);
  const custom = state.overrides[overrideKey()] ?? {};
  const required = ['dorn', 'matrix', 'sikoraWire', 'sikoraOuter', 'extruder1', 'maxSpeed', ...(mode === 'single' ? [] : ['extruder2'])];
  const missing = required.filter(key => r[key] === null);
  const notes = [...r.notes, ...r.uncertain];
  if (mode === 'unknown') notes.unshift('Оберіть кількість екструдерів у «Режим та мої уточнення», якщо ви знаєте її для цього запису.');
  if (sourceRecipe().mode !== 'unknown' && mode !== sourceRecipe().mode) notes.unshift('Ви змінили режим. Продуктивність і швидкість вихідного режиму не переносяться; введіть свої перевірені значення в «Режим та мої уточнення».');
  if (!dyes?.valid) notes.unshift(dyes?.note ?? 'Оберіть колір.');
  const estimate = outerEstimate(r.matrix);
  const differs = r.sikoraOuter !== null && estimate !== null && Math.abs(estimate - r.sikoraOuter) > 0.001;
  const value = key => `${fmt(r[key])}${custom[key] ? '<sup title="Ваше уточнення">*</sup>' : ''}`;
  $('mode-note').textContent = mode === 'single' ? 'Працює №1. Барвник подається в нього.' : mode === 'dual' ? '№1 — основа. №2 — верхній шар.' : 'Режим у записі потребує уточнення.';
  $('selection-summary').innerHTML = `${swatch(state.color)}<span>${escape(cable().label)} · ${fmt(state.section)} мм²<br><span class="muted">${escape(colorName(state.color))}</span></span>`;
  $('setup-results').innerHTML = `
    <section class="machine-panel" aria-label="Значення для екрана лінії">
      <div class="machine-top"><div><h2>${escape(cable().label)} <span>${fmt(state.section)} мм²</span></h2><p>Введіть у поля «Производство» на екрані лінії</p></div><span class="tag">${missing.length || !dyes?.valid || r.uncertain.length ? 'Є поля для уточнення' : Object.keys(custom).length ? 'З вашими уточненнями' : 'Рукописні дані'}</span></div>
      <div class="machine-values"><div class="readout"><span class="readout-label">ЕКСТРУДЕР №1</span><div class="readout-value">${value('extruder1')}</div><div class="readout-note">${r.extruder1 === null ? 'Потрібне значення' : 'Производство'}</div></div><div class="readout"><span class="readout-label">ЕКСТРУДЕР №2</span><div class="readout-value">${mode === 'single' ? '—' : value('extruder2')}</div><div class="readout-note">${mode === 'single' ? 'Вимкнений' : r.extruder2 === null ? 'Потрібне значення' : 'Производство'}</div></div><div class="readout speed"><span class="readout-label">МАКС. ШВИДКІСТЬ</span><div class="readout-value">${value('maxSpeed')}</div><div class="readout-note">${r.maxSpeed === null ? 'Потребує уточнення' : 'м/хв · за записом'}</div></div></div>
      <div class="dye-row"><span class="dye-item"><b>1</b> ${escape(dyes?.first)}</span><span class="dye-item"><b>2</b> ${escape(dyes?.second)}</span></div>
    </section>
    <div class="result-grid"><section class="panel"><div class="card-label">НАЛАШТУВАННЯ СІКОРИ <span>◎</span></div><div class="sikora-pair"><div><div class="metric-caption">1 · Діаметр дроту</div><div class="sikora-number">${value('sikoraWire')} <small>мм</small></div></div><div><div class="metric-caption">2 · Зовнішній діаметр</div><div class="sikora-number">${value('sikoraOuter')} <small>мм</small></div></div></div><div class="estimate">Орієнтир: матриця ${fmt(r.matrix)} + 0,15 ≈ <b>${fmt(estimate)} мм</b>.<br>${differs ? 'У записі інше значення; вище показано саме його.' : 'Основні значення — з рукопису.'}</div></section>
    <section class="panel"><div class="card-label">ПОТРІБНИЙ ІНСТРУМЕНТ <span>↗</span></div><div class="tools-pair"><div class="tool"><span class="tool-label">Дорн</span><strong>${value('dorn')} <small>мм</small></strong><img src="./DORN.svg" alt="Форма дорна"></div><div class="tool"><span class="tool-label">Матриця</span><strong>${value('matrix')} <small>мм</small></strong><img src="./MATRIX.svg" alt="Форма матриці"></div></div><p class="tool-note">Розміри для ${fmt(state.section)} мм² із вибраного запису.</p></section></div>
    <div class="source-strip"><span>${Object.keys(custom).length ? '* Ваші уточнення збережені для цього кольору.' : 'Джерело: рукописна таблиця'}</span><a class="source-link" href="./${r.source}" target="_blank" rel="noopener">${escape(r.source)} ↗</a></div>
    ${notes.length ? `<details class="note-banner compact" ${missing.length || !dyes?.valid || r.uncertain.length ? 'open' : ''}><summary>Примітки до цього запису${missing.length ? ' · не всі поля заповнені' : ''}</summary><ul class="plain-list">${notes.map(note => `<li>${escape(note)}</li>`).join('')}</ul></details>` : ''}
    <div class="note-banner compact"><strong>Для зміни кольору</strong> · №2 орієнтовно за ${fmt(state.rules.lead2)} м, №1 — за ${fmt(state.rules.lead1)} м. Довжину й чергу кольорів задайте у «Плані барабанів».${r.colorLead2 ? `<br>У цьому записі є підказка «колір ${fmt(r.colorLead2)}». <button type="button" class="text-button" id="use-source-lead">Взяти ${fmt(r.colorLead2)} м для №2</button>` : ''}</div>`;
  renderEditor();
}

function renderRules() {
  $('rule-fields').innerHTML = RULE_FIELDS.map(([key, label]) => `<label>${escape(label)}<input data-rule="${key}" inputmode="numeric" value="${escape(state.rules[key])}" autocomplete="off"></label>`).join('');
}

function colorOptions(selected) {
  return COLORS.map(color => `<option value="${color.id}" ${color.id === selected ? 'selected' : ''}>${escape(color.label)}</option>`).join('');
}

function drumOutput(drum, index) {
  const result = planDrum(drum, state.drums[index + 1], currentMode(), state.rules);
  const dyes = dyePlan(drum.color, currentMode());
  const r = recipe(drum.color);
  const log = parseBreakdowns(drum.breakdowns);
  if (result.errors.length) return `<p class="error" role="alert">${result.errors.map(escape).join('<br>')}</p>`;
  return `<div class="target-line"><div><div class="metric-caption">Завдання довжини на екрані</div><strong>${fmt(result.target)} <small>м</small></strong></div><div class="formula">${escape(result.formula)}<br>${result.transition ? 'Запас для ручного перекидання' : 'Без переходу на інший колір'}</div></div>
    <ol class="timeline">${result.events.map(event => `<li><time>≈ ${fmt(event.at)} м</time><span><b>Екструдер №${event.extruder}: ${escape(event.dye)}</b><br>Змінити барвник за ≈ ${fmt(event.lead)} м до потрібної довжини.</span></li>`).join('')}${result.transition ? `<li><time>За кольором</time><span><b>Стравити та перекинути вручну</b><br>Коли ${escape(colorName(result.nextColor).toLowerCase())} з’явиться у 4-му рядку ванни. ${fmt(state.rules.bath)} м у ванні вже враховані у формулі.</span></li>` : `<li><time>${fmt(result.length)} м</time><span><b>${index === state.drums.length - 1 ? 'Останній барабан у плані' : 'Наступний барабан того ж кольору'}</b><br>Окрема поправка на зміну кольору не застосовується.</span></li>`}</ol>
    ${result.warnings.map(warning => `<p class="error">${escape(warning)}</p>`).join('')}
    <div class="drum-dyes">№1: ${escape(dyes?.first)} · «Производство» ${fmt(r.extruder1)}<br>№2: ${escape(dyes?.second)}${currentMode() === 'single' ? '' : ` · «Производство» ${fmt(r.extruder2)}`}<br>Сікора ${fmt(r.sikoraWire)} / ${fmt(r.sikoraOuter)} мм · Дорн ${fmt(r.dorn)} / матриця ${fmt(r.matrix)} мм · V ${fmt(r.maxSpeed)} м/хв</div>
    <div class="log-summary">${log.error ? `<span class="error">${escape(log.error)}</span>` : log.values.length ? `<strong>На ярлик — пробій:</strong> ${log.values.map(value => fmt(value) + ' м').join('; ')}` : 'Позначки пробою з екрана записуйте в поле ліворуч/вище та на ярлик.'}</div>`;
}

function renderDrumOutputs() {
  state.drums.forEach((drum, index) => {
    const target = document.querySelector(`[data-output="${drum.id}"]`);
    if (target) target.innerHTML = drumOutput(drum, index);
  });
}

function renderPlan() {
  $('plan-profile').textContent = `${cable().label} · ${fmt(state.section)} мм² · ${currentMode() === 'single' ? 'лише №1' : currentMode() === 'dual' ? 'екструдери №1 + №2' : 'режим потребує уточнення'}`;
  $('drum-count').textContent = state.drums.length;
  $('drums').innerHTML = state.drums.map((drum, index) => `<article class="drum-card" data-drum="${drum.id}"><div class="drum-inputs"><div class="drum-header"><strong>${String(index + 1).padStart(2, '0')} · Барабан</strong><div class="drum-controls"><button class="icon-button" type="button" data-action="up" aria-label="Перемістити барабан ${index + 1} вгору" ${index === 0 ? 'disabled' : ''}>↑</button><button class="icon-button" type="button" data-action="down" aria-label="Перемістити барабан ${index + 1} вниз" ${index === state.drums.length - 1 ? 'disabled' : ''}>↓</button><button class="icon-button" type="button" data-action="remove" aria-label="Видалити барабан ${index + 1}" ${state.drums.length === 1 ? 'disabled' : ''}>×</button></div></div><div><label for="${drum.id}-color">Колір</label><select id="${drum.id}-color" data-field="color">${colorOptions(drum.color)}</select></div><div><label for="${drum.id}-length">Потрібна довжина, м</label><input id="${drum.id}-length" data-field="length" inputmode="numeric" value="${escape(drum.length)}" autocomplete="off"></div><div><label for="${drum.id}-name">Номер барабана</label><input id="${drum.id}-name" data-field="name" maxlength="80" value="${escape(drum.name)}" placeholder="Наприклад, 124" autocomplete="off"></div><div class="breakdown-field"><label for="${drum.id}-breakdowns">Пробій на метрі · через ;</label><input id="${drum.id}-breakdowns" data-field="breakdowns" maxlength="2000" value="${escape(drum.breakdowns)}" placeholder="3682; 9240" autocomplete="off"></div></div><div class="drum-output" data-output="${drum.id}">${drumOutput(drum, index)}</div></article>`).join('');
  renderRules();
  $('current-target').value = state.currentTarget;
  renderSplice();
}

function renderSplice() {
  const result = spliceTarget(state.currentTarget, state.rules.splice);
  $('splice-result').textContent = result === null ? 'Вкажіть цілі метри' : `${fmt(result)} м`;
  const label = document.querySelector('.splice-panel .tiny-index');
  label.textContent = `+${fmt(state.rules.splice)}`;
}

function renderSources() {
  const handwritten = [['DRAW_3.JPG', 'ВВГ / ВВГнг-П'], ['DRAW_1.JPG', 'ПВ1 / H07V-U'], ['DRAW_5.JPG', 'ПВ3'], ['DRAW_4.JPG', 'YSLY / (H)05VV-F'], ['DRAW_6.JPG', 'H05VV-F · 1,5 мм²'], ['IMG_3843.JPG', 'ПВС / ШВВП'], ['DRAW_2.JPG', 'Заміна кольору · незавершений запис']];
  const printed = [['3848', 'ПВС / ШВВП'], ['3849', 'ВВГ / ВВГ-П'], ['3850', 'ПВ1 / ПВ3 / ПВ5'], ['3851', 'ВВГ3'], ['3852', 'H05V / H07V'], ['3853', 'YSLY / MYYS / Z-FLEX'], ['3854', 'H03VV-F / H05VV-F'], ['3855', 'CYKYL-U / CYKYL-F'], ['3856', 'Speaker cable'], ['3857', 'XYMM'], ['3858', 'YMS-J'], ['3859', 'CYKYL-F · часткова карта'], ['3860', 'H05VV-F · часткова карта'], ['3861', 'ПВС EUROLUMINA'], ['3862', 'YSLY 600/1000']];
  const links = list => list.map(([file, title]) => `<a href="./${file}" target="_blank" rel="noopener">${escape(title)}<span>${file} ↗</span></a>`).join('');
  $('handwritten-sources').innerHTML = links(handwritten);
  $('printed-sources').innerHTML = links(printed.map(([id, title]) => [`IMG_${id}.JPG`, title]));
}

function planText() {
  const lines = [`ОБПРЕСУВАННЯ · ${cable().label} · ${fmt(state.section)} мм²`, 'Позначки від нуля кожного барабана. Зміна барвника — орієнтовно.', ''];
  state.drums.forEach((drum, index) => {
    const p = planDrum(drum, state.drums[index + 1], currentMode(), state.rules);
    const r = recipe(drum.color);
    const dyes = dyePlan(drum.color, currentMode());
    lines.push(`${index + 1}. ${colorName(drum.color)}${drum.name ? ` · №${drum.name}` : ''} · ${fmt(drum.length)} м`);
    lines.push(`На екрані: ${p.errors.length ? p.errors.join('; ') : p.formula}`);
    lines.push(`Е1: ${fmt(r.extruder1)} (${dyes?.first}); Е2: ${currentMode() === 'single' ? 'вимкнений' : `${fmt(r.extruder2)} (${dyes?.second})`}`);
    lines.push(`Сікора: ${fmt(r.sikoraWire)} / ${fmt(r.sikoraOuter)} мм; дорн ${fmt(r.dorn)} / матриця ${fmt(r.matrix)} мм; Vмакс ${fmt(r.maxSpeed)} м/хв.`);
    p.events.forEach(event => lines.push(`≈ ${fmt(event.at)} м: барвник №${event.extruder} → ${event.dye}.`));
    if (p.transition) lines.push('Стравити. Перекинути вручну за потрібним кольором у 4-му рядку ванни.');
    (p.warnings ?? []).forEach(warning => lines.push(warning));
    if (drum.breakdowns) lines.push(`Пробій (м): ${drum.breakdowns}`);
    lines.push(`Джерело: ${r.source}${Object.keys(state.overrides[overrideKey(drum.color)] ?? {}).length ? ' + власні уточнення' : ''}`, '');
  });
  return lines.join('\n');
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('go-plan').addEventListener('click', () => showView('plan'));
$('cable').addEventListener('change', event => {
  state.cableId = event.target.value;
  if (!cable().sections.includes(state.section)) state.section = cable().sections[0];
  state.mode = 'auto';
  renderSelectors(); renderSetup(); persist();
});
$('section').addEventListener('change', event => { state.section = Number(event.target.value); state.mode = 'auto'; renderSelectors(); renderSetup(); persist(); });
$('mode').addEventListener('change', event => { state.mode = event.target.value; renderSetup(); persist(); });
$('mobile-color').addEventListener('change', event => { state.color = event.target.value; renderSelectors(); renderSetup(); persist(); haptic(); });
$('colors').addEventListener('click', event => {
  const button = event.target.closest('[data-color]');
  if (!button) return;
  state.color = button.dataset.color;
  renderSelectors(); renderSetup(); persist(); haptic();
});
$('edit-form').addEventListener('submit', event => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const custom = {};
  for (const [key, label] of FIELDS) {
    const input = values.get(key);
    if (input === null || String(input).trim() === '') continue;
    const value = positive(input);
    if (value === null) { $('edit-error').textContent = `${label}: введіть число більше нуля.`; return; }
    custom[key] = value;
  }
  state.overrides[overrideKey()] = custom;
  persist(); renderSetup(); toast('Уточнення збережені для цього кольору та режиму.');
});
$('reset-recipe').addEventListener('click', () => { delete state.overrides[overrideKey()]; persist(); renderSetup(); toast('Показано значення з рукопису.'); });
$('setup-results').addEventListener('click', event => {
  if (event.target.closest('#use-source-lead')) { state.rules.lead2 = sourceRecipe().colorLead2; persist(); renderSetup(); toast('Випередження зміни №2 оновлено.'); }
});
$('add-drum').addEventListener('click', () => {
  if (state.drums.length >= 50) { toast('У плані вже 50 барабанів.'); return; }
  state.drums.push({ id: `drum-${Date.now()}`, color: state.color, length: '15000', name: '', breakdowns: '' });
  persist(); renderPlan();
  document.querySelector('.drum-card:last-child input')?.focus();
});
$('drums').addEventListener('input', event => {
  const field = event.target.dataset.field;
  const parent = event.target.closest('[data-drum]');
  if (!field || !parent) return;
  const drum = state.drums.find(item => item.id === parent.dataset.drum);
  drum[field] = event.target.value;
  persist(); renderDrumOutputs();
});
$('drums').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const index = state.drums.findIndex(item => item.id === button.closest('[data-drum]').dataset.drum);
  const action = button.dataset.action;
  if (action === 'remove' && state.drums.length > 1) {
    const removed = state.drums.splice(index, 1)[0];
    persist(); renderPlan();
    $('toast').innerHTML = 'Барабан видалено. <button class="undo-button" type="button">Повернути</button>';
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    $('toast').querySelector('button').addEventListener('click', () => { state.drums.splice(index, 0, removed); persist(); renderPlan(); $('toast').hidden = true; }, { once: true });
    return;
  }
  const next = action === 'up' ? index - 1 : index + 1;
  if (next < 0 || next >= state.drums.length) return;
  [state.drums[index], state.drums[next]] = [state.drums[next], state.drums[index]];
  persist(); renderPlan();
});
$('rule-fields').addEventListener('input', event => {
  const key = event.target.dataset.rule;
  if (!key) return;
  state.rules[key] = event.target.value;
  const value = number(event.target.value);
  $('rule-error').textContent = value === null || value < 0 || !Number.isInteger(value) ? 'Вкажіть цілі невід’ємні метри. План не розраховується для некоректних поправок.' : '';
  persist(); renderDrumOutputs(); renderSplice();
});
$('current-target').addEventListener('input', event => { state.currentTarget = event.target.value; persist(); renderSplice(); });
$('copy-plan').addEventListener('click', async () => {
  const invalid = state.drums.some((drum, i) => planDrum(drum, state.drums[i + 1], currentMode(), state.rules).errors.length || parseBreakdowns(drum.breakdowns).error);
  if (invalid) { toast('Спочатку виправте довжини, поправки або позначки пробою.'); return; }
  try { await navigator.clipboard.writeText(planText()); toast('План скопійовано.'); }
  catch { toast('Буфер обміну недоступний. Скористайтеся кнопкою «Друк».'); }
});
$('print-plan').addEventListener('click', () => { renderPlan(); window.print(); });
document.addEventListener('click', event => {
  const link = event.target.closest('a.source-link, .source-list a, a.image-link');
  if (link && document.documentElement.dataset.telegram === 'true') { event.preventDefault(); openSource(link.href); }
});

renderSelectors(); renderSetup(); renderPlan(); renderSources();
initTelegram();
window.addEventListener('load', () => initTelegram(), { once: true });
persist();
