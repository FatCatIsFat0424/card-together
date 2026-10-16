// ─── Napoleon card faces: the shared suit-card art plus original joker art ───

import { isNapoleonJoker } from '@shared/rules/napoleon';
import type { NapoleonCard } from '@shared/types';
import { cardImageUrl } from '../../cards';
import bigJoker from '../../assets/napoleon/joker-big.svg';
import smallJoker from '../../assets/napoleon/joker-small.svg';

/** The big joker is drawn in colour and the small joker in greyscale. */
export function napoleonCardImageUrl(card: NapoleonCard): string {
  if (isNapoleonJoker(card)) return card.joker === 'big' ? bigJoker : smallJoker;
  return cardImageUrl(card);
}
