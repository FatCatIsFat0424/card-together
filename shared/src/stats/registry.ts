import { spadesFacts } from './spades';
import { heartsFacts } from './hearts';
import type { ResultOf } from '../games/game-definition';
import type { GameSeat, GameType, ReplaySnapshot } from '../types';
import { bigTwoFacts } from './bigtwo';
import { blackjackFacts } from './blackjack';
import { bridgeFacts } from './bridge';
import { chinesePokerFacts } from './chinesepoker';
import type { SeatFacts } from './facts';
import { holdemFacts } from './holdem';
import { liarsDeckFacts } from './liarsdeck';
import { liarsDiceFacts } from './liarsdice';
import { oldMaidFacts } from './oldmaid';
import { xiangqiFacts } from './xiangqi';
import { chessFacts } from './chess';
import { napoleonFacts } from './napoleon';
import { ninetyNineFacts } from './ninetynine';
import { redPointsFacts } from './redpoints';
import { reversiFacts } from './reversi';
import { gomokuFacts } from './gomoku';
import { goFacts } from './go';
import { jungleFacts } from './jungle';
import { sevensFacts } from './sevens';
import { tenHalfFacts } from './tenhalf';
import { crazyEightsFacts } from './crazyeights';
import { studFacts } from './stud';
import { gongZhuFacts } from './gongzhu';
import { goFishFacts } from './gofish';
import { douDizhuFacts } from './doudizhu';
import { banqiFacts } from './banqi';
import { chineseCheckersFacts } from './chinesecheckers';
import { landBattleFacts } from './landbattle';
import { battleshipFacts } from './battleship';
import { codeBreakerFacts } from './codebreaker';
import { yachtFacts } from './yacht';
import { dominoesFacts } from './dominoes';

/** Every registered game supplies facts for its own result contract. */
export const GAME_STATS: {
  readonly [K in GameType]: (result: ResultOf<K>, seat: GameSeat, frame: ReplaySnapshot | null) => SeatFacts;
} = {
  spades: spadesFacts,
  hearts: heartsFacts,
  bridge: bridgeFacts,
  bigtwo: bigTwoFacts,
  redpoints: redPointsFacts,
  ninetynine: ninetyNineFacts,
  sevens: sevensFacts,
  chinesepoker: chinesePokerFacts,
  liarsdeck: liarsDeckFacts,
  blackjack: blackjackFacts,
  holdem: (_result, seat, frame) => holdemFacts(seat, frame),
  napoleon: napoleonFacts,
  tenhalf: tenHalfFacts,
  liarsdice: liarsDiceFacts,
  crazyeights: crazyEightsFacts,
  stud: (_result, seat, frame) => studFacts(seat, frame),
  reversi: reversiFacts,
  gomoku: gomokuFacts,
  go: goFacts,
  oldmaid: oldMaidFacts,
  gofish: goFishFacts,
  gongzhu: gongZhuFacts,
  doudizhu: douDizhuFacts,
  jungle: jungleFacts,
  xiangqi: xiangqiFacts,
  chess: chessFacts,
  banqi: banqiFacts,
  chinesecheckers: chineseCheckersFacts,
  landbattle: landBattleFacts,
  battleship: battleshipFacts,
  codebreaker: codeBreakerFacts,
  yacht: yachtFacts,
  dominoes: dominoesFacts,
};

export function gameFacts<K extends GameType>(
  gameType: K, result: ResultOf<K>, seat: GameSeat, frame: ReplaySnapshot | null,
): SeatFacts {
  return GAME_STATS[gameType](result, seat, frame);
}
