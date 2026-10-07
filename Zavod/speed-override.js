import { number, positive, firstSpeed, secondSpeed } from './core.js?v=25';
import { speedRpm } from './rpm.js?v=25';

export const SPEED_STORAGE = 'zavod-working-speeds-v1';

/** The setting belongs to the physical mode, so blue and yellow/green share it. */
export function speedKey(info) {
  return `${info.option.id}:${number(info.row.section)}:${info.mode}${info.option.coreKind === 'thread' ? `:d${number(info.finalDiameter) ?? 'unknown'}` : ''}`;
}

export function speedLimit(info) {
  const speeds = [info.effective.workingSpeed, info.practical.workingSpeed, info.reference.workingSpeed, info.row.maxSpeed, info.knownMaxSpeed].map(positive).filter(value => value !== null);
  return speeds.length ? Math.max(...speeds) : null;
}

/** Always take an unmodified setup; never scale a previous local adjustment. */
export function speedSetup(info, target) {
  const speed = positive(target), limit = speedLimit(info);
  if (!speed) return { info, error: 'Вкажи швидкість більшу за нуль.' };
  if (limit !== null && speed > limit) return { info, error: `У таблиці максимальна швидкість — ${limit} м/хв.` };
  if (speed === positive(info.effective.workingSpeed)) return { info, error: null };
  const thread = info.option.coreKind === 'thread';
  const baseSpeed = thread ? positive(info.rpmSpeedBasis && Object.hasOwn(info.rpmSpeedBasis, 'extruder1')
    ? info.rpmSpeedBasis.extruder1 : info.rpmWorkingSpeed) : positive(info.effective.workingSpeed);
  if (thread && positive(info.finalDiameter) === null) return { info, error: 'Спочатку вкажи фінальний діаметр із завдання.' };
  if (thread && baseSpeed === null) return { info, error: 'Для перерахунку джгута потрібна швидкість, за якої записані ці оберти. Додай її в адмінський замір.' };
  const rpm = speedRpm({ mode: info.mode, ...info.effective, maxSpeed: baseSpeed }, speed);
  if (rpm.first === null) return { info, error: rpm.message };
  return { error: null, info: { ...info,
    effective: { ...info.effective, workingSpeed: speed, extruder1: rpm.first, extruder2: rpm.second },
    sources: { ...info.sources, workingSpeed: 'manual', extruder1: 'manual', extruder2: info.mode === 'dual' ? 'manual' : info.sources.extruder2 },
    stages: { first: firstSpeed(speed), second: secondSpeed(speed), working: speed, source: 'manual' },
    manualSpeed: { speed, baseSpeed },
    ...(thread ? { rpmWorkingSpeed: speed, rpmSpeedBasis: { ...info.rpmSpeedBasis, extruder1: speed } } : {}),
    rpmConflict: null,
  } };
}
