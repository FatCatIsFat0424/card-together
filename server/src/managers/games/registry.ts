import { GAME_TYPES } from '@shared/constants';
import type { GameType } from '@shared/types';
import type { GameAdapter } from './game-adapter';
import { bridgeAdapter } from './bridge-adapter';
import { bigTwoAdapter } from './bigtwo-adapter';
import { redPointsAdapter } from './redpoints-adapter';
import { ninetyNineAdapter } from './ninetynine-adapter';
import { sevensAdapter } from './sevens-adapter';
import { chinesePokerAdapter } from './chinesepoker-adapter';
import { liarsDeckAdapter } from './liarsdeck-adapter';
import { blackjackAdapter } from './blackjack-adapter';
import { holdemAdapter } from './holdem-adapter';
import { napoleonAdapter } from './napoleon-adapter';

/** Every game type maps to its own adapter; a missing or mismatched entry fails to compile. */
export const GAME_ADAPTERS: { readonly [K in GameType]: GameAdapter<K> } = {
  bridge: bridgeAdapter,
  bigtwo: bigTwoAdapter,
  redpoints: redPointsAdapter,
  ninetynine: ninetyNineAdapter,
  sevens: sevensAdapter,
  chinesepoker: chinesePokerAdapter,
  liarsdeck: liarsDeckAdapter,
  blackjack: blackjackAdapter,
  holdem: holdemAdapter,
  napoleon: napoleonAdapter,
};

/**
 * The adapter for a game type. Called with a game's own `gameType`, its hooks accept that game
 * even when TypeScript only knows the union.
 */
export function gameAdapter<K extends GameType>(gameType: K): GameAdapter<K> {
  return GAME_ADAPTERS[gameType];
}

const ORDERED_ADAPTERS: readonly GameAdapter<GameType>[] = GAME_TYPES.map((gameType) => gameAdapter(gameType));

/** Adapters in lobby order, which is also the order games are looked up and exported. */
export function allGameAdapters(): readonly GameAdapter<GameType>[] {
  return ORDERED_ADAPTERS;
}
