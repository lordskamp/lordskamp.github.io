import { CATALOG_OPTIONS } from './catalog-options.js?v=27';
import { COLORS } from './core.js?v=29';
import { api } from './store.js?v=28';
import { photoRowsToJobs } from './photo-import.js?v=2';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const list = CATALOG_OPTIONS.filter(option => option.coreKind !== 'thread');
export function initPhotoImport({ state, planner, persist }) {
  let rows = [];
  const message = text => { $('photo-message').textContent = text; };
  $('photo-refresh').addEventListener('click', async () => {
    message('Завантажую фото…');
    try {
      const { photos } = await api('/photos', { admin: true });
      $('photo-list').innerHTML = photos.length ? photos.map(photo => `<label><input type="checkbox" data-photo-id="${esc(photo.update_id)}"> Фото · ${esc(new Date(photo.received_at).toLocaleString('uk-UA'))}</label>`).join('') : '<p>Фото ще немає. Надішли їх боту в особистий чат.</p>';
      $('photo-recognize').hidden = !photos.length; message('');
    } catch (error) { message(error.message); }
  });
  function showRows(result) {
    rows = Array.isArray(result.rows) ? result.rows : [];
    $('photo-rows').innerHTML = rows.map((row, i) => `<fieldset class="card photo-row" data-photo-row="${i}"><legend>Рядок ${i + 1}${row.uncertain ? ' · потребує уваги' : ''}</legend><label>Марка<select data-photo-field="cableId"><option value="">Обери марку</option>${list.map(option => `<option value="${esc(option.id)}" ${option.id === row.cableId ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select></label><label>Переріз, мм²<input data-photo-field="section" inputmode="decimal" value="${esc(row.section)}"></label><label>Клас жили<input data-photo-field="coreClass" inputmode="numeric" value="${esc(row.coreClass)}"></label><label>Загальна довжина, км<input data-photo-field="totalKm" value="${esc(row.totalKm)}"></label><label>Барабани, км<input data-photo-field="lengthsText" value="${esc(row.lengthsText)}" placeholder="10,200 + 5,150"></label><div>Кольори: ${COLORS.map(color => `<label><input type="checkbox" data-photo-color="${esc(color.id)}" ${Array.isArray(row.colors) && row.colors.includes(color.id) ? 'checked' : ''}>${esc(color.label)}</label>`).join('')}</div><label><input type="checkbox" data-photo-ideal ${row.idealColor === true ? 'checked' : ''}> Ідеальний колір (1 екструдер, окрім чорного і жовто-зеленого)</label><label><input type="checkbox" data-photo-marking ${row.marking === true ? 'checked' : ''}> З маркуванням (принтер, до 150 м/хв)</label><label><input type="checkbox" data-photo-reviewed> Я перевірив цей рядок</label><label><input type="checkbox" data-photo-exclude> Пропустити цей рядок</label></fieldset>`).join('');
    $('photo-apply').hidden = !rows.length; message(rows.length ? 'Звір рядки з фото, зокрема позначки виконання.' : 'Рядків не знайдено.');
  }
  async function recognize(ids) {
    if (!ids.length || ids.length > 10) { message('Обери від 1 до 10 фото.'); return; }
    $('photo-recognize').disabled = true; message('Розпізнаю фото. Це може зайняти кілька хвилин…');
    try {
      const result = await api('/photos/recognize', { method: 'POST', admin: true, body: { ids } });
      showRows(result);
    } catch (error) { message(error.message); } finally { $('photo-recognize').disabled = false; }
  }
  $('photo-recognize').addEventListener('click', () => {
    const ids = [...$('photo-list').querySelectorAll('[data-photo-id]:checked')].map(el => Number(el.dataset.photoId)).sort((a, b) => a - b);
    void recognize(ids);
  });
  async function openBatch(id) {
    $('job-builder').open = true; $('photo-import').open = true;
    message('Завантажую добірку фото…');
    const bar = $('photo-progress');
    try {
      while (true) {
        const result = await api('/photos/batch', { method: 'POST', admin: true, body: { id } });
        if (!result.state) { await recognize(result.ids); return; }
        if (result.state === 'ready') { bar.hidden = true; showRows(result); return; }
        if (result.state === 'failed') { bar.hidden = true; message('Не вдалося розпізнати фото. Надішли їх боту ще раз.'); return; }
        const total = Number(result.total) || 0, completed = Number(result.completed) || 0;
        bar.hidden = false;
        if (total > 0) { bar.max = total; bar.value = completed; message('Розпізнано фото: ' + completed + ' із ' + total + '. Бот повідомить про завершення.'); }
        else { bar.removeAttribute('value'); message('Фото отримано. Очікую початку розпізнавання; бот повідомить про завершення.'); }
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } catch (error) { bar.hidden = true; message(error.message); }
  }
  $('photo-apply').addEventListener('click', () => {
    const fields = [...$('photo-rows').querySelectorAll('[data-photo-row]')].filter(el => !el.querySelector('[data-photo-exclude]').checked);
    if (!fields.length || fields.some(el => !el.querySelector('[data-photo-reviewed]').checked)) { message('Перевір кожен потрібний рядок або познач його як пропущений.'); return; }
    const checked = fields.map(el => {
      const get = key => el.querySelector(`[data-photo-field="${key}"]`).value.trim();
      return { cableId: get('cableId'), section: get('section').replace(',', '.'), coreClass: get('coreClass'), totalKm: get('totalKm'), lengthsText: get('lengthsText'), idealColor: el.querySelector('[data-photo-ideal]').checked, marking: el.querySelector('[data-photo-marking]').checked, colors: [...el.querySelectorAll('[data-photo-color]:checked')].map(color => color.dataset.photoColor) };
    });
    const result = photoRowsToJobs(checked);
    if (result.errors.length) { message(result.errors.join(' ')); return; }
    const first = state.jobs[0];
    const pristine = state.jobs.length === 1 && !state.planJobs?.length && !state.planDirty && !state.manualOrder
      && !String(first.lengthsText ?? '').trim() && !first.coreClass && !first.urgent
      && JSON.stringify(first.colors) === JSON.stringify(['yellow-green', 'blue', 'brown']);
    const existing = pristine ? [] : state.jobs;
    if (existing.length + result.jobs.length > 500) { message('Забагато рядків у завданні.'); return; }
    state.jobs = [...existing, ...result.jobs];
    state.planDirty = true; persist(); planner.render(); $('job-builder').open = true;
    $('photo-apply').hidden = true; message(`Додано ${result.jobs.length} рядків. Складаю чергу.`);
    $('generate-plan').click();
  });
  return { openBatch };
}
