import type { BlackjackMatchResult, GameSeat, ReplaySnapshot } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/**
 * The final stack, blackjacks, the best net win of one deal, busts per hand played, and the net
 * collected while dealing for the table.
 */
export function blackjackFacts(result: BlackjackMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  facts.value('topChips', result.chips[seat]);
  const dealers = new Map<number, GameSeat | undefined>();
  let best: number | null = null;
  for (const entry of frameOf(frame, 'blackjack')?.log ?? []) {
    if (entry.type === 'deal') dealers.set(entry.hand, entry.dealer);
    if (entry.type !== 'settle') continue;
    if (dealers.get(entry.hand) === seat) {
      facts.sum('dealerNet', entry.net[seat]);
      continue;
    }
    const outcomes = entry.outcomes[seat];
    if (outcomes.length === 0) continue;
    facts.count('handsPlayed', outcomes.length);
    facts.count('blackjacks', outcomes.filter((outcome) => outcome === 'blackjack').length);
    facts.count('busts', outcomes.filter((outcome) => outcome === 'bust').length);
    best = Math.max(best ?? entry.net[seat], entry.net[seat]);
  }
  if (best !== null) facts.value('bestHand', best);
  return facts;
}
