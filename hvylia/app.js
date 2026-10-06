import { t, errorText } from './locale.js';
import { RoomTransport, savedSession, lastRoom, forgetSession } from './transport.js';
import { Dial, dialMarkup } from './dial.js';
import { Sound } from './sound.js';
import { Haptics } from './haptics.js';
import { PracticeSession } from './practice.js';
import { scoreTrackMarkup, animateScoreTracks } from './score-track.js';
import { PACKS } from '../content/hvylia/packs.js';
import { SPECTRA } from '../content/hvylia/spectra.js';
import { cardPresentation } from './card-presentation.js';
import { telegramReady, inTelegram, setTelegramBack, telegramRoomCode, openTelegram, openStarInvoice } from './telegram.js';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const app = $('#app');
const sound = new Sound($('#sound-button'));
let state = null;
let screen = '';
let dial = null;
let online = false;
let practice = null;
let entryMode = 'create';
let inviteCode = new URL(window.location.href).searchParams.get('r')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || '';
let noticeTimer;
let settingsDirty = false;
let account = null;
let accountLoading = false;
let accountRequest = null;
let accountChecked = false;
let entryPackId = 'standard';
let purchasePackId = null;
let rankingDialog = null;
let lastPurchaseId = '';
let appMenu = null;
let loginDialog = null;
let collectionDialog = null;
let haptics = null;
let disposeDialFeedback = null;
try { lastPurchaseId = window.localStorage.getItem('hvylia.lastPurchase') || ''; } catch { /* Live receipts still work without storage. */ }
const busy = new Set();
const failedAvatars = new Set();

function avatarURL(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value);
    const api = new URL(transport.base);
    if (url.origin !== api.origin || url.username || url.password || url.search || url.hash
      || !/^\/api\/hvylia\/avatar\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(url.pathname)) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return url.href;
  } catch { return null; }
}

function avatarMarkup(person, style = '') {
  const initial = Array.from(String(person?.name || '?').trim().replace(/^@/u, ''))[0]?.toUpperCase() || '?';
  const url = avatarURL(person?.avatarUrl);
  return `<span class="avatar ${style}" aria-hidden="true"><span class="avatar-fallback">${esc(initial)}</span>${url && !failedAvatars.has(url) ? `<img class="avatar-image" data-avatar-image src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span>`;
}

function spectrumCardMarkup(card, preview = false) {
  const appearance = cardPresentation(card);
  const colors = `--card-left:${appearance.left};--card-right:${appearance.right};--card-left-ink:${appearance.leftInk};--card-right-ink:${appearance.rightInk}`;
  const label = (pole, side) => `<h2${preview ? '' : ` id="spectrum-${side}"`} class="spectrum-pole pole-${side}"><span class="spectrum-label-text">${esc(pole)}</span></h2>`;
  const difficulty = `<span class="spectrum-difficulty" role="img" aria-label="${t.hardCard}"${appearance.difficult ? '' : ' hidden'}>${Array.from(t.cardDifficulty).map(letter => `<span aria-hidden="true">${letter}</span>`).join('')}</span>`;
  const controls = preview ? '' : `<button id="nudge-left" class="nudge-control" type="button" data-direction="-1" aria-label="${t.nudgeLeft}" hidden disabled></button><button id="nudge-right" class="nudge-control" type="button" data-direction="1" aria-label="${t.nudgeRight}" hidden disabled></button>`;
  return `<div class="${preview ? 'preview-poles' : 'spectrum-poles'} spectrum-card" data-difficulty="${appearance.difficult ? 'hard' : 'regular'}" style="${colors}">${label(card.left, 'left')}${label(card.right, 'right')}${difficulty}${controls}</div>`;
}

function updateSpectrumCard(element, card) {
  const appearance = cardPresentation(card);
  element.querySelector('.pole-left .spectrum-label-text').textContent = card.left;
  element.querySelector('.pole-right .spectrum-label-text').textContent = card.right;
  element.style.setProperty('--card-left', appearance.left);
  element.style.setProperty('--card-right', appearance.right);
  element.style.setProperty('--card-left-ink', appearance.leftInk);
  element.style.setProperty('--card-right-ink', appearance.rightInk);
  element.dataset.difficulty = appearance.difficult ? 'hard' : 'regular';
  element.querySelector('.spectrum-difficulty').hidden = !appearance.difficult;
}

document.addEventListener('error', event => {
  const image = event.target;
  if (!(image instanceof window.HTMLImageElement) || !image.hasAttribute('data-avatar-image')) return;
  failedAvatars.add(image.src);
  image.hidden = true;
  image.parentElement?.classList.remove('avatar-image-loaded');
}, true);
document.addEventListener('load', event => {
  const image = event.target;
  if (image instanceof window.HTMLImageElement && image.hasAttribute('data-avatar-image')) image.parentElement?.classList.add('avatar-image-loaded');
}, true);

function hasAccountCredentials() {
  if (inTelegram()) return true;
  if (transport.profileSession?.token && transport.profileSession.expiresAt > Date.now()) return true;
  const launch = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  return launch.has('tgWebAppData') || query.has('tgWebAppData') || launch.has('tgWebAppPlatform');
}

function entryIdentityPending() { return !account?.profile && !accountChecked && hasAccountCredentials(); }

function syncEntryIdentity() {
  const nickname = $('#nickname');
  const profile = account?.profile;
  if (!nickname) return;
  const pending = entryIdentityPending();
  const hidden = Boolean(profile) || pending;
  setHidden('#nickname-field', hidden);
  nickname.disabled = hidden;
  nickname.required = !hidden;
  if (profile) nickname.value = profile.name;
  $('#entry-form').dataset.entryIdentity = profile ? 'account' : pending ? 'loading' : 'guest';
  const button = $('#enter-button');
  if (pending || button.dataset.identityPending === 'true') button.disabled = pending || button.dataset.submitting === 'true';
  button.dataset.identityPending = String(pending);
}

function announce(text) { $('#live').textContent = text; }
function notice(text) {
  const element = $('#notice');
  element.textContent = text;
  element.hidden = false;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { element.hidden = true; }, 6500);
}
function activeSession() { return practice || transport; }
function me() { return state?.players.find(player => player.id === activeSession().session?.playerId); }
function isHost() { return state?.hostId === activeSession().session?.playerId; }
function roomURL() {
  if (inTelegram() && account?.botUsername) return `https://t.me/${account.botUsername.replace(/^@/u, '')}?start=room_${state.code}`;
  const url = new URL(window.location.href); url.hash = ''; url.searchParams.delete('practice'); url.searchParams.set('r', state.code); return url.href;
}
function setText(selector, value) { const element = $(selector); if (element && element.textContent !== String(value)) element.textContent = value; }
function setHidden(selector, hidden) { const element = $(selector); if (element) element.hidden = hidden; }
function setDisabled(selector, disabled) { const element = $(selector); if (element) element.disabled = disabled; }

function bindDialFeedback(element) {
  const motions = new Map();
  const stop = mechanism => {
    const motion = motions.get(mechanism);
    if (!motion) return;
    motion.cancelSound?.(); motion.cancelHaptics?.();
    motions.delete(mechanism);
  };
  const stopAll = () => { for (const mechanism of motions.keys()) stop(mechanism); };
  const onMotion = event => {
    const detail = event.detail;
    if (!detail || !['wheel', 'shutter'].includes(detail.mechanism) || !Number.isSafeInteger(detail.serial)) return;
    if (detail.phase === 'start') {
      stop(detail.mechanism);
      if (document.hidden || !Number.isFinite(detail.duration) || detail.duration <= 0) return;
      motions.set(detail.mechanism, {
        serial: detail.serial,
        cancelSound: sound.mechanical?.(detail),
        cancelHaptics: haptics?.mechanical?.(detail)
      });
    } else if (detail.phase === 'cancel' && motions.get(detail.mechanism)?.serial === detail.serial) stop(detail.mechanism);
    // A natural finish lets the final detent fade. Its bounded callbacks remain
    // owned here until the next motion, page hide, or removal of the instrument.
  };
  const onVisibility = () => { if (document.hidden) stopAll(); };
  element.addEventListener('dialmotion', onMotion);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', stopAll);
  return () => {
    stopAll();
    element.removeEventListener('dialmotion', onMotion);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', stopAll);
  };
}

function receiveState(nextState, training = false) {
  if (!nextState) return;
  if (!training && state && nextState.code === state.code && nextState.revision < state.revision) return;
  const before = state;
  state = nextState;
  if (!training) {
    const url = new URL(window.location.href);
    url.searchParams.set('r', state.code);
    window.history.replaceState(null, '', url);
  }
  if (before?.phase !== state.phase) {
    if (state.phase === 'OPPONENT_BET') sound.play('lock');
    if (state.phase === 'REVEAL') sound.play('suspense');
    if (state.phase === 'SCORE') sound.play('score', { points: state.round?.result?.activePoints || 0 });
    if (state.phase === 'GAME_OVER') sound.play('win');
  }
  if (!before?.round?.revealed && state.round?.revealed) sound.play('reveal');
  render();
}

const transport = new RoomTransport({
  state(nextState) {
    if (practice) { transport.close(); return; }
    receiveState(nextState);
  },
  status(status) {
    if (practice) return;
    online = status === 'connected';
    const banner = $('#connection');
    if (status === 'connected') { banner.hidden = true; render(); return; }
    if (status === 'expired') {
      const code = transport.session?.code;
      if (code) forgetSession(code);
      state = null; inviteCode = code || ''; entryMode = 'join';
      banner.hidden = true; render(); return;
    }
    banner.hidden = false;
    const copy = status === 'replaced' ? t.replaced : status === 'connecting' ? t.connecting : t.offline;
    banner.innerHTML = `<span>${esc(copy)}</span>${status === 'replaced' ? `<button class="quiet-button" id="reconnect-button">${t.reconnectButton} →</button>` : ''}`;
    $('#reconnect-button')?.addEventListener('click', async () => {
      try { await transport.resume(transport.session.code); } catch (error) { notice(errorText(error)); }
    });
    render();
  },
  error(error) { if (!practice) notice(errorText(error)); }
});

async function act(action, key = action.type) {
  if (busy.has(key)) return false;
  if (['clue', 'replace-spectrum'].includes(action.type) && (busy.has('clue') || busy.has('replace-spectrum'))) return false;
  busy.add(key); render();
  try {
    await activeSession().action(action);
    const wheelFeedback = ['replace-spectrum', 'next'].includes(action.type) && dial?.element.dataset.wheel === 'turning';
    if (action.type !== 'move' && !wheelFeedback) haptics?.impact(['clue', 'lock', 'bet'].includes(action.type) ? 'medium' : 'light');
    return true;
  }
  catch (error) { haptics?.error(); notice(errorText(error)); return false; }
  finally { busy.delete(key); render(); }
}
function roundAction(type, extra = {}) { return act({ type, roundId: state.round.id, ...extra }); }

function render() {
  const desired = !state ? 'entry' : state.phase === 'LOBBY' ? 'lobby' : 'game';
  if (screen !== desired) {
    dial?.destroy(); disposeDialFeedback?.(); disposeDialFeedback = null; dial = null; screen = desired;
    app.className = `${screen}-screen`;
    if (screen === 'entry') mountEntry();
    if (screen === 'lobby') mountLobby();
    if (screen === 'game') mountGame();
  }
  if (screen === 'lobby') updateLobby();
  if (screen === 'game') updateGame();
  if (screen === 'entry') { updatePackCards($('#entry-packs'), 'entry'); setText('#entry-pack-name', PACKS.find(pack => pack.id === entryPackId)?.title || PACKS[0].title); }
  updateIdentity();
  app.dataset.phase = state?.phase || 'ENTRY';
  app.dataset.practice = String(Boolean(practice));
  updateTelegramBack();
}

function updateTelegramBack() {
  setTelegramBack(document.querySelector('dialog[open]') || state ? () => {
    const dialog = $('dialog[open]');
    if (dialog) { dialog.close(); return; }
    if (practice) leavePractice();
    else $('#leave-button')?.click();
  } : null);
}

async function refreshAccount({ quiet = true } = {}) {
  if (accountRequest) return accountRequest;
  accountLoading = true;
  syncEntryIdentity();
  updatePackCards($('#entry-packs'), 'entry'); updatePackCards($('#lobby-packs'), 'lobby');
  accountRequest = (async () => {
    try {
      await telegramReady;
      let credential, nextAccount;
      do {
        credential = transport.profileSession?.token;
        nextAccount = await transport.get('/hvylia/account');
        // A login can finish during a previous anonymous request. Refresh with
        // the new credential before replacing its authenticated identity.
      } while (credential !== transport.profileSession?.token);
      account = nextAccount;
      failedAvatars.delete(avatarURL(account.profile?.avatarUrl));
    } catch (error) { if (!quiet) notice(errorText(error)); }
    finally {
      accountChecked = true;
      accountLoading = false;
      syncEntryIdentity();
      updatePackCards($('#entry-packs'), 'entry'); updatePackCards($('#lobby-packs'), 'lobby');
      updateIdentity();
      accountRequest = null;
    }
    return account;
  })();
  return accountRequest;
}

function ownedPack(pack) { return Boolean(pack.free || pack.priceStars === 0 || account?.packs?.find(item => item.id === pack.id)?.owned); }

function purchaseReceiptMarkup() {
  return lastPurchaseId ? `<p class="purchase-receipt"><span>${t.purchaseReceipt}</span><code>${esc(lastPurchaseId)}</code><button type="button" class="quiet-button" data-copy-purchase>${t.purchaseCopy} ↗</button></p>` : '';
}

document.addEventListener('click', async event => {
  if (!event.target.closest('[data-copy-purchase]')) return;
  try { await window.navigator.clipboard.writeText(lastPurchaseId); notice(t.purchaseCopied); }
  catch { notice(lastPurchaseId); }
});

function packCatalogMarkup(context) {
  const host = context === 'entry' || isHost();
  return `<section class="pack-catalog ${context === 'entry' ? 'entry-catalog' : 'lobby-catalog'}" aria-labelledby="${context}-packs-title"><header class="pack-catalog-heading"><div><p class="eyebrow">${t.packsEyebrow}</p><h2 id="${context}-packs-title">${t.packsTitle}</h2></div><p>${host ? t.packsHint : t.packHostSelect}</p></header><div id="${context}-packs" class="pack-grid"></div><p class="pack-sharing-note">${t.packShared}</p><button class="text-link pack-refresh" type="button" data-pack-refresh>${t.packRefresh} ↻</button><div class="purchase-receipt-slot">${purchaseReceiptMarkup()}</div></section>`;
}

function updatePackCards(element, context) {
  if (!element) return;
  const requestedId = context === 'entry' ? entryPackId : state?.config.packId;
  const selectedId = context === 'collection' ? null : PACKS.find(pack => pack.id === requestedId)?.id || PACKS[0].id;
  const host = context === 'entry' || (context === 'lobby' && isHost());
  const packs = context === 'lobby' && !host ? PACKS.filter(pack => pack.id === selectedId) : PACKS;
  const markup = packs.map(pack => {
    const owned = ownedPack(pack), selected = selectedId === pack.id;
    const purchasing = purchasePackId === pack.id;
    let action = '';
    if (selected || owned) {
      const disabled = selected || !host || (context === 'lobby' && (!online || busy.has('settings')));
      action = `<button class="pack-action" type="button" data-pack-select="${esc(pack.id)}" data-focus-key="pack-select-${esc(pack.id)}" aria-pressed="${selected}" ${disabled ? 'disabled' : ''}>${selected ? `✓ ${context === 'lobby' ? t.packSelected : t.packAvailable}` : context === 'collection' ? t.packOwned : `${t.packChoose} →`}</button>`;
    } else if (!account?.paymentReady) {
      action = `<button class="pack-action" type="button" disabled>${accountLoading ? t.packPreparing : t.packUnavailable}</button>`;
    } else {
      const label = purchasing ? t.packConfirming : inTelegram() && account?.profile ? t.packPurchase : t.packTelegram;
      action = `<button class="pack-action pack-buy" type="button" data-pack-buy="${esc(pack.id)}" data-focus-key="pack-buy-${esc(pack.id)}" ${purchasePackId ? 'disabled' : ''}>${label} ${!purchasing ? '↗' : ''}</button>`;
    }
    return `<article class="pack-card pack-${esc(pack.id)}${selected ? ' is-selected' : ''}" data-pack-id="${esc(pack.id)}"><div class="pack-art" aria-hidden="true"><span class="pack-symbol">${pack.id === 'anime' ? '✦' : pack.id === 'games' ? '✚' : '∿'}</span><span class="pack-art-line"></span><span class="pack-art-dot"></span></div><div class="pack-copy"><div class="pack-topline"><span>${esc(t.packCount(pack.count))}</span><span class="pack-price">${pack.priceStars ? `${pack.priceStars} ⭐` : t.packFree}</span></div><h3>${esc(pack.title)}</h3><p>${esc(pack.description)}</p><small>${owned && pack.priceStars ? t.packOwned : pack.priceStars ? t.packPermanent : t.packFree}</small></div>${action}</article>`;
  }).join('');
  replacePreservingFocus(element, markup);
  const refresh = element.closest('.pack-catalog')?.querySelector('[data-pack-refresh]');
  if (refresh) refresh.disabled = accountLoading || Boolean(purchasePackId);
  const receipt = element.closest('.pack-catalog')?.querySelector('.purchase-receipt-slot');
  if (receipt) replacePreservingFocus(receipt, purchaseReceiptMarkup());
}

function bindPackCards(element, context) {
  element.closest('.pack-catalog').querySelector('[data-pack-refresh]').addEventListener('click', () => refreshAccount({ quiet: false }));
  element.addEventListener('click', async event => {
    const select = event.target.closest('[data-pack-select]');
    if (select) {
      if (context === 'entry') { entryPackId = select.dataset.packSelect; updatePackCards(element, context); setText('#entry-pack-name', PACKS.find(pack => pack.id === entryPackId)?.title || PACKS[0].title); $('#entry-pack-picker').open = false; ($('#nickname').disabled ? $('#entry-pack-picker > summary') : $('#nickname')).focus(); }
      else await act({ type: 'settings', packId: select.dataset.packSelect });
    }
    const buy = event.target.closest('[data-pack-buy]');
    if (buy) await purchasePack(buy.dataset.packBuy);
  });
}

async function purchasePack(packId) {
  if (purchasePackId) return;
  if (!inTelegram() || !account?.profile) {
    if (!openTelegram(account?.botUsername)) notice(t.packUnavailable);
    return;
  }
  purchasePackId = packId; render();
  try {
    const invoice = await transport.request('/hvylia/invoice', { packId });
    lastPurchaseId = String(invoice.purchaseId || '');
    try { if (lastPurchaseId) window.localStorage.setItem('hvylia.lastPurchase', lastPurchaseId); } catch { /* Keep this receipt in memory. */ }
    render();
    const status = await openStarInvoice(invoice.invoiceLink);
    if (status === 'cancelled' || status === 'failed') { notice(t.packCancelled); return; }
    // A client-side "paid" callback never grants access. Wait for server entitlement.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await refreshAccount({ quiet: false });
      if (account?.packs?.find(pack => pack.id === packId)?.owned) { notice(t.packUnlocked); return; }
      await new Promise(resolve => window.setTimeout(resolve, 750 + attempt * 200));
    }
    notice(t.packPending);
  } catch (error) { notice(errorText(error)); if (error.code === 'OWNED') await refreshAccount(); }
  finally { purchasePackId = null; render(); }
}

function mountEntry() {
  if (inviteCode) entryMode = 'join';
  const previewSpectrum = SPECTRA[0];
  app.innerHTML = `<section class="entry-intro" aria-labelledby="entry-title"><p class="eyebrow">${t.entryEyebrow}</p><h1 id="entry-title">${t.entryTitle}</h1><p class="entry-description">${t.entryIntro}</p><div class="entry-dial">${dialMarkup('preview-dial')}${spectrumCardMarkup(previewSpectrum, true)}</div><p class="entry-meta">${t.entryMeta}</p></section>
    <section class="entry-panel" aria-label="${t.joiningLabel}"><div class="entry-tabs" role="tablist" aria-label="${t.actionLabel}"><button type="button" id="create-tab" role="tab" aria-controls="entry-form" class="entry-tab">${t.createShort}</button><button type="button" id="join-tab" role="tab" aria-controls="entry-form" class="entry-tab">${t.join}</button></div>
    <form id="entry-form" class="entry-form" role="tabpanel" aria-labelledby="entry-form-title"><h2 id="entry-form-title" class="sr-only"></h2><div id="nickname-field"><label for="nickname">${t.nickname}</label><input id="nickname" name="name" minlength="2" maxlength="33" required autocomplete="nickname" placeholder="${t.nicknamePlaceholder}"></div><div id="room-code-field"><label for="room-code">${t.code}</label><input id="room-code" name="code" maxlength="4" minlength="4" pattern="[A-Za-z0-9]{4}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7FM" value="${esc(inviteCode)}"></div><p id="entry-error" class="form-error" role="alert" hidden></p><button id="enter-button" type="submit" class="button"></button></form><div class="entry-secondary"><button id="practice-button" class="quiet-button" type="button">${t.practiceStart} →</button><button class="quiet-button" type="button" data-open-rules>${t.helpShort} ?</button></div><div class="entry-identity" data-identity></div><details id="entry-pack-picker" class="entry-pack-picker"><summary><span>${t.packsShort}</span><strong id="entry-pack-name"></strong><span class="disclosure-icon" aria-hidden="true">⌄</span></summary>${packCatalogMarkup('entry')}</details></section>`;
  const previewTarget = Math.round(18 + Math.random() * 64);
  const previewPosition = Math.round(previewTarget + (previewTarget < 50 ? 1 : -1) * (16 + Math.random() * 18));
  dial = new Dial($('#preview-dial'), () => {}, { preview: true });
  disposeDialFeedback = bindDialFeedback($('#preview-dial'));
  dial.update({ position: previewPosition, target: previewTarget, revealed: true, canPeek: true, editable: false, showNeedle: true });
  $('#preview-dial').addEventListener('click', event => {
    if (event.target.closest('.dial-shutter-control') && !['opening', 'closing'].includes($('#preview-dial').dataset.shutter)) haptics?.impact();
  });
  const choose = mode => {
    entryMode = mode;
    const joining = mode === 'join';
    $('#create-tab').setAttribute('aria-selected', String(!joining));
    $('#join-tab').setAttribute('aria-selected', String(joining));
    $('#create-tab').tabIndex = joining ? -1 : 0;
    $('#join-tab').tabIndex = joining ? 0 : -1;
    setText('#entry-form-title', joining ? t.entryJoin : t.entryCreate);
    setText('#enter-button', `${joining ? t.join : t.create} →`);
    setHidden('#room-code-field', !joining);
    setHidden('#entry-pack-picker', joining);
    $('#room-code').required = joining;
    setHidden('#entry-error', true);
    syncEntryIdentity();
  };
  $('#create-tab').addEventListener('click', () => choose('create'));
  $('#join-tab').addEventListener('click', () => choose('join'));
  $('.entry-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); choose(entryMode === 'create' ? 'join' : 'create');
    $(entryMode === 'create' ? '#create-tab' : '#join-tab').focus();
  });
  $('#room-code').addEventListener('input', event => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('#entry-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.querySelector('#enter-button').dataset.submitting === 'true') return;
    const code = entryMode === 'join' ? $('#room-code').value.toUpperCase().trim() : null;
    const button = $('#enter-button');
    button.dataset.submitting = 'true';
    button.disabled = true; button.textContent = code ? t.joinBusy : t.createBusy;
    setHidden('#entry-error', true);
    try {
      await telegramReady;
      if (accountRequest) await accountRequest;
      else if (hasAccountCredentials() && !accountChecked) await refreshAccount();
      if (!form.isConnected || state || practice) return;
      const authenticated = Boolean(account?.profile);
      const name = account?.profile?.name || $('#nickname').value.trim();
      await transport.enter(name, code, entryPackId);
      if (!authenticated) {
        try { window.localStorage.setItem('hvylia.nickname', name); } catch { /* The room itself remembers the nickname. */ }
      }
      refreshAccount(); haptics?.impact('medium');
    }
    catch (error) {
      if (!$('#entry-error')) return;
      setText('#entry-error', errorText(error)); setHidden('#entry-error', false);
      button.textContent = `${code ? t.join : t.create} →`;
    } finally {
      button.dataset.submitting = 'false';
      button.disabled = false;
      syncEntryIdentity();
    }
  });
  $('#practice-button').addEventListener('click', startPractice);
  const previousRoom = lastRoom();
  if (previousRoom && savedSession(previousRoom)) {
    const resume = document.createElement('button');
    resume.type = 'button'; resume.className = 'quiet-button'; resume.id = 'saved-room-button';
    resume.textContent = `${t.reconnect} ${previousRoom} →`;
    $('.entry-secondary').append(resume);
    resume.addEventListener('click', () => resumeRoom(previousRoom));
  }
  $('[data-open-rules]').addEventListener('click', openRules);
  bindPackCards($('#entry-packs'), 'entry');
  try { $('#nickname').value = window.localStorage.getItem('hvylia.nickname') || ''; } catch { /* Nicknames can still be entered manually. */ }
  syncEntryIdentity();
  updateIdentity();
  choose(entryMode);
}

function roomHeading() {
  if (practice) return `<div class="practice-tools"><span class="practice-badge">${t.practiceTitle}</span><button class="quiet-button leave-button" id="practice-leave" type="button">${t.practiceLeave} ↗</button></div><p class="practice-help">${t.practiceHelp}</p><p class="field-note" id="practice-step"></p>`;
  return `<div class="room-tools"><span class="room-label">${t.room} <strong id="room-code-display">${esc(state.code)}</strong></span><button class="text-link" id="invite-button" type="button">${t.invite} ↗</button><button class="quiet-button leave-button" id="leave-button" type="button">${t.leave} ↗</button></div><div id="invite-fallback" hidden><label for="invite-url">${t.inviteLabel}</label><input id="invite-url" readonly value="${esc(roomURL())}"></div>`;
}
function startPractice() {
  practice = new PracticeSession(nextState => receiveState(nextState, true));
  transport.close();
  state = null; online = true; busy.clear();
  $('#connection').hidden = true;
  const url = new URL(window.location.href);
  url.searchParams.delete('r'); url.searchParams.set('practice', '1');
  window.history.replaceState(null, '', url);
  practice.start();
  $('#phase-title')?.setAttribute('tabindex', '-1');
  $('#phase-title')?.focus();
}
function leavePractice() {
  practice?.close(); practice = null;
  state = null; online = false; busy.clear();
  const url = new URL(window.location.href);
  url.searchParams.delete('practice');
  if (inviteCode) url.searchParams.set('r', inviteCode);
  window.history.replaceState(null, '', url);
  $('#connection').hidden = true;
  render();
  $('#practice-button')?.focus();
}
function mountLobby() {
  settingsDirty = false;
  app.innerHTML = `${roomHeading()}<header class="lobby-heading"><p class="eyebrow">${t.beforeRound}</p><h1>${t.lobbyTitle}</h1><p>${t.lobbyIntro}</p></header><div id="teams" class="lobby-teams"></div><div id="unassigned" class="unassigned"></div><div class="lobby-bottom"><div class="readiness"><button id="ready-button" type="button" class="button"></button><p id="lobby-status" class="field-note"></p></div><div class="host-start" id="host-start"><button id="randomize-button" class="quiet-button" type="button">${t.randomize} ↔</button><button id="start-button" class="button button-dark" type="button">${t.start} →</button></div></div><details id="host-settings" class="settings"><summary>${t.settings} <span aria-hidden="true">+</span></summary><form id="settings-form"><div class="settings-grid"><div><label for="team-name-0">${t.teamName} 1</label><input id="team-name-0" maxlength="28" required></div><div><label for="team-name-1">${t.teamName} 2</label><input id="team-name-1" maxlength="28" required></div><div><label for="win-score">${t.winScore}</label><input id="win-score" type="number" min="5" max="30" step="1" required></div></div><div class="settings-bottom"><label class="checkbox-label"><input id="self-select" type="checkbox">${t.selfSelect}</label><button class="button button-small" id="save-settings" type="submit">${t.save} →</button></div></form></details>`;
  bindRoomTools();
  $('.lobby-heading').insertAdjacentHTML('afterend', `<details id="lobby-pack-picker" class="lobby-pack-picker" ><summary><span>${t.packRoom}</span><strong id="lobby-pack-name"></strong><i aria-hidden="true">+</i></summary>${packCatalogMarkup('lobby')}</details>`);
  bindPackCards($('#lobby-packs'), 'lobby');
  $('#win-score').step = '5';
  $('#teams').addEventListener('click', teamEvent);
  $('#unassigned').addEventListener('click', teamEvent);
  $('#teams').addEventListener('change', teamChange);
  $('#unassigned').addEventListener('change', teamChange);
  $('#ready-button').addEventListener('click', () => act({ type: 'ready', ready: !me()?.ready }));
  $('#randomize-button').addEventListener('click', () => act({ type: 'randomize' }));
  $('#start-button').addEventListener('click', () => act({ type: 'start' }));
  $('#settings-form').addEventListener('input', () => { settingsDirty = true; });
  $('#settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const success = await act({ type: 'settings', teamNames: [$('#team-name-0').value.trim(), $('#team-name-1').value.trim()], winScore: Number($('#win-score').value), selfSelect: $('#self-select').checked });
    if (success) { settingsDirty = false; notice(t.saved); updateLobby(); }
  });
}
function playerMarkup(player) {
  const mine = player.id === me()?.id;
  return `<li data-player-id="${esc(player.id)}" class="player-row${player.connected ? '' : ' player-offline'}"><div class="player-name">${avatarMarkup(player, 'avatar-player')}<span>${esc(player.name)}</span>${mine ? `<small>${t.you}</small>` : ''}${player.id === state.hostId ? `<small class="host-label">${t.host}</small>` : ''}</div><span class="player-state${player.ready && player.connected ? ' is-ready' : ''}">${player.connected ? (player.ready ? `✓ ${t.ready}` : t.notReady) : t.disconnected}</span>${isHost() ? `<div class="player-controls"><select aria-label="${t.movePlayer}: ${esc(player.name)}" data-player-team="${esc(player.id)}" data-focus-key="team-${esc(player.id)}" ${!online ? 'disabled' : ''}><option value="" ${player.team == null ? 'selected' : ''}>${t.noTeam}</option>${state.teams.map((team, i) => `<option value="${i}" ${player.team === i ? 'selected' : ''}>${esc(team.name)}</option>`).join('')}</select>${!mine ? `<button type="button" class="kick-button" aria-label="${t.removePlayer}: ${esc(player.name)}" data-kick="${esc(player.id)}" ${!online ? 'disabled' : ''}>×</button>` : ''}</div>` : ''}</li>`;
}
function replacePreservingFocus(element, markup) {
  if (element.dataset.markup === markup) return;
  const focused = element.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  element.innerHTML = markup; element.dataset.markup = markup;
  if (focused) Array.from(element.querySelectorAll('[data-focus-key]')).find(item => item.dataset.focusKey === focused)?.focus({ preventScroll: true });
}
function updateLobby() {
  updatePackCards($('#lobby-packs'), 'lobby');
  setText('#lobby-pack-name', PACKS.find(pack => pack.id === state.config.packId)?.title || PACKS[0].title);
  const player = me();
  const allowChoice = state.config.selfSelect || isHost();
  replacePreservingFocus($('#teams'), state.teams.map((team, i) => {
    const members = state.players.filter(item => item.team === i);
    return `<section class="team-column team-${i}"><header><span class="team-number">0${i + 1}</span><h2>${esc(team.name)}</h2><span class="team-count">${members.length}</span></header><ul class="player-list">${members.map(playerMarkup).join('') || `<li class="empty-team">${t.emptyTeam}</li>`}</ul><button type="button" class="team-join" data-team="${i}" ${!online || !allowChoice || player?.team === i || busy.has('team') ? 'disabled' : ''}>${player?.team === i ? `✓ ${t.currentTeam}` : `${t.joinTeam} →`}</button></section>`;
  }).join(''));
  const unassigned = state.players.filter(item => item.team == null);
  setHidden('#unassigned', !unassigned.length);
  replacePreservingFocus($('#unassigned'), `<p class="eyebrow">${t.lobbyUnassigned}</p><ul class="player-list">${unassigned.map(playerMarkup).join('')}</ul>`);
  setText('#ready-button', player?.ready ? `✓ ${t.readyOff}` : t.readyOn);
  setDisabled('#ready-button', !online || player?.team == null || busy.has('ready'));
  const valid = state.teams.every((_, team) => state.players.filter(item => item.team === team && item.connected && item.ready).length >= 2);
  setText('#lobby-status', valid ? (isHost() ? t.allReady : t.lobbyWaiting) : t.lobbyMinimum);
  setHidden('#host-start', !isHost()); setHidden('#host-settings', !isHost());
  setDisabled('#start-button', !online || !valid || busy.has('start'));
  setDisabled('#randomize-button', !online || busy.has('randomize'));
  setDisabled('#save-settings', !online || busy.has('settings'));
  if (!settingsDirty) {
    $('#team-name-0').value = state.teams[0].name;
    $('#team-name-1').value = state.teams[1].name;
    $('#win-score').value = state.config.winScore;
    $('#self-select').checked = state.config.selfSelect;
  }
}
function teamEvent(event) {
  const join = event.target.closest('[data-team]');
  if (join) act({ type: 'team', team: Number(join.dataset.team) });
  const kick = event.target.closest('[data-kick]');
  if (kick) {
    const player = state.players.find(item => item.id === kick.dataset.kick);
    confirmAction(t.kickTitle, t.kickDescription(player.name), t.removePlayer, () => act({ type: 'kick', playerId: player.id }));
  }
}
function teamChange(event) {
  if (event.target.matches('[data-player-team]')) act({ type: 'team', playerId: event.target.dataset.playerTeam, team: event.target.value === '' ? null : Number(event.target.value) });
}
function bindRoomTools() {
  if (practice) {
    $('#practice-leave').addEventListener('click', leavePractice);
    return;
  }
  $('#invite-button').addEventListener('click', async () => {
    try { await window.navigator.clipboard.writeText(roomURL()); notice(t.copied); }
    catch { setHidden('#invite-fallback', false); $('#invite-url').select(); notice(t.copyFailed); }
  });
  $('#leave-button').addEventListener('click', () => confirmAction(t.leaveConfirm, t.leaveDescription, t.leave, async () => {
    const code = state.code;
    if (online && !(await act({ type: 'leave' }))) return;
    transport.close(); forgetSession(code); state = null; online = false; inviteCode = ''; entryMode = 'create';
    const url = new URL(window.location.href); url.searchParams.delete('r'); window.history.replaceState(null, '', url);
    $('#connection').hidden = true; render();
  }));
}

function mountGame() {
  app.innerHTML = `${roomHeading()}<div class="game-layout"><div id="scoreboard" class="scoreboard" aria-label="${t.scoreboardLabel}"></div><section class="game-stage" aria-labelledby="phase-title"><div class="round-meta"><span id="round-number"></span><span id="active-team"></span></div><div id="pause-banner" class="pause-banner" role="status" hidden><strong>${t.pause}</strong><p id="pause-reason"></p><button id="return-lobby" class="text-link" type="button">${t.returnLobby} →</button></div><header class="phase-heading"><p class="eyebrow" id="role-label"></p><h1 id="phase-title"></h1><details class="phase-help"><summary>${t.phaseHelp}<span aria-hidden="true">⌄</span></summary><p class="phase-description" id="phase-description"></p></details><p class="psychic-banner"><span id="psychic-label"></span><strong id="psychic-name"></strong></p></header><p id="spectator-note" class="spectator-note" hidden>${t.spectatorNote}</p><div class="game-dial">${dialMarkup()}${spectrumCardMarkup(SPECTRA[0])}</div><div id="spectrum-tools" class="spectrum-tools" hidden><button id="replace-spectrum" class="spectrum-swap" type="button"><span class="spectrum-swap-icon" aria-hidden="true">↻</span><span id="replace-spectrum-label">${t.replaceCard}</span></button><p>${t.replaceCardHint}</p></div><div class="round-content"><p id="clue-display" class="clue-display" hidden><span>${t.clue}</span><strong id="clue-text"></strong></p><form id="clue-form" class="clue-form" hidden><label class="sr-only" for="clue-input">${t.clueLabel}</label><input id="clue-input" name="clue" maxlength="120" required placeholder="${t.cluePlaceholder}" autocomplete="off"><button class="button" type="submit" id="send-clue">${t.sendClue} →</button><p class="field-note">${t.clueNote}</p></form><div id="guess-controls" class="guess-controls" hidden><p class="field-note">${t.guessCompact}</p><button id="lock-button" class="button" type="button">${t.lock} →</button></div><div id="bet-controls" class="bet-controls" hidden><button id="bet-left" class="button button-outline" type="button">← ${t.left}</button><button id="bet-right" class="button button-outline" type="button">${t.right} →</button></div><div id="round-result" class="round-result" hidden><div class="result-points"><strong id="active-points"></strong><span id="points-description"></span></div><p id="opponent-points"></p><p id="catch-up" class="catch-up" hidden>${t.catchUp}</p><p id="overtime-note" hidden>${t.overtime}</p><button id="next-button" class="button" type="button">${t.next} →</button><p id="next-waiting" class="field-note" hidden>${t.nextWaiting}</p></div><div id="game-over-controls" class="game-over-controls" hidden><button id="rematch-button" class="button" type="button">${t.rematch} →</button><p id="rematch-waiting" class="field-note" hidden>${t.rematchWaiting}</p></div></div></section></div>`;
  $('#psychic-name').insertAdjacentHTML('beforebegin', '<span id="psychic-avatar" class="psychic-avatar" aria-hidden="true"></span>');
  $('.phase-heading').insertAdjacentHTML('beforeend', `<p id="catalog-updated-note" class="field-note" role="status" hidden>${t.catalogUpdated}</p>`);
  bindRoomTools();
  if (!practice && state.config.ranked) $('.room-tools').insertAdjacentHTML('beforeend', `<span class="ranked-match">${t.ratingRanked}</span>`);
  dial = new Dial($('#dial'), position => {
    if (state?.phase !== 'TEAM_GUESS' || !online) return;
    sound.play('move'); haptics?.selection();
    activeSession().action({ type: 'move', position, roundId: state.round.id }).catch(error => { if (online) notice(errorText(error)); });
  }, { nudgeControls: [$('#nudge-left'), $('#nudge-right')] });
  disposeDialFeedback = bindDialFeedback($('#dial'));
  $('#dial').addEventListener('shutterchange', updateClueControl);
  $('#dial').addEventListener('click', event => {
    if (event.target.closest('.dial-shutter-control') && dial.canPeek && !['opening', 'closing'].includes($('#dial').dataset.shutter)) haptics?.impact();
  });
  $('#clue-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!dial.clueReady || busy.has('clue') || busy.has('replace-spectrum')) return;
    roundAction('clue', { text: $('#clue-input').value.trim() });
  });
  $('#replace-spectrum').addEventListener('click', () => {
    if (state?.phase !== 'PSYCHIC_VIEW' || me()?.id !== state.round.psychicId || state.paused) return;
    roundAction('replace-spectrum');
  });
  $('#lock-button').addEventListener('click', () => roundAction('lock', { position: dial.position }));
  $('#bet-left').addEventListener('click', () => roundAction('bet', { side: 'left' }));
  $('#bet-right').addEventListener('click', () => roundAction('bet', { side: 'right' }));
  $('#next-button').addEventListener('click', () => roundAction('next'));
  $('#rematch-button').addEventListener('click', () => act({ type: 'rematch' }));
  $('#return-lobby').addEventListener('click', () => confirmAction(t.returnLobbyTitle, t.returnLobbyDescription, t.returnLabel, () => act({ type: 'lobby' })));
}

function updateClueControl() {
  const changing = busy.has('clue') || busy.has('replace-spectrum');
  setDisabled('#send-clue', !online || changing || !dial?.clueReady);
  setDisabled('#replace-spectrum', !online || changing);
  setDisabled('#clue-input', !online || changing);
}

function updateGame() {
  const round = state.round;
  if (!round) return;
  const player = me();
  const psychic = player?.id === round.psychicId;
  const active = player?.team === round.activeTeam;
  const spectator = player?.team == null;
  const psychicPlayer = state.players.find(item => item.id === round.psychicId);
  const psychicName = psychicPlayer?.name || t.psychic;
  const canGuess = state.phase === 'TEAM_GUESS' && active && !psychic && !state.paused;
  const canBet = state.phase === 'OPPONENT_BET' && !active && !spectator && !state.paused;
  const canClue = state.phase === 'PSYCHIC_VIEW' && psychic && !state.paused;
  const revealed = Boolean(round.revealed || ['SCORE', 'GAME_OVER'].includes(state.phase));
  const scorePhase = state.phase === 'SCORE';
  const ended = state.phase === 'GAME_OVER';
  const canNext = isHost() || psychic;
  const role = spectator ? t.spectatorRole : psychic ? t.yourPsychic : t.teamRole(state.teams[player.team].name);
  let title = t.waitingTitle, description = active ? t.waitingInstruction : t.opponentWaiting;
  if (state.phase === 'PSYCHIC_VIEW') {
    title = psychic ? t.psychicInstruction : t.waitingTitle;
    description = psychic ? t.psychicHint : t.clueWaiting(psychicName);
  }
  if (state.phase === 'TEAM_GUESS') {
    title = psychic ? t.psychicGuess : active ? t.guessTitle : t.opponentGuess;
    description = psychic ? t.psychicGuessHint : active ? t.guessInstruction : t.opponentGuessHint;
  }
  if (state.phase === 'OPPONENT_BET') { title = canBet ? t.betTitle : t.betWaiting; description = canBet ? t.betHint : t.locked; }
  if (state.phase === 'REVEAL') { title = revealed ? t.reveal : t.suspense; description = revealed ? t.revealInstruction : t.suspenseDescription; }
  if (scorePhase) { title = t.hit(round.result?.activePoints || 0); description = t.revealInstruction; }
  if (ended) {
    title = t.gameOver;
    const winner = typeof state.winner === 'number' ? state.teams[state.winner] : state.teams.find(team => team.score === Math.max(...state.teams.map(item => item.score)));
    description = t.winner(winner?.name || t.winningTeam);
  }
  if (practice) {
    if (state.phase === 'PSYCHIC_VIEW') description = t.practicePsychicHint;
    if (state.phase === 'TEAM_GUESS') { title = t.practiceGuessTitle; description = t.practiceGuessHint; }
    if (state.phase === 'OPPONENT_BET') description = t.practiceBetHint;
    setText('#practice-step', t.practiceSteps[state.phase] || '');
    setText('#role-label', t.practiceRoles[state.phase] || t.practiceResultRole);
    setText('#send-clue', `${t.practiceSendClue} →`);
    setText('#lock-button', `${t.practiceLock} →`);
    setText('#rematch-button', `${t.practiceAgain} →`);
  }
  if (!practice) setText('#role-label', role);
  setText('#phase-title', title); setText('#phase-description', description);
  const announcement = `${title}. ${description} ${t.roundPsychic}: ${practice ? t.practicePsychic : psychicName}.`;
  if (app.dataset.announcement !== announcement) { announce(announcement); app.dataset.announcement = announcement; }
  setText('#round-number', `${t.round} ${round.number}`);
  setText('#active-team', t.turnLabel(state.teams[round.activeTeam].name));
  setText('#psychic-label', state.phase === 'PSYCHIC_VIEW' ? t.clueGiver : t.roundPsychic);
  setText('#psychic-name', practice ? t.practicePsychic : psychicName);
  if ($('#psychic-avatar')) { setHidden('#psychic-avatar', Boolean(practice)); replacePreservingFocus($('#psychic-avatar'), practice ? '' : avatarMarkup(psychicPlayer, 'avatar-psychic')); }
  updateSpectrumCard($('.spectrum-poles'), round.spectrum);
  setHidden('#catalog-updated-note', state.phase !== 'PSYCHIC_VIEW' || !round.catalogUpdated);
  setHidden('#spectator-note', !spectator);
  updateSpectatorJoin(spectator);
  setHidden('#pause-banner', !state.paused); setText('#pause-reason', state.pauseReason || t.defaultPauseReason);
  setHidden('#return-lobby', !isHost()); setDisabled('#return-lobby', !online || busy.has('lobby'));
  setHidden('#clue-form', !canClue);
  setHidden('#spectrum-tools', !canClue);
  setText('#replace-spectrum-label', busy.has('replace-spectrum') ? t.changingCard : t.replaceCard);
  $('#replace-spectrum').setAttribute('aria-busy', String(busy.has('replace-spectrum')));
  if ($('#clue-form').dataset.round !== round.id) { $('#clue-input').value = ''; $('#clue-form').dataset.round = round.id; }
  setHidden('#clue-display', !round.clue); setText('#clue-text', round.clue || '');
  setHidden('#guess-controls', !canGuess); setDisabled('#lock-button', !online || busy.has('lock'));
  setHidden('#bet-controls', !canBet); setDisabled('#bet-left', !online || busy.has('bet')); setDisabled('#bet-right', !online || busy.has('bet'));
  setHidden('#round-result', !(scorePhase || ended));
  if (round.result) {
    setText('#active-points', `+${round.result.activePoints}`);
    setText('#points-description', state.teams[round.activeTeam].name);
    setText('#opponent-points', round.result.opponentPoints ? t.bonusDescription(state.teams[1 - round.activeTeam].name, round.result.opponentPoints) : t.noBonus);
    setHidden('#catch-up', !round.result.catchUp || ended);
  }
  setHidden('#overtime-note', !state.overtime || ended);
  setText('#overtime-note', t.overtimeTurns(state.overtimeTurnsRemaining));
  setHidden('#next-button', !scorePhase || !canNext); setDisabled('#next-button', !online || busy.has('next') || state.paused);
  setHidden('#next-waiting', !scorePhase || canNext);
  setHidden('#game-over-controls', !ended); setHidden('#rematch-button', !isHost()); setDisabled('#rematch-button', !online || busy.has('rematch'));
  setHidden('#rematch-waiting', isHost());
  dial.update({ position: state.phase === 'PSYCHIC_VIEW' ? 50 : round.guess, target: state.phase === 'PSYCHIC_VIEW' || revealed ? round.target : undefined, editable: canGuess && online && !busy.has('lock'), canPeek: canClue && online && !busy.has('clue') && !busy.has('replace-spectrum'), psychic, revealed, result: round.result, showNeedle: true, roundId: round.id });
  updateClueControl();
  app.classList.toggle('is-revealed', revealed); app.classList.toggle('is-game-over', ended);
  const previousScores = $('#scoreboard').dataset.scores?.split(',').map(Number);
  replacePreservingFocus($('#scoreboard'), state.teams.map((team, i) => {
    const members = state.players.filter(item => item.team === i);
    const remaining = Math.max(0, state.config.winScore - team.score);
    const winner = ended && state.winner === i;
    const remainingText = ended ? (winner ? t.teamWinner : t.matchFinished) : state.overtime ? t.overtimeRemaining : t.remainingPoints(remaining);
    const nextPsychicId = state.turnOrder?.[i]?.[0];
    const nextPsychic = members.find(item => item.id === nextPsychicId);
    const roster = practice ? `<li class="practice-member"><span class="member-name">${t.practicePlayer}</span><span class="member-role">${t.practiceTitle}</span></li>` : members.map(item => {
      const roles = [item.id === player?.id ? t.you : '', item.id === round.psychicId ? (state.phase === 'PSYCHIC_VIEW' ? t.clueGiver : t.psychic) : '', item.id === state.hostId ? t.host : '', !item.connected ? t.disconnected : ''].filter(Boolean);
      return `<li class="member-with-avatar ${item.connected ? '' : 'member-offline'}${item.id === round.psychicId ? ' member-psychic' : ''}"${item.id === round.psychicId ? ' aria-current="true"' : ''}>${avatarMarkup(item, 'avatar-chip')}<span class="member-name">${esc(item.name)}</span>${roles.length ? `<span class="member-role">${esc(roles.join(' · '))}</span>` : ''}</li>`;
    }).join('');
    const nextTurn = !practice && !ended && nextPsychic ? `<p class="team-next"><span>${t.nextPsychic}</span> <strong>${esc(nextPsychic.name)}</strong></p>` : '';
    return `<section class="score-team team-${i}${round.activeTeam === i ? ' active' : ''}${winner ? ' team-winner' : ''}" aria-label="${esc(team.name)}"><header class="team-heading"><p class="team-kicker">${t.teamNumber(i + 1)}</p><h2>${esc(team.name)}</h2><span class="team-turn">${winner ? t.teamWinner : ended ? t.matchFinished : round.activeTeam === i ? t.activeLabel : t.waitingTurn}</span></header><div class="team-standing"><div class="team-score"><strong>${team.score}</strong><span>/ ${state.config.winScore}</span></div><p class="team-remaining">${esc(remainingText)}</p>${scoreTrackMarkup({ team: i, score: team.score, goal: state.config.winScore, label: t.teamProgress(team.name) })}</div><ul class="team-members" aria-label="${t.players}">${roster}</ul>${nextTurn}</section>`;
  }).join(''));
  if (previousScores) state.teams.forEach((team, i) => { if (team.score > previousScores[i]) $(`.score-team.team-${i} .team-score strong`).classList.add('score-added'); });
  animateScoreTracks($('#scoreboard'), previousScores, state.teams.map(team => team.score));
  $('#scoreboard').dataset.scores = state.teams.map(team => team.score).join(',');
}

function telegramIdentity() { return inTelegram() || account?.identityType === 'telegram' || account?.profile?.identityType === 'telegram'; }

function updateIdentity() {
  const profile = account?.profile;
  const button = $('#account-button');
  if (button) {
    replacePreservingFocus(button, profile ? avatarMarkup(profile, 'avatar-header') : '↗');
    button.setAttribute('aria-label', profile ? `${t.profile}: ${profile.name}` : t.telegramLogin);
    button.classList.toggle('has-profile', Boolean(profile));
  }
  document.querySelectorAll('[data-identity]').forEach(element => {
    const content = profile
      ? `<button class="identity-linked" type="button" data-open-profile>${avatarMarkup(profile, 'avatar-identity')}${esc(profile.name)}${telegramIdentity() ? '<small>Telegram ✓</small>' : ''}</button>`
      : `<button class="telegram-login" type="button" data-telegram-login><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="m3 10 17-7c1-.4 1.5.2 1.3 1.2l-3 15c-.2 1-.8 1.2-1.6.6l-5-3.7-2.4 2.3c-.3.3-.5.4-.7.4l.4-5.1 9.3-8.4c.4-.3-.1-.6-.6-.3L6.2 11.4l-3.1-1c-.8-.3-.8-.8-.1-1.1Z"/></svg>${t.telegramLogin}</button>`;
    replacePreservingFocus(element, content);
  });
  if (collectionDialog?.isConnected) updatePackCards($('#collection-packs', collectionDialog), 'collection');
}

function initializeShell() {
  const nav = $('.site-bar nav');
  const existing = Array.from(nav.children);
  nav.innerHTML = `<button id="account-button" class="account-button" type="button" aria-label="${t.telegramLogin}">↗</button><button id="menu-button" class="menu-button" type="button" aria-label="${t.menu}" aria-haspopup="dialog"><span aria-hidden="true">☰</span></button>`;
  appMenu = document.createElement('dialog');
  appMenu.className = 'app-menu';
  appMenu.setAttribute('aria-labelledby', 'menu-title');
  appMenu.innerHTML = `<div class="dialog-top"><h2 id="menu-title">${t.menu}</h2><button type="button" class="quiet-button" data-menu-close>${t.close} ×</button></div><div data-identity class="menu-identity"></div><div class="menu-actions"><button id="collection-button" type="button">${t.packsShort}<span aria-hidden="true">↗</span></button><button id="participants-button" type="button" hidden>${t.showPlayers}<span aria-hidden="true">↗</span></button></div><div class="menu-preferences"><button id="haptics-button" type="button" aria-pressed="true"></button></div><a class="creator-link" href="https://lordskamp.github.io/">Lordskamp ↗</a>`;
  document.body.append(appMenu);
  for (const button of existing) (button.id === 'sound-button' ? $('.menu-preferences', appMenu) : $('.menu-actions', appMenu)).append(button);
  haptics = new Haptics($('#haptics-button'));
  $('#menu-button').addEventListener('click', () => {
    updateIdentity(); setHidden('#participants-button', !state || Boolean(practice));
    appMenu.showModal(); updateTelegramBack();
  });
  $('#account-button').addEventListener('click', () => account?.profile ? openRanking() : openTelegramLogin());
  $('[data-menu-close]').addEventListener('click', () => appMenu.close());
  appMenu.addEventListener('close', updateTelegramBack);
  $('#collection-button').addEventListener('click', openCollection);
  $('#participants-button').addEventListener('click', openParticipants);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-telegram-login]')) openTelegramLogin();
    if (event.target.closest('[data-open-profile]')) openRanking();
  });
  // Stage instructions remain one tap away while the main action stays prominent.
  const rulesNote = $('.rules-footnote');
  if (rulesNote) rulesNote.textContent = rulesNote.textContent.replace('Перша команда з 10 очками перемагає.', 'Переможну кількість очок обирає ведучий: 5, 10, 15, 20, 25 або 30.');
}

function openCollection() {
  appMenu.close();
  if (collectionDialog?.isConnected) return;
  const dialog = collectionDialog = document.createElement('dialog');
  dialog.className = 'collection-dialog'; dialog.setAttribute('aria-label', t.packsShort);
  dialog.innerHTML = `<div class="dialog-top"><h2>${t.packsShort}</h2><button class="quiet-button" type="button" data-close-collection>${t.close} ×</button></div>${packCatalogMarkup('collection')}`;
  document.body.append(dialog);
  bindPackCards($('#collection-packs', dialog), 'collection');
  $('[data-close-collection]', dialog).addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { collectionDialog = null; dialog.remove(); updateTelegramBack(); });
  updatePackCards($('#collection-packs', dialog), 'collection');
  dialog.showModal(); updateTelegramBack();
}

async function openTelegramLogin() {
  appMenu?.close(); rankingDialog?.close();
  if (loginDialog?.isConnected) return;
  if (inTelegram()) { await refreshAccount({ quiet: false }); openRanking(); return; }
  const dialog = loginDialog = document.createElement('dialog');
  dialog.className = 'login-dialog'; dialog.setAttribute('aria-labelledby', 'login-title');
  dialog.innerHTML = `<div class="dialog-top"><p class="eyebrow">TELEGRAM</p><button type="button" class="quiet-button" data-login-close>${t.close} ×</button></div><h2 id="login-title">${t.telegramLogin}</h2><p class="login-intro">${t.telegramLoginHint}</p><a id="login-bot-link" class="button button-dark" target="_blank" rel="noopener noreferrer" aria-disabled="true">${t.loginPreparing}</a><form id="telegram-login-form"><label for="telegram-login-code">${t.telegramCode}</label><input id="telegram-login-code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" minlength="6" placeholder="000000" required disabled><button class="button" type="submit" id="telegram-login-submit" disabled>${t.loginConfirm} →</button></form><p id="login-error" class="form-error" role="alert" hidden></p><p class="field-note">${t.loginCodeHint}</p>`;
  let challenge = null;
  document.body.append(dialog);
  $('[data-login-close]', dialog).addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { challenge = null; loginDialog = null; dialog.remove(); updateTelegramBack(); });
  dialog.showModal(); updateTelegramBack();
  $('#telegram-login-code', dialog).addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/gu, ''); });
  $('#telegram-login-form', dialog).addEventListener('submit', async event => {
    event.preventDefault();
    if (!challenge || $('#telegram-login-submit', dialog).disabled) return;
    $('#telegram-login-submit', dialog).disabled = true;
    $('#login-error', dialog).hidden = true;
    try {
      const signedIn = await transport.loginTelegram({ loginId: challenge.loginId, secret: challenge.secret, code: $('#telegram-login-code', dialog).value });
      account = { ...account, identityType: signedIn.identityType, profile: signedIn.profile };
      syncEntryIdentity(); updateIdentity();
      const visible = dialog.isConnected;
      challenge = null; if (visible) dialog.close();
      await refreshAccount({ quiet: false });
      if (visible) { haptics?.success(); notice(t.telegramLoggedIn); }
    } catch (error) {
      if (!dialog.isConnected) return;
      $('#login-error', dialog).textContent = errorText(error); $('#login-error', dialog).hidden = false;
      $('#telegram-login-submit', dialog).disabled = false;
    }
  });
  try {
    challenge = await transport.beginTelegramLogin();
    if (!dialog.isConnected) { challenge = null; return; }
    const botURL = new URL(challenge.url);
    if (botURL.protocol !== 'https:' || botURL.hostname !== 't.me') throw { code: 'TELEGRAM_UNAVAILABLE' };
    const link = $('#login-bot-link', dialog);
    link.href = botURL.href; link.removeAttribute('aria-disabled'); link.textContent = `${t.loginOpenBot} ↗`;
    $('#telegram-login-code', dialog).disabled = false; $('#telegram-login-submit', dialog).disabled = false;
  } catch (error) {
    if (!dialog.isConnected) return;
    $('#login-error', dialog).textContent = errorText(error); $('#login-error', dialog).hidden = false;
    $('#login-bot-link', dialog).hidden = true;
  }
}

function updateSpectatorJoin(spectator) {
  let element = $('#spectator-join');
  if (!element) {
    element = document.createElement('div'); element.id = 'spectator-join'; element.className = 'spectator-join';
    $('#spectator-note').after(element);
    element.addEventListener('click', teamEvent);
  }
  const joining = spectator && state.phase !== 'GAME_OVER' && !practice;
  element.hidden = !joining;
  if (!joining) return;
  const counts = state.teams.map((_, index) => state.players.filter(player => player.team === index && player.connected).length);
  const allow = state.config.selfSelect || isHost();
  const buttons = state.teams.map((team, index) => `<button type="button" class="spectator-team" data-team="${index}" ${!online || !allow || counts[index] > counts[1 - index] || busy.has('team') ? 'disabled' : ''}>${esc(team.name)} <span aria-hidden="true">→</span></button>`).join('');
  replacePreservingFocus(element, `<p>${allow ? t.spectatorJoin : t.spectatorHost}</p><div>${buttons}</div>`);
}

function openParticipants() {
  appMenu.close();
  if (!state) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'participants-dialog'; dialog.setAttribute('aria-label', t.showPlayers);
  const playing = state.phase !== 'LOBBY';
  dialog.innerHTML = `<div class="dialog-top"><h2>${t.players}</h2><button class="quiet-button" type="button" data-close-participants>${t.close} ×</button></div><ul class="player-list">${state.players.map(playerMarkup).join('')}</ul>`;
  document.body.append(dialog);
  if (playing) dialog.querySelectorAll('[data-player-team]').forEach(select => {
    const player = state.players.find(item => item.id === select.dataset.playerTeam);
    select.disabled = player?.team != null || state.phase === 'GAME_OVER' || !online;
    if (player?.team == null) select.querySelector('option[value=""]').textContent = t.spectatorRoleShort;
  });
  dialog.addEventListener('change', async event => {
    if (!event.target.matches('[data-player-team]')) return;
    await act({ type: 'team', playerId: event.target.dataset.playerTeam, team: event.target.value === '' ? null : Number(event.target.value) });
    dialog.close();
  });
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-kick]')) { dialog.close(); teamEvent(event); }
  });
  $('[data-close-participants]', dialog).addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { dialog.remove(); updateTelegramBack(); });
  dialog.showModal(); updateTelegramBack();
}

function confirmAction(title, description, buttonLabel, action) {
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog';
  dialog.innerHTML = `<h2>${esc(title)}</h2><p>${esc(description)}</p><div class="confirm-actions"><button class="quiet-button" type="button" data-cancel>${t.cancel}</button><button class="button button-small" type="button" data-confirm>${esc(buttonLabel)} →</button></div>`;
  document.body.append(dialog);
  $('[data-cancel]', dialog).addEventListener('click', () => dialog.close());
  $('[data-confirm]', dialog).addEventListener('click', () => { dialog.close(); action(); });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}
function openRules() { appMenu?.close(); $('#rules').showModal(); updateTelegramBack(); }
$('#rules-button').addEventListener('click', openRules);
$('#rules').addEventListener('close', updateTelegramBack);

function profileMarkup() {
  const profile = account?.profile;
  if (!profile) return `<div class="rating-guest"><p>${t.ratingGuest}</p><button class="telegram-login" type="button" data-telegram-login>${t.telegramLogin} ↗</button></div>`;
  return `<section class="rating-profile" aria-label="${t.ratingYou}">${!telegramIdentity() ? `<p class="nickname-profile-note">${t.nicknameRating}</p>` : ''}<div class="rating-identity">${avatarMarkup(profile, 'avatar-profile rating-avatar')}<div><p class="eyebrow">${t.ratingYou}</p><h3>${esc(profile.name)}</h3></div></div><dl class="rating-stats">${[['wins', t.ratingWins], ['losses', t.ratingLosses], ['played', t.ratingPlayed], ['points', t.ratingPoints]].map(([key, title]) => `<div><dt>${title}</dt><dd>${Number(profile.stats?.[key]) || 0}</dd></div>`).join('')}</dl>${!telegramIdentity() ? `<button class="telegram-login" type="button" data-telegram-login>${t.telegramLogin} ↗</button>` : ''}</section>`;
}

async function loadRanking(dialog) {
  const result = $('#rating-results', dialog);
  const refresh = $('[data-rating-refresh]', dialog);
  refresh.disabled = true; result.innerHTML = `<p class="rating-empty" role="status">${t.ratingLoading}</p>`;
  try {
    const [ranking] = await Promise.all([transport.get('/hvylia/leaderboard'), refreshAccount()]);
    if (!dialog.isConnected) return;
    $('#rating-profile', dialog).innerHTML = profileMarkup();
    $('[data-rating-telegram]', dialog)?.addEventListener('click', () => openTelegram(account?.botUsername));
    const entries = ranking.entries || [];
    if (!entries.length) result.innerHTML = `<p class="rating-empty">${t.ratingEmpty}</p>`;
    else result.innerHTML = `<div class="rating-table-wrap"><table class="rating-table"><thead><tr><th scope="col"><span class="sr-only">${t.ratingRanked}</span>#</th><th scope="col">${t.ratingPlayer}</th><th scope="col">${t.ratingWins}</th><th scope="col">${t.ratingPlayed}</th></tr></thead><tbody>${entries.map((entry, index) => `<tr${entry.publicId === account?.profile?.publicId ? ' class="rating-mine"' : ''}><td>${Number(entry.rank) || index + 1}</td><th scope="row"><span class="rating-person">${avatarMarkup(entry, 'avatar-ranking')}<span class="rating-person-name">${esc(entry.name)}</span></span>${entry.publicId === account?.profile?.publicId ? `<small>${t.you}</small>` : ''}</th><td class="rating-win-count">${Number(entry.wins) || 0}</td><td>${Number(entry.played) || 0}</td></tr>`).join('')}</tbody></table></div>`;
  } catch { if (dialog.isConnected) result.innerHTML = `<p class="rating-empty" role="status">${t.ratingUnavailable}</p>`; }
  finally { if (dialog.isConnected) refresh.disabled = false; }
}

function openRanking() {
  appMenu?.close();
  if (rankingDialog?.isConnected) return;
  const dialog = rankingDialog = document.createElement('dialog');
  dialog.className = 'rating-dialog'; dialog.setAttribute('aria-labelledby', 'rating-title');
  dialog.innerHTML = `<div class="dialog-top"><p class="eyebrow">${t.ratingEyebrow}</p><button type="button" class="quiet-button" data-rating-close>${t.close} ×</button></div><h2 id="rating-title">${t.ratingTitle}</h2><p class="rating-intro">${t.ratingIntro}</p><div id="rating-profile">${profileMarkup()}</div><div class="rating-list-heading"><h3>${t.ratingEyebrow}</h3><button class="text-link" type="button" data-rating-refresh>${t.ratingRefresh} ↻</button></div><div id="rating-results"></div><p class="rating-eligibility">${t.ratingEligible}</p>`;
  document.body.append(dialog);
  $('[data-rating-close]', dialog).addEventListener('click', () => dialog.close());
  $('[data-rating-refresh]', dialog).addEventListener('click', () => loadRanking(dialog));
  $('[data-rating-telegram]', dialog)?.addEventListener('click', () => openTelegram(account?.botUsername));
  dialog.addEventListener('close', () => { rankingDialog = null; dialog.remove(); updateTelegramBack(); });
  dialog.showModal(); updateTelegramBack(); loadRanking(dialog);
}
$('#ranking-button').addEventListener('click', openRanking);
document.querySelectorAll('[data-close-rules]').forEach(button => button.addEventListener('click', () => $('#rules').close()));
$('#rules').addEventListener('click', event => { if (event.target === $('#rules') && (event.clientX < $('#rules').getBoundingClientRect().left || event.clientX > $('#rules').getBoundingClientRect().right || event.clientY < $('#rules').getBoundingClientRect().top || event.clientY > $('#rules').getBoundingClientRect().bottom)) $('#rules').close(); });

async function resumeRoom(resumeCode) {
  const button = $('#enter-button'); button.disabled = true; button.textContent = t.restoring;
  setDisabled('#saved-room-button', true);
  try { await transport.resume(resumeCode); }
  catch (error) {
    if (practice) return;
    if (['INVALID_TOKEN', 'SESSION', 'PLAYER_NOT_FOUND', 'UNAUTHORIZED', 'KICKED', 'ROOM_NOT_FOUND', 'NOT_FOUND'].includes(error.code)) forgetSession(resumeCode);
    notice(errorText(error));
    if ($('#enter-button')) { $('#enter-button').disabled = false; $('#enter-button').textContent = `${entryMode === 'join' ? t.join : t.create} →`; }
    setDisabled('#saved-room-button', false);
  }
}

initializeShell();
render();
telegramReady.then(() => {
  const startRoom = telegramRoomCode();
  if (startRoom && !state && !practice && !inviteCode) {
    inviteCode = startRoom; entryMode = 'join'; screen = ''; render();
    if (savedSession(startRoom)) resumeRoom(startRoom);
  }
  updateTelegramBack(); refreshAccount();
});
if (new URL(window.location.href).searchParams.get('practice') === '1') startPractice();
else {
  const resumeCode = inviteCode || lastRoom();
  if (resumeCode && savedSession(resumeCode)) resumeRoom(resumeCode);
}
