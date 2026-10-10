import type { NinetyNineOptions } from './types/room';

export const DEFAULT_NINETYNINE_OPTIONS: NinetyNineOptions = { twoDecks: false };

export function isNinetyNineOptions(value: unknown): value is NinetyNineOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 1 && typeof candidate.twoDecks === 'boolean';
}
