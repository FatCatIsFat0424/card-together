import type { TimeControl } from './types/room';

export const DEFAULT_TIME_CONTROL: TimeControl = { baseSeconds: 300, bankSeconds: 300 };
/** Board games: 60 seconds per move plus a 300-second reserve. */
export const BOARD_TIME_CONTROL: TimeControl = { baseSeconds: 60, bankSeconds: 300 };
export const TIME_CONTROL_LIMITS = {
  baseSeconds: { min: 1, max: 300 },
  bankSeconds: { min: 0, max: 300 },
} as const;

export function isTimeControl(value: unknown): value is TimeControl {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 2 &&
    (Object.keys(TIME_CONTROL_LIMITS) as (keyof TimeControl)[]).every((key) => {
      const number = candidate[key];
      const { min, max } = TIME_CONTROL_LIMITS[key];
      return typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max;
    });
}

function sameTimeControl(a: TimeControl, b: TimeControl): boolean {
  return a.baseSeconds === b.baseSeconds && a.bankSeconds === b.bankSeconds;
}

/**
 * The room timer after the host switches games: a timer still on the previous game's default follows the
 * new game's default, while a timer the host changed is kept.
 */
export function followDefaultTimeControl(
  current: TimeControl | undefined, previousDefault: TimeControl, nextDefault: TimeControl,
): TimeControl {
  return !current || sameTimeControl(current, previousDefault) ? { ...nextDefault } : current;
}
