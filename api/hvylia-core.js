import { SPECTRA } from '../content/hvylia/spectra.js';
import { PACKS } from '../content/hvylia/packs.js';

export { SPECTRA };

export const GAME_CONFIG = Object.freeze({
  defaultWinScore: 10,
  winScores: Object.freeze([5, 10, 15, 20, 25, 30]),
  sectorHalfWidths: Object.freeze([2, 6, 10]),
  presenceGraceMs: 30_000,
  revealDelayMs: 700,
  scoreDelayMs: 1_200,
  maxPlayers: 24,
  maxNameLength: 24,
  maxClueLength: 120
});

const PRE_REVEAL_PHASES = new Set(['PSYCHIC_VIEW', 'TEAM_GUESS', 'OPPONENT_BET']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function cleanText(value, maxLength, label) {
  if (typeof value !== 'string') fail('INVALID', `Вкажіть ${label}.`);
  const text = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!text || Array.from(text).length > maxLength || /\p{Cc}/u.test(text)) {
    fail('INVALID', `${label[0].toLocaleUpperCase('uk-UA')}${label.slice(1)} має містити від 1 до ${maxLength} символів.`);
  }
  return text;
}

function playerRecord(player, now = Date.now()) {
  if (!player || typeof player.id !== 'string' || !player.id || player.id.length > 128) {
    fail('INVALID', 'Не вдалося визначити гравця.');
  }
  return {
    id: player.id,
    name: cleanText(player.name, GAME_CONFIG.maxNameLength, 'ім’я'),
    team: null,
    connected: player.connected !== false,
    ready: false,
    ...(player._accountId ? { _accountId: player._accountId } : {}),
    ...(player.connected === false ? { disconnectedAt: now } : {})
  };
}

function connectedTeam(state, team) {
  return state.players.filter(player => player.team === team && player.connected);
}

function refreshPause(state) {
  state.paused = false;
  state.pauseReason = '';
  if (state.phase === 'LOBBY' || state.phase === 'GAME_OVER' || !state.round) return;
  const active = connectedTeam(state, state.round.activeTeam);
  const opponent = connectedTeam(state, 1 - state.round.activeTeam);
  if (!active.length || !opponent.length) {
    state.paused = true;
    state.pauseReason = 'Чекаємо на повернення гравців: у кожній команді має бути хоча б один учасник.';
  } else if (PRE_REVEAL_PHASES.has(state.phase) && !active.some(player => player.id === state.round.psychicId)) {
    state.paused = true;
    state.pauseReason = 'Чекаємо на повернення Телепата.';
  } else if (['PSYCHIC_VIEW', 'TEAM_GUESS'].includes(state.phase) && active.length < 2) {
    state.paused = true;
    state.pauseReason = 'Для ходу потрібні Телепат і ще один учасник команди.';
  }
}

function finishMutation(state, now = Date.now()) {
  state.revision += 1;
  state.updatedAt = now;
  refreshPause(state);
  return state;
}

function draw(random) {
  const number = random();
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number >= 1) {
    fail('RANDOM', 'Не вдалося підготувати раунд. Спробуйте ще раз.');
  }
  return number;
}

function drawTarget(random, previousTarget = null) {
  // Give every digital position the same chance, including the two extremes.
  // On a card swap, skip the previous position so the target always changes.
  const previous = previousTarget === null ? null : Math.round(previousTarget * 10);
  let position = Math.floor(draw(random) * (previous === null ? 1001 : 1000));
  if (previous !== null && position >= previous) position += 1;
  return position / 10;
}

function choosePsychic(state, team, excludedId = null, readyOnly = false) {
  const players = connectedTeam(state, team);
  if (!players.length) return null;
  const last = state._rotation[team];
  const all = state.players.filter(player => player.team === team);
  const start = all.findIndex(player => player.id === last);
  for (let offset = 1; offset <= all.length; offset += 1) {
    const player = all[(start + offset + all.length) % all.length];
    if (player.connected && player.id !== excludedId && (!readyOnly || player.ready)) return player.id;
  }
  return null;
}

function psychicTurnOrder(state, team) {
  const all = state.players.filter(player => player.team === team);
  const start = all.findIndex(player => player.id === state._rotation[team]);
  const order = [];
  for (let offset = 1; offset <= all.length; offset += 1) {
    const player = all[(start + offset + all.length) % all.length];
    if (player.connected) order.push(player.id);
  }
  return order;
}

function drawSpectrum(state, random, spectra, replaceCurrent = false) {
  if (!spectra.length) fail('CONTENT', 'Набір спектрів тимчасово недоступний.');
  const eligible = replaceCurrent ? spectra.filter(spectrum => spectrum.id !== state.round?.spectrum.id) : spectra;
  if (!eligible.length) fail('CONTENT', 'У цьому наборі немає іншої картки для заміни.');
  let available = eligible.filter(spectrum => !state._usedSpectra.includes(spectrum.id));
  if (!available.length) {
    state._usedSpectra = [];
    available = eligible.filter(spectrum => spectrum.id !== state.round?.spectrum.id);
    if (!available.length) available = eligible;
  }
  const spectrum = available[Math.floor(draw(random) * available.length)];
  state._usedSpectra.push(spectrum.id);
  return { id: spectrum.id, left: spectrum.left, right: spectrum.right };
}

function dealRound(state, team, random, { number, excludePsychic = null, readyOnly = false } = {}, spectra = SPECTRA) {
  const psychicId = choosePsychic(state, team, excludePsychic, readyOnly);
  if (!psychicId) return false;
  const spectrum = drawSpectrum(state, random, spectra);
  // The original rules allow a partly visible four-point wedge at either extreme.
  // Keep its center on the digital spectrum; the outer wedges can be clipped.
  const target = drawTarget(random);
  state._roundSerial += 1;
  state._rotation[team] = psychicId;
  state.round = {
    id: `${state.code}-${state._roundSerial}`,
    number: number ?? (state.round?.number || 0) + 1,
    activeTeam: team,
    psychicId,
    spectrum,
    target,
    guess: 50,
    clue: '',
    bet: null,
    result: null,
    revealed: false
  };
  state.phase = 'PSYCHIC_VIEW';
  return true;
}

function recoverPresence(state, now, random, spectra = SPECTRA) {
  const departed = state.players.filter(player => !player.connected && !player._recovered
    && now - player.disconnectedAt >= GAME_CONFIG.presenceGraceMs);
  for (const player of departed) {
    player._recovered = true;
    player.ready = false;
  }
  const host = state.players.find(player => player.id === state.hostId);
  if (!host || (!host.connected && host._recovered)) {
    state.hostId = state.players.find(player => player.connected)?.id ?? state.hostId;
  }
  const psychic = state.players.find(player => player.id === state.round?.psychicId);
  if (state.round && PRE_REVEAL_PHASES.has(state.phase) && (!psychic || psychic._recovered)) {
    dealRound(state, state.round.activeTeam, random, { number: state.round.number, excludePsychic: state.round.psychicId }, spectra);
  }
  refreshPause(state);
}

export function createRoom(code, hostPlayer, now = Date.now()) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/u.test(normalizedCode)) fail('INVALID_CODE', 'Код кімнати має містити від 4 до 6 латинських літер або цифр.');
  const host = playerRecord(hostPlayer, now);
  return {
    code: normalizedCode,
    phase: 'LOBBY',
    revision: 0,
    hostId: host.id,
    players: [host],
    teams: [{ name: 'Команда 1', score: 0 }, { name: 'Команда 2', score: 0 }],
    config: { winScore: GAME_CONFIG.defaultWinScore, selfSelect: true, packId: 'standard', ranked: false },
    round: null,
    overtime: false,
    winner: null,
    paused: false,
    pauseReason: '',
    createdAt: now,
    updatedAt: now,
    _rotation: [null, null],
    _overtimeTurns: null,
    _usedSpectra: [],
    _roundSerial: 0,
    _kickedIds: []
  };
}

export function addPlayer(state, player) {
  const record = playerRecord(player);
  if (state._kickedIds.includes(record.id)) fail('KICKED', 'Ведучий видалив вас із цієї кімнати.');
  if (state.players.some(existing => existing.id === record.id)) fail('PLAYER_EXISTS', 'Цей гравець уже є в кімнаті.');
  if (state.players.length >= GAME_CONFIG.maxPlayers) fail('PLAYER_LIMIT', 'У кімнаті вже 24 гравці.');
  if (state.players.some(existing => existing.name.toLocaleLowerCase('uk-UA') === record.name.toLocaleLowerCase('uk-UA'))) {
    fail('NAME_TAKEN', 'Це ім’я вже зайняте. Оберіть інше.');
  }
  const next = structuredClone(state);
  next.players.push(record);
  return finishMutation(next);
}

export function scoreGuess(target, guess, bet) {
  const distance = Math.abs(target - guess);
  // Decimal dial positions can subtract to e.g. 6.000000000000002 at a sector boundary.
  const tolerance = Number.EPSILON * 100;
  const [center, middle, outer] = GAME_CONFIG.sectorHalfWidths;
  const activePoints = distance <= center + tolerance ? 4 : distance <= middle + tolerance ? 3 : distance <= outer + tolerance ? 2 : 0;
  const side = target < guess ? 'left' : target > guess ? 'right' : null;
  return { activePoints, opponentPoints: activePoints !== 4 && side !== null && bet === side ? 1 : 0 };
}

function scoreRound(state) {
  const round = state.round;
  const result = scoreGuess(round.target, round.guess, round.bet);
  state.teams[round.activeTeam].score += result.activePoints;
  state.teams[1 - round.activeTeam].score += result.opponentPoints;
  const scores = state.teams.map(team => team.score);
  round.result = {
    ...result,
    catchUp: !state.overtime && result.activePoints === 4 && scores[round.activeTeam] < scores[1 - round.activeTeam]
  };
  round.revealed = true;
  if (state.overtime) {
    // Every tie-break consists of one turn for BOTH teams before comparing scores.
    // Missing bookkeeping in a previously stored room begins a fresh fair pair.
    state._overtimeTurns ??= [false, false];
    state._overtimeTurns[round.activeTeam] = true;
    if (state._overtimeTurns.every(Boolean)) {
      if (scores[0] !== scores[1]) {
        state.winner = scores[0] > scores[1] ? 0 : 1;
        state.phase = 'GAME_OVER';
        return;
      }
      state._overtimeTurns = [false, false];
    }
    state.phase = 'SCORE';
    return;
  }
  if (Math.max(...scores) >= state.config.winScore) {
    if (scores[0] === scores[1]) {
      state.overtime = true;
      state._overtimeTurns = [false, false];
    } else {
      state.winner = scores[0] > scores[1] ? 0 : 1;
      state.phase = 'GAME_OVER';
      return;
    }
  }
  state.phase = 'SCORE';
}

function phaseIs(state, ...phases) {
  if (!phases.includes(state.phase)) fail('PHASE', 'Цю дію зараз виконати не можна.');
}

function isHost(state, player) {
  if (state.hostId !== player.id) fail('ROLE', 'Цю дію може виконати лише ведучий.');
}

function roundIs(state, action) {
  if (!state.round || typeof action.roundId !== 'string' || action.roundId !== state.round.id) {
    fail('STALE', 'Раунд уже змінився. Оновіть стан кімнати.');
  }
}

function positionIs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    fail('INVALID', 'Позиція стрілки має бути між 0 та 100.');
  }
  return Math.round(value * 10) / 10;
}

export function applyAction(state, playerId, action, random = Math.random, spectra = SPECTRA) {
  if (!action || typeof action.type !== 'string') fail('INVALID', 'Не вдалося розпізнати дію.');
  const next = structuredClone(state);
  if (action.type === 'advance') {
    if (playerId !== null) fail('ROLE', 'Перехід до результатів виконує сервер.');
    if (typeof action.now !== 'number' || !Number.isFinite(action.now)) fail('INVALID', 'Не вдалося визначити час відкриття.');
    if (next.phase !== 'REVEAL' || next.round.result || action.now < next.round.revealAt) return next;
    if (action.now >= next.round.revealAt + GAME_CONFIG.scoreDelayMs) scoreRound(next);
    else if (!next.round.revealed) next.round.revealed = true;
    else return next;
    return finishMutation(next, action.now);
  }
  const player = next.players.find(existing => existing.id === playerId);
  if (!player) fail('PLAYER_NOT_FOUND', 'Ви більше не є учасником цієї кімнати.');
  if (!player.connected) fail('DISCONNECTED', 'Підключення втрачено. Зачекайте на відновлення.');
  if (['replace-spectrum', 'clue', 'move', 'lock', 'bet', 'next'].includes(action.type)) {
    roundIs(next, action);
    if (next.paused) fail('PAUSED', next.pauseReason);
  }
  switch (action.type) {
    case 'team': {
      phaseIs(next, 'LOBBY', 'PSYCHIC_VIEW', 'TEAM_GUESS', 'OPPONENT_BET', 'REVEAL', 'SCORE');
      const id = action.playerId ?? playerId;
      if (id !== playerId || !next.config.selfSelect) isHost(next, player);
      const target = next.players.find(existing => existing.id === id);
      if (!target) fail('PLAYER_NOT_FOUND', 'Цього гравця вже немає в кімнаті.');
      if (action.team !== null && action.team !== 0 && action.team !== 1) fail('INVALID', 'Оберіть одну з двох команд.');
      if (target.team === action.team) return next;
      if (next.phase !== 'LOBBY') {
        if (target.team !== null || action.team === null) fail('TEAM_LOCKED', 'Під час гри учасники залишаються у своїх командах.');
        if (!target.connected) fail('DISCONNECTED', 'Спершу дочекайтеся підключення цього гравця.');
        if (connectedTeam(next, action.team).length > connectedTeam(next, 1 - action.team).length) {
          fail('TEAM_BALANCE', 'Приєднайтеся до меншої команди, щоб кількість гравців була рівною.');
        }
      }
      target.team = action.team;
      target.ready = next.phase !== 'LOBBY';
      // Joining normally leaves the current turn untouched. It can also unblock
      // recovery when the departed psychic had no teammate available before.
      if (next.phase !== 'LOBBY') recoverPresence(next, Date.now(), random, spectra);
      break;
    }
    case 'ready':
      phaseIs(next, 'LOBBY');
      if (player.team === null) fail('INVALID', 'Спершу оберіть команду.');
      if (typeof action.ready !== 'boolean') fail('INVALID', 'Не вдалося змінити готовність.');
      if (player.ready === action.ready) return next;
      player.ready = action.ready;
      break;
    case 'settings':
      isHost(next, player);
      phaseIs(next, 'LOBBY');
      if (action.teamNames !== undefined) {
        if (!Array.isArray(action.teamNames) || action.teamNames.length !== 2) fail('INVALID', 'Вкажіть назви обох команд.');
        next.teams.forEach((team, index) => { team.name = cleanText(action.teamNames[index], 28, 'назву команди'); });
      }
      if (action.winScore !== undefined) {
        if (!GAME_CONFIG.winScores.includes(action.winScore)) fail('INVALID', 'Оберіть 5, 10, 15, 20, 25 або 30 очок для перемоги.');
        next.config.winScore = action.winScore;
      }
      if (action.packId !== undefined) {
        if (!PACKS.some(pack => pack.id === action.packId)) fail('INVALID', 'Оберіть доступний пак карток.');
        if (next.config.packId !== action.packId) next._usedSpectra = [];
        next.config.packId = action.packId;
      }
      if (action.selfSelect !== undefined) {
        if (typeof action.selfSelect !== 'boolean') fail('INVALID', 'Не вдалося змінити вибір команд.');
        next.config.selfSelect = action.selfSelect;
      }
      break;
    case 'randomize': {
      isHost(next, player);
      phaseIs(next, 'LOBBY');
      const players = next.players.filter(existing => existing.connected);
      const previousTeams = new Map(players.map(existing => [existing.id, existing.team]));
      const split = Math.ceil(players.length / 2);
      const sameGrouping = () => {
        if (players.length < 4 || players.some(existing => previousTeams.get(existing.id) === null)) return false;
        const unchanged = players.every((existing, index) => previousTeams.get(existing.id) === (index < split ? 0 : 1));
        const reversed = players.every((existing, index) => previousTeams.get(existing.id) === (index < split ? 1 : 0));
        return unchanged || reversed;
      };
      for (let attempt = 0; attempt < 8; attempt += 1) {
        for (let index = players.length - 1; index > 0; index -= 1) {
          const other = Math.floor(draw(random) * (index + 1));
          [players[index], players[other]] = [players[other], players[index]];
        }
        if (!sameGrouping()) break;
      }
      // A bounded fallback also handles a deterministic random source: swap
      // one member from each half rather than just renaming the same teams.
      if (sameGrouping()) [players[0], players[split]] = [players[split], players[0]];
      next.players.forEach(existing => { existing.team = null; existing.ready = false; });
      players.forEach((existing, index) => { existing.team = index < split ? 0 : 1; });
      break;
    }
    case 'kick': {
      isHost(next, player);
      if (action.playerId === playerId) fail('INVALID', 'Щоб вийти, скористайтеся кнопкою виходу з кімнати.');
      const index = next.players.findIndex(existing => existing.id === action.playerId);
      if (index < 0) fail('PLAYER_NOT_FOUND', 'Цього гравця вже немає в кімнаті.');
      next._kickedIds.push(action.playerId);
      next.players.splice(index, 1);
      recoverPresence(next, Date.now(), random, spectra);
      break;
    }
    case 'start': {
      isHost(next, player);
      phaseIs(next, 'LOBBY');
      if ([0, 1].some(team => connectedTeam(next, team).filter(existing => existing.ready).length < 2)) {
        fail('NOT_READY', 'Для старту потрібні щонайменше два готові гравці в кожній команді.');
      }
      const firstTeam = Math.floor(draw(random) * 2);
      next.teams.forEach((team, index) => { team.score = index === firstTeam ? 0 : 1; });
      dealRound(next, firstTeam, random, { readyOnly: true }, spectra);
      break;
    }
    case 'replace-spectrum':
      phaseIs(next, 'PSYCHIC_VIEW');
      if (player.id !== next.round.psychicId) fail('ROLE', 'Картку може замінити лише Телепат.');
      next.round.spectrum = drawSpectrum(next, random, spectra, true);
      next.round.target = drawTarget(random, next.round.target);
      next._roundSerial += 1;
      next.round.id = `${next.code}-${next._roundSerial}`;
      break;
    case 'clue':
      phaseIs(next, 'PSYCHIC_VIEW');
      if (player.id !== next.round.psychicId) fail('ROLE', 'Підказку дає лише Телепат.');
      next.round.clue = cleanText(action.text, GAME_CONFIG.maxClueLength, 'підказку');
      next.phase = 'TEAM_GUESS';
      break;
    case 'move':
    case 'lock':
      phaseIs(next, 'TEAM_GUESS');
      if (player.team !== next.round.activeTeam || player.id === next.round.psychicId) fail('ROLE', 'Стрілку обирає команда, а Телепат чекає.');
      next.round.guess = positionIs(action.position);
      if (action.type === 'lock') next.phase = 'OPPONENT_BET';
      else if (next.round.guess === state.round.guess) return next;
      break;
    case 'bet':
      phaseIs(next, 'OPPONENT_BET');
      if (player.team !== 1 - next.round.activeTeam) fail('ROLE', 'Сторону цілі обирають суперники.');
      if (!['left', 'right'].includes(action.side)) fail('INVALID', 'Оберіть «Ліворуч» або «Праворуч».');
      next.round.bet = action.side;
      next.round.revealAt = Date.now() + GAME_CONFIG.revealDelayMs;
      next.phase = 'REVEAL';
      break;
    case 'next': {
      phaseIs(next, 'SCORE');
      if (player.id !== next.hostId && player.id !== next.round.psychicId) fail('ROLE', 'Наступний раунд починає ведучий або Телепат.');
      const team = next.round.result.catchUp ? next.round.activeTeam : 1 - next.round.activeTeam;
      if (connectedTeam(next, team).length < 2 || !connectedTeam(next, 1 - team).length) {
        fail('NOT_READY', 'Для наступного раунду потрібні двоє гравців у команді, що ходить, і хоча б один суперник.');
      }
      dealRound(next, team, random, { excludePsychic: next.round.result.catchUp ? next.round.psychicId : null }, spectra);
      break;
    }
    case 'lobby':
    case 'rematch':
      isHost(next, player);
      if (action.type === 'rematch') phaseIs(next, 'GAME_OVER');
      next.phase = 'LOBBY';
      next.config.ranked = false;
      next._ratedRoster = null;
      next.round = null;
      next.winner = null;
      next.overtime = false;
      next._overtimeTurns = null;
      next.teams.forEach(team => { team.score = 0; });
      next.players.forEach(existing => { existing.ready = false; });
      next._rotation = [null, null];
      next._usedSpectra = [];
      break;
    case 'leave':
      next.players = next.players.filter(existing => existing.id !== playerId);
      recoverPresence(next, Date.now(), random, spectra);
      break;
    default:
      fail('INVALID', 'Такої дії немає.');
  }
  return finishMutation(next);
}

export function setConnection(state, playerId, connected, now = Date.now()) {
  if (typeof connected !== 'boolean') fail('INVALID', 'Не вдалося змінити підключення.');
  const next = structuredClone(state);
  const player = next.players.find(existing => existing.id === playerId);
  if (!player) fail('PLAYER_NOT_FOUND', 'Ви більше не є учасником цієї кімнати.');
  if (player.connected === connected) return next;
  player.connected = connected;
  if (connected) {
    delete player.disconnectedAt;
    delete player._recovered;
    if (!next.players.some(existing => existing.id === next.hostId && existing.connected)) {
      const host = next.players.find(existing => existing.id === next.hostId);
      if (!host || host._recovered) next.hostId = player.id;
    }
  } else player.disconnectedAt = now;
  return finishMutation(next, now);
}

export function recoverDisconnected(state, now = Date.now(), random = Math.random, spectra = SPECTRA) {
  const next = structuredClone(state);
  recoverPresence(next, now, random, spectra);
  if (JSON.stringify(next) === JSON.stringify(state)) return next;
  return finishMutation(next, now);
}

export function viewFor(state, playerId) {
  const player = state.players.find(existing => existing.id === playerId);
  const round = state.round ? {
    id: state.round.id,
    number: state.round.number,
    activeTeam: state.round.activeTeam,
    psychicId: state.round.psychicId,
    spectrum: { ...state.round.spectrum },
    guess: state.round.guess,
    clue: state.round.clue,
    bet: state.round.bet,
    result: state.round.result ? { ...state.round.result } : null,
    revealed: state.round.revealed,
    ...(state.round.revealAt === undefined ? {} : { revealAt: state.round.revealAt })
  } : null;
  if (round && (state.round.revealed || player?.id === state.round.psychicId)) round.target = state.round.target;
  const role = player?.team === null || !player ? 'spectator'
    : player.id === state.round?.psychicId ? 'psychic'
      : player.team === state.round?.activeTeam ? 'guesser' : 'opponent';
  return {
    code: state.code,
    phase: state.phase,
    revision: state.revision,
    hostId: state.hostId,
    players: state.players.map(existing => ({
      id: existing.id, name: existing.name, team: existing.team,
      connected: existing.connected, ready: existing.ready,
      ...(existing.disconnectedAt === undefined ? {} : { disconnectedAt: existing.disconnectedAt })
    })),
    teams: state.teams.map(team => ({ name: team.name, score: team.score })),
    config: { winScore: state.config.winScore, selfSelect: state.config.selfSelect, packId: state.config.packId || 'standard', ranked: Boolean(state.config.ranked) },
    turnOrder: [psychicTurnOrder(state, 0), psychicTurnOrder(state, 1)],
    round,
    overtime: state.overtime,
    overtimeTurnsRemaining: state.overtime
      ? (state._overtimeTurns ?? [false, false]).filter(played => !played).length : 0,
    winner: state.winner,
    paused: state.paused,
    pauseReason: state.pauseReason,
    you: player ? { id: player.id, team: player.team, role, host: player.id === state.hostId } : null
  };
}
