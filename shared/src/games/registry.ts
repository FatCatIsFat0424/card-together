import { GAME_TYPES } from '../constants/game-rules';
import type { GameType, TimeControl } from '../types/room';
import { DEFAULT_TIME_CONTROL } from '../time-control';
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
import { tenHalfDefinition } from './tenhalf/definition';
import { liarsDiceDefinition } from './liarsdice/definition';
import { crazyEightsDefinition } from './crazyeights/definition';
import { studDefinition } from './stud/definition';
import { reversiDefinition } from './reversi/definition';
import { oldMaidDefinition } from './oldmaid/definition';
import { goFishDefinition } from './gofish/definition';
import { douDizhuDefinition } from './doudizhu/definition';

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
  tenhalf: tenHalfDefinition,
  liarsdice: liarsDiceDefinition,
  crazyeights: crazyEightsDefinition,
  stud: studDefinition,
  reversi: reversiDefinition,
  oldmaid: oldMaidDefinition,
  gofish: goFishDefinition,
  doudizhu: douDizhuDefinition,
};

export function gameDefinition<K extends GameType>(gameType: K): GameDefinition<K> {
  return GAME_DEFINITIONS[gameType];
}

/** Turn timer a room starts with for the game. */
export function gameTimeControl(gameType: GameType): TimeControl {
  return GAME_DEFINITIONS[gameType].timeControl ?? DEFAULT_TIME_CONTROL;
}

export function isGameType(value: unknown): value is GameType {
  return (GAME_TYPES as readonly unknown[]).includes(value);
}

/** Games whose waiting room adds seats beyond the four compass seats, in lobby order. */
export const EXPANDABLE_ROOM_GAMES: readonly GameType[] = GAME_TYPES
  .filter((gameType) => GAME_DEFINITIONS[gameType].seats.expandable);
