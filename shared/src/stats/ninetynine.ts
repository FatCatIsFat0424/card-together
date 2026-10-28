import type { GameSeat, NinetyNineMatchResult, ReplaySnapshot } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf, isCard } from './facts';

/**
 * Going out first, sharing first place when a two-deck stock ran out, the spade aces and kings played,
 * and opponents knocked out: seats eliminated right after the seat's play left a total they could not follow.
 */
export function ninetyNineFacts(result: NinetyNineMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  if (result.eliminationOrder[0] === seat) facts.count('firstOut');
  if ('winners' in result && result.winners.length > 1 && result.winners.includes(seat)) facts.count('sharedWins');
  let lastPlayer: GameSeat | null = null;
  for (const entry of frameOf(frame, 'ninetynine')?.log ?? []) {
    if (entry.type === 'eliminated') {
      if (lastPlayer === seat && entry.seat !== seat) facts.count('knockouts');
      continue;
    }
    lastPlayer = entry.seat;
    if (entry.seat !== seat) continue;
    if (isCard(entry.card, 'spades', 14)) facts.count('spadeAces');
    if (entry.card.rank === 13) facts.count('kings');
  }
  return facts;
}
