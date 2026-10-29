// ─── XiangqiTable: 9 × 10 board on the board kit, turned so each player's side is at the bottom ───

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { sideRotation } from '@shared/rules/board/board-model';
import { xiangqiBoard } from '@shared/rules/board/boards';
import { xqCell, xqKindOf, xqPieceName, xqSideOf } from '@shared/rules/xiangqi';
import type { XqPiece, XqSide } from '@shared/rules/xiangqi';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { GameShell } from '../GameShell';
import { isSpectator } from '../observer-view';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useTablePerspective, useViewedGame } from '../use-table-perspective';
import { BoardResultDialog } from '../board/BoardResultDialog';
import { TokenPiece } from '../board/BoardPieces';
import { BoardView } from '../board/BoardView';
import { boardControls } from '../board/BoardControls';
import { BoardInfo, boardMoveEntries } from '../board/BoardMoves';
import { BoardTable } from '../board/BoardTable';
import { useBoardInput } from '../board/use-board-input';
import { boardAspect } from '../board/board-view';
import {
  XIANGQI_NOTATION, xiangqiCaptures, xiangqiCheck, xiangqiLastMove, xiangqiPendingText, xiangqiPieces, xiangqiSide,
  xiangqiTargets,
} from './xiangqi-view';
import styles from './XiangqiTable.module.css';

const BOARD = xiangqiBoard();
const ASPECT = boardAspect(BOARD, 0, true);
const EMPTY: readonly string[] = [];

/**
 * File numbers along the bottom edge, indexed by column: each side counts from its own right, red in Chinese
 * numerals (Arabic in English, matching WXF), black in Arabic digits.
 */
function fileLabels(side: XqSide, locale: string): string[] {
  return Array.from({ length: 9 }, (_, col) => {
    const file = side === 0 ? 9 - col : col + 1;
    return side === 0 && locale === 'zh-TW' ? '一二三四五六七八九'[file - 1] : String(file);
  });
}

type XiangqiWireAction =
  | { type: 'move'; from: string; to: string }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'answer-draw'; accept: boolean };

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

export function XiangqiTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.xiangqi));
  const bottomSeat = useTablePerspective();
  const { t, locale } = useI18nStore();
  const seatName = useSeatName();
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);

  const handleActionResult: ActionCallback = useCallback((timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  }, [t]);

  const send = useCallback((action: XiangqiWireAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'xiangqi', action }, handleActionResult);
  }, [handleActionResult]);

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const mySeat: GameSeat | null = game && !isSpectator(game) ? game.mySeat : null;
  const targets = useMemo(() => (game ? xiangqiTargets(game, mySeat) : new Map<string, readonly string[]>()), [game, mySeat]);
  const movable = useMemo(() => [...targets.keys()], [targets]);
  const canMove = movable.length > 0 && connectionReady && !actionPending;
  const input = useBoardInput(
    { movable, targets: (from) => (from === null ? EMPTY : targets.get(from) ?? EMPTY) },
    canMove,
    (choice) => { if (choice.from) send({ type: 'move', from: choice.from, to: choice.to }); },
  );

  if (!game) return null;

  const playing = game.phase === 'playing';
  const bottomSide = xiangqiSide(game, bottomSeat);
  const captures = xiangqiCaptures(game);
  const check = xiangqiCheck(game);
  const sideName = (side: XqSide): string => t(side === 0 ? 'xiangqi.red' : 'xiangqi.black');
  const pieceLabel = (piece: XqPiece): string => t('xiangqi.pieceLabel', {
    side: sideName(xqSideOf(piece)),
    name: locale === 'zh-TW' ? xqPieceName(piece) : t(`xiangqi.piece.${xqKindOf(piece)}`),
  });
  const token = (piece: XqPiece): ReactNode =>
    <TokenPiece tone={xqSideOf(piece) === 0 ? 'red' : 'black'} label={xqPieceName(piece)} />;
  const pieces = xiangqiPieces(game.board).map((item) => ({
    // Keyed by point: a moved piece is redrawn at its new point, which the last-move marker explains.
    node: item.node, key: `piece-${item.node}`, piece: token(item.piece), label: pieceLabel(item.piece),
  }));
  const occupied = (node: string): boolean => {
    const cell = xqCell(node);
    return cell !== null && game.board[cell] !== null;
  };
  const selectedTargets = input.selected ? targets.get(input.selected) ?? EMPTY : EMPTY;
  const pendingMove = input.pending;
  const pendingFrom = pendingMove?.from ? xqCell(pendingMove.from) : null;
  const pendingPiece = pendingFrom === null ? null : game.board[pendingFrom];
  const pendingText = (): string => {
    if (!pendingMove?.from) return '';
    const text = xiangqiPendingText(game, pendingMove.from, pendingMove.to, locale);
    const target = xqCell(pendingMove.to);
    const taken = target === null ? null : game.board[target];
    return taken ? t('xiangqi.pendingCapture', { move: text, piece: pieceLabel(taken) }) : text;
  };

  const seatStats = (seat: GameSeat): ReactNode => {
    const side = xiangqiSide(game, seat);
    const taken = captures[seat] ?? [];
    return <span className={styles.stats}>
      <span className={`${styles.side} ${side === 0 ? styles.red : styles.black}`}
        title={t(side === 0 ? 'xiangqi.sideRed' : 'xiangqi.sideBlack')}>
        {t(side === 0 ? 'xiangqi.redSide' : 'xiangqi.blackSide')}
      </span>
      {taken.length > 0 && <span className={styles.captured}
        aria-label={t('xiangqi.captured', { pieces: taken.map(pieceLabel).join(', ') })}>
        {taken.map((piece, index) => <span key={index} aria-hidden="true"
          className={`${styles.mini} ${xqSideOf(piece) === 0 ? styles.red : styles.black}`}>{xqPieceName(piece)}</span>)}
      </span>}
    </span>;
  };

  const moves = {
    entries: boardMoveEntries(game.log, XIANGQI_NOTATION, locale, t),
    columns: game.seats,
    heads: [t('xiangqi.red'), t('xiangqi.black')],
  };

  const controls = playing ? boardControls(
    { resign: true, draw: true }, game.drawOffer, mySeat, { seats: game.seats, turnSeat: game.currentTurnSeat },
    (action) => send(action),
  ) : null;

  const board = <BoardView
    board={BOARD} surface="wood" label={t('xiangqi.board')} rotation={sideRotation(BOARD, bottomSide)} pieces={pieces}
    lastMove={xiangqiLastMove(game)} selected={input.selected}
    targets={selectedTargets.map((node) => ({ node, capture: occupied(node) }))}
    pending={pendingMove ? { ...pendingMove, piece: pendingPiece ? token(pendingPiece) : undefined } : null}
    check={check} fileLabels={fileLabels(bottomSide, locale)} selectable={canMove ? movable : EMPTY}
    onNodeClick={canMove ? input.tap : undefined} />;

  return (
    <GameShell
      info={<BoardInfo data={moves} />}
      centre={null}
      hand={null}
      board={<BoardTable
        seats={game.seats} bottomSeat={bottomSeat} board={board} aspect={ASPECT} moves={moves} seatStats={seatStats}
        controls={controls}
        pending={pendingMove ? { text: pendingText(), confirm: input.confirm, cancel: input.cancel } : null}
        status={playing && check ? t('xiangqi.check', { name: seatName(game.currentTurnSeat) }) : undefined}
        error={game.phase !== 'scoring' ? actionError : undefined}
        busy={actionPending || !connectionReady} />}
      overlay={game.phase === 'scoring' && game.result && <BoardResultDialog
        outcome={game.result} viewer={mySeat} moves={game.log.length} pending={actionPending}
        error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
    />
  );
}
