// ─── JungleTable: 7 × 9 board on the board kit, with the animal tokens, legal-move marks, and piece counts ───

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { jgCell, jgRankOf } from '@shared/rules/jungle';
import { sideRotation } from '@shared/rules/board/board-model';
import { jungleBoard } from '@shared/rules/board/boards';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { GameShell } from '../GameShell';
import { isSpectator } from '../observer-view';
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
  JUNGLE_GLYPHS, jungleAnimalKey, jungleCounts, jungleLastMove, junglePieces, jungleMovable, jungleNotation, jungleSide,
  jungleTargets,
} from './jungle-view';
import styles from './JungleTable.module.css';

const BOARD = jungleBoard();
const ASPECT = boardAspect(BOARD, 0, true);
const FILES = 'abcdefg'.split('');
const RANKS = '987654321'.split('');

type JungleWireAction =
  | { type: 'move'; from: string; to: string }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'answer-draw'; accept: boolean };

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

export function JungleTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.jungle));
  const bottomSeat = useTablePerspective();
  const { t, locale } = useI18nStore();
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);

  const handleActionResult: ActionCallback = useCallback((timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  }, [t]);

  const send = useCallback((action: JungleWireAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'jungle', action }, handleActionResult);
  }, [handleActionResult]);

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const mySeat: GameSeat | null = game && !isSpectator(game) ? game.mySeat : null;
  const movable = useMemo(() => (game ? jungleMovable(game, mySeat) : []), [game, mySeat]);
  const canMove = movable.length > 0 && connectionReady && !actionPending;
  const input = useBoardInput(
    {
      movable,
      targets: (from) => (game && from !== null ? jungleTargets(game, mySeat, from).map((target) => target.node) : []),
    },
    canMove,
    (choice) => {
      if (choice.from) send({ type: 'move', from: choice.from, to: choice.to });
    },
  );

  if (!game) return null;

  const playing = game.phase === 'playing';
  const counts = jungleCounts(game);
  const viewSide = jungleSide(game, bottomSeat);
  const glyphs = JUNGLE_GLYPHS[locale];
  const sideName = (side: 0 | 1): string => t(side === 0 ? 'jungle.red' : 'jungle.blue');
  const token = (side: 0 | 1, rank: number): ReactNode => <TokenPiece
    tone={side === 0 ? 'red' : 'blue'} variant="solid" label={glyphs[rank - 1]} badge={String(rank)} />;
  const pieces = junglePieces(game.cells).map((piece) => ({
    node: piece.node, key: `${piece.side}-${piece.rank}`, piece: token(piece.side, piece.rank),
    label: `${sideName(piece.side)} ${t(jungleAnimalKey(piece.rank))}`,
  }));
  const targets = input.selected ? jungleTargets(game, mySeat, input.selected) : [];
  const pendingMove = input.pending;
  const pendingFrom = pendingMove?.from ? jgCell(pendingMove.from) : null;
  const pendingPiece = pendingFrom === null ? 0 : game.cells[pendingFrom];
  const pendingTo = pendingMove ? jgCell(pendingMove.to) : null;

  const seatStats = (seat: GameSeat): ReactNode => {
    const side = jungleSide(game, seat);
    return <span className={styles.pieces} title={t(side === 0 ? 'jungle.sideRed' : 'jungle.sideBlue')}>
      <span className={`${styles.dot} ${side === 0 ? styles.red : styles.blue}`} aria-hidden="true" />
      <span className={styles.sideName}>{sideName(side)}</span>
      <span>{t('jungle.pieces', { n: String(counts[seat] ?? 0) })}</span>
    </span>;
  };

  const moves = {
    entries: boardMoveEntries(game.log, jungleNotation, locale, t),
    columns: game.seats,
    heads: [sideName(0), sideName(1)],
  };

  const controls = playing ? boardControls(
    { resign: true, draw: true }, game.drawOffer, mySeat, { seats: game.seats, turnSeat: game.currentTurnSeat },
    (action) => send(action),
  ) : null;

  const board = <BoardView
    board={BOARD} surface="meadow" label={t('jungle.board')} rotation={sideRotation(BOARD, viewSide)} pieces={pieces}
    lastMove={jungleLastMove(game)} selected={input.selected} selectable={movable} targets={targets}
    pending={pendingMove && pendingMove.from ? {
      from: pendingMove.from, to: pendingMove.to, piece: pendingPiece === 0 ? undefined : token(viewSide, jgRankOf(pendingPiece)),
    } : null}
    fileLabels={FILES} rankLabels={RANKS}
    onNodeClick={canMove ? input.tap : undefined} />;

  return (
    <GameShell
      info={<BoardInfo data={moves} />}
      centre={null}
      hand={null}
      board={<BoardTable
        seats={game.seats} bottomSeat={bottomSeat} board={board} aspect={ASPECT} moves={moves} seatStats={seatStats}
        controls={controls}
        pending={pendingMove && pendingMove.from ? {
          text: jungleNotation({
            seat: game.mySeat, from: pendingMove.from, to: pendingMove.to, piece: jgRankOf(pendingPiece),
            capture: pendingTo !== null && game.cells[pendingTo] !== 0, timestamp: 0,
          }, locale) ?? '',
          confirm: input.confirm, cancel: input.cancel,
        } : null}
        error={game.phase !== 'scoring' ? actionError : undefined}
        busy={actionPending || !connectionReady} />}
      overlay={game.phase === 'scoring' && game.result && <BoardResultDialog
        outcome={game.result} viewer={mySeat} moves={game.result.moves} pending={actionPending}
        error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
    />
  );
}
