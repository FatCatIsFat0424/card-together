import type { Card } from '@shared/types';

/** How a card button was activated: `keyboard` covers Enter/Space and assistive technology. */
export type CardInput = 'mouse' | 'touch' | 'pen' | 'keyboard';

export type CardTapResult =
  | { readonly type: 'arm'; readonly card: Card }
  | { readonly type: 'play'; readonly card: Card };

function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** Map a pointer event type, falling back to the device's primary pointer when unknown. */
export function cardInput(pointerType: string | null, coarsePointer: boolean): CardInput {
  if (pointerType === 'mouse' || pointerType === 'touch' || pointerType === 'pen') return pointerType;
  return coarsePointer ? 'touch' : 'mouse';
}

/**
 * Touch play takes two taps: the first lifts and enlarges the card, the second plays it.
 * Mouse, pen, and keyboard activation stay one-step because they are precise.
 */
export function cardTap(armed: Card | null, card: Card, input: CardInput): CardTapResult {
  if (input !== 'touch') return { type: 'play', card };
  return armed && sameCard(armed, card) ? { type: 'play', card } : { type: 'arm', card };
}

/** An armed card is cleared once it leaves the playable set or the hand becomes inactive. */
export function validArmedCard(
  armed: Card | null, playable: readonly Card[] | undefined, active: boolean,
): Card | null {
  if (!armed || !active || !playable?.some((card) => sameCard(card, armed))) return null;
  return armed;
}
