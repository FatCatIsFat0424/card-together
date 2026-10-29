// ─── BoardTable: seats, board, moves, and match controls for GameShell's `board` slot ───

import { useCallback, useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { TableSeat } from '../../components/TableSeat';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { useRoomStore } from '../../stores/room-store';
import { useTablePerspectiveStore } from '../../stores/table-perspective-store';
import { isSpectator } from '../observer-view';
import { useReplayMode } from '../replay-mode';
import { useGamePresentation } from '../use-game-presentation';
import { DrawOfferPrompt, MatchButtons, PendingMove } from './BoardControls';
import type { BoardControls } from './BoardControls';
import { BoardMoveDrawer, BoardMoveStrip } from './BoardMoves';
import type { BoardMoveListData } from './BoardMoves';
import { boardSeatAnchorStyle, boardSeatPlaces } from './board-table';
import type { BoardSeatAnchors, BoardSeatPlace } from './board-table';
import styles from './BoardTable.module.css';

export interface BoardPendingMove {
  /** The move in the game's notation, e.g. 「車一進六」. */
  readonly text: string;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

export interface BoardTableProps {
  /** Seats playing the match, in turn order. */
  readonly seats: readonly GameSeat[];
  /** Seat drawn at the bottom: the viewer's own, or the one a spectator chose (`useTablePerspective`). */
  readonly bottomSeat: GameSeat;
  /** Usually a `BoardView` turned for `bottomSeat`. */
  readonly board: ReactNode;
  /** Drawn width over height of the board (`boardAspect`), so it is sized before it renders. */
  readonly aspect: number;
  readonly moves: BoardMoveListData;
  /** Game chips beside a seat's clock: side colour, captured pieces, progress. */
  readonly seatStats?: (seat: GameSeat) => ReactNode;
  /** Opponent places around the board; by default from turn order (`boardSeatPlaces`). */
  readonly places?: Partial<Record<GameSeat, BoardSeatPlace>>;
  /**
   * Every seat's plate pinned beside its own part of the board instead of `places`. The board fills the table,
   * draws its own edge and turn glow, and the controls gather in the lower-right corner.
   */
  readonly anchors?: Partial<Record<GameSeat, BoardSeatAnchors>>;
  /** Null for spectators and finished matches. */
  readonly controls: BoardControls | null;
  readonly pending: BoardPendingMove | null;
  /** Game actions shown where a pending move would be, such as the Land Battle Chess deployment buttons. */
  readonly tools?: ReactNode;
  /** Short note such as 「無子可下，已跳過」; defaults to the opponent-thinking or spectating line. */
  readonly status?: ReactNode;
  readonly error?: string;
  /** Disables the controls while an action is in flight or the connection is not ready. */
  readonly busy?: boolean;
  /**
   * Whether the viewer must act now, for simultaneous phases such as the Land Battle Chess deployment; by default
   * the viewer's own turn.
   */
  readonly ownTurn?: boolean;
}

/**
 * Desktop: opponents above the board, the viewer's seat and controls below, side seats beside it, and the
 * move list in the dock. Short landscape phones: the board fills the height in the middle, the left column
 * holds opponents and the last moves (tap for the full list), and the right column the controls, the fixed
 * 確認 button, and the viewer's seat. With `anchors`, the board fills the table and every plate sits beside its
 * own corner of it instead.
 */
export function BoardTable({
  seats, bottomSeat, board, aspect, moves, seatStats, places, anchors, controls, pending, tools, status, error,
  busy = false, ownTurn,
}: BoardTableProps): ReactNode {
  const { t } = useI18nStore();
  const presentation = useGamePresentation();
  const game = useGameStore((state) => state.visible);
  const turnSeat = useGameStore((state) => state.phase === 'playing' ? state.currentTurnSeat : null);
  const mySeat = useRoomStore((state) => state.mySeat);
  const replay = useReplayMode();
  const selectSeat = useTablePerspectiveStore((state) => state.selectSeat);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerId = useId();
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const watching = isSpectator(game);
  const seatPlaces = places ?? boardSeatPlaces(seats, bottomSeat);
  const opponents = seats.filter((seat) => seat !== bottomSeat);
  const at = (place: BoardSeatPlace): GameSeat[] => opponents.filter((seat) => (seatPlaces[seat] ?? 'top') === place);
  const multi = seats.length > 2;
  const locked = presentation.locked;
  // Spectators and replays watch someone else's seat, so only a seated player is ever told to move.
  const myTurn = !watching && replay === null && mySeat !== null && mySeat === bottomSeat && !locked
    && (ownTurn ?? turnSeat === mySeat);
  const statusLine = status ?? (watching ? t('table.spectating')
    : turnSeat && turnSeat !== bottomSeat && !locked && !multi ? t('board.opponentThinking') : null);

  const seat = (value: GameSeat, position: 'top' | 'left' | 'right' | 'bottom'): ReactNode =>
    <TableSeat key={value} seat={value} position={position} suppressTurn={locked}
      stats={seatStats?.(value) ?? null}
      onObserve={watching ? () => selectSeat(value) : undefined} />;

  const incoming = controls?.incoming ?? null;
  const statusItem = statusLine && <p className={styles.status} role="status">{statusLine}</p>;
  const errorItem = error && <p className={styles.error} role="alert">{error}</p>;
  const promptItem = incoming ? <div className={styles.prompt}><DrawOfferPrompt incoming={incoming} disabled={busy} compact /></div>
    : pending ? <div className={styles.prompt}>
      <PendingMove text={pending.text} onConfirm={pending.confirm} onCancel={pending.cancel} disabled={busy} />
    </div> : tools ? <div className={styles.prompt}>{tools}</div>
      // GameShell's live region already announces the turn, so the pill stays out of the accessibility tree.
      : myTurn && <p className={`${styles.prompt} ${styles.yourTurn}`} aria-hidden="true">{t('table.yourTurn')}</p>;
  const buttonsItem = controls && <div className={styles.buttons}><MatchButtons controls={controls} disabled={busy || locked} compact /></div>;
  const drawer = drawerOpen && <BoardMoveDrawer data={moves} id={drawerId} onClose={closeDrawer} />;

  if (anchors) {
    // Plates keep one place for the whole match, and the dock grows upward from the corner, so turns never shift.
    return <div className={`${styles.boardTable} ${styles.anchored} ${myTurn ? styles.myTurn : ''}`} data-board-table
      data-my-turn={myTurn || undefined}
      data-expanded-table="" style={{ '--board-aspect': String(aspect) } as CSSProperties}>
      <div className={styles.boardArea}><div className={styles.boardFrame} data-board-frame>
        {board}
        {seats.map((value) => {
          const anchor = anchors[value];
          return anchor && <div key={value} className={styles.seatAnchor} data-anchored-seat
            style={boardSeatAnchorStyle(anchor) as CSSProperties}>{seat(value, value === bottomSeat ? 'bottom' : 'left')}</div>;
        })}
      </div></div>
      {!multi && <div className={`${styles.strip} ${styles.anchoredStrip}`}>
        <BoardMoveStrip data={moves} open={drawerOpen} onOpen={() => setDrawerOpen(true)} controls={drawerId} />
      </div>}
      <div className={styles.dock}>{statusItem}{promptItem}{buttonsItem}</div>
      {errorItem}
      {drawer}
    </div>;
  }

  return <div className={`${styles.boardTable} ${multi ? styles.multi : ''} ${myTurn ? styles.myTurn : ''}`} data-board-table
    data-my-turn={myTurn || undefined}
    data-expanded-table="" style={{ '--board-aspect': String(aspect) } as CSSProperties}>
    <div className={styles.laneLeft}>
      <div className={styles.topSeats}>{at('top').map((value) => seat(value, 'top'))}</div>
      <div className={`${styles.sideSeats} ${styles.leftSeats}`}>{at('left').map((value) => seat(value, 'left'))}</div>
      {!multi && <div className={styles.strip}>
        <BoardMoveStrip data={moves} open={drawerOpen} onOpen={() => setDrawerOpen(true)} controls={drawerId} />
      </div>}
    </div>

    <div className={styles.boardArea}><div className={styles.boardFrame}>{board}</div></div>

    <div className={styles.laneRight}>
      <div className={`${styles.sideSeats} ${styles.rightSeats}`}>{at('right').map((value) => seat(value, 'right'))}</div>
      <span className={styles.spacer} />
      {statusItem}
      {errorItem}
      {promptItem}
      {buttonsItem}
      <div className={styles.ownSeat}>{seats.includes(bottomSeat) && seat(bottomSeat, 'bottom')}</div>
    </div>

    {drawer}
  </div>;
}
