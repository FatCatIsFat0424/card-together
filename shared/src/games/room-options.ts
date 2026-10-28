import { GAME_TYPES } from '../constants/game-rules';
import type { GameOptions, GameOptionsByType, GameOptionsPayload, GameType } from '../types/room';
import { gameDefinition, isGameType } from './registry';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Games without configurable rules accept only an empty object. */
export function isOptionsFor<K extends GameType>(gameType: K, value: unknown): value is GameOptionsByType[K] {
  const rules = gameDefinition(gameType).options;
  return rules ? rules.isValid(value) : object(value) && Object.keys(value).length === 0;
}

export function isGameOptions(value: unknown): value is GameOptions {
  return object(value) && Object.entries(value).every(([key, options]) => isGameType(key) && isOptionsFor(key, options));
}

export function isGameOptionsPayload(value: unknown): value is GameOptionsPayload {
  return object(value) && Object.keys(value).every((key) => key === 'gameType' || key === 'options')
    && isGameType(value.gameType) && isOptionsFor(value.gameType, value.options);
}

/** New rooms use current defaults; missing rules in old snapshots retain their original behavior. */
export function defaultGameOptions(legacy: boolean = false): GameOptions {
  return Object.fromEntries(GAME_TYPES.flatMap((gameType) => {
    const rules = gameDefinition(gameType).options;
    return rules ? [[gameType, structuredClone(legacy ? rules.legacyDefaults : rules.defaults)]] : [];
  }));
}

/** Keeps valid saved choices, adding legacy defaults only where a field did not exist. */
export function restoredGameOptions(options: GameOptions | undefined): GameOptions {
  return { ...defaultGameOptions(true), ...structuredClone(options ?? {}) };
}
