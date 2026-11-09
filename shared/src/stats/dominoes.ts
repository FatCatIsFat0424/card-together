import type { GameSeat, ReplaySnapshot } from '../types';
import type { DominoesMatchResult } from '../games/dominoes/types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/**
 * Rounds won from the result; from the log, rounds ended by emptying the hand, blocked rounds won, and
 * the biggest single round.
 */
export function dominoesFacts(
  result: DominoesMatchResult, seat: GameSeat, frame: ReplaySnapshot | null,
): SeatFacts {
  const facts = factsBuilder();
  facts.count('roundsWon', result.roundWinners.filter((winner) => winner === seat).length);
  for (const entry of frameOf(frame, 'dominoes')?.log ?? []) {
    if (entry.type !== 'roundEnd' || entry.winner !== seat) continue;
    if (entry.reason === 'domino') facts.count('dominoes');
    else if (entry.reason === 'blocked') facts.count('blockedWins');
    const best = facts.values.bestRound ?? 0;
    if (entry.points > best) facts.value('bestRound', entry.points);
  }
  return facts;
}
