import type { GameType } from '@shared/types';
import type { GameUi } from './game-ui';
import { bridgeUi } from './bridge/bridge-ui';
import { bigTwoUi } from './bigtwo/bigtwo-ui';
import { redPointsUi } from './redpoints/redpoints-ui';
import { ninetyNineUi } from './ninetynine/ninetynine-ui';
import { sevensUi } from './sevens/sevens-ui';
import { chinesePokerUi } from './chinesepoker/chinesepoker-ui';
import { liarsDeckUi } from './liarsdeck/liarsdeck-ui';
import { blackjackUi } from './blackjack/blackjack-ui';
import { holdemUi } from './holdem/holdem-ui';
import { napoleonUi } from './napoleon/napoleon-ui';

/**
 * Every game type maps to its own UI module; a missing or mismatched entry fails to compile. Table
 * code stays behind each entry's lazy import, so loading this registry never loads a table. Import it
 * only from the table shell and its routes: the eager [client registry](registry.ts) must not.
 */
export const GAME_UIS: { readonly [K in GameType]: GameUi<K> } = {
  bridge: bridgeUi,
  bigtwo: bigTwoUi,
  redpoints: redPointsUi,
  ninetynine: ninetyNineUi,
  sevens: sevensUi,
  chinesepoker: chinesePokerUi,
  liarsdeck: liarsDeckUi,
  blackjack: blackjackUi,
  holdem: holdemUi,
  napoleon: napoleonUi,
};

/**
 * The UI module for a game type. Called with a game's own `gameType`, its hooks accept that game
 * even when TypeScript only knows the union.
 */
export function gameUi<K extends GameType>(gameType: K): GameUi<K> {
  return GAME_UIS[gameType];
}
