const escapeText = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const boundedScore = (score, goal) => Math.max(0, Math.min(goal, Number.isFinite(Number(score)) ? Number(score) : 0));

function trackTicks(goal) {
  const step = Math.max(1, Math.ceil(goal / 10));
  const ticks = [];
  for (let score = 0; score < goal; score += step) ticks.push(score);
  ticks.push(goal);
  return ticks.map((score, index) => `<span class="score-track-tick" style="bottom:${score / goal * 100}%"${index % 2 === 0 || score === goal ? ' data-key-tick' : ''}><span>${score}</span><i></i></span>`).join('');
}

export function scoreTrackMarkup({ team, score, goal, label }) {
  const teamIndex = Number(team) === 1 ? 1 : 0;
  const winningScore = Math.max(1, Math.min(30, Math.round(Number(goal) || 10)));
  const currentScore = Math.max(0, Number(score) || 0);
  const position = boundedScore(currentScore, winningScore) / winningScore * 100;
  return `<div class="score-track" data-team="${teamIndex}" data-goal="${winningScore}" role="progressbar" aria-label="${escapeText(label)}" aria-valuemin="0" aria-valuemax="${winningScore}" aria-valuenow="${boundedScore(currentScore, winningScore)}" aria-valuetext="${currentScore} / ${winningScore}"><div class="score-track-rail" aria-hidden="true">${trackTicks(winningScore)}<div class="score-track-marker" style="bottom:${position}%"><svg class="score-head" viewBox="0 0 80 88" focusable="false"><path class="score-head-profile" d="M17 31C17 15 28 6 44 6c17 0 28 11 28 28 0 5-1 9-3 13l6 10c1 2 0 4-3 4l-5 1c0 8-4 13-12 13h-5v11H21l4-19c-7-8-10-18-8-36Z"/><path class="score-head-ear" d="M43 39c-4-3-8 0-7 4 0 3 3 5 5 7"/><circle class="score-head-eye" cx="62" cy="35" r="1.7"/></svg></div></div></div>`;
}

export function animateScoreTracks(container, previousScores, currentScores) {
  if (!previousScores || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  container.querySelectorAll('.score-track').forEach(track => {
    const team = Number(track.dataset.team);
    const goal = Number(track.dataset.goal);
    const previous = Number(previousScores[team]);
    const current = Number(currentScores[team]);
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === current) return;
    const marker = track.querySelector('.score-track-marker');
    if (!marker || typeof marker.animate !== 'function') return;
    const from = boundedScore(previous, goal) / goal * 100;
    const to = boundedScore(current, goal) / goal * 100;
    if (from === to) return;
    const animation = marker.animate([
      { bottom: `${from}%`, transform: 'translateX(-50%) scale(1)', offset: 0 },
      { bottom: `${to}%`, transform: 'translateX(-50%) scale(1.035, .97)', offset: .76 },
      { bottom: `${to}%`, transform: 'translateX(-50%) scale(1)', offset: 1 }
    ], { duration: 760, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both' });
    animation.finished.then(() => animation.cancel(), () => {});
  });
}
