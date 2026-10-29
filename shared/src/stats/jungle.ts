import type { GameSeat, JungleMatchResult, ReplaySnapshot } from '../types';
import { JG_COLS, JG_ELEPHANT, JG_RAT, jgCell } from '../rules/jungle';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/** Den entries, the most pieces captured in one match, rats that took an elephant, and river jumps. */
export function jungleFacts(result: JungleMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  if (result.reason === 'den-entered' && result.winners.includes(seat)) facts.count('denWins');
  let captures = 0;
  for (const entry of frameOf(frame, 'jungle')?.log ?? []) {
    if (entry.seat !== seat) continue;
    if (entry.capture) captures++;
    if (entry.piece === JG_RAT && entry.captured === JG_ELEPHANT) facts.count('ratSlays');
    const from = jgCell(entry.from);
    const to = jgCell(entry.to);
    // A step moves one cell sideways or one row; anything longer crossed the river.
    if (from !== null && to !== null && ![1, JG_COLS].includes(Math.abs(from - to))) facts.count('jumps');
  }
  if (captures > 0) facts.value('topCaptures', captures);
  return facts;
}
