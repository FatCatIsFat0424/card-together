// ─── Napoleon card faces: the equipped deck, with a coloured big joker and a greyscale small joker ───

import { useCallback } from 'react';
import { isNapoleonJoker } from '@shared/rules/napoleon';
import type { NapoleonCard } from '@shared/types';
import { useCardFaceUrl, useNapoleonJokerFaceUrls } from '../../cosmetics/card-faces/use-card-face';
import bigJoker from '../../assets/napoleon/joker-big.svg';
import smallJoker from '../../assets/napoleon/joker-small.svg';

/**
 * Every card follows the player's private card face deck. The rules depend on telling the jokers apart,
 * so the big joker is always coloured and the small joker greyscale; the classic deck uses bundled art.
 */
export function useNapoleonCardImageUrl(): (card: NapoleonCard) => string {
  const cardFaceUrl = useCardFaceUrl();
  const jokers = useNapoleonJokerFaceUrls();
  const big = jokers?.big ?? bigJoker;
  const small = jokers?.small ?? smallJoker;
  return useCallback((card: NapoleonCard) => isNapoleonJoker(card)
    ? card.joker === 'big' ? big : small
    : cardFaceUrl(card), [cardFaceUrl, big, small]);
}
