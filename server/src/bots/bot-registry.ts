import type { VisibleStateOf } from '@shared/games/game-definition';
import { BJ_MIN_BET } from '@shared/rules/blackjack';
import type { GameType, NapoleonAction } from '@shared/types';
import type { BotAction } from './bot-decisions';
import { searchStrategy } from './search/search-types';
import type { SearchBotSpec } from './search/search-types';
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
  douDizhuFirstLegalAction, easyDouDizhuAction, getDouDizhuBotAction,
} from './doudizhu-strategy';
import { easyTenHalfAction, getTenHalfBotAction, tenHalfFirstLegalAction } from './tenhalf-strategy';
import { easyLiarsDiceAction, getLiarsDiceBotAction, liarsDiceFirstLegalAction } from './liarsdice-strategy';
import { crazyEightsFirstLegalAction, easyCrazyEightsAction, getCrazyEightsBotAction } from './crazyeights-strategy';
import { getStudBotAction } from './stud-strategy';
import { easyReversiAction, getReversiBotAction, reversiFirstLegalAction } from './reversi-strategy';
import { easyOldMaidAction, getOldMaidBotAction, oldMaidFirstLegalAction } from './oldmaid-strategy';
import { easyGoFishAction, getGoFishBotAction, goFishFirstLegalAction } from './gofish-strategy';
import {
  easyBigTwoAction, easyBlackjackAction, easyBridgeAction, easyChinesePokerAction, easyHoldemAction, easyLiarsDeckAction,
  easyNinetyNineAction, easyRedPointsAction, easySevensAction, easyStudAction,
} from './easy-strategy';
import {
  bigTwoFirstLegalAction, blackjackDealerDefault, blackjackFirstLegalAction, bridgeFirstLegalAction,
  chinesePokerFirstLegalAction, holdemPassiveAction, liarsDeckFirstLegalAction, napoleonFirstLegalAction,
  ninetyNineFirstLegalAction, redPointsFirstLegalAction, sevensFirstLegalAction, studPassiveAction,
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
  /**
   * Synchronous. For a game that declares `search` it must stay cheap: it then serves only human
   * timeouts and shared deadlines, never a bot's own turn.
   */
  readonly hard: Strategy<K>;
  readonly easy: Strategy<K>;
  /** A deliberately simple legal move used only after the strategy repeatedly fails */
  readonly firstLegal: (visible: VisibleStateOf<K>) => BotAction | null;
  /**
   * Opts the hard bot's own turns into the worker pool: the strategy runs off the event loop within
   * `budgetMs`, and `easy` decides instead when the search times out, fails, or no pool is running.
   */
  readonly search?: SearchBotSpec<K>;
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
  tenhalf: {
    hard: getTenHalfBotAction,
    easy: easyTenHalfAction,
    firstLegal: tenHalfFirstLegalAction,
    // A human who runs out of time stands rather than letting a bot draw for them.
    turnTimeout: (visible, { isBot, strategy }) => (isBot ? strategy() : tenHalfFirstLegalAction(visible)),
    // A human who missed the betting window stakes the minimum; bots keep their own decision.
    deadlineExpired: (visible, { isBot, strategy }) => (isBot ? strategy() : tenHalfFirstLegalAction(visible)),
  },
  liarsdice: {
    hard: getLiarsDiceBotAction,
    easy: easyLiarsDiceAction,
    firstLegal: liarsDiceFirstLegalAction,
    // A player who runs out of time raises by the least allowed or challenges, as the easy bot would.
    turnTimeout: (visible) => easyLiarsDiceAction(visible),
  },
  reversi: {
    hard: getReversiBotAction,
    easy: easyReversiAction,
    firstLegal: reversiFirstLegalAction,
    // Hard bots search in the worker pool; the cheap synchronous hard move serves only other seats.
    search: {
      strategy: searchStrategy<'reversi'>(new URL('./reversi-search.ts', import.meta.url), 'reversiSearch'),
      budgetMs: 1000,
      maxDepth: 10,
    },
    // A player who runs out of time gets a legal move by the easy policy.
    turnTimeout: (visible) => easyReversiAction(visible, Math.random),
  },
  crazyeights: { hard: getCrazyEightsBotAction, easy: easyCrazyEightsAction, firstLegal: crazyEightsFirstLegalAction },
  stud: {
    hard: getStudBotAction,
    easy: easyStudAction,
    firstLegal: studPassiveAction,
    // A player who runs out of time checks or folds rather than letting a bot stake their chips.
    turnTimeout: (visible) => studPassiveAction(visible),
  },
  oldmaid: {
    hard: getOldMaidBotAction,
    easy: easyOldMaidAction,
    firstLegal: oldMaidFirstLegalAction,
    // A player who runs out of time draws a random position, as the easy bot would.
    turnTimeout: (visible) => easyOldMaidAction(visible),
  },
  gofish: {
    hard: getGoFishBotAction,
    easy: easyGoFishAction,
    firstLegal: goFishFirstLegalAction,
    // A player who runs out of time asks as the easy bot would.
    turnTimeout: (visible) => easyGoFishAction(visible),
  },
  doudizhu: {
    // The synchronous decision serves human timeouts; bots search in the worker pool.
    hard: getDouDizhuBotAction,
    easy: easyDouDizhuAction,
    firstLegal: douDizhuFirstLegalAction,
    search: { strategy: searchStrategy<'doudizhu'>(new URL('./doudizhu-search.ts', import.meta.url), 'douDizhuSearch'), budgetMs: 900 },
    // A human who runs out of time passes the auction, passes a trick, or leads the smallest play.
    turnTimeout: (visible, { isBot, strategy }) => (isBot ? strategy() : douDizhuFirstLegalAction(visible)),
  },
};

export function gameBot<K extends GameType>(gameType: K): GameBot<K> {
  return GAME_BOTS[gameType];
}
