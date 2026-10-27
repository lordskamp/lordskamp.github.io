import { COLORS } from './core.js';
import { optionFor } from './catalog-base.js';
import { modeFor } from './pv3-modes.js';

export const EMPTY_DYE = 'empty';
const validColors = new Set(COLORS.map(color => color.id));

/** Four dispensers: two per extruder. An empty string means unknown. */
export function normalizeDyeSlots(value) {
  return Array.from({ length: 4 }, (_, index) => {
    const color = value?.[index];
    return validColors.has(color) || color === EMPTY_DYE ? color : '';
  });
}

export function dyeMode(drum) {
  const wanted = drum?.idealColor === true && !['black', 'yellow-green'].includes(drum?.color) ? 'single' : drum?.mode;
  const mode = modeFor(optionFor(drum?.cableId), drum?.color, wanted);
  return mode === 'single' ? 'single' : 'dual';
}

export function dyeRequirements(drum) {
  if (!drum || drum.cableId === 'thread-bundle' || !validColors.has(drum.color)) {
    return [null, null];
  }
  if (dyeMode(drum) === 'single') return [drum.color, null];
  return drum.color === 'yellow-green' ? ['yellow', 'green'] : ['white', drum.color];
}

/** Plan tentative refills; slot contents do not identify the active dispenser. */
export function planDyeSlots(drums, initial) {
  const slots = normalizeDyeSlots(initial);
  const pending = drums.filter(drum => drum.status !== 'done');

  return pending.map((drum, index) => {
    const steps = [];
    dyeRequirements(drum).forEach((color, extruder) => {
      if (!color) return;
      const offset = extruder * 2;
      const current = slots.slice(offset, offset + 2);
      const found = current.indexOf(color);

      if (found >= 0) {
        steps.push({ extruder: extruder + 1, slot: found + 1, color, kind: 'available' });
        return;
      }
      if (current.includes('')) {
        steps.push({ extruder: extruder + 1, color, kind: 'unknown' });
        return;
      }

      let slot = current.indexOf(EMPTY_DYE);
      if (slot < 0) {
        const future = pending.slice(index + 1).map(next => dyeRequirements(next)[extruder]);
        const distance = value => {
          const at = future.indexOf(value);
          return at < 0 ? Infinity : at;
        };
        slot = distance(current[0]) >= distance(current[1]) ? 0 : 1;
      }
      steps.push({ extruder: extruder + 1, slot: slot + 1, color, replaces: current[slot], kind: 'load' });
      slots[offset + slot] = color;
    });
    return { id: drum.id, steps };
  });
}
