import { SUIT_DISPLAY_ORDER } from '@shared/constants';
import { ddzPower } from '@shared/rules/doudizhu';
import type { HandOrder } from '../client-game';

/** Ranks run 3 up to A, then 2; the shared sorter places the jokers ahead of every suit card. */
export const ddzHandOrder: HandOrder = {
  rank: (card) => ddzPower(card),
  suit: (card) => SUIT_DISPLAY_ORDER.indexOf(card.suit),
};
