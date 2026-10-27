// ─── Game UI module contract: what the table draws, loaded with the table shell ───

import type { ComponentType, LazyExoticComponent, ReactNode } from 'react';
import type { PresentationFrame } from '@shared/game-presentation';
import type { VisibleStateOf } from '@shared/games/game-definition';
import type { GameSeat, GameType } from '@shared/types';
import type { TranslationKey } from '../i18n';
import type { CardPlayEffect } from './card-play-effect';
import type { Translate } from './client-game';
import type { HistoryRound } from './round-builder';

/** Props of a game's own presentation content; `name` resolves a seat to its display name. */
export interface FrameProps {
  readonly frame: PresentationFrame;
  readonly name: (seat: GameSeat) => string;
}

/** Sound a presentation frame triggers when it first appears. */
export type FrameCue = 'card' | 'soft' | 'out';

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

/**
 * What the browser draws for one game. Lives behind the table shell rather than the eager client
 * registry: it holds components, the table itself behind a lazy import, and rules-heavy derivations.
 */
export interface GameUi<K extends GameType> {
  readonly gameType: K;
  /** Loaded on demand so entering one game never loads another game's table */
  readonly table: LazyExoticComponent<() => ReactNode>;
  /** How the table centre is laid out around the shared presentation */
  readonly centre?: { readonly responsive?: boolean; readonly wide?: boolean };
  readonly presentation?: GamePresentationUi<K>;
  /** Round list drawn from the rounds the client module derives; absent for games that list tricks elsewhere */
  readonly roundsView?: (props: RoundsViewProps) => ReactNode;
}
