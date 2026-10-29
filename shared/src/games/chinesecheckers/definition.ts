import { BOARD_TIME_CONTROL } from '../../time-control';
import { CC_PLAYER_COUNTS } from '../../rules/chinesecheckers';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import { rankedStanding } from '../result-standing';

export const chineseCheckersDefinition: GameDefinition<'chinesecheckers'> = {
  gameType: 'chinesecheckers',
  category: 'board',
  equipment: [],
  // Up to six seats (N, E, S, W, P5, P6); five players would leave a corner without an opposite player.
  seats: {
    minPlayers: 2, maxPlayers: 6, playerCounts: CC_PLAYER_COUNTS, flexible: true, expandable: true, numbered: true,
  },
  timeControl: BOARD_TIME_CONTROL,
  // Draw offers only ever apply while exactly two seats play.
  matchControls: { resign: true, draw: true },
  result: {
    kind: 'ranking',
    scoreKind: null,
    // A draw puts every seat first, and a tie for first counts as a win.
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: result.ranks[other] ?? seats.length,
      score: null,
    })),
  },
  // Moves are drawn on the board itself, so the game never starts a presentation.
  presentation: {
    logFrames: () => [],
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
