import { defaultGameOptions, isGameOptions } from '@shared/games/room-options';

const LEGACY_FIELDS = {
  sevensOptions: 'sevens',
  ninetyNineOptions: 'ninetynine',
  blackjackOptions: 'blackjack',
  napoleonOptions: 'napoleon',
} as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shared by the JSON and SQLite v10 migrations; game snapshots and recordings stay untouched. */
export function migrateRoomOptions(value: unknown): unknown {
  if (!object(value) || !object(value.info)) return value;
  const info = { ...value.info };
  if (info.gameOptions !== undefined && !isGameOptions(info.gameOptions)) {
    throw new Error('Invalid saved game options.');
  }
  const options: Record<string, unknown> = { ...defaultGameOptions(true), ...(info.gameOptions ?? {}) };
  for (const [field, gameType] of Object.entries(LEGACY_FIELDS)) {
    if (info[field] !== undefined) options[gameType] = info[field];
    delete info[field];
  }
  if (!isGameOptions(options)) throw new Error('Invalid legacy room options.');
  return { ...value, info: { ...info, gameOptions: options } };
}
