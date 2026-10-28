import type { Card, GameSeat, ReplaySnapshot, TenHalfMatchResult } from '../types';
import { thHandKind } from '../rules/tenhalf';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/**
 * The final stack, special hands revealed at showdowns, the best net win of one hand, busts per
 * hand played, and the net collected while banking.
 */
export function tenHalfFacts(result: TenHalfMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  facts.value('topChips', result.chips[seat]);
  const ups = new Map<GameSeat, Card[]>();
  const bankers = new Map<number, GameSeat>();
  let best: number | null = null;
  for (const entry of frameOf(frame, 'tenhalf')?.log ?? []) {
    switch (entry.type) {
      case 'deal':
        bankers.set(entry.hand, entry.banker);
        ups.clear();
        break;
      case 'hit':
        ups.set(entry.seat, [...(ups.get(entry.seat) ?? []), entry.card]);
        break;
      case 'showdown': {
        const hole = entry.holes[seat];
        if (hole && ['tenhalf', 'fivesmall', 'tianwang', 'renwuxiao'].includes(thHandKind([hole, ...(ups.get(seat) ?? [])]))) {
          facts.count('specialHands');
        }
        break;
      }
      case 'settle': {
        if (bankers.get(entry.hand) === seat) {
          facts.sum('bankerNet', entry.net[seat]);
          break;
        }
        const outcome = entry.outcomes[seat];
        if (outcome === null) break;
        facts.count('handsPlayed');
        if (outcome === 'bust') facts.count('busts');
        best = Math.max(best ?? entry.net[seat], entry.net[seat]);
        break;
      }
      default:
    }
  }
  if (best !== null) facts.value('bestHand', best);
  return facts;
}
