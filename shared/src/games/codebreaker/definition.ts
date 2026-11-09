import { MIN_FLEXIBLE_PLAYERS } from '../../constants/game-rules';
import { DEFAULT_CODEBREAKER_OPTIONS, cbRank, isCodeBreakerOptions } from '../../rules/codebreaker';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import { rankedStanding } from '../result-standing';

/** Code Breaker seats two to six players. */
export const CODEBREAKER_MAX_PLAYERS = 6;

export const codeBreakerDefinition: GameDefinition<'codebreaker'> = {
  gameType: 'codebreaker',
  category: 'board',
  equipment: [],
  options: {
    defaults: DEFAULT_CODEBREAKER_OPTIONS,
    legacyDefaults: DEFAULT_CODEBREAKER_OPTIONS,
    isValid: isCodeBreakerOptions,
  },
  seats: { minPlayers: MIN_FLEXIBLE_PLAYERS, maxPlayers: CODEBREAKER_MAX_PLAYERS, flexible: true, expandable: true, numbered: false },
  // The room timer is the window every unsolved seat shares for one round's guess; there is no reserve to draw on.
  timeControl: { baseSeconds: 60, bankSeconds: 0 },
  result: {
    kind: 'ranking',
    scoreKind: null,
    standing: (result, seat, seats) => {
      const finishes = seats.map((other) => ({ seat: other, guesses: result.guesses[other] ?? 0, solved: result.solved.includes(other) }));
      // Nobody wins when nobody cracked the code, even though every seat then shares the first rank.
      return { ...rankedStanding(seats, seat, (other) => ({ rank: cbRank(finishes, other), score: null })),
        won: result.winners.includes(seat) };
    },
  },
  // Guesses are private until the match ends, so the table never presents them.
  presentation: {
    logFrames: () => [],
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
