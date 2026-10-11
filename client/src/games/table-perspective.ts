import type { PlayerVisibleGameState, Seat } from '@shared/types';
import { matchSeats } from '../game-view';
import type { GodView } from '../stores/god-view-store';
import { isSpectator } from './observer-view';

export function perspectiveSeat(game: PlayerVisibleGameState | null, selected: Seat, own: Seat | null): Seat {
  if (!isSpectator(game)) return own ?? 'S';
  const seats = matchSeats(game);
  return seats.includes(selected) ? selected : seats[0] ?? 'S';
}

/** Project only display fields; the authoritative snapshot and observer permissions stay intact. */
export function spectatorGame<T extends PlayerVisibleGameState>(game: T, seat: Seat, view: GodView): T {
  if (!isSpectator(game)) return game;
  if (game.gameType === 'blackjack') return { ...game, mySeat: seat };
  if (game.gameType === 'liarsdeck') return {
    ...game, mySeat: seat, myHand: [...view.liarHands?.[seat] ?? []], myPlayed: [],
  };
  return {
    ...game, mySeat: seat, myHand: [...view.hands?.[seat] ?? []],
    ...(game.gameType === 'sevens' ? { myCovered: [...view.covered?.[seat] ?? []] } : {}),
    ...(game.gameType === 'chinesepoker' ? { myArrangement: null } : {}),
  };
}
