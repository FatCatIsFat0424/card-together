import type { TimeControl } from './types/room';

export const DEFAULT_TIME_CONTROL: TimeControl = { baseSeconds: 5, bankSeconds: 20 };
export const TIME_CONTROL_LIMITS = {
  baseSeconds: { min: 1, max: 60 },
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
