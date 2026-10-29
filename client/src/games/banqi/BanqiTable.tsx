// ─── BanqiTable: 4 × 8 board of face-down and face-up pieces on the board kit ───

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { bqCell, bqColour, bqGlyph } from '@shared/rules/banqi';
import { coordinateLabel } from '@shared/rules/board/board-model';
import { banqiBoard } from '@shared/rules/board/boards';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { GameShell } from '../GameShell';
import { isSpectator } from '../observer-view';
import { useConnectionReady } from '../use-connection-ready';
import { useTablePerspective, useViewedGame } from '../use-table-perspective';
import { BoardResultDialog } from '../board/BoardResultDialog';
import { CoveredToken, TokenPiece } from '../board/BoardPieces';
import { BoardView } from '../board/BoardView';
import { boardControls } from '../board/BoardControls';
import { BoardInfo, boardMoveEntries } from '../board/BoardMoves';
import { BoardTable } from '../board/BoardTable';
import { useBoardInput } from '../board/use-board-input';
import { boardAspect } from '../board/board-view';
import {
  banqiCells, banqiChoices, banqiColour, banqiInChain, banqiLastMove, banqiNotation, banqiRemaining,
} from './banqi-view';
import styles from './BanqiTable.module.css';

const BOARD = banqiBoard();
const ASPECT = boardAspect(BOARD, 0, true);
const FILES = 'abcdefgh'.split('');
const RANKS = '4321'.split('');
/** Quiet moves shown as a reminder once the 50-move draw rule gets close */
const QUIET_NOTICE = 30;

type BanqiWireAction =
  | { type: 'flip'; to: string }
  | { type: 'move'; from: string; to: string }
  | { type: 'stop' }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'answer-draw'; accept: boolean };

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

const tone = (piece: number): 'red' | 'black' => (bqColour(piece) === 0 ? 'red' : 'black');

export function BanqiTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.banqi));
  const bottomSeat = useTablePerspective();
  const { t, locale } = useI18nStore();
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);

  const handleActionResult: ActionCallback = useCallback((timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  }, [t]);

  const send = useCallback((action: BanqiWireAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'banqi', action }, handleActionResult);
  }, [handleActionResult]);

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const mySeat: GameSeat | null = game && !isSpectator(game) ? game.mySeat : null;
  const choices = useMemo(() => (game ? banqiChoices(game, mySeat) : null), [game, mySeat]);
  const canMove = choices !== null && (choices.movable.length > 0 || choices.flips.length > 0)
    && connectionReady && !actionPending;
  const input = useBoardInput(
    {
      movable: choices?.movable ?? [],
      targets: (from) => (from === null ? choices?.flips ?? [] : choices?.targets(from).map((target) => target.node) ?? []),
    },
    canMove,
    (choice) => send(choice.from ? { type: 'move', from: choice.from, to: choice.to } : { type: 'flip', to: choice.to }),
  );

  if (!game || !choices) return null;

  const playing = game.phase === 'playing';
  const [red, black] = banqiRemaining(game);
  const label = (node: string): string => coordinateLabel(BOARD, node);
  const pieces = banqiCells(game).map((cell) => ({
    node: cell.node,
    key: `cell-${cell.node}`,
    piece: cell.piece !== null
      ? <TokenPiece tone={tone(cell.piece)} label={bqGlyph(cell.piece)} />
      : <g>
        <CoveredToken />
        {cell.secret !== null && <text className={styles.secret} fontSize={0.46} dominantBaseline="central" textAnchor="middle">
          {bqGlyph(cell.secret)}
        </text>}
      </g>,
    label: cell.piece !== null ? bqGlyph(cell.piece) : t('banqi.covered'),
  }));

  const seatStats = (seat: GameSeat): ReactNode => {
    const colour = banqiColour(game, seat);
    if (colour === null) return <span className={styles.chip}>{t('banqi.undecided')}</span>;
    return <span className={styles.chip} title={t(colour === 0 ? 'banqi.sideRed' : 'banqi.sideBlack')}>
      <span className={`${styles.dot} ${colour === 0 ? styles.red : styles.black}`} aria-hidden="true" />
      <span>{t(colour === 0 ? 'banqi.red' : 'banqi.black')}</span>
      <span>{t('banqi.left', { n: String(colour === 0 ? red : black) })}</span>
    </span>;
  };

  const moves = {
    entries: boardMoveEntries(game.log, banqiNotation, locale, t),
    columns: game.seats,
    heads: [t('banqi.firstMover'), t('banqi.secondMover')],
  };

  const controls = playing ? boardControls(
    { resign: true, draw: true }, game.drawOffer, mySeat, { seats: game.seats, turnSeat: game.currentTurnSeat },
    (action) => send(action),
  ) : null;

  const pendingMove = input.pending;
  const fromCell = pendingMove?.from ? bqCell(pendingMove.from) : null;
  const movingPiece = fromCell === null ? null : game.board[fromCell];
  const pendingPiece = pendingMove === null ? null
    : movingPiece !== null && movingPiece >= 0
      ? <TokenPiece tone={tone(movingPiece)} label={bqGlyph(movingPiece)} /> : <CoveredToken />;

  const inChain = banqiInChain(game, mySeat);
  const status: ReactNode = inChain
    ? <>{t('banqi.chainPrompt')} <button type="button" className={styles.stop} disabled={actionPending || !connectionReady}
      onClick={() => send({ type: 'stop' })}>{t('banqi.stopChain')}</button></>
    : playing && game.quietMoves >= QUIET_NOTICE ? t('banqi.quiet', { n: String(game.quietMoves) }) : undefined;

  const board = <BoardView
    board={BOARD} surface="wood" label={t('banqi.board')} rotation={0} pieces={pieces}
    lastMove={banqiLastMove(game)}
    selected={input.selected}
    selectable={choices.movable}
    targets={input.selected ? choices.targets(input.selected) : choices.flips.map((node) => ({ node }))}
    pending={pendingMove && pendingPiece ? { ...pendingMove, piece: pendingPiece } : null}
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
          text: pendingMove.from
            ? t('banqi.pendingMove', { from: label(pendingMove.from), to: label(pendingMove.to) })
            : t('banqi.pendingFlip', { at: label(pendingMove.to) }),
          confirm: input.confirm, cancel: input.cancel,
        } : null}
        status={status}
        error={game.phase !== 'scoring' ? actionError : undefined}
        busy={actionPending || !connectionReady} />}
      overlay={game.phase === 'scoring' && game.result && <BoardResultDialog
        outcome={game.result} viewer={mySeat} moves={game.result.moves} pending={actionPending}
        error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
    />
  );
}
