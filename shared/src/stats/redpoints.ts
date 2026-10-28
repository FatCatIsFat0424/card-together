import type { Card, GameSeat, RedPointsMatchResult, ReplaySnapshot, Seat } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf, isCard } from './facts';

const HUNDRED = 100;

/** The best score, scores of 100 or more, and the red aces the seat captured. */
export function redPointsFacts(result: RedPointsMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  const points = result.points[seat as Seat];
  facts.value('topPoints', points);
  if (points >= HUNDRED) facts.count('hundreds');
  for (const entry of frameOf(frame, 'redpoints')?.log ?? []) {
    if (entry.seat !== seat || entry.captured === null) continue;
    // A capture takes both the played or flipped card and the table card it pairs with.
    const taken: readonly Card[] = [entry.card, entry.captured];
    if (taken.some((card) => isCard(card, 'hearts', 14))) facts.count('heartAces');
    if (taken.some((card) => isCard(card, 'diamonds', 14))) facts.count('diamondAces');
  }
  return facts;
}
