import type { GameSeat, GomokuMatchResult } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder } from './facts';

/**
 * Wins by five in a row, the fewest own stones in a win, the longest game in stones, and wins under the Renju
 * rule.
 */
export function gomokuFacts(result: GomokuMatchResult, seat: GameSeat): SeatFacts {
  const facts = factsBuilder();
  facts.value('longestGame', result.moves);
  if (result.winners.includes(seat) && result.reason === 'five-in-row') {
    facts.count('fiveWins');
    // Black lays the odd stones, so it owns the larger half of an odd total.
    facts.value('shortestWin', seat === result.blackSeat ? Math.ceil(result.moves / 2) : Math.floor(result.moves / 2));
    if (result.options.renju) facts.count('renjuWins');
  }
  return facts;
}
