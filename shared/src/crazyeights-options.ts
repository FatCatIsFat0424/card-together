import type { CrazyEightsOptions } from './games/crazyeights/types';

export const DEFAULT_CRAZYEIGHTS_OPTIONS: CrazyEightsOptions = { actionCards: false };

export function isCrazyEightsOptions(value: unknown): value is CrazyEightsOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 1 && typeof candidate.actionCards === 'boolean';
}
