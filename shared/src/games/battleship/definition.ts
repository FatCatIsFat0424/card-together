import { BOARD_TIME_CONTROL } from '../../time-control';
import { DEFAULT_BATTLESHIP_OPTIONS, isBattleshipOptions } from '../../rules/battleship';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import { rankedStanding } from '../result-standing';

export const battleshipDefinition: GameDefinition<'battleship'> = {
  gameType: 'battleship',
  category: 'board',
  equipment: [],
  options: {
    defaults: DEFAULT_BATTLESHIP_OPTIONS,
    legacyDefaults: DEFAULT_BATTLESHIP_OPTIONS,
    isValid: isBattleshipOptions,
  },
  // Flexible seats make the visible state carry its `seats` list; exactly two of the room's seats play.
  seats: { minPlayers: 2, maxPlayers: 2, flexible: true, expandable: false, numbered: false },
  timeControl: BOARD_TIME_CONTROL,
  // Every match ends with a sunk fleet or a resignation, so there is no draw to offer.
  matchControls: { resign: true, draw: false },
  result: {
    kind: 'ranking',
    scoreKind: null,
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: result.winners.length === 0 || result.winners.includes(other) ? 1 : 2,
      score: null,
    })),
  },
  // Shots are shown on the seas themselves, so the game never starts a presentation.
  presentation: {
    logFrames: () => [],
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
