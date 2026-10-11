import type { BlackjackOptions } from './types/room';

export const DEFAULT_BLACKJACK_OPTIONS: BlackjackOptions = { playerDealer: false };

export function isBlackjackOptions(value: unknown): value is BlackjackOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 1 && typeof candidate.playerDealer === 'boolean';
}
