import type { SevensOptions } from './types/room';

export const DEFAULT_SEVENS_OPTIONS: SevensOptions = { closeOnEnd: false };

export function isSevensOptions(value: unknown): value is SevensOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 1 && typeof candidate.closeOnEnd === 'boolean';
}
