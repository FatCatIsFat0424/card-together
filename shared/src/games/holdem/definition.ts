import { HE_HANDS, HE_STARTING_CHIPS } from '../../rules/holdem';
import { rankAfterWinners, rankedStanding } from '../result-standing';
import { MAX_ROOM_SEATS, MIN_FLEXIBLE_PLAYERS } from '../../constants/game-rules';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const holdemDefinition: GameDefinition<'holdem'> = {
  gameType: 'holdem',
  category: 'cards',
  equipment: ['cards', 'chips'],
  seats: { minPlayers: MIN_FLEXIBLE_PLAYERS, maxPlayers: MAX_ROOM_SEATS, flexible: true, expandable: true, numbered: false },
  matchHands: HE_HANDS,
  result: {
    kind: 'ranking',
    scoreKind: 'chips',
    standing: (result, seat, seats) => {
      const survivors = seats.filter((other) => !result.eliminationOrder.includes(other));
      return rankedStanding(seats, seat, (other) => {
        // Busted seats rank by elimination order; survivors rank by their remaining chips.
        const out = result.eliminationOrder.indexOf(other);
        return { rank: out >= 0 ? seats.length - out
          : rankAfterWinners(survivors, result.winners, other, (seat) => result.chips[seat], false),
        score: result.chips[other] - HE_STARTING_CHIPS };
      });
    },
  },
  presentation: {
    logFrames: (game, index, key): PresentationFrame[] => {
      const entry = game.log[index];
      switch (entry.type) {
        case 'hand': return [{ key, kind: 'deal', durationMs: 1500, seat: entry.button, cards: [] }];
        case 'action':
          return [{ key, kind: entry.allIn ? 'allIn' : entry.action, durationMs: 900, seat: entry.seat, cards: [],
            ...(entry.action === 'fold' || entry.action === 'check' ? {} : { amount: entry.to }) }];
        case 'street': return [{ key, kind: 'street', durationMs: 1300, cards: entry.cards }];
        case 'showdown': return [{ key, kind: 'showdown', durationMs: 2500, cards: [] }];
        case 'award': return [{ key, kind: 'award', durationMs: 2500, cards: [] }];
      }
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
