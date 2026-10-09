import { afterEach, describe, expect, it } from 'vitest';
import type { GameType, PlayerInfo, Seat } from '@shared/types';
import * as games from '../../src/managers/game-manager';
import { getTurnSeat } from '../../src/managers/game-clock';
import { applyAutomatedAction, firstLegalAction } from '../../src/runtime/automated-action';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
}])) as Record<Seat, PlayerInfo>;
const CODE = 'FALL01';

describe('first legal automated action', () => {
  afterEach(() => games.restoreGames([]));

  it.each<GameType>(['bridge', 'bigtwo', 'redpoints', 'ninetynine'])(
    'is accepted on every turn of a %s game until it ends', (type) => {
      games.startGame(CODE, type, PLAYERS);
      // Ninety-Nine reshuffles its discards, so random games can run for several hundred turns.
      for (let step = 0; step < 5_000; step += 1) {
        const game = games.getGameState(CODE)!;
        const seat = getTurnSeat(game);
        if (!seat || game.phase === 'scoring') break;
        // Presentations only delay actions; skip them so the whole game can be replayed.
        delete game.presentation;
        // Fallback bidding always passes, so open once to reach play instead of redealing forever.
        if (game.gameType === 'bridge' && game.phase === 'bidding' && !game.bidding?.highestBid) {
          expect(games.handleBid(CODE, seat, { type: 'bid', level: 1, suit: 'clubs' }, true)).toEqual({ success: true });
          continue;
        }
        const visible = games.getPlayerVisibleState(CODE, seat)!;
        const action = firstLegalAction(visible);
        expect(action).not.toBeNull();
        expect(applyAutomatedAction(CODE, seat, action!)).toEqual({ success: true });
      }
      expect(games.getGameState(CODE)!.phase).toBe('scoring');
    });
});
