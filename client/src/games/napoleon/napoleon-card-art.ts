// ─── Napoleon card faces: the equipped suit-card deck plus original joker art ───

import { useCallback } from 'react';
import { isNapoleonJoker } from '@shared/rules/napoleon';
import type { NapoleonCard } from '@shared/types';
import { useCardFaceUrl } from '../../cosmetics/card-faces/use-card-face';
import bigJoker from '../../assets/napoleon/joker-big.svg';
import smallJoker from '../../assets/napoleon/joker-small.svg';

/**
 * Suit cards follow the player's private card face deck. Napoleon keeps its own jokers because the big
 * joker is drawn in colour and the small joker in greyscale, a distinction the rules depend on.
 */
export function useNapoleonCardImageUrl(): (card: NapoleonCard) => string {
  const cardFaceUrl = useCardFaceUrl();
  return useCallback((card: NapoleonCard) => isNapoleonJoker(card)
    ? card.joker === 'big' ? bigJoker : smallJoker
    : cardFaceUrl(card), [cardFaceUrl]);
}
