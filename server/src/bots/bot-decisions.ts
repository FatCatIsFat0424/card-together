import type { GameActionEnvelope } from '@shared/games/actions';
import type {
  BidAction, BlackjackAction, BlackjackDealerAction, Card, ChinesePokerArrangement, HoldemAction, NapoleonAction,
  PlayerVisibleGameState,
  BotDifficulty, GameSeat,
} from '@shared/types';
import type { NnChoice } from '@shared/rules/ninetynine';
import { gameBot } from './bot-registry';

export type BotAction =
  | { readonly type: 'game-action'; readonly request: GameActionEnvelope }
  | { readonly type: 'bridge-redeal'; readonly accept: boolean }
  | { readonly type: 'bridge-bid'; readonly action: BidAction }
  | { readonly type: 'bridge-play'; readonly card: Card }
  | { readonly type: 'bigtwo-play'; readonly cards: readonly Card[] }
  | { readonly type: 'bigtwo-pass' }
  | { readonly type: 'redpoints-play'; readonly card: Card; readonly capture?: Card }
  | { readonly type: 'redpoints-flip'; readonly capture: Card }
  | { readonly type: 'ninetynine-play'; readonly card: Card; readonly choice?: NnChoice; readonly target?: GameSeat }
  | { readonly type: 'sevens-play'; readonly card: Card }
  | { readonly type: 'sevens-cover'; readonly card: Card }
  | { readonly type: 'chinesepoker-arrange'; readonly arrangement: ChinesePokerArrangement }
  | { readonly type: 'liarsdeck-play'; readonly cardIds: readonly number[] }
  | { readonly type: 'liarsdeck-challenge' }
  | { readonly type: 'blackjack-bet'; readonly amount: number }
  | { readonly type: 'blackjack-action'; readonly action: BlackjackAction }
  | { readonly type: 'blackjack-dealer'; readonly action: BlackjackDealerAction }
  | { readonly type: 'holdem-action'; readonly action: HoldemAction }
  | { readonly type: 'napoleon-action'; readonly action: NapoleonAction };

/** Decisions receive only filtered player information and injectable randomness. */
export function getBotAction(
  visible: PlayerVisibleGameState, random: () => number = Math.random,
  difficulty: BotDifficulty = 'hard',
): BotAction | null {
  if (visible.phase === 'scoring') return null;
  const bot = gameBot(visible.gameType);
  return difficulty === 'easy' ? bot.easy(visible, random) : bot.hard(visible, random);
}

/** Basic decisions use only the current legal choices, without opponent inference or lookahead. */
export function getEasyBotAction(
  visible: PlayerVisibleGameState, random: () => number = Math.random,
): BotAction | null {
  return getBotAction(visible, random, 'easy');
}
