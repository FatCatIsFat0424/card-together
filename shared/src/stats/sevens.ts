import type { GameSeat, ReplaySnapshot, Seat, SevensMatchResult } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/** Finishing without a covered card, the lowest and highest penalty, and Dragon Slaying closes (an A or K played). */
export function sevensFacts(result: SevensMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  const penalty = result.penalties[seat as Seat];
  if (result.covered[seat as Seat].length === 0) facts.count('clean');
  facts.value('lowPenalty', penalty);
  facts.value('highPenalty', penalty);
  const sevens = frameOf(frame, 'sevens');
  // Without Dragon Slaying an A or K only extends its row.
  if (!sevens?.options?.closeOnEnd) return facts;
  for (const entry of sevens.log) {
    if (entry.type === 'play' && entry.seat === seat && (entry.card.rank === 14 || entry.card.rank === 13)) facts.count('slays');
  }
  return facts;
}
