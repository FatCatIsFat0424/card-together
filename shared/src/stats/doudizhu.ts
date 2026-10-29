import type { DouDizhuMatchResult, GameSeat, ReplaySnapshot } from '../types';
import { ddzIsBomb } from '../rules/doudizhu';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/**
 * The best total, deals won as landlord, bombs and rockets played, and springs (or anti-springs) won
 * on the seat's side.
 */
export function douDizhuFacts(result: DouDizhuMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  facts.value('topScore', result.scores[seat]);
  for (const entry of frameOf(frame, 'doudizhu')?.log ?? []) {
    if (entry.type === 'play' && entry.seat === seat && ddzIsBomb(entry.combo)) {
      facts.count(entry.combo.type === 'rocket' ? 'rockets' : 'bombs');
    } else if (entry.type === 'deal_end') {
      const landlord = entry.landlord === seat;
      if (landlord && entry.landlordWins) facts.count('landlordWins');
      if ((entry.spring || entry.antiSpring) && entry.landlordWins === landlord) facts.count('springs');
    }
  }
  return facts;
}
