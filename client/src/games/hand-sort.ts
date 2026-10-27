import type { GameType, LiarCard, NapoleonCard } from '@shared/types';
import { isNapoleonJoker } from '@shared/rules/napoleon';
import type { HandSort } from '../stores/hand-sort-store';
import { clientGame } from './registry';

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
    const { order } = clientGame(game).handSort;
    const rank = order.rank(a) - order.rank(b);
    const suit = order.suit(a) - order.suit(b);
    return by === 'suit' ? suit || rank : rank || suit;
  });
}
