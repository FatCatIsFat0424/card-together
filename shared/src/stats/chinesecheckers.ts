import type { ChineseCheckersMatchResult, ChineseCheckersMove, GameSeat, ReplaySnapshot } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/** Jumps a move chains together: 0 for a step, otherwise one more than its intermediate landings. */
export function ccJumps(move: Pick<ChineseCheckersMove, 'jump' | 'path'>): number {
  return move.jump ? (move.path?.length ?? 0) + 1 : 0;
}

/** Chains of this many jumps or more count as long chains. */
export const CC_LONG_CHAIN = 3;

/**
 * Wins in matches of three or more players, the fewest own moves in a win, the longest jump chain, and long
 * chains made.
 */
export function chineseCheckersFacts(result: ChineseCheckersMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  const won = result.winners.includes(seat);
  if (won && result.seats.length > 2) facts.count('crowdWins');
  const log = frameOf(frame, 'chinesecheckers')?.log;
  if (!log) return facts;
  let moves = 0;
  let longest = 0;
  for (const entry of log) {
    if (entry.seat !== seat || entry.to === undefined) continue;
    moves++;
    const jumps = ccJumps(entry);
    longest = Math.max(longest, jumps);
    if (jumps >= CC_LONG_CHAIN) facts.count('longChains');
  }
  if (won && result.reason === 'all-home') facts.value('fewestMoves', moves);
  if (longest > 0) facts.value('longestChain', longest);
  return facts;
}
