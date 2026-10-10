import type { BidAction, BlackjackAction, Card, ChinesePokerArrangement, PlayerVisibleGameState, Seat } from '@shared/types';
import type { NnChoice } from '@shared/rules/ninetynine';
import { getBridgeBotAction } from './bridge-strategy';
import { getBigTwoBotAction } from './bigtwo-strategy';
import { getRedPointsBotAction } from './redpoints-strategy';
import { getNinetyNineBotAction } from './ninetynine-strategy';
import { getSevensBotAction } from './sevens-strategy';
import { getChinesePokerBotAction } from './chinesepoker-strategy';
import { getLiarsDeckBotAction } from './liarsdeck-strategy';
import { getBlackjackBotAction } from './blackjack-strategy';

export type BotAction =
  | { readonly type: 'bridge-redeal'; readonly accept: boolean }
  | { readonly type: 'bridge-bid'; readonly action: BidAction }
  | { readonly type: 'bridge-play'; readonly card: Card }
  | { readonly type: 'bigtwo-play'; readonly cards: readonly Card[] }
  | { readonly type: 'bigtwo-pass' }
  | { readonly type: 'redpoints-play'; readonly card: Card; readonly capture?: Card }
  | { readonly type: 'redpoints-flip'; readonly capture: Card }
  | { readonly type: 'ninetynine-play'; readonly card: Card; readonly choice?: NnChoice; readonly target?: Seat }
  | { readonly type: 'sevens-play'; readonly card: Card }
  | { readonly type: 'sevens-cover'; readonly card: Card }
  | { readonly type: 'chinesepoker-arrange'; readonly arrangement: ChinesePokerArrangement }
  | { readonly type: 'liarsdeck-play'; readonly cardIds: readonly number[] }
  | { readonly type: 'liarsdeck-challenge' }
  | { readonly type: 'blackjack-bet'; readonly amount: number }
  | { readonly type: 'blackjack-action'; readonly action: BlackjackAction };

/** Decisions receive only filtered player information and injectable randomness. */
export function getBotAction(
  visible: PlayerVisibleGameState, random: () => number = Math.random,
): BotAction | null {
  if (visible.phase === 'scoring') return null;
  switch (visible.gameType) {
    case 'bridge': return getBridgeBotAction(visible, random);
    case 'bigtwo': return getBigTwoBotAction(visible, random);
    case 'redpoints': return getRedPointsBotAction(visible, random);
    case 'ninetynine': return getNinetyNineBotAction(visible, random);
    case 'sevens': return getSevensBotAction(visible, random);
    case 'chinesepoker': return getChinesePokerBotAction(visible, random);
    case 'liarsdeck': return getLiarsDeckBotAction(visible, random);
    case 'blackjack': return getBlackjackBotAction(visible, random);
  }
}
