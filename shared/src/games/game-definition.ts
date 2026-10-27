import type { AnyGameState, PlayerVisibleGameState } from '../types/game';
import type { GameSeat } from '../types/player';
import type { GameType } from '../types/room';
import type { FrameTiming, PresentationFrame } from './presentation';

/** Lobby grouping; every current game is a card game. */
export type GameCategory = 'cards' | 'dice' | 'board';

/** Table pieces a game renders, which decides the equippable cosmetics that apply to it. */
export type TableEquipment = 'cards' | 'chips';

/** Server state of one game type. */
export type GameStateOf<K extends GameType> = Extract<AnyGameState, { readonly gameType: K }>;

/** One recipient's filtered view of one game type. */
export type VisibleStateOf<K extends GameType> = Extract<PlayerVisibleGameState, { readonly gameType: K }>;

/** Presentation frames are derived identically from server state and from filtered views. */
export type PresentedGameOf<K extends GameType> = GameStateOf<K> | VisibleStateOf<K>;

export interface GameSeatRules {
  /** Occupied seats a match needs before it can start */
  readonly minPlayers: number;
  /** Occupied seats a match accepts; also caps the waiting-room seats */
  readonly maxPlayers: number;
  /** Occupied seats may include P5–P8 and leave others empty; otherwise exactly N, E, S, W play */
  readonly flexible: boolean;
  /** The waiting room can add seats beyond the four compass seats, up to `maxPlayers` */
  readonly expandable: boolean;
  /** Seats are named by play-order number (Player 1, Player 2, ...) instead of compass point */
  readonly numbered: boolean;
}

export interface GamePresentationRules<K extends GameType> {
  /** Public frames for one committed log entry; never reads private hands or unrevealed stock */
  readonly logFrames: (
    game: PresentedGameOf<K>, index: number, key: string, timing: FrameTiming,
  ) => readonly PresentationFrame[];
  /** Seat the closing result frame highlights, if exactly one seat won */
  readonly finishSeat: (game: PresentedGameOf<K>) => GameSeat | undefined;
  /** Closing result frame length; defaults to `FINAL_RESULT_MS` */
  readonly finishMs?: (game: PresentedGameOf<K>) => number;
}

/** Pure per-game metadata shared by the browser and the server. */
export interface GameDefinition<K extends GameType> {
  readonly gameType: K;
  readonly category: GameCategory;
  readonly equipment: readonly TableEquipment[];
  readonly seats: GameSeatRules;
  readonly presentation: GamePresentationRules<K>;
}

/** The single winner among `winners`, or none when the result is shared or empty. */
export function soleWinner(winners: readonly GameSeat[] | undefined): GameSeat | undefined {
  return winners?.length === 1 ? winners[0] : undefined;
}
