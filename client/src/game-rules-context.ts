import type { GameType, PlayerVisibleGameState, RoomInfo, XiangqiOptions } from '@shared/types';
import { clientGame } from './games/registry';
import type { TranslationKey } from './i18n';

export interface GameRulesOption {
  readonly label: TranslationKey;
  readonly enabled: boolean;
}

/** The part of a rules context that depends on the game's own room rules. */
export interface GameRulesContextFields {
  readonly option: GameRulesOption | null;
  /** Further room rules of a game with more than one, listed after `option` */
  readonly moreOptions?: readonly GameRulesOption[];
  /** Match length for Blackjack; player-dealer matches depend on the seats taking part. */
  readonly blackjackHands?: number;
  /** Match length for Ten and a Half, which depends on the seats taking part. */
  readonly tenHalfHands?: number;
  /** Xiangqi handicap, described in the summary when one is set. */
  readonly xiangqiHandicap?: XiangqiOptions;
}

export interface GameRulesContext extends GameRulesContextFields {
  readonly gameType: GameType;
  readonly active: boolean;
}

export function roomRulesContext(room: RoomInfo): GameRulesContext {
  return { gameType: room.gameType, active: false, ...clientGame(room.gameType).rules.roomContext(room) };
}

export function matchRulesContext(game: PlayerVisibleGameState): GameRulesContext {
  return { gameType: game.gameType, active: game.phase !== 'scoring',
    ...clientGame(game.gameType).rules.matchContext(game) };
}
