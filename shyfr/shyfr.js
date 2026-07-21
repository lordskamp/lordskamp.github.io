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
  const BOOTSTRAP_CACHE_KEY = 'lordskamp:shyfr:bootstrap:v1';
  const OFFLINE_ATTEMPT_KEY = 'lordskamp:shyfr:offline-attempt:v1';
  const KEYBOARD_ROWS = ['ЙЦУКЕНГШЩЗХЇ', 'ФІВАПРОЛДЖЄ', 'ЯЧСМИТЬБЮҐ'];
  const PHYSICAL_UKRAINIAN_KEYS = {
    Backquote: 'Ґ',
    KeyQ: 'Й', KeyW: 'Ц', KeyE: 'У', KeyR: 'К', KeyT: 'Е', KeyY: 'Н', KeyU: 'Г', KeyI: 'Ш', KeyO: 'Щ', KeyP: 'З', BracketLeft: 'Х', BracketRight: 'Ї',
    KeyA: 'Ф', KeyS: 'І', KeyD: 'В', KeyF: 'А', KeyG: 'П', KeyH: 'Р', KeyJ: 'О', KeyK: 'Л', KeyL: 'Д', Semicolon: 'Ж', Quote: 'Є',
    KeyZ: 'Я', KeyX: 'Ч', KeyC: 'С', KeyV: 'М', KeyB: 'И', KeyN: 'Т', KeyM: 'Ь', Comma: 'Б', Period: 'Ю'
  };
  const ICONS = { school: 'fa-graduation-cap', feather: 'fa-feather-pointed', 'book-open': 'fa-book-open', spark: 'fa-wand-magic-sparkles', hash: 'fa-hashtag', at: 'fa-at', shield: 'fa-shield-halved', note: 'fa-music', calendar: 'fa-calendar-days' };

  const state = {
    sessionToken: '', bootstrap: null, view: 'home', selectedCategoryId: '', attempt: null,
    selectedPosition: null, hintedPosition: null, errorPosition: null, hintMode: false,
    celebrationPositions: [], codeCelebrationPositions: [], solveCelebration: false, busy: false, telegram: false,
    leaderboard: [], historyReady: false, returnView: 'home',
    tutorialSelectedCell: false, tutorialGuessed: false,
    offlineActions: [], offlineStartedAt: 0, syncPending: false
  };
  let gameCorePromise;

  function storageGet(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* The game remains playable for this visit. */ }
  }

  function storageRemove(key) {
    try { window.localStorage.removeItem(key); } catch { /* Nothing to clean up. */ }
  }

  function offlineRecord() {
    const record = storageGet(OFFLINE_ATTEMPT_KEY);
    return record?.attempt?.id && record?.attempt?.offline ? record : null;
  }

  function persistOfflineAttempt() {
    if (!state.attempt?.offline) return;
    storageSet(OFFLINE_ATTEMPT_KEY, {
      attempt: state.attempt,
      actions: state.offlineActions,
      startedAt: state.offlineStartedAt,
      inventory: state.bootstrap?.inventory,
      onboarding: state.bootstrap?.onboarding,
      pending: state.syncPending
    });
  }

  function clearOfflineAttempt() {
    state.offlineActions = [];
    state.offlineStartedAt = 0;
    state.syncPending = false;
    storageRemove(OFFLINE_ATTEMPT_KEY);
  }

  function restoreOfflineAttempt(record = offlineRecord()) {
    if (!record) return false;
    state.attempt = normalizeAttempt(record.attempt);
    state.offlineActions = Array.isArray(record.actions) ? record.actions : [];
    state.offlineStartedAt = Number(record.startedAt) || Date.now();
    state.syncPending = Boolean(record.pending || state.attempt.status !== 'active');
    if (state.bootstrap && record.inventory) state.bootstrap.inventory = record.inventory;
    if (state.bootstrap && record.onboarding) state.bootstrap.onboarding = { ...state.bootstrap.onboarding, ...record.onboarding };
    return true;
  }

  function cacheBootstrap() {
    if (state.bootstrap) storageSet(BOOTSTRAP_CACHE_KEY, state.bootstrap);
  }

  function cachedBootstrap() {
    const cached = storageGet(BOOTSTRAP_CACHE_KEY);
    return cached?.categories && cached?.inventory ? cached : null;
  }

  function gameCore() {
    gameCorePromise ||= import('../api/shyfr-core.js');
    return gameCorePromise;
  }

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
    state.sessionToken = localStorage.getItem(SESSION_KEY) || '';
    if (state.sessionToken) {
      try { state.bootstrap = await api('/bootstrap'); return; }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        localStorage.removeItem(SESSION_KEY);
        state.sessionToken = '';
      }
    }
    if (state.telegram) {
      const login = await api('/auth/telegram', { method: 'POST', headers: { Authorization: `tma ${initData}` } });
      state.sessionToken = login.sessionToken;
      localStorage.setItem(SESSION_KEY, state.sessionToken);
      return;
    }
    const login = await api('/auth/browser', { method: 'POST' });
    state.sessionToken = login.sessionToken;
    localStorage.setItem(SESSION_KEY, state.sessionToken);
  }

  async function reloadBootstrap() {
    state.bootstrap = await api('/bootstrap');
    state.telegram = Boolean(state.bootstrap.telegram);
    cacheBootstrap();
  }

  function normalizeAttempt(attempt) {
    if (!attempt) return null;
    const legacyCodeModel = (attempt.tokens || []).some(token => token.type === 'letter' && !Number.isSafeInteger(token.position));
    if (!legacyCodeModel) return { ...attempt, legacyCodeModel: false };
    const codeRevealed = attempt.revealed || {};
    const tokens = (attempt.tokens || []).map((token, position) => ({
      ...token,
      position,
      ...(token.locked && !token.lockType ? { lockType: 'single' } : {})
    }));
    const revealed = Object.fromEntries(tokens
      .filter(token => token.type === 'letter' && codeRevealed[token.code])
      .map(token => [token.position, codeRevealed[token.code]]));
    const selectedPosition = tokens.find(token => token.type === 'letter' && Number(token.code) === Number(attempt.selectedCode) && !token.locked)?.position;
    return { ...attempt, tokens, revealed, selectedPosition, legacyCodeModel: true };
  }

  function localAttemptWithLocks(attempt, core) {
    if (!attempt?.offline) return attempt;
    const locked = new Set(core.lockedPositionsForAttempt(
      attempt.offline.text,
      attempt.offline.substitution,
      attempt.revealed || {},
      attempt.offline.lockRequirements || {}
    ));
    const tokens = core.encodePhrase(attempt.offline.text, attempt.offline.substitution).map(token => token.type === 'letter'
      ? {
          ...token,
          locked: !attempt.revealed?.[token.position] && locked.has(token.position),
          lockType: locked.has(token.position) ? (Number(attempt.offline.lockRequirements?.[token.position]) === 2 ? 'double' : 'single') : null
        }
      : token);
    return {
      ...attempt,
      tokens,
      hiddenRemaining: tokens.filter(token => token.type === 'letter' && !attempt.revealed?.[token.position]).length,
      selectedPosition: core.nextUnknownPosition(tokens, attempt.revealed || {}, [...locked])
    };
  }

  function offlineSeconds() {
    return Math.max(1, Math.round((Date.now() - state.offlineStartedAt) / 1000));
  }

  function localResult(attempt) {
    return {
      text: attempt.offline.text,
      source: attempt.offline.source,
      seconds: offlineSeconds(),
      errors: Number(attempt.errors || 0),
      hintsUsed: Number(attempt.hintsUsed || 0)
    };
  }

  function currentCategory() { return state.bootstrap?.categories?.find(category => category.id === state.selectedCategoryId) || null; }

  function inventoryHtml() {
    const inventory = state.bootstrap?.inventory || { lives: 0, hints: 0 };
    return `<div class="inventory-row" aria-label="Ресурси"><button class="inventory-chip" type="button" data-action="resources" data-resource="lives" aria-label="Життя: ${inventory.lives}. Відкрити меню ресурсів"><i class="fa-solid fa-heart" aria-hidden="true"></i>${inventory.lives}</button><button class="inventory-chip" type="button" data-action="resources" data-resource="hints" aria-label="Підказки: ${inventory.hints}. Відкрити меню ресурсів"><i class="fa-solid fa-lightbulb" aria-hidden="true"></i>${inventory.hints}</button></div>`;
  }

  function screenHeader(title, description = '') {
    return `<div class="topline"><button class="back-button" type="button" data-action="back" aria-label="Назад"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button></div><div class="screen-heading"><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div>`;
  }

  function avatarHtml(person, className = 'avatar') {
    const name = String(person?.name || 'Гравець');
    const initial = name.replace('@', '').charAt(0).toLocaleUpperCase('uk-UA') || 'Г';
    return person?.avatarUrl
      ? `<span class="${className}"><img src="${escapeHtml(person.avatarUrl)}" alt="Аватар ${escapeHtml(name)}" referrerpolicy="no-referrer"></span>`
      : `<span class="${className}" aria-hidden="true">${escapeHtml(initial)}</span>`;
  }

  function renderTutorialIntro() {
    return `<section class="screen onboarding-screen" data-view="tutorial-intro"><article class="onboarding-card"><span class="onboarding-icon"><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i></span><p class="eyebrow">Перший запуск</p><h2>Спочатку коротке навчання</h2><p>Три рівні покажуть, як обирати комірки, користуватися підказкою та відкривати замки. Після них відкриється меню гри.</p><button class="button button--primary button--wide" type="button" data-action="begin-tutorial">Почати навчання</button></article></section>`;
  }

  function renderNickname() {
    return `<section class="screen onboarding-screen" data-view="nickname"><form class="nickname-card" data-nickname-form><span class="onboarding-icon"><i class="fa-solid fa-user-pen" aria-hidden="true"></i></span><p class="eyebrow">Навчання завершено</p><h2>Як вас показувати у грі?</h2><p>Введіть нікнейм для профілю та лідерборда. Його можна написати українською або латинкою.</p><label for="nicknameInput">Нікнейм</label><input id="nicknameInput" name="nickname" type="text" minlength="2" maxlength="24" autocomplete="nickname" placeholder="Наприклад, Шифрувальник" required><button class="button button--primary button--wide" type="submit">Відкрити меню</button></form></section>`;
  }

  function renderHome() {
    if (!state.bootstrap.onboarding?.tutorialCompleted) return renderTutorialIntro();
    if (state.bootstrap.onboarding?.nicknameRequired) return renderNickname();
    const categories = (state.bootstrap.categories || []).filter(category => category.id !== 'tutorial');
    const tutorial = state.bootstrap.categories?.find(category => category.id === 'tutorial');
    return `<section class="screen screen--home" data-view="home">
      ${tutorial ? `<article class="tutorial-card is-complete" style="--category-color:${escapeHtml(tutorial.color)};--category-accent:${escapeHtml(tutorial.accent)}"><span class="tutorial-card__icon"><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i></span><span><span class="eyebrow">Навчання</span><strong>Усі механіки вже освоєно</strong><small>Звичайні, замкнені та подвійно замкнені літери</small></span><span class="tutorial-card__progress">${tutorial.completed} / ${tutorial.total}<i class="fa-solid fa-check" aria-hidden="true"></i></span></article>` : ''}
      <div class="section-row"><h3>Категорії</h3><span>${state.bootstrap.profile?.completedLevels || 0} завершено</span></div>
      <div class="category-list">${categories.map(category => {
        const status = !category.available ? '<span class="badge badge--soon">Незабаром</span>' : category.free ? '<span class="badge badge--free">Безкоштовно</span>' : category.unlocked ? '<span class="badge badge--free">Відкрито</span>' : `<span class="badge badge--paid">${category.priceStars} ⭐</span>`;
        return `<button class="category-card" style="--category-color:${escapeHtml(category.color)};--category-accent:${escapeHtml(category.accent)}" type="button" data-action="open-category" data-category-id="${escapeHtml(category.id)}"><span class="category-icon"><i class="fa-solid ${ICONS[category.icon] || 'fa-font'}" aria-hidden="true"></i></span><span class="category-copy"><strong>${escapeHtml(category.title)}</strong><small>${escapeHtml(category.description)}</small></span><span class="category-meta">${status}<span class="progress-mini" aria-label="Прогрес ${category.completed} з ${category.total}"><span style="--progress:${Math.round(category.progress * 100)}%"></span></span></span></button>`;
      }).join('')}</div>
      <nav class="bottom-nav" aria-label="Меню гри"><button class="button" type="button" data-action="store"><i class="fa-solid fa-bag-shopping" aria-hidden="true"></i>Магазин</button><button class="button" type="button" data-action="leaderboard"><i class="fa-solid fa-trophy" aria-hidden="true"></i>Лідери</button><button class="button" type="button" data-action="profile"><i class="fa-solid fa-chart-simple" aria-hidden="true"></i>Прогрес</button></nav>
    </section>`;
  }

  function tokenLines(tokens) {
    const lines = [[]]; let current = [];
    const finishWord = () => {
      if (current.length) lines.at(-1).push(current);
      current = [];
    };
    for (const token of tokens || []) {
      if (token.type === 'literal' && /[\r\n\u2028\u2029]/u.test(token.value)) {
        finishWord(); lines.push([]);
      } else if (token.type === 'literal' && /\s/u.test(token.value)) finishWord();
      else current.push(token);
    }
    finishWord();
    return lines;
  }

  function groupTokens(tokens) {
    return tokenLines(tokens).flat();
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

  function completedCodePositions(attempt) {
    const completeCodes = new Set([...letterProgress(attempt).entries()]
      .filter(([, progress]) => progress.letter && progress.solved === progress.total)
      .map(([code]) => code));
    return [...completeCodes].map(code => (attempt?.tokens || [])
      .filter(token => token.type === 'letter' && token.code === code)
      .map(token => token.position));
  }

  function cipherHtml(attempt) {
    const revealed = attempt.revealed || {};
    const progress = letterProgress(attempt);
    return tokenLines(attempt.tokens).map(line => `<span class="cipher-line">${line.map(group => `<span class="cipher-word">${group.map(token => {
      if (token.type === 'literal') return `<span class="cipher-literal" aria-hidden="true">${escapeHtml(token.value)}</span>`;
      const letter = revealed[token.position] || '';
      const selected = state.selectedPosition != null && Number(state.selectedPosition) === Number(token.position);
      const status = progress.get(token.code);
      const codeComplete = Boolean(status?.letter && status.solved === status.total);
      const celebrationIndex = state.celebrationPositions.indexOf(token.position);
      const codeCelebrating = state.codeCelebrationPositions.includes(token.position);
      const hintTarget = state.hintMode && !letter;
      const hinted = state.hintedPosition != null && Number(state.hintedPosition) === Number(token.position);
      const errored = state.errorPosition != null && Number(state.errorPosition) === Number(token.position);
      const classes = ['cipher-cell', selected ? 'is-selected' : '', letter ? 'is-revealed' : '', codeComplete ? 'is-code-complete' : '', codeCelebrating ? 'is-code-completing' : '', token.locked ? `is-locked is-locked--${token.lockType || 'single'}` : '', hintTarget ? 'is-hint-target' : '', hinted ? 'is-hinted' : '', errored ? 'is-error' : '', celebrationIndex >= 0 ? 'is-word-complete' : ''].filter(Boolean).join(' ');
      const lockLabel = token.lockType === 'double' ? 'подвійно замкнено, потрібні літери з обох боків' : 'замкнено до відкриття сусідньої літери';
      const label = token.locked ? `Код ${token.code}, ${lockLabel}` : `Код ${token.code}${letter ? `, літера ${letter}` : ', не розгадано'}`;
      const lockIcon = token.lockType === 'double' ? '<span class="lock-stack" aria-hidden="true"><i class="fa-solid fa-lock"></i><i class="fa-solid fa-lock"></i></span>' : '<i class="fa-solid fa-lock" aria-hidden="true"></i>';
      const unavailable = Boolean(letter) || (token.locked && !state.hintMode);
      return `<button class="${classes}" style="--celebration-index:${Math.max(0, celebrationIndex)};--cell-index:${token.position}" type="button" data-action="${hintTarget ? 'choose-hint-position' : 'select-position'}" data-position="${token.position}" aria-label="${escapeHtml(state.hintMode && !letter ? `${label}. Підказати цю комірку` : label)}" aria-pressed="${selected}" ${unavailable ? 'disabled' : ''}><span class="cipher-cell__letter">${token.locked && !letter ? lockIcon : escapeHtml(letter)}</span><span class="cipher-cell__line"></span><span class="cipher-cell__code">${codeComplete && !codeCelebrating ? '&nbsp;' : token.code}</span></button>`;
    }).join('')}</span>`).join('')}</span>`).join('');
  }

  function keyboardHtml(attempt) {
    const byLetter = new Map([...letterProgress(attempt).values()].filter(item => item.letter).map(item => [item.letter, item]));
    const awaitingTutorialCell = attempt.tutorialStep === 1 && !state.tutorialSelectedCell;
    return `<div class="keyboard" role="group" aria-label="Українська клавіатура">${KEYBOARD_ROWS.map(row => `<div class="keyboard-row">${Array.from(row).map(letter => {
      const progress = byLetter.get(letter);
      const complete = Boolean(progress && progress.solved === progress.total);
      const partial = Boolean(progress && !complete);
      const label = complete ? ', розгадана всюди' : partial ? ', розгадана частково' : '';
      return `<button class="key ${complete ? 'is-complete' : partial ? 'is-partial' : ''}" type="button" data-action="guess" data-letter="${letter}" aria-label="Літера ${letter}${label}" ${complete || state.hintMode || awaitingTutorialCell ? 'disabled' : ''}>${letter}</button>`;
    }).join('')}</div>`).join('')}</div>`;
  }

  function tutorialCoachFor(attempt) {
    if (!attempt?.tutorialStep) return null;
    if (attempt.tutorialStep === 1 && !state.tutorialSelectedCell) return {
      target: 'cell', title: 'Крок 1 · оберіть комірку',
      text: 'Натисніть будь-яку незаповнену комірку. Вона отримає кольорову рамку — саме сюди буде введена літера.'
    };
    if (attempt.tutorialStep === 1 && !state.tutorialGuessed) return {
      target: 'keyboard', title: 'Крок 2 · введіть літеру',
      text: 'Тепер натисніть літеру на клавіатурі. Навіть однакові цифрові коди потрібно заповнювати в кожній комірці окремо.'
    };
    if (attempt.tutorialStep === 1) return {
      target: 'board', title: 'Продовжуйте розгадувати',
      text: 'Правильна літера відкривається лише в обраному місці. Три помилки завершують спробу, але навчання не витрачає життя.'
    };
    const tutorialHintsUsed = Number(state.bootstrap.onboarding?.tutorialHintsUsed || 0);
    if (attempt.tutorialStep === 2 && tutorialHintsUsed === 0) return {
      target: 'hint', title: 'Спробуйте підказку',
      text: 'Натисніть «Підказка», а потім оберіть пунктирну комірку. У навчанні підказки безкоштовні, але доступно не більше трьох.'
    };
    if (attempt.tutorialStep === 2) return {
      target: 'lock', title: 'Одинарний замок',
      text: 'Замкнена комірка відкриється, щойно буде розгадана літера зліва або справа від неї.'
    };
    return {
      target: 'lock', title: 'Подвійний замок',
      text: 'Для подвійного замка потрібно правильно відкрити сусідні літери з обох боків.'
    };
  }

  function renderGame() {
    const attempt = state.attempt;
    if (!attempt) return renderHome();
    if (attempt.status === 'won' && !state.solveCelebration) return renderResult();
    if (attempt.status !== 'active' && !(attempt.status === 'won' && state.solveCelebration)) return renderFailure();
    const dots = Array.from({ length: attempt.maxErrors }, (_, index) => `<span class="mistake-dot ${index < attempt.errors ? 'is-used' : ''}" aria-label="${index < attempt.errors ? 'Помилку використано' : 'Помилка доступна'}">${index < attempt.errors ? '×' : ''}</span>`).join('');
    const coach = tutorialCoachFor(attempt);
    const guidance = state.hintMode ? '<strong>Оберіть комірку, яку треба підказати</strong><span>Доступні місця позначено пунктиром. У навчанні підказка не витратить ваш запас.</span>' : coach ? `<strong>${escapeHtml(coach.title)}</strong><span>${escapeHtml(coach.text)}</span>` : '';
    const category = currentCategory();
    const theme = `--category-color:${escapeHtml(category?.color || '#e0bbff')};--category-accent:${escapeHtml(category?.accent || '#68308d')}`;
    const coachTarget = state.hintMode ? 'hint-cell' : coach?.target || '';
    const tutorial = Boolean(attempt.tutorialStep);
    const tutorialHintsRemaining = Number(state.bootstrap.onboarding?.tutorialHintsRemaining ?? 3);
    const hintLabel = tutorial ? `Підказка · ${tutorialHintsRemaining}/3` : 'Підказка';
    return `<section class="screen screen--game ${state.hintMode ? 'is-choosing-hint' : ''} ${state.solveCelebration ? 'is-solve-celebration' : ''}" data-view="game" data-tutorial-coach="${coachTarget}" style="${theme}"><div class="topline"><button class="back-button" type="button" data-action="back" aria-label="Назад до категорій"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button><div class="mistake-stack" aria-label="Помилки"><div class="mistake-row">${dots}</div><span>ПОМИЛКИ</span></div></div>
      ${state.solveCelebration ? '<div class="solve-message"><i class="fa-solid fa-sparkles" aria-hidden="true"></i><strong>Шифр розгадано!</strong></div>' : guidance ? `<div class="game-guidance ${state.hintMode ? 'game-guidance--hint' : ''}">${guidance}</div>` : ''}
      <div class="cipher-scroll-wrap"><div class="cipher-scroll" tabindex="0" aria-label="Зашифрована фраза"><div class="cipher-board ${state.solveCelebration ? 'is-solved' : ''}">${cipherHtml(attempt)}</div></div><span class="cipher-scroll-indicator" aria-hidden="true"><span class="cipher-scroll-indicator__thumb"></span></span></div>${state.solveCelebration ? '' : keyboardHtml(attempt)}
      ${state.solveCelebration ? '' : `<div class="game-actions"><button class="button ${state.hintMode ? 'is-active' : ''}" type="button" data-action="hint" ${tutorial && tutorialHintsRemaining <= 0 ? 'disabled' : ''}><i class="fa-solid fa-lightbulb" aria-hidden="true"></i>${state.hintMode ? 'Скасувати' : hintLabel}</button><button class="button button--danger" type="button" data-action="surrender" ${tutorial ? 'disabled aria-label="Здатися недоступно у навчанні"' : ''}><i class="fa-solid fa-flag" aria-hidden="true"></i>Здатися</button></div>`}</section>`;
  }

  function renderFailure() {
    const surrendered = state.attempt?.status === 'surrendered';
    const noLives = Number(state.bootstrap.inventory?.lives || 0) <= 0;
    return `<section class="screen" data-view="failure">${screenHeader(surrendered ? 'Спробу завершено' : 'Три помилки')}<div class="failure-card"><div class="failure-symbol"><i class="fa-solid ${surrendered ? 'fa-flag' : 'fa-xmark'}" aria-hidden="true"></i></div><h2>${surrendered ? 'Ви здалися' : 'Цього разу не вийшло'}</h2><p>Відповідь і джерело залишаються закритими. Нова спроба отримає інший шифр.</p><div class="action-stack"><button class="button button--primary button--wide" type="button" data-action="retry" ${noLives ? 'disabled' : ''}>Спробувати ще раз</button>${noLives ? '<button class="button button--wide" type="button" data-action="store">Поповнити життя</button>' : ''}</div></div></section>`;
  }

  function spotifyEmbedUrl(url) {
    try {
      const parsed = new URL(url);
      const match = parsed.hostname === 'open.spotify.com'
        && parsed.pathname.match(/^\/(?:intl-[a-z]{2}\/)?(track|episode|album|playlist)\/([A-Za-z0-9]+)$/u);
      return match ? `https://open.spotify.com/embed/${match[1]}/${match[2]}?utm_source=generator` : '';
    } catch {
      return '';
    }
  }

  function sourceHtml(source, isIdiomsCategory) {
    const embedUrl = spotifyEmbedUrl(source.url);
    if (embedUrl) {
      return `<div class="spotify-widget"><span class="spotify-widget__label"><i class="fa-brands fa-spotify" aria-hidden="true"></i>Слухати в Spotify</span><iframe class="spotify-widget__player" src="${embedUrl}" title="Плеєр Spotify" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div><button class="button button--wide" type="button" data-action="open-source" data-url="${escapeHtml(source.url)}"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>Відкрити в Spotify</button>`;
    }
    return `<p class="source-line">${isIdiomsCategory ? '<span>Пояснення</span>' : ''}<strong>${escapeHtml(source.label || 'Джерело')}</strong></p>${source.url ? `<button class="button" type="button" data-action="open-source" data-url="${escapeHtml(source.url)}"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>Відкрити джерело</button>` : ''}`;
  }

  function renderResult() {
    const result = state.attempt?.result;
    if (!result) return renderHome();
    const source = result.source || {};
    const category = currentCategory();
    const finished = Boolean(category?.completedAll);
    const tutorialFinished = state.attempt?.categoryId === 'tutorial' && finished;
    const isIdiomsCategory = state.attempt?.categoryId === 'ukrainian-idioms';
    const primaryAction = tutorialFinished ? 'finish-tutorial' : finished ? 'category-complete' : 'next-level';
    const primaryLabel = tutorialFinished ? 'Перейти далі' : finished ? 'Категорію завершено' : 'Наступний рівень';
    return `<section class="screen" data-view="result">${screenHeader(`Рівень ${state.attempt.levelNumber} завершено`, state.attempt.categoryTitle)}<article class="result-card"><p class="eyebrow">Розгадана фраза</p><blockquote>«${escapeHtml(result.text)}»</blockquote>${sourceHtml(source, isIdiomsCategory)}<div class="result-stats"><div class="stat"><strong>${formatTime(result.seconds)}</strong><span>час</span></div><div class="stat"><strong>${result.errors}</strong><span>помилки</span></div><div class="stat"><strong>${result.hintsUsed}</strong><span>підказки</span></div></div><div class="action-stack"><button class="button button--primary button--wide" type="button" data-action="${primaryAction}">${primaryLabel}</button><button class="button" type="button" data-action="share"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i>Поширити</button></div></article></section>`;
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
    return `<section class="screen" data-view="profile">${screenHeader('Прогрес', state.telegram ? 'Профіль прив’язаний до перевіреного Telegram ID.' : 'Профіль сайту зберігається у Cloudflare KV.')}<div class="profile-card"><div class="profile-summary">${avatarHtml(profile)}<div><h2>${escapeHtml(profile.name)}</h2><p>${state.telegram ? 'Telegram-гравець' : 'Гравець сайту'}</p></div></div><div class="profile-grid"><div class="profile-metric"><strong>${profile.completedLevels}</strong><span>рівнів завершено</span></div><div class="profile-metric"><strong>${profile.totalCompletions}</strong><span>усіх проходжень</span></div><div class="profile-metric"><strong>${unlocked}</strong><span>категорій відкрито</span></div><div class="profile-metric"><strong>${best}</strong><span>кращий час</span></div></div></div></section>`;
  }

  function renderLeaderboard() {
    return `<section class="screen" data-view="leaderboard">${screenHeader('Лідерборд', 'Гравці, які завершили найбільше різних рівнів.')}<div class="leaderboard-card">${state.leaderboard.length ? `<div class="leaderboard-list">${state.leaderboard.map(row => `<div class="leader-row"><span class="leader-rank">#${row.rank}</span>${avatarHtml(row, 'leader-avatar')}<span class="leader-name">${escapeHtml(row.name)}</span><span class="leader-score">${row.completedLevels}<small>рівнів</small></span></div>`).join('')}</div>` : '<p class="notice">Поки що немає результатів гравців.</p>'}</div></section>`;
  }

  const views = { home: renderHome, nickname: renderNickname, game: renderGame, failure: renderFailure, result: renderResult, store: renderStore, resources: renderResources, profile: renderProfile, leaderboard: renderLeaderboard };
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

  function updateCipherScrollIndicator() {
    const cipherScroll = appRoot.querySelector('.cipher-scroll');
    const scrollWrap = appRoot.querySelector('.cipher-scroll-wrap');
    const indicator = scrollWrap?.querySelector('.cipher-scroll-indicator');
    const thumb = indicator?.querySelector('.cipher-scroll-indicator__thumb');
    if (!cipherScroll || !scrollWrap || !indicator || !thumb) return;

    const scrollRange = cipherScroll.scrollHeight - cipherScroll.clientHeight;
    const isScrollable = scrollRange > 1;
    scrollWrap.classList.toggle('is-scrollable', isScrollable);
    if (!isScrollable) return;

    const trackHeight = Math.max(1, indicator.clientHeight);
    const thumbHeight = Math.min(trackHeight, Math.max(20, Math.round(trackHeight * cipherScroll.clientHeight / cipherScroll.scrollHeight)));
    const thumbOffset = Math.round((trackHeight - thumbHeight) * cipherScroll.scrollTop / scrollRange);
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${thumbOffset}px)`;
  }

  function render() {
    if (!state.bootstrap) return;
    // The game board is rebuilt after every choice and guess. Preserve its
    // internal scroll position so interacting with a lower cell does not
    // return the player to the beginning of a long phrase.
    const previousCipherScroll = state.view === 'game' ? appRoot.querySelector('.cipher-scroll') : null;
    const cipherScrollPosition = previousCipherScroll && {
      left: previousCipherScroll.scrollLeft,
      top: previousCipherScroll.scrollTop
    };
    updateBrand();
    if (inventoryMount) {
      inventoryMount.innerHTML = inventoryHtml();
      inventoryMount.querySelectorAll('button').forEach(button => { button.disabled = state.busy; });
    }
    appRoot.innerHTML = (views[state.view] || renderHome)();
    if (cipherScrollPosition) {
      const cipherScroll = appRoot.querySelector('.cipher-scroll');
      if (cipherScroll) {
        cipherScroll.scrollLeft = cipherScrollPosition.left;
        cipherScroll.scrollTop = cipherScrollPosition.top;
      }
    }
    appRoot.setAttribute('aria-busy', String(state.busy));
    appRoot.querySelectorAll('button').forEach(button => { if (state.busy && button.dataset.action !== 'back') button.disabled = true; });
    updateCipherScrollIndicator();
    window.requestAnimationFrame(updateCipherScrollIndicator);
    if (state.view === 'nickname') window.setTimeout(() => appRoot.querySelector('#nicknameInput')?.focus(), 0);
    window.SiteTelegram?.setBackButtonVisible?.(!['home', 'nickname'].includes(state.view));
  }

  function navigate(view, { push = true } = {}) {
    if (view === 'resources' && state.view !== 'resources') state.returnView = state.view;
    state.view = view;
    if (push && state.historyReady) history.pushState({ shyfrView: view }, '', window.location.href);
    render();
  }

  function goBack({ fromHistory = false } = {}) {
    if (state.view === 'nickname') return;
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
    // Move forward through the phrase. When a player filled its last available
    // cell, keep focus on the last remaining cell instead of wrapping around.
    return values.find(position => position > Number(currentPosition)) ?? values.at(-1);
  }

  function pause(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  function feedback(kind, pattern) {
    window.SiteTelegram?.haptic?.(kind);
    if (!state.telegram && navigator.vibrate) navigator.vibrate(pattern);
  }

  function feedbackForWordLetters(count) {
    const total = Math.max(0, Number(count) || 0);
    if (!total) return;
    if (state.telegram) {
      for (let index = 0; index < total; index += 1) {
        window.setTimeout(() => window.SiteTelegram?.haptic?.('medium'), index * 36);
      }
      return;
    }
    if (navigator.vibrate) navigator.vibrate(Array.from({ length: total }, () => [18, 18]).flat());
  }

  function newCompletedWordPositions(before, after) {
    const beforeWords = new Set(completedWordPositions(before).map(positions => positions.join(',')));
    return completedWordPositions(after).filter(positions => !beforeWords.has(positions.join(','))).flat();
  }

  function newCompletedCodePositions(before, after) {
    const beforeCodes = new Set(completedCodePositions(before).map(positions => positions.join(',')));
    return completedCodePositions(after).filter(positions => !beforeCodes.has(positions.join(','))).flat();
  }

  async function celebrateCorrectGuess(before, after) {
    const wordPositions = newCompletedWordPositions(before, after);
    const codePositions = newCompletedCodePositions(before, after);
    const celebrationPositions = [...new Set([...wordPositions, ...codePositions])];
    if (after.status === 'won') state.solveCelebration = true;
    if (celebrationPositions.length) {
      state.celebrationPositions = celebrationPositions;
      state.codeCelebrationPositions = codePositions;
      render();
      feedbackForWordLetters(celebrationPositions.length);
      await pause(after.status === 'won' ? 420 : 560);
      state.celebrationPositions = [];
      state.codeCelebrationPositions = [];
    }
    if (after.status === 'won') {
      render();
      feedback('success', [55, 45, 110]);
      await pause(880);
      state.solveCelebration = false;
      await syncCompletedAttempt();
      navigate('result');
    } else if (!celebrationPositions.length) {
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
    const messages = { NO_LIVES: 'Життя закінчилися.', NO_HINTS: 'Підказки закінчилися.', TELEGRAM_REQUIRED: 'Покупки доступні лише у Telegram.', ALREADY_OWNED: 'Цей товар уже відкрито.', PURCHASE_PENDING: 'Рахунок уже створюється. Спробуйте ще раз за мить.', RATE_LIMITED: 'Забагато дій. Зачекайте кілька секунд.', SESSION_REQUIRED: 'Сесія завершилася. Перезапустіть гру.', LOCKED_CODE: 'Ця комірка ще замкнена.', INVALID_HINT_POSITION: 'Оберіть нерозгадану комірку, позначену пунктиром.', INVALID_GUESS: 'Оберіть доступну комірку й літеру.', CATEGORY_COMPLETED: 'Усі рівні цієї категорії вже завершено.', TUTORIAL_REQUIRED: 'Спочатку завершіть навчання.', NICKNAME_REQUIRED: 'Спочатку введіть нікнейм.', INVALID_NICKNAME: 'Нікнейм має містити 2–24 літери або цифри.', TUTORIAL_HINT_LIMIT: 'У навчанні доступно не більше трьох підказок.', TUTORIAL_SURRENDER_DISABLED: 'У навчанні не можна здатися.' };
    showToast(messages[code] || error?.message || 'Сталася помилка.');
    if (code === 'NO_LIVES' || code === 'NO_HINTS') navigate('resources');
  }

  function resetAttemptUi() {
    state.selectedPosition = state.attempt.tutorialStep === 1
      ? null
      : state.attempt.selectedPosition ?? unknownPositions(state.attempt)[0] ?? null;
    state.hintedPosition = null; state.errorPosition = null; state.hintMode = false;
    state.celebrationPositions = []; state.codeCelebrationPositions = []; state.solveCelebration = false;
    state.tutorialSelectedCell = false; state.tutorialGuessed = false;
  }

  async function beginOfflineAttempt(response) {
    if (!response?.attempt || !response?.offline?.text) throw new Error('Unable to prepare this level for offline play.');
    const core = await gameCore();
    state.attempt = localAttemptWithLocks(normalizeAttempt({ ...response.attempt, offline: response.offline }), core);
    state.offlineActions = [];
    state.offlineStartedAt = Date.now();
    state.syncPending = false;
    resetAttemptUi();
    persistOfflineAttempt();
  }

  function finalizeLocalAttempt() {
    if (!state.attempt || state.attempt.status === 'active') return;
    if (state.attempt.status === 'won') state.attempt.result = localResult(state.attempt);
    if (['lost', 'surrendered'].includes(state.attempt.status) && !state.attempt.tutorialStep) {
      state.bootstrap.inventory.lives = Math.max(0, Number(state.bootstrap.inventory?.lives || 0) - 1);
    }
    state.syncPending = true;
    persistOfflineAttempt();
  }

  async function syncCompletedAttempt({ quiet = true } = {}) {
    if (!state.attempt?.offline || state.attempt.status === 'active' || !state.syncPending || !navigator.onLine) return false;
    try {
      const localAttempt = state.attempt;
      const response = await api(`/attempts/${localAttempt.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ actions: state.offlineActions, playedSeconds: offlineSeconds() })
      });
      state.attempt = normalizeAttempt({ ...response.attempt, offline: localAttempt.offline });
      state.bootstrap.inventory = response.inventory;
      clearOfflineAttempt();
      try { await reloadBootstrap(); } catch { cacheBootstrap(); }
      return true;
    } catch (error) {
      persistOfflineAttempt();
      if (!quiet) handleError(error);
      return false;
    }
  }

  function scheduleCompletedAttemptSync() {
    window.setTimeout(() => { syncCompletedAttempt(); }, 0);
  }

  async function startAttempt() {
    const category = currentCategory();
    if (!category) return;
    const saved = offlineRecord();
    if (saved?.attempt?.categoryId === category.id) {
      restoreOfflineAttempt(saved);
      state.selectedCategoryId = category.id;
      resetAttemptUi();
      navigate(state.attempt.status === 'won' ? 'result' : state.attempt.status === 'active' ? 'game' : 'failure');
      scheduleCompletedAttemptSync();
      return;
    }
    await withBusy(async () => {
      const response = await api('/attempts', { method: 'POST', body: JSON.stringify({ categoryId: category.id }) });
      await beginOfflineAttempt(response);
      if (!state.attempt) throw new Error('Сервер не зміг відкрити рівень. Спробуйте ще раз.');
      state.bootstrap.inventory = response.inventory;
      state.selectedPosition = state.attempt.tutorialStep === 1
        ? null
        : state.attempt.selectedPosition ?? unknownPositions(state.attempt)[0] ?? null;
      state.hintedPosition = null; state.errorPosition = null; state.hintMode = false;
      state.celebrationPositions = []; state.codeCelebrationPositions = []; state.solveCelebration = false;
      state.tutorialSelectedCell = false; state.tutorialGuessed = false;
      navigate(state.attempt.status === 'won' ? 'result' : state.attempt.status === 'active' ? 'game' : 'failure');
    });
  }

  function openCategory(categoryId) {
    if (categoryId !== 'tutorial' && !state.bootstrap.onboarding?.complete) { navigate(state.bootstrap.onboarding?.nicknameRequired ? 'nickname' : 'home'); return; }
    state.selectedCategoryId = categoryId;
    const category = currentCategory();
    if (!category?.available) { showToast('Рівні цієї категорії ще готуються.'); return; }
    if (category.completedAll && !category.attemptId) {
      if (categoryId === 'tutorial') navigate('home');
      else showToast('Усі рівні цієї категорії вже завершено.');
      return;
    }
    const canPlay = category.free || category.unlocked || category.levels.some(level => level.unlocked);
    if (!canPlay) { navigate('store'); showToast('Спочатку відкрийте категорію в магазині.'); return; }
    startAttempt();
  }

  async function submitGuess(letter) {
    if (state.view !== 'game' || !state.attempt || state.selectedPosition == null || state.hintMode) return;
    if (state.attempt.tutorialStep === 1 && !state.tutorialSelectedCell) { showToast('Спочатку натисніть комірку в шифрі.'); return; }
    if (state.attempt.tutorialStep) state.tutorialGuessed = true;
    const position = state.selectedPosition;
    await withBusy(async () => {
      const before = state.attempt;
      const core = await gameCore();
      const lockedPositions = state.attempt.tokens.filter(token => token.type === 'letter' && token.locked).map(token => token.position);
      const result = core.evaluateGuess(
        { text: state.attempt.offline.text, substitution: state.attempt.offline.substitution, revealed: state.attempt.revealed, errors: state.attempt.errors },
        position,
        letter,
        { maxErrors: state.attempt.offline.maxErrors, lockedPositions }
      );
      if (['INVALID_GUESS', 'LOCKED_CODE'].includes(result.reason)) return;
      state.attempt = localAttemptWithLocks({ ...state.attempt, revealed: result.revealed, errors: result.errors, status: result.status }, core);
      state.offlineActions.push({ type: 'guess', position, letter });
      if (result.ok) {
        // A preceding wrong attempt may still have a pending shake timeout.
        // Clear it immediately so a correctly revealed cell never keeps the
        // red error outline.
        state.hintedPosition = null;
        state.errorPosition = null;
        announce(`Правильно: ${letter}`);
        state.selectedPosition = positionAfter(state.attempt, position);
        if (state.attempt.status !== 'active') { finalizeLocalAttempt(); scheduleCompletedAttemptSync(); }
        else persistOfflineAttempt();
        await celebrateCorrectGuess(before, state.attempt);
      } else {
        state.errorPosition = position; announce(`Неправильна літера ${letter}. Помилка ${state.attempt.errors} з ${state.attempt.maxErrors}.`); feedback('error', [55, 35, 55]);
        if (state.attempt.status !== 'active') { finalizeLocalAttempt(); scheduleCompletedAttemptSync(); navigate('failure'); }
        else window.setTimeout(() => { state.errorPosition = null; render(); }, 360);
        persistOfflineAttempt();
      }
    });
  }

  async function useHint() {
    const tutorial = Boolean(state.attempt?.tutorialStep);
    if (tutorial && Number(state.bootstrap.onboarding?.tutorialHintsRemaining || 0) <= 0) { showToast('У навчанні вже використано три підказки.'); return; }
    if (!tutorial && Number(state.bootstrap.inventory?.hints || 0) <= 0) { navigate('resources'); showToast('Підказки закінчилися.'); return; }
    state.hintMode = !state.hintMode;
    state.selectedPosition = null;
    render();
    if (state.hintMode) announce('Оберіть пунктирну комірку, яку треба підказати.');
  }

  async function chooseHint(position) {
    if (!state.hintMode || state.attempt?.revealed?.[position]) return;
    await withBusy(async () => {
      const before = state.attempt;
      const core = await gameCore();
      const hint = core.revealHint({ text: state.attempt.offline.text, substitution: state.attempt.offline.substitution, revealed: state.attempt.revealed }, position);
      if (!hint.ok) return;
      state.attempt = localAttemptWithLocks({
        ...state.attempt,
        revealed: hint.revealed,
        hintsUsed: Number(state.attempt.hintsUsed || 0) + 1,
        status: core.isAttemptSolved(state.attempt.offline.text, state.attempt.offline.substitution, hint.revealed) ? 'won' : 'active'
      }, core);
      const tutorial = Boolean(state.attempt.tutorialStep);
      if (tutorial) {
        state.bootstrap.onboarding.tutorialHintsUsed = Number(state.bootstrap.onboarding?.tutorialHintsUsed || 0) + 1;
        state.bootstrap.onboarding.tutorialHintsRemaining = Math.max(0, Number(state.bootstrap.onboarding?.tutorialHintsRemaining || 0) - 1);
      } else state.bootstrap.inventory.hints = Math.max(0, Number(state.bootstrap.inventory?.hints || 0) - 1);
      state.offlineActions.push({ type: 'hint', position });
      const hintedPosition = hint.position;
      state.hintedPosition = hintedPosition;
      state.hintMode = false;
      state.selectedPosition = positionAfter(state.attempt, hintedPosition);
      announce(`Підказка: код ${hint.code} — літера ${hint.letter}.`); feedback('light', 24);
      window.setTimeout(() => {
        if (Number(state.hintedPosition) !== hintedPosition) return;
        state.hintedPosition = null;
        render();
      }, 650);
      if (state.attempt.status !== 'active') { finalizeLocalAttempt(); scheduleCompletedAttemptSync(); }
      else persistOfflineAttempt();
      await celebrateCorrectGuess(before, state.attempt);
    });
  }

  async function surrender() {
    if (state.attempt?.tutorialStep) return;
    const confirmed = await window.SiteTelegram?.showConfirm?.('Здатися? Буде списано одне життя, а відповідь залишиться закритою.');
    if (!confirmed) return;
    await withBusy(async () => {
      state.attempt = { ...state.attempt, status: 'surrendered' };
      state.offlineActions.push({ type: 'surrender' });
      finalizeLocalAttempt();
      scheduleCompletedAttemptSync();
      window.SiteTelegram?.haptic?.('warning'); navigate('failure');
    });
  }

  async function openLeaderboard() {
    await withBusy(async () => { const response = await api('/leaderboard'); state.leaderboard = response.leaderboard || []; navigate('leaderboard'); });
  }

  async function finishTutorial() {
    await withBusy(async () => {
      // Refresh first: completion is persisted on the server and determines
      // whether categories or browser nickname setup should be shown.
      await reloadBootstrap();
      state.selectedCategoryId = '';
      navigate(state.bootstrap.onboarding?.nicknameRequired ? 'nickname' : 'home');
    });
  }

  async function saveNickname(name) {
    await withBusy(async () => {
      await api('/profile', { method: 'POST', body: JSON.stringify({ name }) });
      await reloadBootstrap();
      navigate('home');
      showToast('Нікнейм збережено. Ласкаво просимо!');
    });
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
    else if (action === 'begin-tutorial') openCategory('tutorial');
    else if (action === 'open-tutorial') openCategory('tutorial');
    else if (action === 'open-category') openCategory(button.dataset.categoryId);
    else if (action === 'select-position') {
      const position = Number(button.dataset.position);
      if (state.attempt?.revealed?.[position]) return;
      state.selectedPosition = position;
      if (state.attempt?.tutorialStep) state.tutorialSelectedCell = true;
      feedback('selection', 12);
      render();
    }
    else if (action === 'choose-hint-position') chooseHint(Number(button.dataset.position));
    else if (action === 'guess') submitGuess(button.dataset.letter);
    else if (action === 'hint') useHint();
    else if (action === 'surrender') surrender();
    else if (action === 'retry') startAttempt();
    else if (action === 'next-level') startAttempt();
    else if (action === 'category-complete') navigate('home');
    else if (action === 'finish-tutorial') finishTutorial();
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

  document.addEventListener('submit', event => {
    const form = event.target.closest('[data-nickname-form]');
    if (!form || state.busy) return;
    event.preventDefault();
    saveNickname(form.querySelector('[name="nickname"]')?.value);
  });

  appRoot.addEventListener('scroll', event => {
    if (event.target?.classList?.contains('cipher-scroll')) updateCipherScrollIndicator();
  }, true);

  window.addEventListener('resize', () => window.requestAnimationFrame(updateCipherScrollIndicator));
  window.visualViewport?.addEventListener('resize', () => window.requestAnimationFrame(updateCipherScrollIndicator));

  function keyboardLetterFromEvent(event) {
    return PHYSICAL_UKRAINIAN_KEYS[event.code] || (() => {
      const letter = String(event.key || '').toLocaleUpperCase('uk-UA');
      return KEYBOARD_ROWS.join('').includes(letter) ? letter : '';
    })();
  }

  document.addEventListener('keydown', event => {
    if (state.view !== 'game' || state.busy || state.hintMode || event.ctrlKey || event.metaKey || event.altKey) return;
    const letter = keyboardLetterFromEvent(event);
    if (letter) { event.preventDefault(); submitGuess(letter); return; }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); const values = unknownPositions(state.attempt); if (!values.length) return;
      const current = values.indexOf(Number(state.selectedPosition)); const direction = event.key === 'ArrowRight' ? 1 : -1;
      state.selectedPosition = values[(current + direction + values.length) % values.length]; render();
    }
    if (event.key === 'Escape') goBack();
  });

  window.addEventListener('popstate', () => goBack({ fromHistory: true }));
  window.addEventListener('online', () => { syncCompletedAttempt(); });

  function registerOfflineSupport() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }

  let refreshedResetAt = '';
  window.setInterval(async () => {
    const resetAt = state.bootstrap?.inventory?.resetAt;
    document.querySelectorAll('[data-reset-countdown]').forEach(element => { element.textContent = formatCountdown(resetAt); });
    if (!resetAt || Date.parse(resetAt) > Date.now() || refreshedResetAt === resetAt || state.busy) return;
    refreshedResetAt = resetAt;
    try { await reloadBootstrap(); render(); } catch { /* Наступна дія повторить синхронізацію. */ }
  }, 1000);

  async function init() {
    registerOfflineSupport();
    try {
      await window.SiteTelegram?.init?.(); window.SiteTelegram?.setBackHandler?.(() => goBack());
      await establishSession(); if (!state.bootstrap) await reloadBootstrap();
      state.historyReady = true; history.replaceState({ shyfrView: 'home' }, '', window.location.href); appRoot.setAttribute('aria-busy', 'false');
      const pending = offlineRecord();
      if (pending?.attempt?.status !== 'active') {
        restoreOfflineAttempt(pending);
        state.selectedCategoryId = state.attempt.categoryId;
        scheduleCompletedAttemptSync();
      }
      if (state.bootstrap.onboarding?.nicknameRequired) navigate('nickname', { push: false });
      else render();
    } catch (error) {
      const cached = cachedBootstrap();
      const saved = offlineRecord();
      if (cached && saved) {
        state.bootstrap = cached;
        state.telegram = Boolean(cached.telegram);
        restoreOfflineAttempt(saved);
        state.selectedCategoryId = state.attempt.categoryId;
        state.historyReady = true;
        history.replaceState({ shyfrView: 'game' }, '', window.location.href);
        appRoot.setAttribute('aria-busy', 'false');
        navigate(state.attempt.status === 'won' ? 'result' : state.attempt.status === 'active' ? 'game' : 'failure', { push: false });
        showToast('Гра продовжується на пристрої. Результат синхронізується, коли мережа повернеться.', 4600);
        return;
      }
      appRoot.setAttribute('aria-busy', 'false');
      appRoot.innerHTML = '<section class="screen"><div class="failure-card"><div class="failure-symbol"><i class="fa-solid fa-cloud-bolt" aria-hidden="true"></i></div><h2>Сервер гри недоступний</h2><p>Cloudflare Worker і KV мають бути розгорнуті та налаштовані.</p><button class="button button--primary button--wide" type="button" data-action="reload">Спробувати знову</button></div></section>';
      appRoot.querySelector('[data-action="reload"]')?.addEventListener('click', () => window.location.reload()); handleError(error);
    }
  }

  init();
})();
