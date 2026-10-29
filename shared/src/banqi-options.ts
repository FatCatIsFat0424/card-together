import type { BanqiOptions } from './games/banqi/types';

export const DEFAULT_BANQI_OPTIONS: BanqiOptions = { chain: false, rookDash: false };

export function isBanqiOptions(value: unknown): value is BanqiOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 2 && typeof candidate.chain === 'boolean'
    && typeof candidate.rookDash === 'boolean';
}
