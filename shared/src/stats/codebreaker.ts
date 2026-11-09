import type { CodeBreakerMatchResult, GameSeat } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, seatValue } from './facts';

/** Codes cracked, the fewest guesses one needed, and the guesses behind the average. Every number comes from the stored result. */
export function codeBreakerFacts(result: CodeBreakerMatchResult, seat: GameSeat): SeatFacts {
  const facts = factsBuilder();
  if (result.solved.includes(seat)) {
    const guesses = seatValue(result.guesses, seat);
    facts.count('codesCracked');
    facts.value('fewestGuesses', guesses);
    facts.sum('guessesToSolve', guesses);
  }
  return facts;
}
