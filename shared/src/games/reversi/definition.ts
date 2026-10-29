import { BOARD_TIME_CONTROL } from '../../time-control';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import { rankedStanding } from '../result-standing';

export const reversiDefinition: GameDefinition<'reversi'> = {
  gameType: 'reversi',
  category: 'board',
  equipment: [],
  // Flexible seats make the visible state carry its `seats` list; exactly two of the room's seats play.
  seats: { minPlayers: 2, maxPlayers: 2, flexible: true, expandable: false, numbered: false },
  timeControl: BOARD_TIME_CONTROL,
  matchControls: { resign: true, draw: true },
  result: {
    kind: 'ranking',
    scoreKind: null,
    // A draw puts both seats first, and a tie for first counts as a win.
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: result.winners.length === 0 || result.winners.includes(other) ? 1 : 2,
      score: null,
    })),
  },
  // Board moves are drawn on the board itself, so the game never starts a presentation.
  presentation: {
    logFrames: () => [],
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
