import type { NapoleonOptions } from './types/room';

export const DEFAULT_NAPOLEON_OPTIONS: NapoleonOptions = { jokerSummon: true };

export function isNapoleonOptions(value: unknown): value is NapoleonOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 1 && typeof candidate.jokerSummon === 'boolean';
}
