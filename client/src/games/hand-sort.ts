import type { GameType, NapoleonCard } from '@shared/types';
import { SUIT_DISPLAY_ORDER } from '@shared/constants';
import { isNapoleonJoker } from '@shared/rules/napoleon';
import { BIGTWO_RANK_ORDER, BIGTWO_SUIT_ORDER } from '@shared/rules/bigtwo';
import type { HandSort } from '../stores/hand-sort-store';

/** Sort copies only; retain each game's rank conventions and keep Napoleon's jokers together. */
export function sortHand<T extends NapoleonCard>(cards: readonly T[], by: HandSort, game: GameType): T[] {
  return [...cards].sort((a, b) => {
    if (isNapoleonJoker(a)) return isNapoleonJoker(b) ? Number(a.joker === 'small') - Number(b.joker === 'small') : -1;
    if (isNapoleonJoker(b)) return 1;
    const rank = game === 'bigtwo' ? BIGTWO_RANK_ORDER.indexOf(a.rank) - BIGTWO_RANK_ORDER.indexOf(b.rank) : b.rank - a.rank;
    const suit = game === 'bigtwo' ? BIGTWO_SUIT_ORDER.indexOf(a.suit) - BIGTWO_SUIT_ORDER.indexOf(b.suit)
      : SUIT_DISPLAY_ORDER.indexOf(a.suit) - SUIT_DISPLAY_ORDER.indexOf(b.suit);
    return by === 'suit' ? suit || rank : rank || suit;
  });
}
