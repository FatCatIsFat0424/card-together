import type { BidSuit, Card, GameType, LiarCard, NapoleonCard } from '@shared/types';
import { LD_HAND_ORDER } from '@shared/rules/liarsdeck';
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

/**
 * Sort copies so every hand reads high to low from the left: ranks run high to low, suits group in the
 * game's suit order, and Napoleon's jokers lead. `trump` puts Napoleon's trump suit first, as the server deals it.
 */
export function sortHand<T extends SortableCard>(
  cards: readonly T[], by: HandSort, game: GameType, trump: BidSuit | null = null,
): T[] {
  const { order } = clientGame(game).handSort;
  const suit = (card: Card): number => trump && trump !== 'nt' && card.suit === trump ? -1 : order.suit(card);
  return [...cards].sort((a, b) => {
    if ('face' in a || 'face' in b) return 'face' in a && 'face' in b
      ? LD_HAND_ORDER.indexOf(a.face) - LD_HAND_ORDER.indexOf(b.face) : 0;
    if (isNapoleonJoker(a)) return isNapoleonJoker(b) ? Number(a.joker === 'small') - Number(b.joker === 'small') : -1;
    if (isNapoleonJoker(b)) return 1;
    const rank = order.rank(b) - order.rank(a);
    const bySuit = suit(a) - suit(b);
    return by === 'suit' ? bySuit || rank : rank || bySuit;
  });
}
