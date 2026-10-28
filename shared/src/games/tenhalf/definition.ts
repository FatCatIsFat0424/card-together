import { rankedStanding, rankAfterWinners } from '../result-standing';
import { BJ_STARTING_CHIPS } from '../../rules/blackjack';
import { MAX_ROOM_SEATS, MIN_FLEXIBLE_PLAYERS } from '../../constants/game-rules';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const tenHalfDefinition: GameDefinition<'tenhalf'> = {
  gameType: 'tenhalf',
  category: 'cards',
  equipment: ['cards', 'chips'],
  seats: { minPlayers: MIN_FLEXIBLE_PLAYERS, maxPlayers: MAX_ROOM_SEATS, flexible: true, expandable: true, numbered: false },
  result: {
    kind: 'ranking',
    scoreKind: 'chips',
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: rankAfterWinners(seats, result.winners, other, (seat) => result.chips[seat], false),
      score: result.chips[other] - BJ_STARTING_CHIPS,
    })),
  },
  presentation: {
    logFrames: (game, index, key): PresentationFrame[] => {
      const entry = game.log[index];
      switch (entry.type) {
        // Bets stay hidden until the deal, so they have no frame and never delay other bettors.
        case 'bet': return [];
        case 'deal': return [{ key, kind: 'deal', durationMs: 1800, seat: entry.banker, cards: [] }];
        case 'hit': return [{ key, kind: 'hit', durationMs: 1000, seat: entry.seat, cards: [entry.card] }];
        case 'stand': return [{ key, kind: 'stand', durationMs: 700, seat: entry.seat, cards: [] }];
        case 'showdown': return [{ key, kind: 'showdown', durationMs: 2200, cards: [] }];
        case 'settle': return [{ key, kind: 'settle', durationMs: 2500, cards: [] }];
      }
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
