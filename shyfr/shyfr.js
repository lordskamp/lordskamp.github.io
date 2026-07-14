(() => {
  'use strict';

  const appRoot = document.getElementById('shyfrApp');
  const toast = document.getElementById('toast');
  const liveRegion = document.getElementById('screenReaderStatus');
  const configuredApiBase = String(document.querySelector('meta[name="shyfr-api-endpoint"]')?.content || '').replace(/\/$/u, '');
  const localApiOverride = new URLSearchParams(window.location.search).get('api');
  const mayUseLocalOverride = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/shyfr$/iu.test(localApiOverride || '');
  const apiBase = mayUseLocalOverride ? localApiOverride.replace(/\/$/u, '') : configuredApiBase;
  const SESSION_KEY = 'lordskamp:shyfr:session:v2';
  const KEYBOARD_ROWS = ['ЙЦУКЕНГШЩЗХЇ', 'ФІВАПРОЛДЖЄ', 'ЯЧСМИТЬБЮҐ'];
  const ICONS = { feather: 'fa-feather-pointed', spark: 'fa-wand-magic-sparkles', hash: 'fa-hashtag', at: 'fa-at', shield: 'fa-shield-halved', note: 'fa-music', calendar: 'fa-calendar-days' };

  const state = {
    sessionToken: '', bootstrap: null, view: 'home', selectedCategoryId: '', attempt: null,
    selectedCode: null, hintedCode: null, errorCode: null, busy: false, telegram: false,
    leaderboard: [], historyReady: false
  };

  class ApiError extends Error {
    constructor(message, status, body) { super(message); this.status = status; this.body = body; }
  }

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Number(totalSeconds) || 0);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function showToast(message, duration = 2800) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.hidden = true; }, duration);
  }

  function announce(message) {
    liveRegion.textContent = '';
    window.setTimeout(() => { liveRegion.textContent = message; }, 10);
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (state.sessionToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${state.sessionToken}`);
    const response = await fetch(`${apiBase}${path}`, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(body.message || body.error || 'Помилка сервера', response.status, body);
    return body;
  }

  async function establishSession() {
    const telegram = window.SiteTelegram;
    const initData = telegram?.getInitData?.() || '';
    state.telegram = Boolean(telegram?.isAvailable?.() && initData);
    if (state.telegram) {
      const login = await api('/auth/telegram', { method: 'POST', headers: { Authorization: `tma ${initData}` } });
      state.sessionToken = login.sessionToken;
      localStorage.setItem(SESSION_KEY, state.sessionToken);
      return;
    }
    state.sessionToken = localStorage.getItem(SESSION_KEY) || '';
    if (state.sessionToken) {
      try { state.bootstrap = await api('/bootstrap'); return; }
      catch (error) { if (!(error instanceof ApiError) || error.status !== 401) throw error; }
    }
    const login = await api('/auth/browser', { method: 'POST' });
    state.sessionToken = login.sessionToken;
    localStorage.setItem(SESSION_KEY, state.sessionToken);
  }

  async function reloadBootstrap() {
    state.bootstrap = await api('/bootstrap');
    state.telegram = Boolean(state.bootstrap.telegram);
  }

  function currentCategory() { return state.bootstrap?.categories?.find(category => category.id === state.selectedCategoryId) || null; }

  function inventoryHtml() {
    const inventory = state.bootstrap?.inventory || { lives: 0, hints: 0 };
    return `<div class="inventory-row" aria-label="Інвентар"><span class="inventory-chip" aria-label="Життя: ${inventory.lives}"><i class="fa-solid fa-heart" aria-hidden="true"></i>${inventory.lives}</span><span class="inventory-chip" aria-label="Підказки: ${inventory.hints}"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i>${inventory.hints}</span></div>`;
  }

  function screenHeader(title, description = '') {
    return `<div class="topline"><button class="back-button" type="button" data-action="back" aria-label="Назад"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>${inventoryHtml()}</div><div class="screen-heading"><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div>`;
  }

  function renderHome() {
    const categories = state.bootstrap.categories || [];
    return `<section class="screen screen--home" data-view="home">
      <div class="topline">${inventoryHtml()}<button class="icon-button" type="button" data-action="profile" aria-label="Відкрити профіль"><i class="fa-solid fa-user" aria-hidden="true"></i></button></div>
      <div class="hero-card"><p class="eyebrow">Коди однакові — літери теж</p><h2>Розкрий фразу за три помилки</h2><p>На перших рівнях приховано 30% літер. Закриті символи стають доступними, коли ви відкриваєте літери поруч.</p></div>
      <div class="section-row"><h3>Категорії</h3><span>${state.bootstrap.profile?.completedLevels || 0} завершено</span></div>
      <div class="category-list">${categories.map(category => {
        const status = !category.available ? '<span class="badge badge--soon">Незабаром</span>' : category.free ? '<span class="badge badge--free">Безкоштовно</span>' : category.unlocked ? '<span class="badge badge--free">Відкрито</span>' : `<span class="badge badge--paid">${category.priceStars} ⭐</span>`;
        return `<button class="category-card" style="--category-color:${escapeHtml(category.color)}" type="button" data-action="open-category" data-category-id="${escapeHtml(category.id)}"><span class="category-icon"><i class="fa-solid ${ICONS[category.icon] || 'fa-font'}" aria-hidden="true"></i></span><span class="category-copy"><strong>${escapeHtml(category.title)}</strong><small>${escapeHtml(category.description)}</small></span><span class="category-meta">${status}<span class="progress-mini" aria-label="Прогрес ${category.completed} з ${category.total}"><span style="--progress:${Math.round(category.progress * 100)}%"></span></span></span></button>`;
      }).join('')}</div>
      <nav class="bottom-nav" aria-label="Меню гри"><button class="button" type="button" data-action="store"><i class="fa-solid fa-bag-shopping" aria-hidden="true"></i>Магазин</button><button class="button" type="button" data-action="leaderboard"><i class="fa-solid fa-trophy" aria-hidden="true"></i>Лідери</button><button class="button" type="button" data-action="profile"><i class="fa-solid fa-chart-simple" aria-hidden="true"></i>Прогрес</button></nav>
    </section>`;
  }

  function renderCategory() {
    const category = currentCategory();
    if (!category) return renderHome();
    const canPlay = category.available && (category.free || category.unlocked || category.levels.some(level => level.unlocked));
    const continueLabel = category.levels.some(level => level.attemptId) ? 'Продовжити спробу' : 'Почати рівень';
    return `<section class="screen" data-view="category" style="--category-color:${escapeHtml(category.color)}">${screenHeader(category.title, category.description)}
      <div class="panel-card"><div class="section-row"><h3>Прогрес</h3><span>${category.completed} / ${category.total}</span></div><div class="category-progress"><span style="--progress:${Math.round(category.progress * 100)}%"></span></div>
      ${!category.available ? '<div class="notice">Рівнів ще немає. Купівлю вимкнено.</div>' : canPlay ? `<button class="button button--primary button--wide" type="button" data-action="start-category">${continueLabel}</button>` : `<button class="button button--primary button--wide" type="button" data-action="buy" data-product-key="category_unlock:${escapeHtml(category.id)}">Відкрити категорію · ${category.priceStars} ⭐</button>`}</div>
      ${category.levels.length ? `<div class="section-row"><h3>Рівні</h3><span>Прихованих літер стає більше</span></div><div class="level-grid">${category.levels.map(level => `<button class="level-tile ${level.completed ? 'is-complete' : ''} ${level.unlocked ? '' : 'is-locked'}" type="button" data-action="${level.unlocked ? 'start-level' : 'buy'}" ${level.unlocked ? `data-level-id="${escapeHtml(level.id)}"` : `data-product-key="level_unlock:${escapeHtml(level.id)}"`} aria-label="Рівень ${level.number}, приховано ${level.hiddenPercent}%${level.unlocked ? '' : ', заблоковано'}">${level.unlocked ? level.number : '<i class="fa-solid fa-lock" aria-hidden="true"></i>'}<small>${level.hiddenPercent}%</small></button>`).join('')}</div>` : ''}
    </section>`;
  }

  function groupTokens(tokens) {
    const groups = []; let current = [];
    for (const token of tokens || []) {
      if (token.type === 'literal' && /\s/u.test(token.value)) { if (current.length) groups.push(current); current = []; }
      else current.push(token);
    }
    if (current.length) groups.push(current);
    return groups;
  }

  function cipherHtml(attempt) {
    const revealed = attempt.revealed || {};
    return groupTokens(attempt.tokens).map(group => `<span class="cipher-word">${group.map(token => {
      if (token.type === 'literal') return `<span class="cipher-literal" aria-hidden="true">${escapeHtml(token.value)}</span>`;
      const letter = revealed[token.code] || '';
      const selected = Number(state.selectedCode) === Number(token.code);
      const classes = ['cipher-cell', selected ? 'is-selected' : '', letter ? 'is-revealed' : '', token.locked ? 'is-locked' : '', Number(state.hintedCode) === Number(token.code) ? 'is-hinted' : '', Number(state.errorCode) === Number(token.code) ? 'is-error' : ''].filter(Boolean).join(' ');
      const label = token.locked ? `Код ${token.code}, закрито до відкриття сусідньої літери` : `Код ${token.code}${letter ? `, літера ${letter}` : ', не розгадано'}`;
      return `<button class="${classes}" type="button" data-action="select-code" data-code="${token.code}" aria-label="${escapeHtml(label)}" aria-pressed="${selected}" ${token.locked ? 'disabled' : ''}><span class="cipher-cell__letter">${token.locked ? '<i class="fa-solid fa-lock" aria-hidden="true"></i>' : escapeHtml(letter)}</span><span class="cipher-cell__line"></span><span class="cipher-cell__code">${token.code}</span></button>`;
    }).join('')}</span>`).join('');
  }

  function keyboardHtml(attempt) {
    const used = new Set(Object.values(attempt.revealed || {}));
    return `<div class="keyboard" role="group" aria-label="Українська клавіатура">${KEYBOARD_ROWS.map(row => `<div class="keyboard-row">${Array.from(row).map(letter => `<button class="key ${used.has(letter) ? 'is-used' : ''}" type="button" data-action="guess" data-letter="${letter}" aria-label="Літера ${letter}${used.has(letter) ? ', уже відкрита' : ''}" ${used.has(letter) ? 'disabled' : ''}>${letter}</button>`).join('')}</div>`).join('')}</div>`;
  }

  function renderGame() {
    const attempt = state.attempt;
    if (!attempt) return renderCategory();
    if (attempt.status === 'won') return renderResult();
    if (attempt.status !== 'active') return renderFailure();
    const dots = Array.from({ length: attempt.maxErrors }, (_, index) => `<span class="mistake-dot ${index < attempt.errors ? 'is-used' : ''}" aria-label="${index < attempt.errors ? 'Помилку використано' : 'Помилка доступна'}">${index < attempt.errors ? '×' : ''}</span>`).join('');
    return `<section class="screen screen--game" data-view="game"><div class="topline"><button class="back-button" type="button" data-action="back" aria-label="Назад до категорії"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button><div class="mistake-row" aria-label="Помилки">${dots}</div>${inventoryHtml()}</div>
      <div class="game-meta"><div><strong>${escapeHtml(attempt.categoryTitle)} · рівень ${attempt.levelNumber}</strong><br><span>Приховано ${attempt.hiddenTotal} літер (${attempt.hiddenPercent}%)</span></div><span>Залишилось: ${attempt.hiddenRemaining}</span></div>
      <div class="cipher-scroll" tabindex="0" aria-label="Зашифрована фраза"><div class="cipher-board">${cipherHtml(attempt)}</div></div>${keyboardHtml(attempt)}
      <div class="game-actions"><button class="button" type="button" data-action="hint"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i>Підказка</button><button class="button button--danger" type="button" data-action="surrender"><i class="fa-solid fa-flag" aria-hidden="true"></i>Здатися</button></div></section>`;
  }

  function renderFailure() {
    const surrendered = state.attempt?.status === 'surrendered';
    const noLives = Number(state.bootstrap.inventory?.lives || 0) <= 0;
    return `<section class="screen" data-view="failure">${screenHeader(surrendered ? 'Спробу завершено' : 'Три помилки')}<div class="failure-card"><div class="failure-symbol"><i class="fa-solid ${surrendered ? 'fa-flag' : 'fa-xmark'}" aria-hidden="true"></i></div><h2>${surrendered ? 'Ви здалися' : 'Цього разу не вийшло'}</h2><p>Відповідь і джерело залишаються закритими. Нова спроба отримає інший шифр.</p><div class="action-stack"><button class="button button--primary button--wide" type="button" data-action="retry" ${noLives ? 'disabled' : ''}>Спробувати ще раз</button>${noLives ? '<button class="button button--wide" type="button" data-action="store">Поповнити життя</button>' : ''}</div></div></section>`;
  }

  function renderResult() {
    const result = state.attempt?.result;
    if (!result) return renderCategory();
    const source = result.source || {};
    return `<section class="screen" data-view="result">${screenHeader(`Рівень ${state.attempt.levelNumber} завершено`, state.attempt.categoryTitle)}<article class="result-card"><p class="eyebrow">Розгадана фраза</p><blockquote>«${escapeHtml(result.text)}»</blockquote><p class="source-line"><strong>${escapeHtml(source.label || 'Джерело')}</strong></p>${source.url ? `<button class="button" type="button" data-action="open-source" data-url="${escapeHtml(source.url)}"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>Відкрити джерело</button>` : ''}<div class="result-stats"><div class="stat"><strong>${formatTime(result.seconds)}</strong><span>час</span></div><div class="stat"><strong>${result.errors}</strong><span>помилки</span></div><div class="stat"><strong>${result.hintsUsed}</strong><span>підказки</span></div></div><div class="action-stack"><button class="button button--primary button--wide" type="button" data-action="next-level">Наступний рівень</button><div class="action-pair"><button class="button" type="button" data-action="repeat">Повторити</button><button class="button" type="button" data-action="share"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i>Поширити</button></div></div></article></section>`;
  }

  function renderStore() {
    const shop = state.bootstrap.shop;
    const categories = state.bootstrap.categories.filter(category => category.available && !category.free && !category.unlocked);
    const last = state.bootstrap.purchases?.[0];
    return `<section class="screen" data-view="store">${screenHeader('Магазин', state.telegram ? 'Цифрові товари оплачуються Telegram Stars.' : 'Покупки доступні лише у Telegram.')}<div class="shop-list">${Object.values(shop.packs || {}).map(pack => `<div class="shop-item"><div><strong>${escapeHtml(pack.title)}</strong><small>${pack.kind === 'lives_pack' ? 'Поповнює запас життів' : 'Відкриває невідому літеру'}</small></div><button class="button button--primary" type="button" data-action="buy" data-product-key="${pack.kind}:${pack.id}">${pack.stars} ⭐</button></div>`).join('')}${categories.map(category => `<div class="shop-item"><div><strong>${escapeHtml(category.title)}</strong><small>Усі рівні категорії</small></div><button class="button button--primary" type="button" data-action="buy" data-product-key="category_unlock:${escapeHtml(category.id)}">${category.priceStars} ⭐</button></div>`).join('')}</div>${!categories.length ? '<p class="notice">Порожні платні категорії не продаються.</p>' : ''}${last ? `<p class="notice">Остання покупка: ${escapeHtml(last.status)} · ${last.stars} ⭐</p>` : ''}<button class="button button--wide" type="button" data-action="payment-support"><i class="fa-solid fa-life-ring" aria-hidden="true"></i>Підтримка з оплат</button></section>`;
  }

  function renderProfile() {
    const profile = state.bootstrap.profile;
    const unlocked = state.bootstrap.categories.filter(category => category.unlocked && !category.free).length;
    const best = Number.isFinite(Number(profile.bestSeconds)) ? formatTime(profile.bestSeconds) : '—';
    return `<section class="screen" data-view="profile">${screenHeader('Прогрес', state.telegram ? 'Профіль прив’язаний до перевіреного Telegram ID.' : 'Гостьовий прогрес зберігається у Cloudflare KV.')}<div class="profile-card"><div class="profile-summary"><div class="avatar">${escapeHtml((profile.name || 'Г').replace('@','').charAt(0).toLocaleUpperCase('uk-UA'))}</div><div><h2>${escapeHtml(profile.name)}</h2><p>${state.telegram ? 'Telegram-гравець' : 'Гостьовий режим'}</p></div></div><div class="profile-grid"><div class="profile-metric"><strong>${profile.completedLevels}</strong><span>рівнів завершено</span></div><div class="profile-metric"><strong>${profile.totalCompletions}</strong><span>усіх проходжень</span></div><div class="profile-metric"><strong>${unlocked}</strong><span>категорій відкрито</span></div><div class="profile-metric"><strong>${best}</strong><span>кращий час</span></div></div></div></section>`;
  }

  function renderLeaderboard() {
    return `<section class="screen" data-view="leaderboard">${screenHeader('Лідерборд', 'Гравці, які завершили найбільше різних рівнів.')}<div class="leaderboard-card">${state.leaderboard.length ? `<div class="leaderboard-list">${state.leaderboard.map(row => `<div class="leader-row"><span class="leader-rank">#${row.rank}</span><span class="leader-name">${escapeHtml(row.name)}</span><span class="leader-score">${row.completedLevels}<small>рівнів</small></span></div>`).join('')}</div>` : '<p class="notice">Поки що немає результатів Telegram-гравців.</p>'}</div></section>`;
  }

  const views = { home: renderHome, category: renderCategory, game: renderGame, failure: renderFailure, result: renderResult, store: renderStore, profile: renderProfile, leaderboard: renderLeaderboard };
  function render() {
    if (!state.bootstrap) return;
    appRoot.innerHTML = (views[state.view] || renderHome)();
    appRoot.setAttribute('aria-busy', String(state.busy));
    appRoot.querySelectorAll('button').forEach(button => { if (state.busy && button.dataset.action !== 'back') button.disabled = true; });
    window.SiteTelegram?.setBackButtonVisible?.(state.view !== 'home');
  }

  function navigate(view, { push = true } = {}) {
    state.view = view;
    if (push && state.historyReady) history.pushState({ shyfrView: view }, '', window.location.href);
    render();
  }

  function goBack({ fromHistory = false } = {}) {
    if (['game','failure','result'].includes(state.view)) navigate('category', { push: false });
    else if (state.view !== 'home') navigate('home', { push: false });
    else if (!state.telegram) window.location.href = '../';
    if (!fromHistory && state.historyReady && history.state?.shyfrView) history.replaceState({ shyfrView: state.view }, '', window.location.href);
  }

  function unknownCodes(attempt) {
    const values = [];
    for (const token of attempt.tokens || []) if (token.type === 'letter' && !token.locked && !attempt.revealed?.[token.code] && !values.includes(token.code)) values.push(token.code);
    return values;
  }

  function codeAfter(attempt, currentCode) {
    const values = unknownCodes(attempt);
    if (!values.length) return null;
    const index = values.indexOf(Number(currentCode));
    return values[(index + 1 + values.length) % values.length];
  }

  async function withBusy(action) {
    if (state.busy) return;
    state.busy = true; render();
    try { await action(); }
    catch (error) { handleError(error); }
    finally { state.busy = false; render(); }
  }

  function handleError(error) {
    const code = error?.body?.error;
    const messages = { NO_LIVES: 'Життя закінчилися.', NO_HINTS: 'Підказки закінчилися.', TELEGRAM_REQUIRED: 'Покупки доступні лише у Telegram.', ALREADY_OWNED: 'Цей товар уже відкрито.', PURCHASE_PENDING: 'Рахунок уже створюється. Спробуйте ще раз за мить.', RATE_LIMITED: 'Забагато дій. Зачекайте кілька секунд.', SESSION_REQUIRED: 'Сесія завершилася. Перезапустіть гру.', LOCKED_CODE: 'Цей символ відкриється, коли стане відома сусідня літера.', LETTER_ALREADY_USED: 'Цю літеру вже відкрито.', INVALID_GUESS: 'Оберіть доступний символ і літеру.' };
    showToast(messages[code] || error?.message || 'Сталася помилка.');
    if (code === 'NO_LIVES' || code === 'NO_HINTS') navigate('store');
  }

  async function startAttempt({ levelId = '' } = {}) {
    const category = currentCategory();
    if (!category) return;
    await withBusy(async () => {
      const response = await api('/attempts', { method: 'POST', body: JSON.stringify({ categoryId: category.id, levelId: levelId || undefined }) });
      state.attempt = response.attempt;
      state.bootstrap.inventory = response.inventory;
      state.selectedCode = state.attempt.selectedCode || unknownCodes(state.attempt)[0] || null;
      state.hintedCode = null; state.errorCode = null;
      navigate(state.attempt.status === 'won' ? 'result' : state.attempt.status === 'active' ? 'game' : 'failure');
    });
  }

  async function submitGuess(letter) {
    if (state.view !== 'game' || !state.attempt || !state.selectedCode) return;
    const code = state.selectedCode;
    await withBusy(async () => {
      const response = await api(`/attempts/${state.attempt.id}/guess`, { method: 'POST', body: JSON.stringify({ code, letter }) });
      state.attempt = response.attempt; state.bootstrap.inventory = response.inventory;
      if (response.ok) {
        announce(`Правильно: ${letter}`); window.SiteTelegram?.haptic?.(state.attempt.status === 'won' ? 'success' : 'selection');
        state.selectedCode = codeAfter(state.attempt, code);
        if (state.attempt.status === 'won') { await reloadBootstrap(); navigate('result'); }
      } else {
        state.errorCode = code; announce(`Неправильна літера ${letter}. Помилка ${state.attempt.errors} з ${state.attempt.maxErrors}.`); window.SiteTelegram?.haptic?.('error');
        if (state.attempt.status !== 'active') { await reloadBootstrap(); navigate('failure'); }
        else window.setTimeout(() => { state.errorCode = null; render(); }, 360);
      }
    });
  }

  async function useHint() {
    if (Number(state.bootstrap.inventory?.hints || 0) <= 0) { navigate('store'); showToast('Підказки закінчилися.'); return; }
    await withBusy(async () => {
      const response = await api(`/attempts/${state.attempt.id}/hint`, { method: 'POST' });
      state.attempt = response.attempt; state.bootstrap.inventory = response.inventory; state.hintedCode = response.hint.code;
      state.selectedCode = codeAfter(state.attempt, response.hint.code);
      announce(`Підказка: код ${response.hint.code} — літера ${response.hint.letter}.`); window.SiteTelegram?.haptic?.('light');
      if (state.attempt.status === 'won') { await reloadBootstrap(); navigate('result'); }
    });
  }

  async function surrender() {
    const confirmed = await window.SiteTelegram?.showConfirm?.('Здатися? Буде списано одне життя, а відповідь залишиться закритою.');
    if (!confirmed) return;
    await withBusy(async () => {
      const response = await api(`/attempts/${state.attempt.id}/surrender`, { method: 'POST' });
      state.attempt = response.attempt; state.bootstrap.inventory = response.inventory; window.SiteTelegram?.haptic?.('warning'); navigate('failure');
    });
  }

  async function openLeaderboard() {
    await withBusy(async () => { const response = await api('/leaderboard'); state.leaderboard = response.leaderboard || []; navigate('leaderboard'); });
  }

  async function pollPurchase(id) {
    for (let index = 0; index < 8; index += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 1250));
      const response = await api(`/purchases/${id}`);
      if (response.purchase.status === 'paid') return true;
      if (['rejected','expired','refunded'].includes(response.purchase.status)) return false;
    }
    return false;
  }

  async function buy(productKey) {
    if (!state.telegram) { showToast('Відкрийте гру через Telegram, щоб купувати за Stars.'); return; }
    await withBusy(async () => {
      const invoice = await api('/invoice', { method: 'POST', body: JSON.stringify({ productKey }) });
      const status = await window.SiteTelegram?.openInvoice?.(invoice.invoiceLink);
      if (status === 'cancelled') { showToast('Оплату скасовано.'); return; }
      if (await pollPurchase(invoice.purchaseId)) { await reloadBootstrap(); showToast('Покупку підтверджено.'); window.SiteTelegram?.haptic?.('success'); }
      else showToast('Платіж ще обробляється сервером.', 4200);
    });
  }

  async function shareResult() {
    const text = `Я розгадав(-ла) «Шифр» за ${formatTime(state.attempt?.result?.seconds)}. Спробуєш?`;
    const url = 'https://lordskamp.github.io/shyfr/';
    if (window.SiteTelegram?.share?.(text, url)) return;
    if (navigator.share) { await navigator.share({ title: 'Шифр', text, url }).catch(() => {}); return; }
    await navigator.clipboard?.writeText?.(`${text} ${url}`); showToast('Результат скопійовано.');
  }

  appRoot.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button || state.busy) return;
    const action = button.dataset.action;
    if (action === 'back') goBack();
    else if (action === 'profile') navigate('profile');
    else if (action === 'store') navigate('store');
    else if (action === 'leaderboard') openLeaderboard();
    else if (action === 'open-category') { state.selectedCategoryId = button.dataset.categoryId; navigate('category'); }
    else if (action === 'start-category') startAttempt();
    else if (action === 'start-level') startAttempt({ levelId: button.dataset.levelId });
    else if (action === 'select-code') { state.selectedCode = Number(button.dataset.code); window.SiteTelegram?.haptic?.('selection'); render(); }
    else if (action === 'guess') submitGuess(button.dataset.letter);
    else if (action === 'hint') useHint();
    else if (action === 'surrender') surrender();
    else if (action === 'retry' || action === 'repeat') startAttempt({ levelId: state.attempt?.levelId });
    else if (action === 'next-level') startAttempt();
    else if (action === 'buy') buy(button.dataset.productKey);
    else if (action === 'share') shareResult();
    else if (action === 'open-source') { if (!window.SiteTelegram?.openLink?.(button.dataset.url)) window.open(button.dataset.url, '_blank', 'noopener'); }
    else if (action === 'payment-support') {
      const support = String(state.bootstrap.shop.paymentSupport || '');
      const link = support.startsWith('@') ? `https://t.me/${support.slice(1)}` : support.startsWith('https://') ? support : '';
      if (link && !window.SiteTelegram?.openLink?.(link)) window.open(link, '_blank', 'noopener');
      else if (!link) showToast(`Контакт підтримки: ${support}`);
    }
  });

  document.addEventListener('keydown', event => {
    if (state.view !== 'game' || state.busy || event.ctrlKey || event.metaKey || event.altKey) return;
    const letter = String(event.key || '').toLocaleUpperCase('uk-UA');
    if (KEYBOARD_ROWS.join('').includes(letter)) { event.preventDefault(); submitGuess(letter); return; }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); const values = unknownCodes(state.attempt); if (!values.length) return;
      const current = values.indexOf(Number(state.selectedCode)); const direction = event.key === 'ArrowRight' ? 1 : -1;
      state.selectedCode = values[(current + direction + values.length) % values.length]; render();
    }
    if (event.key === 'Escape') goBack();
  });

  window.addEventListener('popstate', () => goBack({ fromHistory: true }));

  async function init() {
    try {
      await window.SiteTelegram?.init?.(); window.SiteTelegram?.setBackHandler?.(() => goBack());
      await establishSession(); if (!state.bootstrap) await reloadBootstrap();
      state.historyReady = true; history.replaceState({ shyfrView: 'home' }, '', window.location.href); appRoot.setAttribute('aria-busy', 'false'); render();
    } catch (error) {
      appRoot.setAttribute('aria-busy', 'false');
      appRoot.innerHTML = '<section class="screen"><div class="failure-card"><div class="failure-symbol"><i class="fa-solid fa-cloud-bolt" aria-hidden="true"></i></div><h2>Сервер гри недоступний</h2><p>Cloudflare Worker і KV мають бути розгорнуті та налаштовані.</p><button class="button button--primary button--wide" type="button" data-action="reload">Спробувати знову</button></div></section>';
      appRoot.querySelector('[data-action="reload"]')?.addEventListener('click', () => window.location.reload()); handleError(error);
    }
  }

  init();
})();
