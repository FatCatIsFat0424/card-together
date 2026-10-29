import type { GameSeat, OldMaidMatchResult, ReplaySnapshot } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/** Deals ending with the joker in hand, deals finished first, joker-free matches, best points, and pairs discarded. */
export function oldMaidFacts(result: OldMaidMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  const lost = result.dealOrders.filter((order) => order[order.length - 1] === seat).length;
  facts.sum('jokerLosses', lost);
  facts.count('firstOuts', result.dealOrders.filter((order) => order[0] === seat).length);
  if (lost === 0) facts.count('clean');
  facts.value('topPoints', result.totals[seat]);
  let pairs = 0;
  for (const entry of frameOf(frame, 'oldmaid')?.log ?? []) {
    if (entry.type === 'deal') pairs += (entry.discards[seat]?.length ?? 0) / 2;
    else if (entry.type === 'draw' && entry.seat === seat) pairs += entry.discarded.length / 2;
  }
  facts.count('pairsDiscarded', pairs);
  return facts;
}
