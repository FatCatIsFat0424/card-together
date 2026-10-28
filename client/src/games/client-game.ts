// ─── Client game module contract: the small, pure per-game data the whole app can load eagerly ───

import type { VisibleStateOf } from '@shared/games/game-definition';
import type {
  Card, GameSeat, GameType, LiarCard, MatchResult, NapoleonCard, RoomInfo,
} from '@shared/types';
import type { AppIconName } from '../components/AppIcon';
import type { GameRulesContextFields } from '../game-rules-context';
import type { TranslationKey } from '../i18n';
import type { GodView } from '../stores/god-view-store';
import type { HistoryInputOf, RoundBuilder } from './round-builder';
import type { GameStoreState } from '../stores/game-store';

export type Translate = (key: TranslationKey, params?: Record<string, string>) => string;

export type ResultOf<K extends GameType> = Extract<MatchResult, { readonly gameType: K }>;

/** What the game store needs to build the next snapshot for one game. */
export interface SnapshotContext {
  readonly state: GameStoreState;
  /** Keeps the previous object when the snapshot did not change, so subscribers skip re-rendering. */
  readonly retain: <T>(previous: T | null, next: T) => T;
}

/** Display fields a spectator's chosen seat overrides; every game also gets the seat itself. */
export interface SpectatorPatch {
  readonly myHand?: readonly (Card | LiarCard | NapoleonCard)[];
  readonly myCovered?: readonly Card[];
  readonly myArrangement?: null;
  readonly myPlayed?: readonly never[];
  readonly validCards?: readonly never[];
}

/** Sort keys of one game's cards. Hands read high to low: a higher rank sorts first, a lower suit value sorts first. */
export interface HandOrder {
  readonly rank: (card: Card) => number;
  readonly suit: (card: Card) => number;
}

export interface HandSortRules {
  readonly order: HandOrder;
  /** Cards that differ only by rank have no suit order to offer */
  readonly bySuit: boolean;
}

/** One line of the history list: winners with an optional own-score detail, or plain text. */
export type ResultSummary =
  | {
    readonly kind: 'winners';
    readonly winners: readonly GameSeat[];
    /** Appended right after the winners' names */
    readonly suffix?: string;
    /** The viewer's own score or rank; omitted when the viewer did not play */
    readonly detail?: { readonly key: TranslationKey; readonly n: string } | null;
  }
  | { readonly kind: 'text'; readonly text: string };

export interface LobbyIcon {
  readonly glyph: string;
  /** Replaces the glyph with a drawn icon */
  readonly icon?: AppIconName;
  readonly red?: boolean;
}

/**
 * Everything the browser knows about one game without drawing it. The registry loads these eagerly,
 * so entries hold only small pure functions: components, rules-heavy derivations, and tables belong
 * in the game's UI module ([`GameUi`](game-ui.ts)).
 */
export interface ClientGame<K extends GameType> {
  readonly gameType: K;
  /** Store fields this game's snapshot sets; the store resets the rest and sets `gameType`. */
  readonly restoreSnapshot: (game: VisibleStateOf<K>, context: SnapshotContext) => Partial<GameStoreState>;
  /** Other seats' cards a spectator or eliminated player may see */
  readonly observedView: (game: VisibleStateOf<K>) => Partial<Omit<GodView, 'role'>>;
  /** Display fields for the seat a spectator watches from */
  readonly spectatorPatch: (view: GodView, seat: GameSeat) => SpectatorPatch;
  readonly rules: {
    /** Short reminders at the top of the rules dialog; option lines follow the room or match context */
    readonly summary: (context: GameRulesContextFields | undefined, t: Translate) => string[];
    readonly roomContext: (room: RoomInfo) => GameRulesContextFields;
    readonly matchContext: (game: VisibleStateOf<K>) => GameRulesContextFields;
  };
  /** Absent for games that list their tricks or results elsewhere */
  readonly roundHistory?: {
    /** Adds the game's rounds from its public log */
    readonly derive: (game: HistoryInputOf<K>, builder: RoundBuilder) => void;
    /** Lists only entries up to the frame on screen, so results never appear before their frame */
    readonly followsPresentation?: boolean;
  };
  readonly handSort: HandSortRules;
  /** Seats sit beside their hand instead of above it */
  readonly handBeside: boolean;
  readonly lobbyIcon: LobbyIcon;
  /** The live table's settlement in the shape history records */
  readonly settlement: (game: VisibleStateOf<K>) => MatchResult | null;
  readonly result: {
    /** Seats that won a finished match; ties list every tied seat */
    readonly winners: (result: ResultOf<K>) => readonly GameSeat[];
    /** Winners are one side rather than rivals, so several winners are never a tie */
    readonly sidesWin: boolean;
    readonly summary: (result: ResultOf<K>, mySeat: GameSeat | undefined, t: Translate) => ResultSummary;
  };
}
