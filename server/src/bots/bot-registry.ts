import type { VisibleStateOf } from '@shared/games/game-definition';
import { BJ_MIN_BET } from '@shared/rules/blackjack';
import type { GameType, NapoleonAction } from '@shared/types';
import type { BotAction } from './bot-decisions';
import { getBridgeBotAction } from './bridge-strategy';
import { getBigTwoBotAction } from './bigtwo-strategy';
import { getRedPointsBotAction } from './redpoints-strategy';
import { getNinetyNineBotAction } from './ninetynine-strategy';
import { getSevensBotAction } from './sevens-strategy';
import { getChinesePokerBotAction } from './chinesepoker-strategy';
import { getLiarsDeckBotAction } from './liarsdeck-strategy';
import { getBlackjackBotAction } from './blackjack-strategy';
import { getHoldemBotAction } from './holdem-strategy';
import { getNapoleonBotAction } from './napoleon-strategy';
import {
  easyBigTwoAction, easyBlackjackAction, easyBridgeAction, easyChinesePokerAction, easyHoldemAction, easyLiarsDeckAction,
  easyNinetyNineAction, easyRedPointsAction, easySevensAction,
} from './easy-strategy';
import {
  bigTwoFirstLegalAction, blackjackDealerDefault, blackjackFirstLegalAction, bridgeFirstLegalAction,
  chinesePokerFirstLegalAction, holdemPassiveAction, liarsDeckFirstLegalAction, napoleonFirstLegalAction,
  ninetyNineFirstLegalAction, redPointsFirstLegalAction, sevensFirstLegalAction,
} from './fallback-actions';

type Strategy<K extends GameType> = (visible: VisibleStateOf<K>, random: () => number) => BotAction | null;

/** What an automated decision for a seat that is not a bot's own turn may fall back on. */
export interface AutomationContext {
  /** The seat holds a bot rather than a human who ran out of time */
  readonly isBot: boolean;
  /** The hard strategy's decision from the same view */
  readonly strategy: () => BotAction | null;
}

/** Decisions for one game type; every hook receives only the seat's own filtered view. */
export interface GameBot<K extends GameType> {
  readonly hard: Strategy<K>;
  readonly easy: Strategy<K>;
  /** A deliberately simple legal move used only after the strategy repeatedly fails */
  readonly firstLegal: (visible: VisibleStateOf<K>) => BotAction | null;
  /** A human whose turn clock expired; defaults to the hard strategy */
  readonly turnTimeout?: (visible: VisibleStateOf<K>, context: AutomationContext) => BotAction | null;
  /** A seat that missed a shared deadline; defaults to the hard strategy */
  readonly deadlineExpired?: (visible: VisibleStateOf<K>, context: AutomationContext) => BotAction | null;
}

function napoleonAction(action: NapoleonAction | null): BotAction | null {
  return action ? { type: 'napoleon-action', action } : null;
}

/** Every game type maps to its own bot; a missing or mismatched entry fails to compile. */
export const GAME_BOTS: { readonly [K in GameType]: GameBot<K> } = {
  bridge: { hard: getBridgeBotAction, easy: easyBridgeAction, firstLegal: bridgeFirstLegalAction },
  bigtwo: { hard: getBigTwoBotAction, easy: easyBigTwoAction, firstLegal: bigTwoFirstLegalAction },
  redpoints: { hard: getRedPointsBotAction, easy: easyRedPointsAction, firstLegal: redPointsFirstLegalAction },
  ninetynine: { hard: getNinetyNineBotAction, easy: easyNinetyNineAction, firstLegal: ninetyNineFirstLegalAction },
  sevens: { hard: getSevensBotAction, easy: easySevensAction, firstLegal: sevensFirstLegalAction },
  chinesepoker: { hard: getChinesePokerBotAction, easy: easyChinesePokerAction, firstLegal: chinesePokerFirstLegalAction },
  liarsdeck: { hard: getLiarsDeckBotAction, easy: easyLiarsDeckAction, firstLegal: liarsDeckFirstLegalAction },
  blackjack: {
    hard: getBlackjackBotAction,
    easy: easyBlackjackAction,
    firstLegal: blackjackFirstLegalAction,
    // A player dealer plays the house rule rather than the bot's judgement.
    turnTimeout: (visible, { strategy }) => (visible.dealerSeat === visible.mySeat ? blackjackDealerDefault(visible) : strategy()),
    // A human who missed the betting window stakes the minimum; bots keep their own decision.
    deadlineExpired: (_visible, { isBot, strategy }) => (isBot ? strategy() : { type: 'blackjack-bet', amount: BJ_MIN_BET }),
  },
  holdem: {
    hard: getHoldemBotAction,
    easy: easyHoldemAction,
    firstLegal: holdemPassiveAction,
    // A player who runs out of time checks or folds rather than letting a bot stake their chips.
    turnTimeout: (visible) => holdemPassiveAction(visible),
  },
  napoleon: {
    // The Napoleon strategy implements both difficulties itself.
    hard: (visible, random) => napoleonAction(getNapoleonBotAction(visible, random, 'hard')),
    easy: (visible, random) => napoleonAction(getNapoleonBotAction(visible, random, 'easy')),
    firstLegal: napoleonFirstLegalAction,
    // Everyone who left the discards open acknowledges them.
    deadlineExpired: () => ({ type: 'napoleon-action', action: { type: 'review' } }),
  },
};

export function gameBot<K extends GameType>(gameType: K): GameBot<K> {
  return GAME_BOTS[gameType];
}
