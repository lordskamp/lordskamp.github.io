const CURVES = {
  wheel: [0.18, 0.72, 0.24, 1],
  shutter: [0.22, 0.75, 0.25, 1]
};

function bezier(at, first, second) {
  const remaining = 1 - at;
  return 3 * remaining * remaining * at * first + 3 * remaining * at * at * second + at * at * at;
}

// A tooth clicks when the visible rotation crosses its angle, rather than at
// regular time intervals. Invert the animation's progress curve to find that time.
export function mechanicalProgressTime(progress, mechanism = 'wheel') {
  const [x1, y1, x2, y2] = CURVES[mechanism] || CURVES.wheel;
  const desired = Math.max(0, Math.min(1, progress));
  if (desired === 0 || desired === 1) return desired;
  let lower = 0, upper = 1;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (bezier(middle, y1, y2) < desired) lower = middle;
    else upper = middle;
  }
  return bezier((lower + upper) / 2, x1, x2);
}

export function mechanicalSchedule({ mechanism, duration, distance } = {}) {
  if (!Object.hasOwn(CURVES, mechanism)) return null;
  const milliseconds = duration === undefined ? mechanism === 'wheel' ? 980 : 650 : Number(duration);
  const degrees = Math.abs(Number(distance));
  if (!Number.isFinite(milliseconds) || milliseconds < 60 || !Number.isFinite(degrees) || degrees < 1) return null;
  const length = Math.min(3000, milliseconds);
  const travel = Math.min(360, degrees);
  const pitch = mechanism === 'wheel' ? 10 : 45;
  const teeth = [];
  for (let angle = pitch; angle < travel; angle += pitch) teeth.push(mechanicalProgressTime(angle / travel, mechanism) * length);
  return { mechanism, duration: length, distance: travel, teeth, detentAt: Math.max(0, length - 24) };
}

export function mechanicalPulses(schedule, minimumInterval = 70) {
  if (!schedule) return [];
  const minimum = Math.max(45, minimumInterval);
  const pulses = [{ at: 0, kind: 'soft' }];
  let last = 0;
  for (const at of schedule.teeth) {
    if (at - last < minimum || schedule.detentAt - at < minimum) continue;
    pulses.push({ at, kind: schedule.mechanism === 'wheel' ? 'selection' : 'soft' });
    last = at;
  }
  if (schedule.detentAt - last >= minimum) pulses.push({ at: schedule.detentAt, kind: 'detent' });
  return pulses;
}
