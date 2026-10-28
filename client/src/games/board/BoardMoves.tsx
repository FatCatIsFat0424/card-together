// ─── Move list: full list in the side panel and drawer, the last moves in the phone strip ───

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { moveRows } from '@shared/rules/board/board-move';
import type { BoardMoveRecord, MoveNotation, NotationLocale } from '@shared/rules/board/board-move';
import { AppCheckbox } from '../../components/AppCheckbox';
import { AppIcon } from '../../components/AppIcon';
import { useBoardInputStore } from '../../stores/board-input-store';
import { useI18nStore } from '../../stores/i18n-store';
import type { Translate } from '../client-game';
import styles from './BoardMoves.module.css';

/** One formatted move; `mark` is an optional leading glyph such as a marble colour. */
export interface BoardMoveEntry {
  readonly seat: GameSeat;
  readonly text: string;
  readonly mark?: ReactNode;
}

export interface BoardMoveListData {
  readonly entries: readonly BoardMoveEntry[];
  /**
   * Column per seat for two-player games, headed by `heads` (e.g. 紅／黑). Omit for one move per row, which
   * multi-player games use.
   */
  readonly columns?: readonly GameSeat[];
  readonly heads?: readonly string[];
}

/** Formats moves with the game's notation hook; moves that did not touch the board read as a pass. */
export function boardMoveEntries<M extends BoardMoveRecord>(
  moves: readonly M[], notation: MoveNotation<M>, locale: NotationLocale, t: Translate,
  mark?: (move: M) => ReactNode,
): BoardMoveEntry[] {
  return moves.map((move) => ({ seat: move.seat, text: notation(move, locale) ?? t('board.pass'), mark: mark?.(move) }));
}

interface Row {
  readonly number: number;
  readonly cells: readonly ({ readonly entry: BoardMoveEntry; readonly index: number } | null)[];
}

/** Numbered rows, newest last; `limit` keeps only the newest rows. */
export function boardMoveRows(data: BoardMoveListData, limit = Infinity): Row[] {
  const indexed = data.entries.map((entry, index) => ({ seat: entry.seat, entry, index }));
  const grouped = data.columns ? moveRows(indexed, data.columns) : indexed.map((item) => [item]);
  const rows = grouped.map((cells, row) => ({
    number: row + 1, cells: cells.map((cell) => cell && { entry: cell.entry, index: cell.index }),
  }));
  return rows.slice(Math.max(0, rows.length - limit));
}

function MoveGrid({ data, limit, header }: {
  readonly data: BoardMoveListData; readonly limit?: number; readonly header?: boolean;
}): ReactNode {
  const columns = data.columns?.length ?? 1;
  const last = data.entries.length - 1;
  return <div className={styles.grid} style={{ gridTemplateColumns: `minmax(1.6em, auto) repeat(${columns}, minmax(0, 1fr))` }}>
    {header && data.heads && <>
      <span aria-hidden="true" />
      {data.heads.map((head, index) => <span key={index} className={styles.head}>{head}</span>)}
    </>}
    {boardMoveRows(data, limit).map((row) => <div key={row.number} className={styles.row} role="listitem">
      <span className={styles.number}>{row.number}</span>
      {row.cells.map((cell, column) => cell
        ? <span key={column} className={`${styles.move} ${cell.index === last ? styles.last : ''}`}
          aria-current={cell.index === last ? 'step' : undefined}>{cell.entry.mark}{cell.entry.text}</span>
        : <span key={column} />)}
    </div>)}
  </div>;
}

/** The whole list, kept scrolled to the newest move (side panel, info sheet, and phone drawer). */
export function BoardMoveList({ data, className }: { readonly data: BoardMoveListData; readonly className?: string }): ReactNode {
  const { t } = useI18nStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const count = data.entries.length;
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [count]);
  return <section className={`${styles.list} ${className ?? ''}`} aria-labelledby={titleId}>
    <h3 id={titleId} className={styles.title}>{t('board.moves')}
      <span className={styles.count}>{t('board.movesCount', { n: String(count) })}</span></h3>
    <div ref={scrollRef} className={styles.scroll} role="list">
      {count === 0 ? <p className={styles.empty}>{t('board.movesEmpty')}</p> : <MoveGrid data={data} header />}
    </div>
  </section>;
}

/** The 「一點即走」 switch, shown with the move list so it is at hand during a game. */
export function OneTapSetting(): ReactNode {
  const { t } = useI18nStore();
  const oneTap = useBoardInputStore((state) => state.oneTap);
  const setOneTap = useBoardInputStore((state) => state.setOneTap);
  return <label className={styles.setting}>
    <AppCheckbox checked={oneTap} onChange={(event) => setOneTap(event.target.checked)} />
    <span>{t('board.oneTap')}<span className={styles.hint}>{t('board.oneTapHint')}</span></span>
  </label>;
}

/** Side-panel content for board games: the move list and the input setting. */
export function BoardInfo({ data }: { readonly data: BoardMoveListData }): ReactNode {
  return <div className={styles.info}>
    <BoardMoveList data={data} />
    <OneTapSetting />
  </div>;
}

/** Phone strip: the last four rows; tapping it opens the drawer. */
export function BoardMoveStrip({ data, open, onOpen, controls }: {
  readonly data: BoardMoveListData; readonly open: boolean; readonly onOpen: () => void; readonly controls: string;
}): ReactNode {
  const { t } = useI18nStore();
  return <button type="button" className={styles.strip} onClick={onOpen} aria-expanded={open} aria-controls={controls}
    aria-label={`${t('board.movesOpen')} · ${t('board.movesCount', { n: String(data.entries.length) })}`}>
    <span className={styles.stripHead}>{t('board.moves')}
      <span className={styles.count}>{t('board.movesCount', { n: String(data.entries.length) })}</span></span>
    {data.entries.length === 0 ? <span className={styles.empty}>{t('board.movesEmpty')}</span>
      : <MoveGrid data={data} limit={data.columns ? 4 : 5} />}
  </button>;
}

/** Phone drawer over the left of the table with the full list. */
export function BoardMoveDrawer({ data, id, onClose }: {
  readonly data: BoardMoveListData; readonly id: string; readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div ref={ref} id={id} className={styles.drawer} tabIndex={-1} role="dialog" aria-label={t('board.moves')}>
    <button type="button" className={styles.drawerClose} onClick={onClose} aria-label={t('table.close')}
      title={t('table.close')}><AppIcon name="close" /></button>
    <BoardMoveList data={data} className={styles.drawerList} />
  </div>;
}
