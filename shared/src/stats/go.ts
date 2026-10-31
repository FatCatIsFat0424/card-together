import type { GameSeat, GoMatchResult } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder } from './facts';

/**
 * Wins by the largest margin on points (rounded down), wins with a handicap, wins by resignation, and the most stones
 * captured in one match. Everything comes from the public result.
 */
export function goFacts(result: GoMatchResult, seat: GameSeat): SeatFacts {
  const facts = factsBuilder();
  facts.value('mostCaptured', result.captured[seat] ?? 0);
  if (!result.winners.includes(seat)) return facts;
  if (result.reason === 'resign') facts.count('resignWins');
  // Records hold whole numbers, and a margin is always a half point over them (komi ends in .5).
  else facts.value('bigMargin', Math.floor(result.margin));
  // Black takes the handicap stones, so only the first seat's win counts.
  if (result.options.handicap > 0 && result.seats[0] === seat) facts.count('handicapWins');
  return facts;
}
