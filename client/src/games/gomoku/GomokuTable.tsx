// ─── GomokuTable: 15 × 15 intersections on the board kit, with a clear pending stone for fingertip taps ───

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { gomokuDefinition } from '@shared/games/gomoku/definition';
import type { GmSide } from '@shared/rules/gomoku';
import { coordinateLabel } from '@shared/rules/board/board-model';
import { gomokuBoard } from '@shared/rules/board/boards';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { Button } from '../../components/Button';
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
  gomokuLastMove, gomokuMoves, gomokuNextSide, gomokuNotation, gomokuSide, gomokuStageOf,
  gomokuStoneCount, gomokuStones, gomokuWinningNodes,
} from './gomoku-view';
import styles from './GomokuTable.module.css';

const BOARD = gomokuBoard();
const ASPECT = boardAspect(BOARD, 0, true);
const FILES = 'abcdefghijklmno'.split('');
const RANKS = Array.from({ length: 15 }, (_, index) => String(15 - index));

type GomokuWireAction =
  | { type: 'place'; to: string }
  | { type: 'choose-side'; swap: boolean }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'answer-draw'; accept: boolean };

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

const tone = (side: GmSide): 'dark' | 'light' => (side === 0 ? 'dark' : 'light');

/** The stone waiting for confirmation: a crosshair over the intersection makes the exact point unmistakable. */
function PendingStone({ side }: { readonly side: GmSide }): ReactNode {
  return <g>
    <path className={styles.cross} d="M-0.9 0H0.9M0 -0.9V0.9" />
    <StonePiece tone={tone(side)} />
  </g>;
}

export function GomokuTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.gomoku));
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

  const send = useCallback((action: GomokuWireAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'gomoku', action }, handleActionResult);
  }, [handleActionResult]);

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const mySeat: GameSeat | null = game && !isSpectator(game) ? game.mySeat : null;
  const moves = useMemo(() => (game ? gomokuMoves(game, mySeat) : { targets: [], forbidden: [] }), [game, mySeat]);
  const canMove = moves.targets.length > 0 && connectionReady && !actionPending;
  const input = useBoardInput(
    { movable: [], targets: (from) => (from === null ? moves.targets : []) },
    canMove,
    (choice) => send({ type: 'place', to: choice.to }),
  );

  if (!game) return null;

  const playing = game.phase === 'playing';
  const stage = gomokuStageOf(game);
  const nextSide = gomokuNextSide(game);
  const winning = new Set(gomokuWinningNodes(game));
  const colourName = (side: GmSide): string => t(side === 0 ? 'gomoku.black' : 'gomoku.white');
  const pieces = [
    ...gomokuStones(game.stones).map((stone) => ({
      node: stone.node, key: `stone-${stone.node}`, label: colourName(stone.side),
      piece: <g>
        <StonePiece tone={tone(stone.side)} />
        {winning.has(stone.node) && <circle className={styles.win} r={0.56} />}
      </g>,
    })),
    ...moves.forbidden.map((node) => ({
      node, key: `forbidden-${node}`, label: t('gomoku.forbidden'),
      piece: <path className={styles.forbidden} d="M-0.24 -0.24L0.24 0.24M0.24 -0.24L-0.24 0.24" />,
    })),
  ];
  const pendingMove = input.pending;

  const seatStats = (seat: GameSeat): ReactNode => {
    const side = gomokuSide(game, seat);
    return <span className={styles.side} title={t(side === 0 ? 'gomoku.sideBlack' : 'gomoku.sideWhite')}>
      <span className={`${styles.dot} ${side === 0 ? styles.black : styles.white}`} aria-hidden="true" />
      <span>{colourName(side)}</span>
    </span>;
  };

  const moveList = {
    entries: boardMoveEntries(game.log, gomokuNotation, locale, t),
    columns: game.seats,
    heads: game.seats.map((seat) => colourName(gomokuSide(game, seat))),
  };

  const controls = playing ? boardControls(
    gomokuDefinition.matchControls, game.drawOffer, mySeat, { seats: game.seats, turnSeat: game.currentTurnSeat },
    (action) => send(action),
  ) : null;

  const choosing = playing && stage === 'choosing';
  const chooser = choosing && mySeat === game.currentTurnSeat;
  const placed = gomokuStoneCount(game);
  const status: ReactNode = !playing ? undefined
    : chooser ? <span className={styles.choice}>
      <span title={t('gomoku.chooseHint')}>{t('gomoku.chooseColour')}</span>
      <span className={styles.choiceButtons}>
        <Button variant="primary" className={styles.choose} disabled={actionPending || !connectionReady}
          onClick={() => send({ type: 'choose-side', swap: true })}>{t('gomoku.takeBlack')}</Button>
        <Button className={styles.choose} disabled={actionPending || !connectionReady}
          onClick={() => send({ type: 'choose-side', swap: false })}>{t('gomoku.keepWhite')}</Button>
      </span>
    </span>
      : choosing ? t('gomoku.choosing', { name: seatName(game.currentTurnSeat) })
        : game.options.swap && placed < 3 ? t('gomoku.opening', { n: String(placed + 1) })
          : undefined;

  const board = <BoardView
    board={BOARD} surface="go" label={t('gomoku.board')} rotation={0} pieces={pieces}
    lastMove={gomokuLastMove(game)}
    // Every empty point takes a tap but only the pending one is drawn: a dot on each would bury the board.
    selectable={canMove ? moves.targets : undefined}
    pending={pendingMove ? { to: pendingMove.to, piece: <PendingStone side={nextSide} /> } : null}
    fileLabels={FILES} rankLabels={RANKS}
    onNodeClick={canMove ? input.tap : undefined} />;

  return (
    <GameShell
      info={<BoardInfo data={moveList} />}
      centre={null}
      hand={null}
      board={<BoardTable
        seats={game.seats} bottomSeat={bottomSeat} board={board} aspect={ASPECT} moves={moveList} seatStats={seatStats}
        controls={controls}
        pending={pendingMove ? {
          text: coordinateLabel(BOARD, pendingMove.to), confirm: input.confirm, cancel: input.cancel,
        } : null}
        status={status}
        error={game.phase !== 'scoring' ? actionError : undefined}
        busy={actionPending || !connectionReady} />}
      overlay={game.phase === 'scoring' && game.result && <BoardResultDialog
        outcome={game.result} viewer={mySeat} moves={placed} pending={actionPending}
        error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
    />
  );
}
