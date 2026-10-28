import { rankedStanding, rankAfterWinners, compassScore } from '../result-standing';
import { rpScore } from '../../rules/redpoints';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const redPointsDefinition: GameDefinition<'redpoints'> = {
  gameType: 'redpoints',
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 4, flexible: false, expandable: false, numbered: false },
  result: {
    kind: 'ranking',
    scoreKind: 'points',
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: rankAfterWinners(seats, result.winners, other, (seat) => compassScore(result.points, seat), false),
      score: compassScore(result.points, other),
    })),
  },
  presentation: {
    logFrames: (game, index, key): PresentationFrame[] => {
      const entry = game.log[index];
      const cards = entry.captured ? [entry.card, entry.captured] : [entry.card];
      return [{ key, kind: entry.captured ? 'capture' : 'play', durationMs: 1900,
        seat: entry.seat, cards, flipped: entry.type === 'flip', points: entry.captured ? rpScore(cards) : 0 }];
    },
    finishSeat: () => undefined,
  },
};
