import type { GameType } from '../types/room';
import { isGameType } from './registry';
import { actionRecord } from './action-validation';
import { parseAction as parseBridgeAction } from './bridge/actions';
import type { BridgeAction } from './bridge/actions';
import { parseAction as parseBigTwoAction } from './bigtwo/actions';
import type { BigTwoAction } from './bigtwo/actions';
import { parseAction as parseRedPointsAction } from './redpoints/actions';
import type { RedPointsAction } from './redpoints/actions';
import { parseAction as parseNinetyNineAction } from './ninetynine/actions';
import type { NinetyNineAction } from './ninetynine/actions';
import { parseAction as parseSevensAction } from './sevens/actions';
import type { SevensAction } from './sevens/actions';
import { parseAction as parseChinesePokerAction } from './chinesepoker/actions';
import type { ChinesePokerAction } from './chinesepoker/actions';
import { parseAction as parseLiarsDeckAction } from './liarsdeck/actions';
import type { LiarsDeckAction } from './liarsdeck/actions';
import { parseAction as parseBlackjackGameAction } from './blackjack/actions';
import type { BlackjackGameAction } from './blackjack/actions';
import { parseAction as parseHoldemAction } from './holdem/actions';
import type { HoldemAction } from './holdem/actions';
import { parseAction as parseNapoleonAction } from './napoleon/actions';
import type { NapoleonAction } from './napoleon/actions';
import { parseAction as parseTenHalfAction } from './tenhalf/actions';
import type { TenHalfGameAction } from './tenhalf/actions';
import { parseAction as parseLiarsDiceAction } from './liarsdice/actions';
import type { LiarsDiceAction } from './liarsdice/actions';
import { parseAction as parseCrazyEightsAction } from './crazyeights/actions';
import type { CrazyEightsAction } from './crazyeights/actions';
import { parseAction as parseStudAction } from './stud/actions';
import type { StudAction } from './stud/actions';
import { parseAction as parseReversiAction } from './reversi/actions';
import type { ReversiGameAction } from './reversi/actions';
import { parseAction as parseGomokuAction } from './gomoku/actions';
import type { GomokuGameAction } from './gomoku/actions';
import { parseAction as parseOldMaidAction } from './oldmaid/actions';
import type { OldMaidAction } from './oldmaid/actions';
import { parseAction as parseGoFishAction } from './gofish/actions';
import type { GoFishAction } from './gofish/actions';
import { parseAction as parseDouDizhuAction } from './doudizhu/actions';
import type { DouDizhuAction } from './doudizhu/actions';
import { parseAction as parseJungleAction } from './jungle/actions';
import type { JungleGameAction } from './jungle/actions';
import { parseAction as parseXiangqiAction } from './xiangqi/actions';
import type { XiangqiGameAction } from './xiangqi/actions';

/** Action contracts are indexed separately from lobby and presentation metadata. */
export interface GameActionMap {
  bridge: BridgeAction;
  bigtwo: BigTwoAction;
  redpoints: RedPointsAction;
  ninetynine: NinetyNineAction;
  sevens: SevensAction;
  chinesepoker: ChinesePokerAction;
  liarsdeck: LiarsDeckAction;
  blackjack: BlackjackGameAction;
  holdem: HoldemAction;
  napoleon: NapoleonAction;
  tenhalf: TenHalfGameAction;
  liarsdice: LiarsDiceAction;
  crazyeights: CrazyEightsAction;
  stud: StudAction;
  reversi: ReversiGameAction;
  gomoku: GomokuGameAction;
  oldmaid: OldMaidAction;
  gofish: GoFishAction;
  doudizhu: DouDizhuAction;
  jungle: JungleGameAction;
  xiangqi: XiangqiGameAction;
}

export type GameActionEnvelope<K extends GameType = GameType> = {
  [G in K]: { gameType: G; action: GameActionMap[G] };
}[K];

export const ACTION_PARSERS: { readonly [K in GameType]: (value: unknown) => GameActionMap[K] | string } = {
  bridge: parseBridgeAction,
  bigtwo: parseBigTwoAction,
  redpoints: parseRedPointsAction,
  ninetynine: parseNinetyNineAction,
  sevens: parseSevensAction,
  chinesepoker: parseChinesePokerAction,
  liarsdeck: parseLiarsDeckAction,
  blackjack: parseBlackjackGameAction,
  holdem: parseHoldemAction,
  napoleon: parseNapoleonAction,
  tenhalf: parseTenHalfAction,
  liarsdice: parseLiarsDiceAction,
  crazyeights: parseCrazyEightsAction,
  stud: parseStudAction,
  reversi: parseReversiAction,
  gomoku: parseGomokuAction,
  oldmaid: parseOldMaidAction,
  gofish: parseGoFishAction,
  doudizhu: parseDouDizhuAction,
  jungle: parseJungleAction,
  xiangqi: parseXiangqiAction,
};

function parseEnvelope<K extends GameType>(gameType: K, value: unknown): GameActionEnvelope<K> | string {
  const action = ACTION_PARSERS[gameType](value);
  return typeof action === 'string' ? action : { gameType, action } as GameActionEnvelope<K>;
}

/** Rebuilds the envelope and every nested action field from untrusted wire input. */
export function parseGameAction(value: unknown): GameActionEnvelope | string {
  const payload = actionRecord(value);
  return payload && isGameType(payload.gameType)
    ? parseEnvelope(payload.gameType, payload.action) : 'Invalid game action.';
}
