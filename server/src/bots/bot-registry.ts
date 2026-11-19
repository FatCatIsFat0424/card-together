import { getSpadesBotAction, spadesFirstLegalAction } from './spades-strategy';
import { getHeartsBotAction, heartsFirstLegalAction } from './hearts-strategy';
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
import { douDizhuFirstLegalAction, getDouDizhuBotAction } from './doudizhu-strategy';
import { getTenHalfBotAction, tenHalfFirstLegalAction } from './tenhalf-strategy';
import { getLiarsDiceBotAction, liarsDiceFirstLegalAction } from './liarsdice-strategy';
import { crazyEightsFirstLegalAction, getCrazyEightsBotAction } from './crazyeights-strategy';
import { getStudBotAction } from './stud-strategy';
import { getReversiBotAction, reversiFirstLegalAction } from './reversi-strategy';
import { getGomokuBotAction, gomokuFirstLegalAction } from './gomoku-strategy';
import { getGoBotAction, goFirstLegalAction } from './go-strategy';
import { goConfirmAction } from './go-search';
import { autoDeployAction, getLandBattleBotAction, landBattleFirstLegalAction } from './landbattle-strategy';
import { autoPlaceAction, battleshipFirstLegalAction, getBattleshipBotAction } from './battleship-strategy';
import { codeBreakerFirstLegalAction, getCodeBreakerBotAction } from './codebreaker-strategy';
import { getYachtBotAction, yachtFirstLegalAction, yachtTimeoutAction } from './yacht-strategy';
import { dominoesFirstLegalAction, getDominoesBotAction } from './dominoes-strategy';
import { getOldMaidBotAction, oldMaidFirstLegalAction } from './oldmaid-strategy';
import { getGongZhuBotAction, gongZhuFirstLegalAction } from './gongzhu-strategy';
import { getGoFishBotAction, goFishFirstLegalAction } from './gofish-strategy';
import { getJungleBotAction, jungleFirstLegalAction } from './jungle-strategy';
import { getXiangqiBotAction, xiangqiFirstLegalAction } from './xiangqi-strategy';
import { chessFirstLegalAction, getChessBotAction } from './chess-strategy';
import { banqiFirstLegalAction, getBanqiBotAction } from './banqi-strategy';
import { chineseCheckersFirstLegalAction, getChineseCheckersBotAction } from './chinesecheckers-strategy';
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
  /** The bot's decision from the same view: the worker pool's result when the timeout searched for it */
  readonly strategy: () => BotAction | null;
}

/** Decisions for one game type; every hook receives only the seat's own filtered view. */
export interface GameBot<K extends GameType> {
  /**
   * The bot's synchronous decision. For a game that declares `search` it must stay cheap: it then
   * decides only when no pool runs, a search fails, or a shared deadline expires.
   */
  readonly decide: Strategy<K>;
  /** A deliberately simple legal move used only after the strategy repeatedly fails */
  readonly firstLegal: (visible: VisibleStateOf<K>) => BotAction | null;
  /**
   * Moves bot turns and human turn timeouts into the worker pool: the search runs off the event loop
   * within `budgetMs`, and `decide` answers instead when the search times out, fails, or no pool is running.
   */
  readonly search?: SearchBotSpec<K>;
  /** A human whose turn clock expired; defaults to the bot's decision */
  readonly turnTimeout?: (visible: VisibleStateOf<K>, context: AutomationContext) => BotAction | null;
  /** A seat that missed a shared deadline; defaults to the bot's decision */
  readonly deadlineExpired?: (visible: VisibleStateOf<K>, context: AutomationContext) => BotAction | null;
}

function napoleonAction(action: NapoleonAction | null): BotAction | null {
  return action ? { type: 'napoleon-action', action } : null;
}

/** Every game type maps to its own bot; a missing or mismatched entry fails to compile. */
export const GAME_BOTS: { readonly [K in GameType]: GameBot<K> } = {
  spades: { decide: getSpadesBotAction, firstLegal: spadesFirstLegalAction,
    turnTimeout: (visible) => getSpadesBotAction(visible) },
  hearts: { decide: getHeartsBotAction, firstLegal: heartsFirstLegalAction },
  bridge: {
    // The synchronous heuristic is the fallback; bots and timeouts sample hidden hands and solve them in the worker pool.
    decide: getBridgeBotAction,
    firstLegal: bridgeFirstLegalAction,
    search: { strategy: searchStrategy<'bridge'>(new URL('./bridge-search.ts', import.meta.url), 'bridgeSearch'), budgetMs: 1500 },
    // A human who lets a redeal offer time out keeps the deal; bots accept with their weak hand.
    turnTimeout: (_visible, { isBot, strategy }) => {
      const action = strategy();
      return !isBot && action?.type === 'bridge-redeal' ? { type: 'bridge-redeal', accept: false } : action;
    },
  },
  bigtwo: { decide: getBigTwoBotAction, firstLegal: bigTwoFirstLegalAction },
  redpoints: { decide: getRedPointsBotAction, firstLegal: redPointsFirstLegalAction },
  ninetynine: { decide: getNinetyNineBotAction, firstLegal: ninetyNineFirstLegalAction },
  sevens: { decide: getSevensBotAction, firstLegal: sevensFirstLegalAction },
  chinesepoker: { decide: getChinesePokerBotAction, firstLegal: chinesePokerFirstLegalAction },
  liarsdeck: { decide: getLiarsDeckBotAction, firstLegal: liarsDeckFirstLegalAction },
  blackjack: {
    decide: getBlackjackBotAction,
    firstLegal: blackjackFirstLegalAction,
    // A player dealer plays the house rule rather than the bot's judgement.
    turnTimeout: (visible, { strategy }) => (visible.dealerSeat === visible.mySeat ? blackjackDealerDefault(visible) : strategy()),
    // A human who missed the betting window stakes the minimum; bots keep their own decision.
    deadlineExpired: (_visible, { isBot, strategy }) => (isBot ? strategy() : { type: 'blackjack-bet', amount: BJ_MIN_BET }),
  },
  holdem: {
    decide: getHoldemBotAction,
    firstLegal: holdemPassiveAction,
    // A player who runs out of time checks or folds rather than letting a bot stake their chips.
    turnTimeout: (visible) => holdemPassiveAction(visible),
  },
  napoleon: {
    decide: (visible, random) => napoleonAction(getNapoleonBotAction(visible, random)),
    firstLegal: napoleonFirstLegalAction,
    // Everyone who left the discards open acknowledges them.
    deadlineExpired: () => ({ type: 'napoleon-action', action: { type: 'review' } }),
  },
  tenhalf: {
    decide: getTenHalfBotAction,
    firstLegal: tenHalfFirstLegalAction,
    // A human who runs out of time stands rather than letting a bot draw for them.
    turnTimeout: (visible, { isBot, strategy }) => (isBot ? strategy() : tenHalfFirstLegalAction(visible)),
    // A human who missed the betting window stakes the minimum; bots keep their own decision.
    deadlineExpired: (visible, { isBot, strategy }) => (isBot ? strategy() : tenHalfFirstLegalAction(visible)),
  },
  liarsdice: { decide: getLiarsDiceBotAction, firstLegal: liarsDiceFirstLegalAction },
  reversi: {
    // The cheap synchronous move is the fallback; bot turns and timeouts search in the worker pool.
    decide: getReversiBotAction,
    firstLegal: reversiFirstLegalAction,
    search: {
      strategy: searchStrategy<'reversi'>(new URL('./reversi-search.ts', import.meta.url), 'reversiSearch'),
      budgetMs: 1000,
      maxDepth: 10,
    },
  },
  jungle: {
    // The cheap synchronous move is the fallback; bot turns and timeouts search in the worker pool.
    decide: getJungleBotAction,
    firstLegal: jungleFirstLegalAction,
    search: {
      strategy: searchStrategy<'jungle'>(new URL('./jungle-search.ts', import.meta.url), 'jungleSearch'),
      budgetMs: 1000,
      maxDepth: 12,
    },
  },
  gomoku: {
    // The cheap synchronous move is the fallback; bot turns and timeouts search in the worker pool.
    decide: getGomokuBotAction,
    firstLegal: gomokuFirstLegalAction,
    search: {
      strategy: searchStrategy<'gomoku'>(new URL('./gomoku-search.ts', import.meta.url), 'gomokuSearch'),
      budgetMs: 1000,
      maxDepth: 10,
    },
  },
  crazyeights: { decide: getCrazyEightsBotAction, firstLegal: crazyEightsFirstLegalAction },
  stud: {
    decide: getStudBotAction,
    firstLegal: studPassiveAction,
    // A player who runs out of time checks or folds rather than letting a bot stake their chips.
    turnTimeout: (visible) => studPassiveAction(visible),
  },
  oldmaid: { decide: getOldMaidBotAction, firstLegal: oldMaidFirstLegalAction },
  gongzhu: { decide: getGongZhuBotAction, firstLegal: gongZhuFirstLegalAction },
  gofish: { decide: getGoFishBotAction, firstLegal: goFishFirstLegalAction },
  doudizhu: {
    // The synchronous heuristic is the fallback; bots search in the worker pool.
    decide: getDouDizhuBotAction,
    firstLegal: douDizhuFirstLegalAction,
    search: { strategy: searchStrategy<'doudizhu'>(new URL('./doudizhu-search.ts', import.meta.url), 'douDizhuSearch'), budgetMs: 900 },
    // A human who runs out of time passes the auction, passes a trick, or leads the smallest play.
    turnTimeout: (visible, { isBot, strategy }) => (isBot ? strategy() : douDizhuFirstLegalAction(visible)),
  },
  go: {
    // The cheap synchronous move is the fallback; bot turns and timeouts search in the worker pool (UCT with RAVE,
    // capped by iterations per board size). The same strategy answers the marking of dead stones.
    decide: getGoBotAction,
    firstLegal: goFirstLegalAction,
    search: {
      strategy: searchStrategy<'go'>(new URL('./go-search.ts', import.meta.url), 'goSearch'),
      budgetMs: 2500,
    },
    // A human who missed the marking deadline accepts the proposed dead stones; bots keep their own answer.
    deadlineExpired: (visible, { isBot, strategy }) => (isBot ? strategy() : goConfirmAction(visible)),
  },
  xiangqi: {
    // The cheap synchronous move is the fallback; bot turns and timeouts search in the worker pool.
    decide: getXiangqiBotAction,
    firstLegal: xiangqiFirstLegalAction,
    search: {
      strategy: searchStrategy<'xiangqi'>(new URL('./xiangqi-search.ts', import.meta.url), 'xiangqiSearch'),
      budgetMs: 1500,
      maxDepth: 12,
    },
  },
  chess: {
    // The cheap synchronous move is the fallback; bot turns and timeouts search in the worker pool.
    decide: getChessBotAction,
    firstLegal: chessFirstLegalAction,
    search: {
      strategy: searchStrategy<'chess'>(new URL('./chess-search.ts', import.meta.url), 'chessSearch'),
      budgetMs: 1500,
      maxDepth: 12,
    },
  },
  banqi: {
    // The cheap synchronous move is the fallback; bot turns and timeouts search in the worker pool.
    decide: getBanqiBotAction,
    firstLegal: banqiFirstLegalAction,
    search: {
      strategy: searchStrategy<'banqi'>(new URL('./banqi-search.ts', import.meta.url), 'banqiSearch'),
      budgetMs: 1000,
      maxDepth: 6,
    },
  },
  chinesecheckers: {
    // The cheap one-move evaluation is the fallback; bot turns and timeouts look two moves ahead in the worker pool.
    decide: getChineseCheckersBotAction,
    firstLegal: chineseCheckersFirstLegalAction,
    search: {
      strategy: searchStrategy<'chinesecheckers'>(new URL('./chinesecheckers-search.ts', import.meta.url), 'chineseCheckersSearch'),
      budgetMs: 800,
      maxDepth: 2,
    },
  },
  landbattle: {
    // Bots deploy from a template; bot turns and timeouts sample hidden identities in the worker pool.
    decide: getLandBattleBotAction,
    firstLegal: landBattleFirstLegalAction,
    search: {
      strategy: searchStrategy<'landbattle'>(new URL('./landbattle-search.ts', import.meta.url), 'landBattleSearch'),
      budgetMs: 1000,
    },
    // A human who missed the deployment deadline gets the automatic deployment; bots keep their own.
    deadlineExpired: (visible, { isBot, strategy }) => (isBot ? strategy() : autoDeployAction(visible, Math.random)),
  },
  battleship: {
    // The density search covers at most a few thousand ship placements, so it runs on the event loop.
    decide: getBattleshipBotAction,
    firstLegal: battleshipFirstLegalAction,
    // A human who missed the placement deadline gets a random fleet; bots keep their own.
    deadlineExpired: (visible, { isBot, strategy }) => (isBot ? strategy() : autoPlaceAction(visible, Math.random)),
  },
  codebreaker: {
    // Deduction over at most a few thousand codes with sampled scoring, cheap enough for the event loop.
    decide: getCodeBreakerBotAction,
    firstLegal: codeBreakerFirstLegalAction,
  },
  yacht: {
    decide: getYachtBotAction,
    firstLegal: yachtFirstLegalAction,
    // A player who runs out of time rolls if needed and writes the dice into the best box.
    turnTimeout: yachtTimeoutAction,
    // A round that ran out completes every unfinished turn the same way, bots included.
    deadlineExpired: yachtTimeoutAction,
  },
  dominoes: {
    decide: getDominoesBotAction,
    firstLegal: dominoesFirstLegalAction,
    // A player who runs out of time plays the heaviest legal tile, or draws or passes.
    turnTimeout: dominoesFirstLegalAction,
  },
};

export function gameBot<K extends GameType>(gameType: K): GameBot<K> {
  return GAME_BOTS[gameType];
}
