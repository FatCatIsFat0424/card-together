import type { GameSeat } from '../types';
import type { YachtMatchResult } from '../games/yacht/types';
import type { SeatFacts } from './facts';
import { factsBuilder, seatValue } from './facts';

/** Best total, Yachts rolled (the Yacht box plus extra ones), and upper bonuses earned, all from the final result. */
export function yachtFacts(result: YachtMatchResult, seat: GameSeat): SeatFacts {
  const facts = factsBuilder();
  facts.value('topScore', seatValue(result.totals, seat));
  facts.count('yachts', seatValue(result.yachts, seat));
  if (result.upperBonus[seat]) facts.count('upperBonuses');
  return facts;
}
