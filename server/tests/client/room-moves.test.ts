import { describe, expect, it } from 'vitest';
import type { PlayerInfo, RoomInfo, SeatInfo } from '../../../shared/src/types';
import {
  moveOptions, roomSeatCards, seatCardTarget, seatDropOutcome, spectatorDropOutcome,
} from '../../../client/src/pages/room-moves';
import type { RoomSeatCard } from '../../../client/src/pages/room-moves';

function player(id: string, extra: Partial<PlayerInfo> = {}): PlayerInfo {
  return { id, nickname: id, avatar: 'cat', avatarImage: null, color: '#fff', ...extra } as PlayerInfo;
}

const human = player('human');
const other = player('other');
const bot = player('bot', { isBot: true });

describe('seat drop outcomes', () => {
  it('treats the member\'s own place as the origin', () => {
    expect(seatDropOutcome('seat', human, true).state).toBe('origin');
    expect(spectatorDropOutcome('spectator').state).toBe('origin');
  });

  it('moves into empty seats and sits spectators down', () => {
    expect(seatDropOutcome('seat', null, false)).toEqual({ state: 'available', action: 'move' });
    expect(seatDropOutcome('spectator', null, false)).toEqual({ state: 'available', action: 'sit' });
  });

  it('swaps with humans from either place', () => {
    expect(seatDropOutcome('seat', other, false)).toEqual({ state: 'available', action: 'swap' });
    expect(seatDropOutcome('spectator', other, false)).toEqual({ state: 'available', action: 'swap' });
  });

  it('lets a seated member replace a bot but refuses spectators, as the server does', () => {
    expect(seatDropOutcome('seat', bot, false)).toEqual({ state: 'available', action: 'swap' });
    expect(seatDropOutcome('spectator', bot, false)).toEqual({ state: 'unavailable', reason: 'bot' });
  });

  it('offers the spectator area only to seated members', () => {
    expect(spectatorDropOutcome('seat')).toEqual({ state: 'available', action: 'spectate' });
  });
});

describe('move menu options', () => {
  const card = (key: string, seat: RoomSeatCard['seat'], occupant: PlayerInfo | null): RoomSeatCard => ({
    key, label: `Seat ${key}`, info: { player: occupant, isReady: false }, seat, gameSeat: seat ?? 'N',
  });
  const cards = [card('N', 'N', null), card('E', 'E', human), card('S', 'S', other), card('W', 'W', bot)];

  it('lists every other seat and the spectator area for a seated member', () => {
    const options = moveOptions(cards, [], human, 8);
    expect(options.map((option) => option.key)).toEqual(['N', 'S', 'W', 'spectator']);
    expect(options.find((option) => option.key === 'S')?.outcome.action).toBe('swap');
    expect(options.find((option) => option.key === 'N')?.outcome.action).toBe('move');
    expect(options.every((option) => !option.disabled)).toBe(true);
  });

  it('disables bot seats for spectators and leaves out the spectator area', () => {
    const options = moveOptions(cards, [player('watcher')], player('watcher'), 8);
    expect(options.map((option) => option.key)).toEqual(['N', 'E', 'S', 'W']);
    expect(options.find((option) => option.key === 'W')?.disabled).toBe(true);
    expect(options.find((option) => option.key === 'N')?.outcome.action).toBe('sit');
  });

  it('disables the spectator area when it is full', () => {
    const spectators = Array.from({ length: 8 }, (_, index) => player(`s${index}`));
    expect(moveOptions(cards, spectators, human, 8).find((option) => option.key === 'spectator')?.disabled).toBe(true);
  });

  it('maps seat cards to server targets', () => {
    expect(seatCardTarget(card('N', 'N', null))).toEqual({ type: 'seat', seat: 'N' });
    expect(seatCardTarget({ ...card('additional-1', undefined, null), additionalIndex: 1 }))
      .toEqual({ type: 'additional', index: 1 });
  });
});

describe('waiting-room seat list', () => {
  const empty: SeatInfo = { player: null, isReady: false };
  const room = (gameType: RoomInfo['gameType'], additional = 0): RoomInfo => ({
    code: 'ABCD', gameType, seats: { N: empty, E: empty, S: empty, W: empty },
    ...(additional ? { additionalSeats: Array.from({ length: additional }, () => empty) } : {}),
  } as RoomInfo);
  const keys = (info: RoomInfo): string[] => roomSeatCards(info, (seat) => seat).map((card) => card.key);

  it('shows two facing seats for a two-player game', () => {
    expect(keys(room('reversi'))).toEqual(['N', 'S']);
  });

  it('keeps four seats for a four-player game and adds the extra seats of flexible games', () => {
    expect(keys(room('bridge'))).toEqual(['N', 'E', 'S', 'W']);
    expect(keys(room('holdem', 4))).toEqual([
      'N', 'E', 'S', 'W', 'additional-0', 'additional-1', 'additional-2', 'additional-3',
    ]);
  });

  it('labels and targets each card by its seat', () => {
    const cards = roomSeatCards(room('holdem', 1), (seat, index) => `${seat}:${index ?? '-'}`);
    expect(cards.map((card) => card.label)).toEqual(['N:-', 'E:-', 'S:-', 'W:-', 'P5:0']);
    expect(cards[4].gameSeat).toBe('P5');
  });
});
