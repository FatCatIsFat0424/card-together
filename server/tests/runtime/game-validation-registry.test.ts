import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_TYPES, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { normalizeFlexibleGame } from '@shared/game-seat-compat';
import { gameDefinition } from '@shared/games/registry';
import { defaultGameOptions } from '@shared/games/room-options';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import type { PlayerInfo, Seat } from '@shared/types';
import { gameAdapter } from '../../src/managers/games/registry';
import { gameValidator } from '../../src/managers/games/validation-registry';
import type { ObjectValue } from '../../src/runtime/validation-helpers';

const CODE = 'VALREG';
const PLAYERS = Object.fromEntries(SEAT_ORDER_CLOCKWISE.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
}])) as Record<Seat, PlayerInfo>;

function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

afterEach(() => {
  for (const gameType of GAME_TYPES) gameAdapter(gameType).restoreGames([]);
});

describe('game validation registry', () => {
  it.each(GAME_TYPES)('validates %s without mutating the stored game and uses the runtime player validator', (gameType) => {
    const adapter = gameAdapter(gameType);
    // Two-player games seat only the first two seats; the validator still reads every seat's player.
    const seated = SEAT_ORDER_CLOCKWISE.slice(0, gameDefinition(gameType).seats.maxPlayers);
    const players = Object.fromEntries(seated.map((seat) => [seat, PLAYERS[seat]]));
    expect(adapter.start({
      roomCode: CODE, players, settings: DEFAULT_TIME_CONTROL, options: defaultGameOptions(),
    })).toEqual({ success: true });
    const state = structuredClone(normalizeFlexibleGame(adapter.getGameState(CODE)!));
    const before = structuredClone(state);
    freeze(state);
    const validator = gameValidator(gameType);
    const validPlayer = vi.fn(() => true);
    expect(validator.shape(state as unknown as ObjectValue, validPlayer)).toBe(true);
    expect(validPlayer).toHaveBeenCalledTimes(seated.length);
    expect(validator.coherent(state)).toBe(true);
    expect(validator.shape(state as unknown as ObjectValue, () => false)).toBe(false);
    expect(state).toEqual(before);

    const duplicatePlayer = structuredClone(state);
    duplicatePlayer.players.E = duplicatePlayer.players.N!;
    expect(validator.coherent(duplicatePlayer)).toBe(false);
  });
});
