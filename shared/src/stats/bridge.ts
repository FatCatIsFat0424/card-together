import { SEAT_ORDER_CLOCKWISE } from '../constants';
import type { GameResult, GameSeat, Seat } from '../types';
import { encodeContract } from './definitions';
import type { SeatFacts } from './facts';
import { factsBuilder } from './facts';

/** Contracts made by the seat's side: slams (six or seven), the highest one, no-trump ones, and overtricks. */
export function bridgeFacts(result: GameResult, seat: GameSeat): SeatFacts {
  const facts = factsBuilder();
  const { contract } = result;
  const declaring = SEAT_ORDER_CLOCKWISE.indexOf(seat as Seat) % 2 === SEAT_ORDER_CLOCKWISE.indexOf(contract.declarer) % 2;
  if (!declaring || !result.declarerTeamWins) return facts;
  facts.sum('overtricks', result.declarerTeamTricks - result.requiredTricks);
  if (contract.level >= 6) facts.count('slams');
  if (contract.suit === 'nt') facts.count('ntMade');
  facts.value('topContract', encodeContract(contract.level, contract.suit));
  return facts;
}
