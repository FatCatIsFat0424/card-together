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
