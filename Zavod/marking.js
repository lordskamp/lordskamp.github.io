import { number } from './core.js';
import { retainWorkingSpeed } from './speed-override.js';

export const MARKING_MAX_SPEED = 150;
export function applyMarkingSpeed(info, marked) {
  const current = number(info?.effective?.workingSpeed);
  return marked && current !== null && current > MARKING_MAX_SPEED ? retainWorkingSpeed(info, MARKING_MAX_SPEED) : info;
}
