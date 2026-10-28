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
};

/** Called with a game's own type, the validator accepts that game even when TypeScript only knows the union. */
export function gameValidator<K extends GameType>(gameType: K): GameStateValidator<K> {
  return GAME_VALIDATORS[gameType];
}
