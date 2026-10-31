import { BOARD_TIME_CONTROL } from '../../time-control';
import { DEFAULT_GO_OPTIONS, isGoOptions } from '../../rules/go';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import { rankedStanding } from '../result-standing';

export const goDefinition: GameDefinition<'go'> = {
  gameType: 'go',
  category: 'board',
  equipment: [],
  options: {
    defaults: DEFAULT_GO_OPTIONS,
    legacyDefaults: DEFAULT_GO_OPTIONS,
    isValid: isGoOptions,
  },
  // Flexible seats make the visible state carry its `seats` list; exactly two of the room's seats play.
  seats: { minPlayers: 2, maxPlayers: 2, flexible: true, expandable: false, numbered: false },
  timeControl: BOARD_TIME_CONTROL,
  // Komi ends in a half point, so a match never ties and offers no draw.
  matchControls: { resign: true, draw: false },
  result: {
    kind: 'ranking',
    scoreKind: null,
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: result.winners.length === 0 || result.winners.includes(other) ? 1 : 2,
      score: null,
    })),
  },
  // Stones are drawn on the board itself, so the game never starts a presentation.
  presentation: {
    logFrames: () => [],
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
