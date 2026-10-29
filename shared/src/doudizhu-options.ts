import type { DouDizhuOptions } from './types/room';

export const DEFAULT_DOUDIZHU_OPTIONS: DouDizhuOptions = { variant: 'score' };

export function isDouDizhuOptions(value: unknown): value is DouDizhuOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 1 && (candidate.variant === 'score' || candidate.variant === 'grab');
}
