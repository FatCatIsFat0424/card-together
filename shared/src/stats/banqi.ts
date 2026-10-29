import type { GameSeat, ReplaySnapshot } from '../types';
import type { BanqiMatchResult } from '../games/banqi/types';
import { BQ_GENERAL, bqRank } from '../rules/banqi';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/**
 * Most pieces left at the end, wipeouts (the opponent left with none), generals captured, and the most
 * pieces taken in one turn (more than one only with 連吃).
 */
export function banqiFacts(result: BanqiMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  facts.value('topPieces', result.remaining[seat] ?? 0);
  if (result.reason === 'all-captured' && result.winners.includes(seat)) facts.count('wipeouts');
  let streak = 0;
  let best = 0;
  let previousSeat: GameSeat | null = null;
  for (const entry of frameOf(frame, 'banqi')?.log ?? []) {
    if (entry.seat !== previousSeat || entry.captured === undefined || !entry.chain) streak = 0;
    previousSeat = entry.seat;
    if (entry.seat !== seat || entry.captured === undefined) continue;
    streak++;
    best = Math.max(best, streak);
    if (bqRank(entry.captured) === BQ_GENERAL) facts.count('generalsTaken');
  }
  if (best > 0) facts.value('bestChain', best);
  return facts;
}
