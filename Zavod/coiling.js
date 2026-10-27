import { number, parseBreakdowns, planSplices } from './core.js?v=28';

export const isCoilingBrand = brand => ['ПВ1', 'ПВ3', 'H07V-K', 'H05V-K', 'H05V-U', 'H07V-U'].includes(brand);

export function coilLength(brand, section) {
  const size = number(section);
  if (['ПВ1', 'ПВ3'].includes(brand)) {
    if (size >= 0.5 && size <= 1) return 300;
    if (size === 1.5) return 200;
    if (size >= 2.5 && size <= 6) return 100;
  }
  if (['H07V-K', 'H05V-K', 'H05V-U', 'H07V-U'].includes(brand)) {
    if (size === 0.5) return 200;
    if (size >= 0.75 && size <= 6) return 100;
  }
  return null;
}

// Marks are counter readings. Each interrupted segment loses its incomplete coil.
export function calculateProduction(lengthInput, faults, joints, coiling, size) {
  const length = number(lengthInput);
  const a = parseBreakdowns(faults), b = parseBreakdowns(joints);
  const errors = [a.error, b.error].filter(Boolean);
  if (!Number.isSafeInteger(length) || length <= 0) errors.push('Вкажи додатну цілу довжину в метрах.');
  if (coiling && !size) errors.push('Для цієї марки та перерізу довжина бухти невідома.');
  const marks = [...a.values, ...b.values].sort((x, y) => x - y);
  if (new Set(marks).size !== marks.length || marks.some(x => x <= 0)) errors.push('Позначки мають бути різними додатними числами.');
  if (errors.length) return { errors };
  let target = length, waste = 0, previous = 0;
  if (coiling) {
    for (const mark of marks) {
      if (mark >= target) { errors.push('Позначка має бути меншою за поточну потрібну довжину.'); break; }
      const lost = (mark - previous) % size;
      waste += lost; target += lost; previous = mark;
      if (!Number.isSafeInteger(target)) { errors.push('Завелика довжина.'); break; }
    }
    return { errors, target, waste, coils: Math.floor(length / size), remainder: length % size, size, marks };
  }
  const splice = planSplices(length, marks.join(';'), 0);
  errors.push(...splice.errors);
  return { errors, target, splice };
}