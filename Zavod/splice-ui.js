import { fmt, planSplices } from './core.js?v=25';

const STORAGE_KEY = 'zavod-splice-plan-v1';
const instances = new WeakMap();
const draft = value => ({
  length: typeof value?.length === 'string' ? value.length.slice(0, 20) : '',
  breakdowns: typeof value?.breakdowns === 'string' ? value.breakdowns.slice(0, 2000) : '',
});

/** A standalone calculation: no cable selection, queue or production settings. */
export function initSplicePlanner({ toast = () => {}, initialDraft } = {}) {
  const element = document.getElementById('splice-planner');
  if (!element) return null;
  if (instances.has(element)) return instances.get(element);

  const lengthInput = document.getElementById('splice-length');
  const breakdownsInput = document.getElementById('splice-breakdowns');
  const label = document.getElementById('splice-label');
  const screen = document.getElementById('splice-screen');
  const message = document.getElementById('splice-message');
  let raw = null, stored = null, storageWarning = false;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* The calculator also works without storage. */ }
  if (raw !== null) {
    try { stored = JSON.parse(raw); } catch { /* Ignore an unreadable draft, keeping the calculator usable. */ }
  }
  const state = draft(raw !== null ? stored : initialDraft);
  lengthInput.value = state.length;
  breakdownsInput.value = state.breakdowns;

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageWarning = false;
    } catch {
      if (!storageWarning) toast('Розрахунок працює, але зберегти його на цьому пристрої не вдалося.');
      storageWarning = true;
    }
  }

  function refresh() {
    const hasLength = state.length.trim().length > 0;
    const result = hasLength ? planSplices(state.length, state.breakdowns) : null;
    const valid = Boolean(result && !result.errors.length);
    label.innerHTML = valid ? `(${result.parts.join('+<wbr>')})` : '—';
    screen.textContent = valid ? fmt(result.target) : '—';
    message.classList.toggle('error', Boolean(result?.errors.length));
    const validLength = Number.isSafeInteger(result?.length) && result.length > 0;
    lengthInput.setAttribute('aria-invalid', String(hasLength && !validLength));
    breakdownsInput.setAttribute('aria-invalid', String(Boolean(validLength && result.errors.length)));
    if (!hasLength) {
      message.textContent = 'Вкажи потрібну довжину та позначки пробоїв.';
    } else if (!valid) {
      message.textContent = result.errors.join(' ');
    } else if (result.spliceCount) {
      const rounding = result.marks.map((mark, i) => `${fmt(mark)} → ${fmt(result.roundedMarks[i])}`).join('; ');
      message.textContent = `${rounding} м. +${fmt(result.target - result.length)} м на скрутку — тільки на екрані.`;
    } else {
      message.textContent = 'Додай пробої через кому, коли вони з’являться.';
    }
    return result;
  }

  for (const [input, field] of [[lengthInput, 'length'], [breakdownsInput, 'breakdowns']]) {
    input.addEventListener('input', () => {
      state[field] = input.value;
      persist();
      refresh();
    });
  }
  const instance = { refresh, getDraft: () => ({ ...state }) };
  instances.set(element, instance);
  if (raw === null && initialDraft) persist();
  refresh();
  return instance;
}
