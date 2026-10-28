import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { isJoker } from '@shared/rules/cards';
import type { Card, CardFaceStyleId, CardOrJoker } from '@shared/types';
import { useAccountStore } from '../../stores/account-store';
import { cardFaceUrl, jokerFaceUrl, jokerFaceUrls } from './card-faces';
import bundledBigJoker from '../../assets/napoleon/joker-big.svg';
import bundledSmallJoker from '../../assets/napoleon/joker-small.svg';
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

const BUNDLED_JOKERS = { big: bundledBigJoker, small: bundledSmallJoker } as const;

/** Big (coloured) and small (greyscale) joker URLs for the signed-in player's deck; the classic deck uses bundled art. */
export function useJokerFaceUrls(): { readonly big: string; readonly small: string } {
  return jokerFaceUrls(useCardFaceStyle()) ?? BUNDLED_JOKERS;
}

/** Face URL for any card or joker in the signed-in player's deck. */
export function useCardOrJokerFaceUrl(): (card: CardOrJoker) => string {
  const cardFace = useCardFaceUrl();
  const { big, small } = useJokerFaceUrls();
  return useCallback((card: CardOrJoker) => isJoker(card)
    ? card.joker === 'big' ? big : small
    : cardFace(card), [cardFace, big, small]);
}
