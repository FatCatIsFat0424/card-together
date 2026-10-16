import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Card, CardFaceStyleId } from '@shared/types';
import { useAccountStore } from '../../stores/account-store';
import { cardFaceUrl, jokerFaceUrl, napoleonJokerFaceUrls } from './card-faces';
import { fourColorResolver, loadFourColorDeck, subscribeFourColorDeck } from './four-color';

export function useCardFaceStyle(): CardFaceStyleId | null {
  return useAccountStore((state) => state.account?.cardFaceStyle ?? null);
}

/** Card face URLs for a specific deck, refreshed when lazily loaded faces arrive. */
export function useDeckFaceUrl(style: CardFaceStyleId | null): (card: Card) => string {
  const fourColorFace = useSyncExternalStore(subscribeFourColorDeck, fourColorResolver, fourColorResolver);
  const fourColor = style === 'card-face-four-color';
  useEffect(() => {
    if (fourColor) void loadFourColorDeck();
  }, [fourColor]);
  return useCallback((card: Card) => (fourColor ? fourColorFace(card) : cardFaceUrl(card, style)), [fourColor, fourColorFace, style]);
}

/** Card face URLs follow the signed-in player's private deck. */
export function useCardFaceUrl(): (card: Card) => string {
  return useDeckFaceUrl(useCardFaceStyle());
}

/** Joker image for the signed-in player's deck; null keeps the built-in classic joker. */
export function useJokerFaceUrl(): string | null {
  return jokerFaceUrl(useCardFaceStyle());
}

/** Napoleon's big and small jokers for the signed-in player's deck; null keeps the bundled pair. */
export function useNapoleonJokerFaceUrls(): { readonly big: string; readonly small: string } | null {
  return napoleonJokerFaceUrls(useCardFaceStyle());
}
