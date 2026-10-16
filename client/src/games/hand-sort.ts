import type { GameType, LiarCard, NapoleonCard } from '@shared/types';
import { SUIT_DISPLAY_ORDER } from '@shared/constants';
import { isNapoleonJoker } from '@shared/rules/napoleon';
import { BIGTWO_RANK_ORDER, BIGTWO_SUIT_ORDER } from '@shared/rules/bigtwo';
import type { HandSort } from '../stores/hand-sort-store';

/** Sort copies only; retain each game's rank conventions and keep Napoleon's jokers together. */
export type SortableCard = NapoleonCard | LiarCard;

export function sameHandCard(a: SortableCard, b: SortableCard): boolean {
  if ('face' in a || 'face' in b) return 'face' in a && 'face' in b && a.id === b.id;
  if (isNapoleonJoker(a) || isNapoleonJoker(b)) return isNapoleonJoker(a) && isNapoleonJoker(b) && a.joker === b.joker;
  return a.rank === b.rank && a.suit === b.suit;
}

export function sortHand<T extends SortableCard>(cards: readonly T[], by: HandSort, game: GameType): T[] {
  return [...cards].sort((a, b) => {
    if ('face' in a || 'face' in b) return 'face' in a && 'face' in b
      ? ['Q', 'K', 'A', 'joker'].indexOf(a.face) - ['Q', 'K', 'A', 'joker'].indexOf(b.face) : 0;
    if (isNapoleonJoker(a)) return isNapoleonJoker(b) ? Number(a.joker === 'big') - Number(b.joker === 'big') : 1;
    if (isNapoleonJoker(b)) return -1;
    const rank = game === 'bigtwo' ? BIGTWO_RANK_ORDER.indexOf(a.rank) - BIGTWO_RANK_ORDER.indexOf(b.rank) : a.rank - b.rank;
    const suit = game === 'bigtwo' ? BIGTWO_SUIT_ORDER.indexOf(a.suit) - BIGTWO_SUIT_ORDER.indexOf(b.suit)
      : SUIT_DISPLAY_ORDER.indexOf(a.suit) - SUIT_DISPLAY_ORDER.indexOf(b.suit);
    return by === 'suit' ? suit || rank : rank || suit;
  });
}
