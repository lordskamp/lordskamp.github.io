import { t, errorText } from './locale.js';
import { RoomTransport, savedSession, lastRoom, forgetSession } from './transport.js';
import { Dial, dialMarkup } from './dial.js';
import { Sound } from './sound.js';
import { PracticeSession } from './practice.js';

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
const busy = new Set();

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
function roomURL() { const url = new URL(window.location.href); url.searchParams.set('r', state.code); return url.href; }
function setText(selector, value) { const element = $(selector); if (element && element.textContent !== String(value)) element.textContent = value; }
function setHidden(selector, hidden) { const element = $(selector); if (element) element.hidden = hidden; }
function setDisabled(selector, disabled) { const element = $(selector); if (element) element.disabled = disabled; }

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
  busy.add(key); render();
  try { await activeSession().action(action); return true; }
  catch (error) { notice(errorText(error)); return false; }
  finally { busy.delete(key); render(); }
}
function roundAction(type, extra = {}) { return act({ type, roundId: state.round.id, ...extra }); }

function render() {
  const desired = !state ? 'entry' : state.phase === 'LOBBY' ? 'lobby' : 'game';
  if (screen !== desired) {
    dial?.destroy(); dial = null; screen = desired;
    app.className = `${screen}-screen`;
    if (screen === 'entry') mountEntry();
    if (screen === 'lobby') mountLobby();
    if (screen === 'game') mountGame();
  }
  if (screen === 'lobby') updateLobby();
  if (screen === 'game') updateGame();
  app.dataset.phase = state?.phase || 'ENTRY';
  app.dataset.practice = String(Boolean(practice));
}

function mountEntry() {
  if (inviteCode) entryMode = 'join';
  app.innerHTML = `<section class="entry-intro" aria-labelledby="entry-title"><p class="eyebrow">${t.entryEyebrow}</p><h1 id="entry-title">${t.entryTitle}</h1><p class="entry-description">${t.entryIntro}</p><div class="entry-dial">${dialMarkup('preview-dial')}<div class="preview-poles"><span>${t.previewLeft}</span><span>${t.previewRight}</span></div></div><p class="entry-meta">${t.entryMeta}</p></section>
    <section class="entry-panel" aria-label="${t.joiningLabel}"><div class="entry-tabs" role="tablist" aria-label="${t.actionLabel}"><button type="button" id="create-tab" role="tab" aria-controls="entry-form" class="entry-tab">${t.create}</button><button type="button" id="join-tab" role="tab" aria-controls="entry-form" class="entry-tab">${t.join}</button></div>
    <form id="entry-form" class="entry-form" role="tabpanel" aria-labelledby="entry-form-title"><p class="eyebrow" id="entry-form-context">${t.entryStart}</p><h2 id="entry-form-title"></h2><label for="nickname">${t.nickname}</label><input id="nickname" name="name" minlength="2" maxlength="24" required autocomplete="nickname" placeholder="${t.nicknamePlaceholder}"><div id="room-code-field"><label for="room-code">${t.code}</label><input id="room-code" name="code" maxlength="4" minlength="4" pattern="[A-Za-z0-9]{4}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7FM" value="${esc(inviteCode)}"><p class="field-note">${t.enterCode}</p></div><p id="entry-error" class="form-error" role="alert" hidden></p><button id="enter-button" type="submit" class="button"></button></form><p class="entry-note">${t.entryNote}</p><button class="text-link" type="button" data-open-rules>${t.firstTime}</button></section>`;
  dial = new Dial($('#preview-dial'), () => {});
  dial.update({ position: 63, target: 67, revealed: true });
  $('#preview-dial').setAttribute('role', 'img');
  ['aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'aria-valuetext', 'aria-disabled'].forEach(name => $('#preview-dial').removeAttribute(name));
  $('#preview-dial').setAttribute('aria-label', t.previewLabel);
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
    $('#room-code').required = joining;
    setHidden('#entry-error', true);
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
    const name = $('#nickname').value.trim();
    const code = entryMode === 'join' ? $('#room-code').value.toUpperCase().trim() : null;
    const button = $('#enter-button');
    button.disabled = true; button.textContent = code ? t.joinBusy : t.createBusy;
    setHidden('#entry-error', true);
    try { await transport.enter(name, code); }
    catch (error) {
      if (!$('#entry-error')) return;
      setText('#entry-error', errorText(error)); setHidden('#entry-error', false);
      button.disabled = false; button.textContent = `${code ? t.join : t.create} →`;
    }
  });
  const practiceStart = document.createElement('div');
  practiceStart.className = 'practice-start';
  practiceStart.innerHTML = `<button id="practice-button" class="button button-outline" type="button">${t.practiceStart} →</button><p class="field-note">${t.practiceEntryHint}</p>`;
  $('.entry-note').before(practiceStart);
  $('#practice-button').addEventListener('click', startPractice);
  const previousRoom = lastRoom();
  if (previousRoom && savedSession(previousRoom)) {
    const resume = document.createElement('button');
    resume.type = 'button'; resume.className = 'text-link'; resume.id = 'saved-room-button';
    resume.textContent = `${t.reconnect} ${previousRoom} →`;
    practiceStart.append(resume);
    resume.addEventListener('click', () => resumeRoom(previousRoom));
  }
  $('[data-open-rules]').addEventListener('click', openRules);
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
  return `<li data-player-id="${esc(player.id)}" class="player-row${player.connected ? '' : ' player-offline'}"><div class="player-name"><span>${esc(player.name)}</span>${mine ? `<small>${t.you}</small>` : ''}${player.id === state.hostId ? `<small class="host-label">${t.host}</small>` : ''}</div><span class="player-state${player.ready && player.connected ? ' is-ready' : ''}">${player.connected ? (player.ready ? `✓ ${t.ready}` : t.notReady) : t.disconnected}</span>${isHost() ? `<div class="player-controls"><select aria-label="${t.movePlayer}: ${esc(player.name)}" data-player-team="${esc(player.id)}" data-focus-key="team-${esc(player.id)}" ${!online ? 'disabled' : ''}><option value="" ${player.team == null ? 'selected' : ''}>${t.noTeam}</option>${state.teams.map((team, i) => `<option value="${i}" ${player.team === i ? 'selected' : ''}>${esc(team.name)}</option>`).join('')}</select>${!mine ? `<button type="button" class="kick-button" aria-label="${t.removePlayer}: ${esc(player.name)}" data-kick="${esc(player.id)}" ${!online ? 'disabled' : ''}>×</button>` : ''}</div>` : ''}</li>`;
}
function replacePreservingFocus(element, markup) {
  if (element.dataset.markup === markup) return;
  const focused = element.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
  element.innerHTML = markup; element.dataset.markup = markup;
  if (focused) Array.from(element.querySelectorAll('[data-focus-key]')).find(item => item.dataset.focusKey === focused)?.focus({ preventScroll: true });
}
function updateLobby() {
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
  app.innerHTML = `${roomHeading()}<div class="game-layout"><div id="scoreboard" class="scoreboard" aria-label="${t.scoreboardLabel}"></div><section class="game-stage" aria-labelledby="phase-title"><div class="round-meta"><span id="round-number"></span><span id="active-team"></span><span id="psychic-name"></span></div><div id="pause-banner" class="pause-banner" role="status" hidden><strong>${t.pause}</strong><p id="pause-reason"></p><button id="return-lobby" class="text-link" type="button">${t.returnLobby} →</button></div><header class="phase-heading"><p class="eyebrow" id="role-label"></p><h1 id="phase-title"></h1><p class="phase-description" id="phase-description"></p></header><p id="spectator-note" class="spectator-note" hidden>${t.spectatorNote}</p><div class="game-dial">${dialMarkup()}<div class="spectrum-poles"><h2 id="spectrum-left"></h2><span aria-hidden="true">↔</span><h2 id="spectrum-right"></h2></div></div><div class="round-content"><p id="clue-display" class="clue-display" hidden><span>${t.clue}</span><strong id="clue-text"></strong></p><form id="clue-form" class="clue-form" hidden><label class="sr-only" for="clue-input">${t.clueLabel}</label><input id="clue-input" name="clue" maxlength="120" required placeholder="${t.cluePlaceholder}" autocomplete="off"><button class="button" type="submit" id="send-clue">${t.sendClue} →</button><p class="field-note">${t.clueNote}</p></form><div id="guess-controls" class="guess-controls" hidden><p class="field-note">${t.guessHint}</p><button id="lock-button" class="button" type="button">${t.lock} →</button></div><div id="bet-controls" class="bet-controls" hidden><button id="bet-left" class="button button-outline" type="button">← ${t.left}</button><button id="bet-right" class="button button-outline" type="button">${t.right} →</button></div><div id="round-result" class="round-result" hidden><div class="result-points"><strong id="active-points"></strong><span id="points-description"></span></div><p id="opponent-points"></p><p id="catch-up" class="catch-up" hidden>${t.catchUp}</p><p id="overtime-note" hidden>${t.overtime}</p><button id="next-button" class="button" type="button">${t.next} →</button><p id="next-waiting" class="field-note" hidden>${t.nextWaiting}</p></div><div id="game-over-controls" class="game-over-controls" hidden><button id="rematch-button" class="button" type="button">${t.rematch} →</button><p id="rematch-waiting" class="field-note" hidden>${t.rematchWaiting}</p></div></div></section></div>`;
  bindRoomTools();
  dial = new Dial($('#dial'), position => {
    if (state?.phase !== 'TEAM_GUESS' || !online) return;
    sound.play('move');
    activeSession().action({ type: 'move', position, roundId: state.round.id }).catch(error => { if (online) notice(errorText(error)); });
  });
  $('#dial').addEventListener('shutterchange', updateClueControl);
  $('#clue-form').addEventListener('submit', event => {
    event.preventDefault();
    if ($('#dial').dataset.shutter !== 'open') return;
    roundAction('clue', { text: $('#clue-input').value.trim() });
  });
  $('#lock-button').addEventListener('click', () => roundAction('lock', { position: dial.position }));
  $('#bet-left').addEventListener('click', () => roundAction('bet', { side: 'left' }));
  $('#bet-right').addEventListener('click', () => roundAction('bet', { side: 'right' }));
  $('#next-button').addEventListener('click', () => roundAction('next'));
  $('#rematch-button').addEventListener('click', () => act({ type: 'rematch' }));
  $('#return-lobby').addEventListener('click', () => confirmAction(t.returnLobbyTitle, t.returnLobbyDescription, t.returnLabel, () => act({ type: 'lobby' })));
}

function updateClueControl() {
  setDisabled('#send-clue', !online || busy.has('clue') || $('#dial')?.dataset.shutter !== 'open');
}

function updateGame() {
  const round = state.round;
  if (!round) return;
  const player = me();
  const psychic = player?.id === round.psychicId;
  const active = player?.team === round.activeTeam;
  const spectator = player?.team == null;
  const psychicName = state.players.find(item => item.id === round.psychicId)?.name || t.psychic;
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
  const announcement = `${title}. ${description}`;
  if (app.dataset.announcement !== announcement) { announce(announcement); app.dataset.announcement = announcement; }
  setText('#round-number', `${t.round} ${round.number}`);
  setText('#active-team', t.turnLabel(state.teams[round.activeTeam].name));
  setText('#psychic-name', `${t.psychic}: ${psychicName}`);
  setHidden('#psychic-name', Boolean(practice));
  setText('#spectrum-left', round.spectrum.left); setText('#spectrum-right', round.spectrum.right);
  $('.spectrum-poles').classList.toggle('is-long', Math.max(round.spectrum.left.length, round.spectrum.right.length) > 25);
  setHidden('#spectator-note', !spectator);
  setHidden('#pause-banner', !state.paused); setText('#pause-reason', state.pauseReason || t.defaultPauseReason);
  setHidden('#return-lobby', !isHost()); setDisabled('#return-lobby', !online || busy.has('lobby'));
  setHidden('#clue-form', !canClue); setDisabled('#send-clue', !online || busy.has('clue'));
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
  setHidden('#next-button', !scorePhase || !canNext); setDisabled('#next-button', !online || busy.has('next') || state.paused);
  setHidden('#next-waiting', !scorePhase || canNext);
  setHidden('#game-over-controls', !ended); setHidden('#rematch-button', !isHost()); setDisabled('#rematch-button', !online || busy.has('rematch'));
  setHidden('#rematch-waiting', isHost());
  dial.update({ position: round.guess, target: state.phase === 'PSYCHIC_VIEW' || revealed ? round.target : undefined, editable: canGuess && online && !busy.has('lock'), psychic, revealed, result: round.result, showNeedle: state.phase !== 'PSYCHIC_VIEW', roundId: round.id });
  updateClueControl();
  app.classList.toggle('is-revealed', revealed); app.classList.toggle('is-game-over', ended);
  const previousScores = $('#scoreboard').dataset.scores?.split(',').map(Number);
  replacePreservingFocus($('#scoreboard'), state.teams.map((team, i) => {
    const members = state.players.filter(item => item.team === i);
    const remaining = Math.max(0, state.config.winScore - team.score);
    const winner = ended && state.winner === i;
    const remainingText = winner ? t.teamWinner : state.overtime && !ended ? t.overtimeRemaining : t.remainingPoints(remaining);
    const roster = practice ? `<li class="practice-member"><span class="member-name">${t.practicePlayer}</span><span class="member-role">${t.practiceTitle}</span></li>` : members.map(item => {
      const roles = [item.id === player?.id ? t.you : '', item.id === round.psychicId ? t.psychic : '', item.id === state.hostId ? t.host : '', !item.connected ? t.disconnected : ''].filter(Boolean);
      return `<li class="${item.connected ? '' : 'member-offline'}"><span class="member-name">${esc(item.name)}</span>${roles.length ? `<span class="member-role">${esc(roles.join(' · '))}</span>` : ''}</li>`;
    }).join('');
    const progress = Math.min(100, team.score / state.config.winScore * 100);
    return `<section class="score-team team-${i}${round.activeTeam === i ? ' active' : ''}${winner ? ' team-winner' : ''}" aria-label="${esc(team.name)}"><header class="team-heading"><p class="team-kicker">${t.teamNumber(i + 1)}</p><h2>${esc(team.name)}</h2><span class="team-turn">${winner ? t.teamWinner : ended ? t.matchFinished : round.activeTeam === i ? t.activeLabel : t.waitingTurn}</span></header><div class="team-score"><strong>${team.score}</strong><span>/ ${state.config.winScore}</span></div><p class="team-remaining">${esc(remainingText)}</p><div class="team-progress" role="progressbar" aria-label="${esc(t.teamProgress(team.name))}" aria-valuemin="0" aria-valuemax="${state.config.winScore}" aria-valuenow="${Math.min(team.score, state.config.winScore)}" aria-valuetext="${esc(t.teamProgressValue(team.score, state.config.winScore))}"><i style="width:${progress}%"></i></div><ul class="team-members" aria-label="${t.players}">${roster}</ul></section>`;
  }).join(''));
  if (previousScores) state.teams.forEach((team, i) => { if (team.score > previousScores[i]) $(`.score-team.team-${i} .team-score strong`).classList.add('score-added'); });
  $('#scoreboard').dataset.scores = state.teams.map(team => team.score).join(',');
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
function openRules() { $('#rules').showModal(); }
$('#rules-button').addEventListener('click', openRules);
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

render();
if (new URL(window.location.href).searchParams.get('practice') === '1') startPractice();
else {
  const resumeCode = inviteCode || lastRoom();
  if (resumeCode && savedSession(resumeCode)) resumeRoom(resumeCode);
}
