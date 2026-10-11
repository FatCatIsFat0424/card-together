import type { Card, Seat, SevensVisibleState } from '@shared/types';
import { RANK_ORDER_DESC, SEAT_ORDER_CLOCKWISE, SUIT_DISPLAY_ORDER } from '@shared/constants';
import { svApply, svEmptyTable, svIsPlayable, svTableCards } from '@shared/rules/sevens';

export interface SevensKnowledge {
  readonly liveProbabilities: ReadonlyMap<string, Readonly<Record<Seat, number>>>;
}

function cardKey(card: Card): string {
  return `${card.suit}:${card.rank}`;
}

function emptyProbabilities(): Record<Seat, number> {
  return { N: 0, E: 0, S: 0, W: 0 };
}

/** Estimates current ownership from public information, without sampling hidden deals. */
export function buildSevensKnowledge(visible: SevensVisibleState): SevensKnowledge {
  const cards = SUIT_DISPLAY_ORDER.flatMap((suit) => RANK_ORDER_DESC.map((rank): Card => ({ suit, rank })));
  const excluded = new Map<string, Set<Seat>>();
  const unavailable = new Set([...visible.myCovered, ...svTableCards(visible.table)].map(cardKey));
  let table = svEmptyTable();
  let firstPlay = true;
  const closeOnEnd = visible.options?.closeOnEnd ?? false;

  for (const entry of visible.log) {
    if (entry.type === 'play') {
      unavailable.add(cardKey(entry.card));
      table = svApply(table, entry.card, closeOnEnd);
      firstPlay = false;
      continue;
    }
    // No draws occur, so a card absent at a forced cover cannot enter that hand later.
    for (const card of cards) {
      if (!svIsPlayable(table, card, firstPlay, closeOnEnd)) continue;
      const key = cardKey(card);
      const seats = excluded.get(key) ?? new Set<Seat>();
      seats.add(entry.seat);
      excluded.set(key, seats);
    }
  }

  const own = new Set(visible.myHand.map(cardKey));
  const opponents = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== visible.mySeat);
  const hiddenCovers = opponents.reduce((total, seat) => total + visible.coveredCounts[seat], 0);
  const liveProbabilities = new Map<string, Readonly<Record<Seat, number>>>();
  for (const card of cards) {
    const key = cardKey(card);
    const probabilities = emptyProbabilities();
    if (own.has(key)) {
      probabilities[visible.mySeat] = 1;
    } else if (!unavailable.has(key)) {
      const eligible = opponents.filter((seat) => !excluded.get(key)?.has(seat));
      const remaining = eligible.reduce((total, seat) => total + visible.handCounts[seat], 0);
      const unknown = remaining + hiddenCovers;
      // This count-weighted estimate is not an exact posterior; covers have unknown identities.
      if (unknown > 0) {
        for (const seat of eligible) probabilities[seat] = visible.handCounts[seat] / unknown;
      }
    }
    liveProbabilities.set(key, probabilities);
  }
  return { liveProbabilities };
}

/** Probability that the card remains in any hand, including an unreachable card. */
export function sevensLiveProbability(knowledge: SevensKnowledge, card: Card): number {
  const probabilities = knowledge.liveProbabilities.get(cardKey(card));
  return probabilities ? SEAT_ORDER_CLOCKWISE.reduce((total, seat) => total + probabilities[seat], 0) : 0;
}

export function sevensLiveProbabilityAt(knowledge: SevensKnowledge, card: Card, seat: Seat): number {
  return knowledge.liveProbabilities.get(cardKey(card))?.[seat] ?? 0;
}
