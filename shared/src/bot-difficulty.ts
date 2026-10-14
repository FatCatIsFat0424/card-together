import type { BotDifficulty } from './types';

export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'hard'];

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return value === 'easy' || value === 'hard';
}
