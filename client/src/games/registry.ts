import { GAME_TYPES } from '@shared/constants';
import { gameDefinition } from '@shared/games/registry';
import type { GameCategory } from '@shared/games/game-definition';
import type { GameType } from '@shared/types';
import type { ClientGame } from './client-game';
import { bridgeClient } from './bridge/bridge-client';
import { bigTwoClient } from './bigtwo/bigtwo-client';
import { redPointsClient } from './redpoints/redpoints-client';
import { ninetyNineClient } from './ninetynine/ninetynine-client';
import { sevensClient } from './sevens/sevens-client';
import { chinesePokerClient } from './chinesepoker/chinesepoker-client';
import { liarsDeckClient } from './liarsdeck/liarsdeck-client';
import { blackjackClient } from './blackjack/blackjack-client';
import { holdemClient } from './holdem/holdem-client';
import { studClient } from './stud/stud-client';
import { reversiClient } from './reversi/reversi-client';
import { napoleonClient } from './napoleon/napoleon-client';
import { tenHalfClient } from './tenhalf/tenhalf-client';
import { oldMaidClient } from './oldmaid/oldmaid-client';
import { douDizhuClient } from './doudizhu/doudizhu-client';
import { liarsDiceClient } from './liarsdice/liarsdice-client';
import { crazyEightsClient } from './crazyeights/crazyeights-client';
import { goFishClient } from './gofish/gofish-client';

/**
 * Every game type maps to its own pure client module; a missing or mismatched entry fails to compile.
 * Loaded eagerly: keep entries to metadata and small functions, and put components, rules-heavy
 * derivations, and tables in the matching [UI registry](ui-registry.ts).
 */
export const CLIENT_GAMES: { readonly [K in GameType]: ClientGame<K> } = {
  bridge: bridgeClient,
  bigtwo: bigTwoClient,
  redpoints: redPointsClient,
  ninetynine: ninetyNineClient,
  sevens: sevensClient,
  chinesepoker: chinesePokerClient,
  liarsdeck: liarsDeckClient,
  blackjack: blackjackClient,
  holdem: holdemClient,
  napoleon: napoleonClient,
  tenhalf: tenHalfClient,
  oldmaid: oldMaidClient,
  doudizhu: douDizhuClient,
  liarsdice: liarsDiceClient,
  crazyeights: crazyEightsClient,
  stud: studClient,
  reversi: reversiClient,
  gofish: goFishClient,
};

/**
 * The client module for a game type. Called with a game's own `gameType`, its hooks accept that
 * game even when TypeScript only knows the union.
 */
export function clientGame<K extends GameType>(gameType: K): ClientGame<K> {
  return CLIENT_GAMES[gameType];
}

/** Game types of one lobby category, in lobby order. */
export function gamesInCategory(category: GameCategory): readonly GameType[] {
  return GAME_TYPES.filter((gameType) => gameDefinition(gameType).category === category);
}

const CATEGORY_ORDER: readonly GameCategory[] = ['cards', 'dice', 'board'];

/** Lobby categories that have at least one game, in tab order. */
export function lobbyCategories(): readonly GameCategory[] {
  return CATEGORY_ORDER.filter((category) => gamesInCategory(category).length > 0);
}
