import { DEFAULT_NINETYNINE_OPTIONS, isNinetyNineOptions } from '../../ninetynine-options';
import { rankedStanding } from '../result-standing';
import { MAX_ROOM_SEATS, MIN_FLEXIBLE_PLAYERS } from '../../constants/game-rules';
import { nnRank, nnWinners } from '../../rules/ninetynine';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const ninetyNineDefinition: GameDefinition<'ninetynine'> = {
  gameType: 'ninetynine',
  options: {
    defaults: DEFAULT_NINETYNINE_OPTIONS,
    legacyDefaults: DEFAULT_NINETYNINE_OPTIONS,
    isValid: isNinetyNineOptions,
  },
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: MIN_FLEXIBLE_PLAYERS, maxPlayers: MAX_ROOM_SEATS, flexible: true, expandable: true, numbered: false },
  result: {
    kind: 'ranking',
    scoreKind: null,
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: nnRank(result, other),
      score: null,
    })),
  },
  presentation: {
    logFrames: (game, index, key): PresentationFrame[] => {
      const entry = game.log[index];
      if (entry.type === 'play') {
        const previousPlay = game.log.slice(0, index).reverse()
          .find((event) => event.type === 'play');
        const previousTotal = previousPlay?.type === 'play' ? previousPlay.total : 0;
        return [{ key, kind: 'play', durationMs: 1900, seat: entry.seat,
          cards: [entry.card], total: entry.total, previousTotal, direction: game.direction, choice: entry.choice,
          ...(entry.target ? { target: entry.target } : {}) }];
      }
      return [{ key, kind: 'eliminated', durationMs: 2500, seat: entry.seat, cards: [] }];
    },
    finishSeat: (game) => (game.result ? soleWinner(nnWinners(game.result)) : undefined),
  },
};
