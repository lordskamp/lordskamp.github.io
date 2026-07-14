(() => {
  'use strict';

  const appRoot = document.getElementById('shyfrApp');
  const inventoryMount = document.getElementById('shyfrInventoryMount');
  const gameBrand = document.querySelector('.game-brand');
  const brandEyebrow = gameBrand?.querySelector('.eyebrow');
  const brandTitle = document.getElementById('shyfrTitle');
  const toast = document.getElementById('toast');
  const liveRegion = document.getElementById('screenReaderStatus');
  const configuredApiBase = String(document.querySelector('meta[name="shyfr-api-endpoint"]')?.content || '').replace(/\/$/u, '');
  const localApiOverride = new URLSearchParams(window.location.search).get('api');
  const mayUseLocalOverride = ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/shyfr$/iu.test(localApiOverride || '');
  const apiBase = mayUseLocalOverride ? localApiOverride.replace(/\/$/u, '') : configuredApiBase;
  const SESSION_KEY = 'lordskamp:shyfr:session:v2';
  const KEYBOARD_ROWS = ['ЙЦУКЕНГШЩЗХЇ', 'ФІВАПРОЛДЖЄ', 'ЯЧСМИТЬБЮҐ'];
  const ICONS = { school: 'fa-graduation-cap', feather: 'fa-feather-pointed', 'book-open': 'fa-book-open', spark: 'fa-wand-magic-sparkles', hash: 'fa-hashtag', at: 'fa-at', shield: 'fa-shield-halved', note: 'fa-music', calendar: 'fa-calendar-days' };

  const state = {
    sessionToken: '', bootstrap: null, view: 'home', selectedCategoryId: '', attempt: null,
    selectedPosition: null, hintedPosition: null, errorPosition: null, hintMode: false,
    wordCelebrationPositions: [], solveCelebration: false, busy: false, telegram: false,
    leaderboard: [], historyReady: false, returnView: 'home'
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

  function formatCountdown(resetAt) {
    const seconds = Math.max(0, Math.ceil((Date.parse(resetAt) - Date.now()) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
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
    return `<div class="inventory-row" aria-label="Ресурси"><button class="inventory-chip" type="button" data-action="resources" data-resource="lives" aria-label="Життя: ${inventory.lives}. Відкрити меню ресурсів"><i class="fa-solid fa-heart" aria-hidden="true"></i>${inventory.lives}</button><button class="inventory-chip" type="button" data-action="resources" data-resource="hints" aria-label="Підказки: ${inventory.hints}. Відкрити меню ресурсів"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i>${inventory.hints}</button></div>`;
  }

  function screenHeader(title, description = '') {
    return `<div class="topline"><button class="back-button" type="button" data-action="back" aria-label="Назад"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button></div><div class="screen-heading"><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div>`;
  }

  function renderHome() {
    const categories = (state.bootstrap.categories || []).filter(category => category.id !== 'tutorial');
    const tutorial = state.bootstrap.categories?.find(category => category.id === 'tutorial');
    return `<section class="screen screen--home" data-view="home">
      <div class="topline topline--end"><button class="icon-button" type="button" data-action="profile" aria-label="Відкрити профіль"><i class="fa-solid fa-user" aria-hidden="true"></i></button></div>
      ${tutorial ? `<button class="tutorial-card" style="--category-color:${escapeHtml(tutorial.color)};--category-accent:${escapeHtml(tutorial.accent)}" type="button" data-action="open-tutorial"><span class="tutorial-card__icon"><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i></span><span><span class="eyebrow">Навчання</span><strong>Освой усі механіки за 3 рівні</strong><small>Звичайні, замкнені та подвійно замкнені літери</small></span><span class="tutorial-card__progress">${tutorial.completed} / ${tutorial.total}<i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span></button>` : ''}
      <div class="section-row"><h3>Категорії</h3><span>${state.bootstrap.profile?.completedLevels || 0} завершено</span></div>
      <div class="category-list">${categories.map(category => {
        const status = !category.available ? '<span class="badge badge--soon">Незабаром</span>' : category.free ? '<span class="badge badge--free">Безкоштовно</span>' : category.unlocked ? '<span class="badge badge--free">Відкрито</span>' : `<span class="badge badge--paid">${category.priceStars} ⭐</span>`;
        return `<button class="category-card" style="--category-color:${escapeHtml(category.color)};--category-accent:${escapeHtml(category.accent)}" type="button" data-action="open-category" data-category-id="${escapeHtml(category.id)}"><span class="category-icon"><i class="fa-solid ${ICONS[category.icon] || 'fa-font'}" aria-hidden="true"></i></span><span class="category-copy"><strong>${escapeHtml(category.title)}</strong><small>${escapeHtml(category.description)}</small></span><span class="category-meta">${status}<span class="progress-mini" aria-label="Прогрес ${category.completed} з ${category.total}"><span style="--progress:${Math.round(category.progress * 100)}%"></span></span></span></button>`;
      }).join('')}</div>
      <nav class="bottom-nav" aria-label="Меню гри"><button class="button" type="button" data-action="store"><i class="fa-solid fa-bag-shopping" aria-hidden="true"></i>Магазин</button><button class="button" type="button" data-action="leaderboard"><i class="fa-solid fa-trophy" aria-hidden="true"></i>Лідери</button><button class="button" type="button" data-action="profile"><i class="fa-solid fa-chart-simple" aria-hidden="true"></i>Прогрес</button></nav>
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

  function letterProgress(attempt) {
    const progress = new Map();
    for (const token of attempt.tokens || []) {
      if (token.type !== 'letter') continue;
      const current = progress.get(token.code) || { total: 0, solved: 0, letter: '' };
      current.total += 1;
      if (attempt.revealed?.[token.position]) {
        current.solved += 1;
        current.letter = attempt.revealed[token.position];
      }
      progress.set(token.code, current);
    }
    return progress;
  }

  function completedWordPositions(attempt) {
    return groupTokens(attempt?.tokens).filter(group => {
      const letters = group.filter(token => token.type === 'letter');
      return letters.length && letters.every(token => attempt.revealed?.[token.position]);
    }).map(group => group.filter(token => token.type === 'letter').map(token => token.position));
  }

  function cipherHtml(attempt) {
    const revealed = attempt.revealed || {};
    const progress = letterProgress(attempt);
    return groupTokens(attempt.tokens).map(group => `<span class="cipher-word">${group.map(token => {
      if (token.type === 'literal') return `<span class="cipher-literal" aria-hidden="true">${escapeHtml(token.value)}</span>`;
      const letter = revealed[token.position] || '';
      const selected = Number(state.selectedPosition) === Number(token.position);
      const status = progress.get(token.code);
      const codeComplete = Boolean(status?.letter && status.solved === status.total);
      const celebrationIndex = state.wordCelebrationPositions.indexOf(token.position);
      const hintTarget = state.hintMode && !letter;
      const classes = ['cipher-cell', selected ? 'is-selected' : '', letter ? 'is-revealed' : '', codeComplete ? 'is-code-complete' : '', token.locked ? `is-locked is-locked--${token.lockType || 'single'}` : '', hintTarget ? 'is-hint-target' : '', Number(state.hintedPosition) === Number(token.position) ? 'is-hinted' : '', Number(state.errorPosition) === Number(token.position) ? 'is-error' : '', celebrationIndex >= 0 ? 'is-word-complete' : ''].filter(Boolean).join(' ');
      const lockLabel = token.lockType === 'double' ? 'подвійно замкнено, потрібні літери з обох боків' : 'замкнено до відкриття сусідньої літери';
      const label = token.locked ? `Код ${token.code}, ${lockLabel}` : `Код ${token.code}${letter ? `, літера ${letter}` : ', не розгадано'}`;
      const lockIcon = token.lockType === 'double' ? '<span class="lock-stack" aria-hidden="true"><i class="fa-solid fa-lock"></i><i class="fa-solid fa-lock"></i></span>' : '<i class="fa-solid fa-lock" aria-hidden="true"></i>';
      return `<button class="${classes}" style="--celebration-index:${Math.max(0, celebrationIndex)};--cell-index:${token.position}" type="button" data-action="${hintTarget ? 'choose-hint-position' : 'select-position'}" data-position="${token.position}" aria-label="${escapeHtml(state.hintMode && !letter ? `${label}. Підказати цю комірку` : label)}" aria-pressed="${selected}" ${token.locked && !state.hintMode ? 'disabled' : ''}><span class="cipher-cell__letter">${token.locked && !letter ? lockIcon : escapeHtml(letter)}</span><span class="cipher-cell__line"></span><span class="cipher-cell__code">${codeComplete ? '&nbsp;' : token.code}</span></button>`;
    }).join('')}</span>`).join('');
  }

  function keyboardHtml(attempt) {
    const byLetter = new Map([...letterProgress(attempt).values()].filter(item => item.letter).map(item => [item.letter, item]));
    return `<div class="keyboard" role="group" aria-label="Українська клавіатура">${KEYBOARD_ROWS.map(row => `<div class="keyboard-row">${Array.from(row).map(letter => {
      const progress = byLetter.get(letter);
      const complete = Boolean(progress && progress.solved === progress.total);
      const partial = Boolean(progress && !complete);
      const label = complete ? ', розгадана всюди' : partial ? ', розгадана частково' : '';
      return `<button class="key ${complete ? 'is-complete' : partial ? 'is-partial' : ''}" type="button" data-action="guess" data-letter="${letter}" aria-label="Літера ${letter}${label}" ${complete || state.hintMode ? 'disabled' : ''}>${letter}</button>`;
    }).join('')}</div>`).join('')}</div>`;
  }

  function renderGame() {
    const attempt = state.attempt;
    if (!attempt) return renderHome();
    if (attempt.status === 'won' && !state.solveCelebration) return renderResult();
    if (attempt.status !== 'active' && !(attempt.status === 'won' && state.solveCelebration)) return renderFailure();
    const dots = Array.from({ length: attempt.maxErrors }, (_, index) => `<span class="mistake-dot ${index < attempt.errors ? 'is-used' : ''}" aria-label="${index < attempt.errors ? 'Помилку використано' : 'Помилка доступна'}">${index < attempt.errors ? '×' : ''}</span>`).join('');
    const tutorial = {
      1: 'Обирай кожну комірку окремо: однаковий код більше не заповнює інші місця.',
      2: 'Один замок відкриється, коли буде розгадана літера зліва або справа.',
      3: 'Подвійний замок потребує розгаданих літер з обох боків.'
    }[attempt.tutorialStep];
    const guidance = state.hintMode ? '<strong>Оберіть комірку, яку треба підказати</strong><span>Доступні місця позначено пунктиром. Підказка спишеться після вибору.</span>' : tutorial ? `<strong>Навчання · крок ${attempt.tutorialStep} із 3</strong><span>${escapeHtml(tutorial)}</span>` : '';
    const category = currentCategory();
    const theme = `--category-color:${escapeHtml(category?.color || '#e0bbff')};--category-accent:${escapeHtml(category?.accent || '#68308d')}`;
    return `<section class="screen screen--game ${state.hintMode ? 'is-choosing-hint' : ''} ${state.solveCelebration ? 'is-solve-celebration' : ''}" data-view="game" style="${theme}"><div class="topline"><button class="back-button" type="button" data-action="back" aria-label="Назад до категорій"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button><div class="mistake-stack" aria-label="Помилки"><div class="mistake-row">${dots}</div><span>ПОМИЛКИ</span></div></div>
      ${state.solveCelebration ? '<div class="solve-message"><i class="fa-solid fa-sparkles" aria-hidden="true"></i><strong>Шифр розгадано!</strong></div>' : guidance ? `<div class="game-guidance ${state.hintMode ? 'game-guidance--hint' : ''}">${guidance}</div>` : ''}
      <div class="cipher-scroll" tabindex="0" aria-label="Зашифрована фраза"><div class="cipher-board ${state.solveCelebration ? 'is-solved' : ''}">${cipherHtml(attempt)}</div></div>${state.solveCelebration ? '' : keyboardHtml(attempt)}
      ${state.solveCelebration ? '' : `<div class="game-actions"><button class="button ${state.hintMode ? 'is-active' : ''}" type="button" data-action="hint"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i>${state.hintMode ? 'Скасувати' : 'Підказка'}</button><button class="button button--danger" type="button" data-action="surrender"><i class="fa-solid fa-flag" aria-hidden="true"></i>Здатися</button></div>`}</section>`;
  }

  function renderFailure() {
    const surrendered = state.attempt?.status === 'surrendered';
    const noLives = Number(state.bootstrap.inventory?.lives || 0) <= 0;
    return `<section class="screen" data-view="failure">${screenHeader(surrendered ? 'Спробу завершено' : 'Три помилки')}<div class="failure-card"><div class="failure-symbol"><i class="fa-solid ${surrendered ? 'fa-flag' : 'fa-xmark'}" aria-hidden="true"></i></div><h2>${surrendered ? 'Ви здалися' : 'Цього разу не вийшло'}</h2><p>Відповідь і джерело залишаються закритими. Нова спроба отримає інший шифр.</p><div class="action-stack"><button class="button button--primary button--wide" type="button" data-action="retry" ${noLives ? 'disabled' : ''}>Спробувати ще раз</button>${noLives ? '<button class="button button--wide" type="button" data-action="store">Поповнити життя</button>' : ''}</div></div></section>`;
  }

  function renderResult() {
    const result = state.attempt?.result;
    if (!result) return renderHome();
    const source = result.source || {};
    const category = currentCategory();
    const finished = Boolean(category?.completedAll);
    const isIdiomsCategory = state.attempt?.categoryId === 'ukrainian-idioms';
    return `<section class="screen" data-view="result">${screenHeader(`Рівень ${state.attempt.levelNumber} завершено`, state.attempt.categoryTitle)}<article class="result-card"><p class="eyebrow">Розгадана фраза</p><blockquote>«${escapeHtml(result.text)}»</blockquote><p class="source-line">${isIdiomsCategory ? '<span>Пояснення</span>' : ''}<strong>${escapeHtml(source.label || 'Джерело')}</strong></p>${source.url ? `<button class="button" type="button" data-action="open-source" data-url="${escapeHtml(source.url)}"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>Відкрити джерело</button>` : ''}<div class="result-stats"><div class="stat"><strong>${formatTime(result.seconds)}</strong><span>час</span></div><div class="stat"><strong>${result.errors}</strong><span>помилки</span></div><div class="stat"><strong>${result.hintsUsed}</strong><span>підказки</span></div></div><div class="action-stack"><button class="button button--primary button--wide" type="button" data-action="${finished ? 'category-complete' : 'next-level'}">${finished ? 'Категорію завершено' : 'Наступний рівень'}</button><button class="button" type="button" data-action="share"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i>Поширити</button></div></article></section>`;
  }

  function renderStore() {
    const shop = state.bootstrap.shop;
    const categories = state.bootstrap.categories.filter(category => category.available && !category.free && !category.unlocked);
    const last = state.bootstrap.purchases?.[0];
    return `<section class="screen" data-view="store">${screenHeader('Магазин', state.telegram ? 'Цифрові товари оплачуються Telegram Stars.' : 'Покупки доступні лише у Telegram.')}<div class="shop-list">${Object.values(shop.packs || {}).map(pack => `<div class="shop-item"><div><strong>${escapeHtml(pack.title)}</strong><small>${pack.kind === 'lives_pack' ? 'Заповнює життя до денного ліміту' : 'Додає підказки понад денний ліміт'}</small></div><button class="button button--primary" type="button" data-action="buy" data-product-key="${pack.kind}:${pack.id}">${pack.stars} ⭐</button></div>`).join('')}${categories.map(category => `<div class="shop-item"><div><strong>${escapeHtml(category.title)}</strong><small>Усі рівні категорії</small></div><button class="button button--primary" type="button" data-action="buy" data-product-key="category_unlock:${escapeHtml(category.id)}">${category.priceStars} ⭐</button></div>`).join('')}</div>${!categories.length ? '<p class="notice">Порожні платні категорії не продаються.</p>' : ''}${last ? `<p class="notice">Остання покупка: ${escapeHtml(last.status)} · ${last.stars} ⭐</p>` : ''}<button class="button button--wide" type="button" data-action="payment-support"><i class="fa-solid fa-life-ring" aria-hidden="true"></i>Підтримка з оплат</button></section>`;
  }

  function renderResources() {
    const inventory = state.bootstrap.inventory;
    const limits = inventory.limits || { lives: 4, hints: 3 };
    const packs = Object.values(state.bootstrap.shop?.packs || {});
    const livesPack = packs.find(pack => pack.kind === 'lives_pack');
    const hintsPack = packs.find(pack => pack.kind === 'hints_pack');
    return `<section class="screen" data-view="resources">${screenHeader('Ресурси', 'Щоденний запас поновлюється автоматично.')}<div class="reset-card"><span>До наступного поновлення</span><strong data-reset-countdown>${formatCountdown(inventory.resetAt)}</strong><small>Щодня о 00:00 за київським часом</small></div><div class="resource-list"><article class="resource-card"><div class="resource-card__heading"><span class="resource-icon resource-icon--lives"><i class="fa-solid fa-heart" aria-hidden="true"></i></span><div><strong>${inventory.lives} / ${limits.lives}</strong><span>Життя</span></div></div><p>Щодня запас повертається до ${limits.lives}. Покупка одразу заповнює його повністю.</p>${livesPack ? `<button class="button button--primary button--wide" type="button" data-action="buy" data-product-key="${livesPack.kind}:${livesPack.id}">${escapeHtml(livesPack.title)} · ${livesPack.stars} ⭐</button>` : ''}</article><article class="resource-card"><div class="resource-card__heading"><span class="resource-icon resource-icon--hints"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i></span><div><strong>${inventory.hints}</strong><span>Підказки · щодня до ${limits.hints}</span></div></div><p>Щоденне поновлення не забирає накопичені підказки, а куплені можуть перевищувати ліміт.</p>${hintsPack ? `<button class="button button--primary button--wide" type="button" data-action="buy" data-product-key="${hintsPack.kind}:${hintsPack.id}">Додати ${hintsPack.quantity} · ${hintsPack.stars} ⭐</button>` : ''}</article></div></section>`;
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

  const views = { home: renderHome, game: renderGame, failure: renderFailure, result: renderResult, store: renderStore, resources: renderResources, profile: renderProfile, leaderboard: renderLeaderboard };
  function updateBrand() {
    const showLevel = state.view === 'game' && Boolean(state.attempt);
    const category = currentCategory();
    if (brandEyebrow) brandEyebrow.hidden = showLevel;
    if (brandTitle) brandTitle.textContent = showLevel ? `Рівень ${state.attempt.levelNumber}` : 'Шифр';
    if (gameBrand) {
      gameBrand.classList.toggle('is-level', showLevel);
      if (showLevel && category?.color) gameBrand.style.setProperty('--category-color', category.color);
      else gameBrand.style.removeProperty('--category-color');
    }
  }

  function render() {
    if (!state.bootstrap) return;
    updateBrand();
    if (inventoryMount) {
      inventoryMount.innerHTML = inventoryHtml();
      inventoryMount.querySelectorAll('button').forEach(button => { button.disabled = state.busy; });
    }
    appRoot.innerHTML = (views[state.view] || renderHome)();
    appRoot.setAttribute('aria-busy', String(state.busy));
    appRoot.querySelectorAll('button').forEach(button => { if (state.busy && button.dataset.action !== 'back') button.disabled = true; });
    window.SiteTelegram?.setBackButtonVisible?.(state.view !== 'home');
  }

  function navigate(view, { push = true } = {}) {
    if (view === 'resources' && state.view !== 'resources') state.returnView = state.view;
    state.view = view;
    if (push && state.historyReady) history.pushState({ shyfrView: view }, '', window.location.href);
    render();
  }

  function goBack({ fromHistory = false } = {}) {
    if (state.view === 'resources') navigate(state.returnView || 'home', { push: false });
    else if (['game','failure','result'].includes(state.view)) navigate('home', { push: false });
    else if (state.view !== 'home') navigate('home', { push: false });
    else if (!state.telegram) window.location.href = '../';
    if (!fromHistory && state.historyReady && history.state?.shyfrView) history.replaceState({ shyfrView: state.view }, '', window.location.href);
  }

  function unknownPositions(attempt) {
    const values = [];
    for (const token of attempt.tokens || []) if (token.type === 'letter' && !token.locked && !attempt.revealed?.[token.position]) values.push(token.position);
    return values;
  }

  function positionAfter(attempt, currentPosition) {
    const values = unknownPositions(attempt);
    if (!values.length) return null;
    const index = values.indexOf(Number(currentPosition));
    return values[(index + 1 + values.length) % values.length];
  }

  function pause(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  function feedback(kind, pattern) {
    window.SiteTelegram?.haptic?.(kind);
    if (!state.telegram && navigator.vibrate) navigator.vibrate(pattern);
  }

  function newCompletedWordPositions(before, after) {
    const beforeWords = new Set(completedWordPositions(before).map(positions => positions.join(',')));
    return completedWordPositions(after).filter(positions => !beforeWords.has(positions.join(','))).flat();
  }

  async function celebrateCorrectGuess(before, after) {
    const wordPositions = newCompletedWordPositions(before, after);
    if (after.status === 'won') state.solveCelebration = true;
    if (wordPositions.length) {
      state.wordCelebrationPositions = wordPositions;
      render();
      feedback('medium', 45);
      await pause(after.status === 'won' ? 420 : 560);
      state.wordCelebrationPositions = [];
    }
    if (after.status === 'won') {
      render();
      feedback('success', [55, 45, 110]);
      await pause(880);
      state.solveCelebration = false;
      await reloadBootstrap();
      navigate('result');
    } else if (!wordPositions.length) {
      feedback('selection', 18);
    }
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
    const messages = { NO_LIVES: 'Життя закінчилися.', NO_HINTS: 'Підказки закінчилися.', TELEGRAM_REQUIRED: 'Покупки доступні лише у Telegram.', ALREADY_OWNED: 'Цей товар уже відкрито.', PURCHASE_PENDING: 'Рахунок уже створюється. Спробуйте ще раз за мить.', RATE_LIMITED: 'Забагато дій. Зачекайте кілька секунд.', SESSION_REQUIRED: 'Сесія завершилася. Перезапустіть гру.', LOCKED_CODE: 'Ця комірка ще замкнена.', INVALID_HINT_POSITION: 'Оберіть нерозгадану комірку, позначену пунктиром.', INVALID_GUESS: 'Оберіть доступну комірку й літеру.', CATEGORY_COMPLETED: 'Усі рівні цієї категорії вже завершено.' };
    showToast(messages[code] || error?.message || 'Сталася помилка.');
    if (code === 'NO_LIVES' || code === 'NO_HINTS') navigate('resources');
  }

  async function startAttempt() {
    const category = currentCategory();
    if (!category) return;
    await withBusy(async () => {
      const response = await api('/attempts', { method: 'POST', body: JSON.stringify({ categoryId: category.id }) });
      state.attempt = response.attempt;
      state.bootstrap.inventory = response.inventory;
      state.selectedPosition = state.attempt.selectedPosition ?? unknownPositions(state.attempt)[0] ?? null;
      state.hintedPosition = null; state.errorPosition = null; state.hintMode = false;
      state.wordCelebrationPositions = []; state.solveCelebration = false;
      navigate(state.attempt.status === 'won' ? 'result' : state.attempt.status === 'active' ? 'game' : 'failure');
    });
  }

  function openCategory(categoryId) {
    state.selectedCategoryId = categoryId;
    const category = currentCategory();
    if (!category?.available) { showToast('Рівні цієї категорії ще готуються.'); return; }
    if (category.completedAll && !category.attemptId) { showToast('Усі рівні цієї категорії вже завершено.'); return; }
    const canPlay = category.free || category.unlocked || category.levels.some(level => level.unlocked);
    if (!canPlay) { navigate('store'); showToast('Спочатку відкрийте категорію в магазині.'); return; }
    startAttempt();
  }

  async function submitGuess(letter) {
    if (state.view !== 'game' || !state.attempt || state.selectedPosition == null || state.hintMode) return;
    const position = state.selectedPosition;
    await withBusy(async () => {
      const before = state.attempt;
      const response = await api(`/attempts/${state.attempt.id}/guess`, { method: 'POST', body: JSON.stringify({ position, letter }) });
      state.attempt = response.attempt; state.bootstrap.inventory = response.inventory;
      if (response.ok) {
        announce(`Правильно: ${letter}`);
        state.selectedPosition = positionAfter(state.attempt, position);
        await celebrateCorrectGuess(before, state.attempt);
      } else {
        state.errorPosition = position; announce(`Неправильна літера ${letter}. Помилка ${state.attempt.errors} з ${state.attempt.maxErrors}.`); feedback('error', [55, 35, 55]);
        if (state.attempt.status !== 'active') { await reloadBootstrap(); navigate('failure'); }
        else window.setTimeout(() => { state.errorPosition = null; render(); }, 360);
      }
    });
  }

  async function useHint() {
    if (Number(state.bootstrap.inventory?.hints || 0) <= 0) { navigate('resources'); showToast('Підказки закінчилися.'); return; }
    state.hintMode = !state.hintMode;
    state.selectedPosition = null;
    render();
    if (state.hintMode) announce('Оберіть пунктирну комірку, яку треба підказати.');
  }

  async function chooseHint(position) {
    if (!state.hintMode || state.attempt?.revealed?.[position]) return;
    await withBusy(async () => {
      const before = state.attempt;
      const response = await api(`/attempts/${state.attempt.id}/hint`, { method: 'POST', body: JSON.stringify({ position }) });
      state.attempt = response.attempt; state.bootstrap.inventory = response.inventory; state.hintedPosition = response.hint.position;
      state.hintMode = false;
      state.selectedPosition = positionAfter(state.attempt, response.hint.position);
      announce(`Підказка: код ${response.hint.code} — літера ${response.hint.letter}.`); feedback('light', 24);
      await celebrateCorrectGuess(before, state.attempt);
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

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button || state.busy || (!appRoot.contains(button) && !inventoryMount?.contains(button))) return;
    const action = button.dataset.action;
    if (action === 'back') goBack();
    else if (action === 'profile') navigate('profile');
    else if (action === 'store') navigate('store');
    else if (action === 'resources') navigate('resources');
    else if (action === 'leaderboard') openLeaderboard();
    else if (action === 'open-tutorial') openCategory('tutorial');
    else if (action === 'open-category') openCategory(button.dataset.categoryId);
    else if (action === 'select-position') { state.selectedPosition = Number(button.dataset.position); feedback('selection', 12); render(); }
    else if (action === 'choose-hint-position') chooseHint(Number(button.dataset.position));
    else if (action === 'guess') submitGuess(button.dataset.letter);
    else if (action === 'hint') useHint();
    else if (action === 'surrender') surrender();
    else if (action === 'retry') startAttempt();
    else if (action === 'next-level') startAttempt();
    else if (action === 'category-complete') navigate('home');
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
    if (state.view !== 'game' || state.busy || state.hintMode || event.ctrlKey || event.metaKey || event.altKey) return;
    const letter = String(event.key || '').toLocaleUpperCase('uk-UA');
    if (KEYBOARD_ROWS.join('').includes(letter)) { event.preventDefault(); submitGuess(letter); return; }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); const values = unknownPositions(state.attempt); if (!values.length) return;
      const current = values.indexOf(Number(state.selectedPosition)); const direction = event.key === 'ArrowRight' ? 1 : -1;
      state.selectedPosition = values[(current + direction + values.length) % values.length]; render();
    }
    if (event.key === 'Escape') goBack();
  });

  window.addEventListener('popstate', () => goBack({ fromHistory: true }));

  let refreshedResetAt = '';
  window.setInterval(async () => {
    const resetAt = state.bootstrap?.inventory?.resetAt;
    document.querySelectorAll('[data-reset-countdown]').forEach(element => { element.textContent = formatCountdown(resetAt); });
    if (!resetAt || Date.parse(resetAt) > Date.now() || refreshedResetAt === resetAt || state.busy) return;
    refreshedResetAt = resetAt;
    try { await reloadBootstrap(); render(); } catch { /* Наступна дія повторить синхронізацію. */ }
  }, 1000);

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
