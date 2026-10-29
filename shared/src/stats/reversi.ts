import type { GameSeat, ReversiMatchResult, ReplaySnapshot } from '../types';
import { RV_SIZE, rvCell, rvIndex } from '../rules/reversi';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

const CORNERS: readonly number[] = [
  rvIndex(0, 0), rvIndex(RV_SIZE - 1, 0), rvIndex(0, RV_SIZE - 1), rvIndex(RV_SIZE - 1, RV_SIZE - 1),
];

/**
 * Most discs on the board at the end, wipeouts (the opponent left with none), corners taken, and the most
 * discs flipped by one move.
 */
export function reversiFacts(result: ReversiMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  facts.value('topDiscs', result.discs[seat] ?? 0);
  const opponent = result.seats.find((other) => other !== seat);
  if (result.winners.includes(seat) && opponent !== undefined && (result.discs[opponent] ?? 0) === 0) facts.count('wipeouts');
  let biggest = 0;
  for (const entry of frameOf(frame, 'reversi')?.log ?? []) {
    if (entry.seat !== seat || !entry.to) continue;
    if (CORNERS.includes(rvCell(entry.to) ?? -1)) facts.count('corners');
    biggest = Math.max(biggest, entry.flips.length);
  }
  if (biggest > 0) facts.value('biggestFlip', biggest);
  return facts;
}
