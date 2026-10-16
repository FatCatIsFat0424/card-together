import type { NapoleonCard } from '@shared/types';
import { sameNapoleonCard } from '@shared/rules/napoleon';

/** How a card button was activated: `keyboard` covers Enter/Space and assistive technology. */
export type CardInput = 'mouse' | 'touch' | 'pen' | 'keyboard';

export type CardTapResult<T extends NapoleonCard = NapoleonCard> =
  | { readonly type: 'arm'; readonly card: T }
  | { readonly type: 'play'; readonly card: T };

/** Map a pointer event type, falling back to the device's primary pointer when unknown. */
export function cardInput(pointerType: string | null, coarsePointer: boolean): CardInput {
  if (pointerType === 'mouse' || pointerType === 'touch' || pointerType === 'pen') return pointerType;
  return coarsePointer ? 'touch' : 'mouse';
}

/**
 * Touch play takes two taps: the first lifts and enlarges the card, the second plays it.
 * Mouse, pen, and keyboard activation stay one-step because they are precise.
 */
export function cardTap<T extends NapoleonCard>(armed: T | null, card: T, input: CardInput): CardTapResult<T> {
  if (input !== 'touch') return { type: 'play', card };
  return armed && sameNapoleonCard(armed, card) ? { type: 'play', card } : { type: 'arm', card };
}

/** An armed card is cleared once it leaves the playable set or the hand becomes inactive. */
export function validArmedCard<T extends NapoleonCard>(
  armed: T | null, playable: readonly T[] | undefined, active: boolean,
): T | null {
  if (!armed || !active || !playable?.some((card) => sameNapoleonCard(card, armed))) return null;
  return armed;
}
