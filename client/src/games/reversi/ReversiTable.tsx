// ─── ReversiTable: 8 × 8 board on the board kit, with taps on legal cells and disc counts beside the seats ───

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { coordinateLabel } from '@shared/rules/board/board-model';
import { coordinateNotation } from '@shared/rules/board/board-move';
import { reversiBoard } from '@shared/rules/board/boards';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { GameShell } from '../GameShell';
import { isSpectator } from '../observer-view';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useTablePerspective, useViewedGame } from '../use-table-perspective';
import { BoardResultDialog } from '../board/BoardResultDialog';
import { StonePiece } from '../board/BoardPieces';
import { BoardView } from '../board/BoardView';
import { boardControls } from '../board/BoardControls';
import { BoardInfo, boardMoveEntries } from '../board/BoardMoves';
import { BoardTable } from '../board/BoardTable';
import { useBoardInput } from '../board/use-board-input';
import { boardAspect } from '../board/board-view';
import {
  reversiDiscCounts, reversiLastMove, reversiPassedSeat, reversiPieces, reversiPlacements, reversiSide, reversiTargets,
} from './reversi-view';
import styles from './ReversiTable.module.css';

const BOARD = reversiBoard();
const NOTATION = coordinateNotation(BOARD);
const ASPECT = boardAspect(BOARD, 0, true);
const FILES = 'abcdefgh'.split('');
const RANKS = '87654321'.split('');

type ReversiWireAction =
  | { type: 'place'; to: string }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'answer-draw'; accept: boolean };

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

export function ReversiTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.reversi));
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

  const send = useCallback((action: ReversiWireAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'reversi', action }, handleActionResult);
  }, [handleActionResult]);

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const mySeat: GameSeat | null = game && !isSpectator(game) ? game.mySeat : null;
  const targets = useMemo(() => (game ? reversiTargets(game, mySeat) : []), [game, mySeat]);
  const canMove = targets.length > 0 && connectionReady && !actionPending;
  const input = useBoardInput(
    { movable: [], targets: (from) => (from === null ? targets : []) },
    canMove,
    (choice) => send({ type: 'place', to: choice.to }),
  );

  if (!game) return null;

  const playing = game.phase === 'playing';
  const counts = reversiDiscCounts(game);
  const passed = reversiPassedSeat(game);
  const mySide = reversiSide(game, mySeat ?? game.seats[0]);
  const stone = (side: 0 | 1, key: string): ReactNode => <StonePiece key={key} tone={side === 0 ? 'dark' : 'light'} />;
  const pieces = reversiPieces(game.discs).map((piece) => ({
    node: piece.node, key: `disc-${piece.node}`, piece: stone(piece.side, piece.node),
    label: t(piece.side === 0 ? 'reversi.dark' : 'reversi.light'),
  }));
  const pendingMove = input.pending;

  const seatStats = (seat: GameSeat): ReactNode => {
    const side = reversiSide(game, seat);
    return <span className={styles.discs} title={t(side === 0 ? 'reversi.sideDark' : 'reversi.sideLight')}>
      <span className={`${styles.dot} ${side === 0 ? styles.dark : styles.light}`} aria-hidden="true" />
      <span className={styles.sideName}>{t(side === 0 ? 'reversi.dark' : 'reversi.light')}</span>
      <span>{t('reversi.discs', { n: String(counts[seat] ?? 0) })}</span>
    </span>;
  };

  const moves = {
    entries: boardMoveEntries(game.log, NOTATION, locale, t),
    columns: game.seats,
    heads: [t('reversi.dark'), t('reversi.light')],
  };

  const controls = playing ? boardControls(
    { resign: true, draw: true }, game.drawOffer, mySeat, { seats: game.seats, turnSeat: game.currentTurnSeat },
    (action) => send(action),
  ) : null;

  const board = <BoardView
    board={BOARD} surface="green" label={t('reversi.board')} rotation={0} pieces={pieces}
    lastMove={reversiLastMove(game)} targets={targets.map((node) => ({ node }))}
    pending={pendingMove ? { to: pendingMove.to, piece: stone(mySide, 'pending') } : null}
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
        pending={pendingMove ? {
          text: coordinateLabel(BOARD, pendingMove.to), confirm: input.confirm, cancel: input.cancel,
        } : null}
        status={passed ? t('reversi.passed', { name: seatName(passed) }) : undefined}
        error={game.phase !== 'scoring' ? actionError : undefined}
        busy={actionPending || !connectionReady} />}
      overlay={game.phase === 'scoring' && game.result && <BoardResultDialog
        outcome={game.result} viewer={mySeat} moves={reversiPlacements(game)} pending={actionPending}
        error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
    />
  );
}
