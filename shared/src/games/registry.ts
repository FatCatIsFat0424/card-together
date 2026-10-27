import { GAME_TYPES } from '../constants/game-rules';
import type { GameType } from '../types/room';
import type { GameDefinition } from './game-definition';
import { bridgeDefinition } from './bridge/definition';
import { bigTwoDefinition } from './bigtwo/definition';
import { redPointsDefinition } from './redpoints/definition';
import { ninetyNineDefinition } from './ninetynine/definition';
import { sevensDefinition } from './sevens/definition';
import { chinesePokerDefinition } from './chinesepoker/definition';
import { liarsDeckDefinition } from './liarsdeck/definition';
import { blackjackDefinition } from './blackjack/definition';
import { holdemDefinition } from './holdem/definition';
import { napoleonDefinition } from './napoleon/definition';

/** Every game type maps to its own definition; a missing or mismatched entry fails to compile. */
export const GAME_DEFINITIONS: { readonly [K in GameType]: GameDefinition<K> } = {
  bridge: bridgeDefinition,
  bigtwo: bigTwoDefinition,
  redpoints: redPointsDefinition,
  ninetynine: ninetyNineDefinition,
  sevens: sevensDefinition,
  chinesepoker: chinesePokerDefinition,
  liarsdeck: liarsDeckDefinition,
  blackjack: blackjackDefinition,
  holdem: holdemDefinition,
  napoleon: napoleonDefinition,
};

export function gameDefinition<K extends GameType>(gameType: K): GameDefinition<K> {
  return GAME_DEFINITIONS[gameType];
}

export function isGameType(value: unknown): value is GameType {
  return (GAME_TYPES as readonly unknown[]).includes(value);
}

/** Games whose waiting room adds seats beyond the four compass seats, in lobby order. */
export const EXPANDABLE_ROOM_GAMES: readonly GameType[] = GAME_TYPES
  .filter((gameType) => GAME_DEFINITIONS[gameType].seats.expandable);
