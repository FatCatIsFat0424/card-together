import type { BattleshipMatchResult, GameSeat } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, seatValue } from './facts';

/**
 * Fleets sunk and the fewest shots one took, enemy ships sunk, and the shots fired and landed behind the
 * accuracy figure. Every number comes from the public shot results in the stored result.
 */
export function battleshipFacts(result: BattleshipMatchResult, seat: GameSeat): SeatFacts {
  const facts = factsBuilder();
  const shots = seatValue(result.shots, seat);
  if (result.reason === 'fleet-sunk' && result.winners.includes(seat)) {
    facts.count('fleetsSunk');
    facts.value('fewestShots', shots);
  }
  facts.count('shipsSunk', seatValue(result.sunk, seat));
  facts.sum('shotsFired', shots);
  facts.sum('shotsHit', seatValue(result.hits, seat));
  return facts;
}
