import { DEFAULT_DOMINOES_OPTIONS, isDominoesOptions } from '../../dominoes-options';
import { MIN_FLEXIBLE_PLAYERS } from '../../constants/game-rules';
import { rankAfterWinners, rankedStanding } from '../result-standing';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

/** Dealing the tiles, and the round summary with every remaining hand. */
export const DOMINOES_DEAL_MS = 1500;
export const DOMINOES_ROUND_END_MS = 5000;

export const dominoesDefinition: GameDefinition<'dominoes'> = {
  gameType: 'dominoes',
  options: {
    defaults: DEFAULT_DOMINOES_OPTIONS,
    legacyDefaults: DEFAULT_DOMINOES_OPTIONS,
    isValid: isDominoesOptions,
  },
  category: 'dice',
  equipment: [],
  seats: { minPlayers: MIN_FLEXIBLE_PLAYERS, maxPlayers: 4, flexible: true, expandable: false, numbered: false },
  result: {
    kind: 'ranking',
    scoreKind: 'points',
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: rankAfterWinners(seats, result.winners, other, (value) => result.scores[value], false),
      score: result.scores[other],
    })),
  },
  presentation: {
    // Tiles join the line in plain view, so only the deal and a round's settlement hold the table.
    logFrames: (game, index, key): PresentationFrame[] => {
      const entry = game.log[index];
      switch (entry.type) {
        case 'round': return [{ key, kind: 'deal', durationMs: DOMINOES_DEAL_MS, seat: entry.leader, cards: [] }];
        case 'roundEnd': return [{ key, kind: 'settle', durationMs: DOMINOES_ROUND_END_MS,
          ...(entry.winner ? { seat: entry.winner } : {}), points: entry.points, cards: [] }];
        default: return [];
      }
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
