import type { GameSeat, ReplaySnapshot, XiangqiMatchResult } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/** Checkmates delivered, the fewest own moves to a checkmate, checks given, and the most pieces taken in one match. */
export function xiangqiFacts(result: XiangqiMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  if (result.reason === 'checkmate' && result.winners.includes(seat)) {
    facts.count('checkmates');
    // Red moves first, so the winner's own moves are the plies rounded up for red and down for black.
    const red = result.seats[0] === seat;
    facts.value('fastestMate', red ? Math.ceil(result.moves / 2) : Math.floor(result.moves / 2));
  }
  let captures = 0;
  for (const entry of frameOf(frame, 'xiangqi')?.log ?? []) {
    if (entry.seat !== seat) continue;
    if (entry.check) facts.count('checks');
    if (entry.capture) captures++;
  }
  if (captures > 0) facts.value('mostCaptures', captures);
  return facts;
}
