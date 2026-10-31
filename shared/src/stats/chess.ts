import type { ChessMatchResult, GameSeat, ReplaySnapshot } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/** Checkmates delivered, the fewest own moves to a checkmate, and promotions, castlings and en passant captures. */
export function chessFacts(result: ChessMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  if (result.reason === 'checkmate' && result.winners.includes(seat)) {
    facts.count('checkmates');
    // White moves first, so the winner's own moves are the plies rounded up for white and down for black.
    const white = result.seats[0] === seat;
    facts.value('fastestMate', white ? Math.ceil(result.moves / 2) : Math.floor(result.moves / 2));
  }
  for (const entry of frameOf(frame, 'chess')?.log ?? []) {
    if (entry.seat !== seat) continue;
    if (entry.promotion) facts.count('promotions');
    if (entry.castle) facts.count('castles');
    if (entry.enPassant) facts.count('enPassants');
  }
  return facts;
}
