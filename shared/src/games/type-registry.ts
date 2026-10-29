import type { BridgeGameContract } from './bridge/types';
import type { BigTwoGameContract } from './bigtwo/types';
import type { RedPointsGameContract } from './redpoints/types';
import type { NinetyNineGameContract } from './ninetynine/types';
import type { SevensGameContract } from './sevens/types';
import type { ChinesePokerGameContract } from './chinesepoker/types';
import type { LiarsDeckGameContract } from './liarsdeck/types';
import type { LiarsDiceGameContract } from './liarsdice/types';
import type { BlackjackGameContract } from './blackjack/types';
import type { HoldemGameContract } from './holdem/types';
import type { NapoleonGameContract } from './napoleon/types';
import type { TenHalfGameContract } from './tenhalf/types';
import type { CrazyEightsGameContract } from './crazyeights/types';
import type { StudGameContract } from './stud/types';
import type { ReversiGameContract } from './reversi/types';
import type { OldMaidGameContract } from './oldmaid/types';
import type { GoFishGameContract } from './gofish/types';
import type { DouDizhuGameContract } from './doudizhu/types';
import type { JungleGameContract } from './jungle/types';
import type { GameAutomation } from '../types/game';
import type { GameSeat } from '../types/player';

/** Type-only contracts; each game owns its state, visible view, result, and room rules. */
export interface GameTypeRegistry {
  readonly bridge: BridgeGameContract;
  readonly bigtwo: BigTwoGameContract;
  readonly redpoints: RedPointsGameContract;
  readonly ninetynine: NinetyNineGameContract;
  readonly sevens: SevensGameContract;
  readonly chinesepoker: ChinesePokerGameContract;
  readonly liarsdeck: LiarsDeckGameContract;
  readonly blackjack: BlackjackGameContract;
  readonly holdem: HoldemGameContract;
  readonly napoleon: NapoleonGameContract;
  readonly tenhalf: TenHalfGameContract;
  readonly liarsdice: LiarsDiceGameContract;
  readonly crazyeights: CrazyEightsGameContract;
  readonly stud: StudGameContract;
  readonly reversi: ReversiGameContract;
  readonly oldmaid: OldMaidGameContract;
  readonly gofish: GoFishGameContract;
  readonly doudizhu: DouDizhuGameContract;
  readonly jungle: JungleGameContract;
}

export type GameType = keyof GameTypeRegistry;

export type AnyGameState = GameAutomation & GameTypeRegistry[GameType]['state'];

export type PlayerVisibleGameState = {
  readonly autoPlay?: boolean;
  readonly earlyLeaveSeats?: readonly GameSeat[];
} & GameTypeRegistry[GameType]['visible'];

export type MatchResult = GameTypeRegistry[GameType]['result'];

/** Each game owns its room-rule shape; games without configurable rules accept an empty object. */
export type GameOptionsByType = {
  readonly [K in GameType]: GameTypeRegistry[K]['options'];
};
