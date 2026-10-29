import type { GameType } from '@shared/types';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { GameStateOf } from '@shared/games/game-definition';
import { bridgeGame, coherentBridgeGame } from './bridge-validation';
import { bigTwoGame, coherentBigTwoGame } from './bigtwo-validation';
import { redPointsGame, coherentRedPointsGame } from './redpoints-validation';
import { ninetyNineGame, coherentNinetyNineGame } from './ninetynine-validation';
import { sevensGame, coherentSevensGame } from './sevens-validation';
import { chinesePokerGame, coherentChinesePokerGame } from './chinesepoker-validation';
import { liarsDeckGame, coherentLiarsDeckGame } from './liarsdeck-validation';
import { blackjackGame, coherentBlackjackGame } from './blackjack-validation';
import { holdemGame, coherentHoldemGame } from './holdem-validation';
import { napoleonGame, coherentNapoleonGame } from './napoleon-validation';
import { tenHalfGame, coherentTenHalfGame } from './tenhalf-validation';
import { liarsDiceGame, coherentLiarsDiceGame } from './liarsdice-validation';
import { crazyEightsGame, coherentCrazyEightsGame } from './crazyeights-validation';
import { studGame, coherentStudGame } from './stud-validation';
import { reversiGame, coherentReversiGame } from './reversi-validation';
import { gomokuGame, coherentGomokuGame } from './gomoku-validation';
import { oldMaidGame, coherentOldMaidGame } from './oldmaid-validation';
import { goFishGame, coherentGoFishGame } from './gofish-validation';
import { douDizhuGame, coherentDouDizhuGame } from './doudizhu-validation';
import { jungleGame, coherentJungleGame } from './jungle-validation';
import { xiangqiGame, coherentXiangqiGame } from './xiangqi-validation';
import { banqiGame, coherentBanqiGame } from './banqi-validation';

export interface GameStateValidator<K extends GameType> {
  /** Field types and bounds of a stored game of this type */
  readonly shape: (value: ObjectValue, player: PlayerValidator) => boolean;
  /** Replaying the stored public log reproduces the stored state and result */
  readonly coherent: (state: GameStateOf<K>) => boolean;
}

export const GAME_VALIDATORS: { readonly [K in GameType]: GameStateValidator<K> } = {
  bridge: { shape: bridgeGame, coherent: coherentBridgeGame },
  bigtwo: { shape: bigTwoGame, coherent: coherentBigTwoGame },
  redpoints: { shape: redPointsGame, coherent: coherentRedPointsGame },
  ninetynine: { shape: ninetyNineGame, coherent: coherentNinetyNineGame },
  sevens: { shape: sevensGame, coherent: coherentSevensGame },
  chinesepoker: { shape: chinesePokerGame, coherent: coherentChinesePokerGame },
  liarsdeck: { shape: liarsDeckGame, coherent: coherentLiarsDeckGame },
  blackjack: { shape: blackjackGame, coherent: coherentBlackjackGame },
  holdem: { shape: holdemGame, coherent: coherentHoldemGame },
  napoleon: { shape: napoleonGame, coherent: coherentNapoleonGame },
  tenhalf: { shape: tenHalfGame, coherent: coherentTenHalfGame },
  liarsdice: { shape: liarsDiceGame, coherent: coherentLiarsDiceGame },
  crazyeights: { shape: crazyEightsGame, coherent: coherentCrazyEightsGame },
  stud: { shape: studGame, coherent: coherentStudGame },
  reversi: { shape: reversiGame, coherent: coherentReversiGame },
  gomoku: { shape: gomokuGame, coherent: coherentGomokuGame },
  oldmaid: { shape: oldMaidGame, coherent: coherentOldMaidGame },
  gofish: { shape: goFishGame, coherent: coherentGoFishGame },
  doudizhu: { shape: douDizhuGame, coherent: coherentDouDizhuGame },
  jungle: { shape: jungleGame, coherent: coherentJungleGame },
  xiangqi: { shape: xiangqiGame, coherent: coherentXiangqiGame },
  banqi: { shape: banqiGame, coherent: coherentBanqiGame },
};

/** Called with a game's own type, the validator accepts that game even when TypeScript only knows the union. */
export function gameValidator<K extends GameType>(gameType: K): GameStateValidator<K> {
  return GAME_VALIDATORS[gameType];
}
