import { DEFAULT_CRAZYEIGHTS_OPTIONS, isCrazyEightsOptions } from '../../crazyeights-options';
import { rankAfterWinners, rankedStanding } from '../result-standing';
import { MAX_ROOM_SEATS, MIN_FLEXIBLE_PLAYERS } from '../../constants/game-rules';
import { CE_HANDS } from '../../rules/crazyeights';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const crazyEightsDefinition: GameDefinition<'crazyeights'> = {
  gameType: 'crazyeights',
  options: {
    defaults: DEFAULT_CRAZYEIGHTS_OPTIONS,
    legacyDefaults: DEFAULT_CRAZYEIGHTS_OPTIONS,
    isValid: isCrazyEightsOptions,
  },
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: MIN_FLEXIBLE_PLAYERS, maxPlayers: MAX_ROOM_SEATS, flexible: true, expandable: true, numbered: false },
  matchHands: CE_HANDS,
  result: {
    kind: 'ranking',
    scoreKind: 'penalty',
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: rankAfterWinners(seats, result.winners, other, (value) => result.scores[value], true),
      score: result.scores[other],
    })),
  },
  presentation: {
    logFrames: (game, index, key): PresentationFrame[] => {
      const entry = game.log[index];
      switch (entry.type) {
        case 'hand':
          return [{ key, kind: 'deal', durationMs: 1500, seat: entry.first, cards: [entry.starter] }];
        case 'play':
          return [{ key, kind: 'play', durationMs: entry.suit || entry.effect ? 1900 : 1300, seat: entry.seat,
            cards: [entry.card],
            ...(entry.suit ? { suit: entry.suit } : {}),
            ...(entry.effect ? { effect: entry.effect } : {}),
            ...(entry.target ? { target: entry.target } : {}),
            ...(entry.drawn > 0 ? { count: entry.drawn } : {}) }];
        // Frames reuse the nearest shared kinds: a draw is a hit, and the end of a hand a settlement.
        case 'draw':
          return [{ key, kind: 'hit', durationMs: 900, seat: entry.seat, cards: [], count: 1 }];
        case 'pass':
          return [{ key, kind: 'pass', durationMs: 800, seat: entry.seat, cards: [] }];
        case 'handEnd':
          return [{ key, kind: 'settle', durationMs: 2500, seat: entry.winner, cards: [] }];
      }
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
