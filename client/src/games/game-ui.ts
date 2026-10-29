// ─── Game UI module contract: what the table draws, loaded with the table shell ───

import type { ComponentType, LazyExoticComponent, ReactNode } from 'react';
import type { PresentationFrame } from '@shared/game-presentation';
import type { VisibleStateOf } from '@shared/games/game-definition';
import type { GameOptions, GameOptionsPayload, GameSeat, GameType } from '@shared/types';
import type { BoardSoundCue } from '../audio/card-sound';
import type { TranslationKey } from '../i18n';
import type { CardPlayEffect } from './card-play-effect';
import type { Translate } from './client-game';
import type { HistoryRound } from './round-builder';

/** Props of a game's own presentation content; `name` resolves a seat to its display name. */
export interface FrameProps {
  readonly frame: PresentationFrame;
  readonly name: (seat: GameSeat) => string;
}

/** Record type of a game's public move log. */
export type LogEntryOf<K extends GameType> = VisibleStateOf<K> extends { readonly log: readonly (infer M)[] } ? M : never;

/** Sound a presentation frame triggers when it first appears. */
export type FrameCue = 'card' | 'soft' | 'out' | 'diceRoll' | 'diceReveal' | BoardSoundCue;

export interface RoundsViewProps {
  readonly rounds: readonly HistoryRound[];
  readonly mySeat: GameSeat | null;
}

export interface GamePresentationUi<K extends GameType> {
  /** One line under the winning or trick frame, such as the final score */
  readonly summary?: (game: VisibleStateOf<K>, t: Translate) => string;
  /** Larger frames for games with more or bigger cards */
  readonly style?: { readonly large?: boolean; readonly bigCard?: boolean; readonly wideTrick?: boolean };
  /** Heading text for frames that differ from the shared `presentation.<kind>` wording */
  readonly heading?: (frame: PresentationFrame) => TranslationKey | undefined;
  /** The game's own content, drawn under the heading */
  readonly Frame?: ComponentType<FrameProps>;
  /** Effects drawn after the frame's totals */
  readonly Effects?: ComponentType<FrameProps & { readonly className: string }>;
  /** The frame draws whole hands itself instead of the cards it adds */
  readonly ownCards?: boolean;
  /** A frame that replaces the whole presentation, such as a showdown row */
  readonly takeover?: (frame: PresentationFrame, bottomSeat: GameSeat) => ReactNode;
  /** Decorative feedback for rare plays */
  readonly playEffect?: (game: VisibleStateOf<K>, frame: PresentationFrame) => CardPlayEffect | null;
  /** Sound for frames the shared rules do not cover */
  readonly cue?: (game: VisibleStateOf<K>, frame: PresentationFrame) => FrameCue | undefined;
}

/** Shared room settings surface; each game reads and updates only its own options. */
export interface RoomOptionsProps {
  readonly gameOptions?: GameOptions;
  readonly disabled: boolean;
  readonly setGameOptions: (payload: GameOptionsPayload) => void;
}

/**
 * What the browser draws for one game. Lives behind the table shell rather than the eager client
 * registry: it holds components, the table itself behind a lazy import, and rules-heavy derivations.
 */
export interface GameUi<K extends GameType> {
  readonly gameType: K;
  /** Optional room rules, displayed beside the shared room settings */
  readonly roomOptions?: ComponentType<RoomOptionsProps>;
  /** Loaded on demand so entering one game never loads another game's table */
  readonly table: LazyExoticComponent<() => ReactNode>;
  /** How the table centre is laid out around the shared presentation */
  readonly centre?: { readonly responsive?: boolean; readonly wide?: boolean };
  /** Short line centred in the table's top bar, such as the hand number; renders nothing when it has no content */
  readonly hudInfo?: ComponentType;
  /** Compact chip at the toolbar's left, such as the contract of a trick-taking game; renders nothing when it has no content */
  readonly hudChip?: ComponentType;
  readonly presentation?: GamePresentationUi<K>;
  /**
   * Board games: the sound for a move that just appeared in the public move log (`null` for silence, such as a
   * pass). Board games play no presentation frames, so this replaces `presentation.cue`. Without it every
   * placement sounds as `place` and every capture as `capture`.
   */
  readonly boardMoveCue?: (move: LogEntryOf<K>, game: VisibleStateOf<K>) => BoardSoundCue | null;
  /** Round list drawn from the rounds the client module derives; absent for games that list tricks elsewhere */
  readonly roundsView?: (props: RoundsViewProps) => ReactNode;
}
