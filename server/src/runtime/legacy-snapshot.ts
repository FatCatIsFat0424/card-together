import type { AnyGameState, PlayerInfo, SeatInfo } from '@shared/types';
import type { PersistedRoom, RuntimeSnapshot } from './types';

/** Fields that older snapshots stored on players and that validation still accepts on load. */
const RETIRED_PLAYER_FIELDS = ['botDifficulty'] as const;

function withoutRetiredFields(player: PlayerInfo): PlayerInfo {
  if (!RETIRED_PLAYER_FIELDS.some((field) => Object.hasOwn(player, field))) return player;
  const copy: Record<string, unknown> = { ...player };
  for (const field of RETIRED_PLAYER_FIELDS) delete copy[field];
  return copy as unknown as PlayerInfo;
}

function seatWithoutRetiredFields(entry: SeatInfo): SeatInfo {
  return entry.player ? { ...entry, player: withoutRetiredFields(entry.player) } : entry;
}

function roomWithoutRetiredFields(room: PersistedRoom): PersistedRoom {
  const { info } = room;
  const seats = Object.fromEntries(Object.entries(info.seats)
    .map(([seat, entry]) => [seat, seatWithoutRetiredFields(entry)])) as typeof info.seats;
  return { ...room, info: { ...info, seats,
    ...(info.additionalSeats ? { additionalSeats: info.additionalSeats.map(seatWithoutRetiredFields) } : {}) } };
}

function gameWithoutRetiredFields(game: AnyGameState): AnyGameState {
  const players = Object.fromEntries(Object.entries(game.players)
    .map(([seat, player]) => [seat, player && withoutRetiredFields(player)]));
  return { ...game, players } as AnyGameState;
}

/**
 * Drops player fields that are no longer part of the contract, so a snapshot saved by an older
 * release restores as current state. Bots that once had the retired easy difficulty become normal
 * bots. Recorded replay frames keep what was recorded.
 */
export function upgradeLegacySnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
  return {
    ...snapshot,
    rooms: snapshot.rooms.map(roomWithoutRetiredFields),
    games: snapshot.games.map(gameWithoutRetiredFields),
  };
}
