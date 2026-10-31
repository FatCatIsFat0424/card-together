// ─── GoTable: 9, 13, or 19 lines on the board kit, a pending stone for fingertip taps, and the shared marking of dead stones ───

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameSeat, GoMatchResult } from '@shared/types';
import { goDefinition } from '@shared/games/go/definition';
import { goMoveLimit, goNode, goPointName, goPointOfNode } from '@shared/rules/go';
import type { GoSize } from '@shared/rules/go';
import type { GoSide } from '@shared/rules/go';
import { goBoard } from '@shared/rules/board/boards';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { Button } from '../../components/Button';
import { GameShell } from '../GameShell';
import { isSpectator } from '../observer-view';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useTablePerspective, useViewedGame } from '../use-table-perspective';
import { ResultDialog } from '../ResultDialog';
import { StonePiece } from '../board/BoardPieces';
import { BoardView } from '../board/BoardView';
import { boardControls } from '../board/BoardControls';
import { BoardInfo, boardMoveEntries } from '../board/BoardMoves';
import { BoardTable } from '../board/BoardTable';
import { useBoardInput } from '../board/use-board-input';
import { useDeadlinePassed } from '../board/use-deadline-passed';
import { boardAspect } from '../board/board-view';
import { boardReasonLabel, boardResultTitle } from '../board/board-result';
import {
  goCount, goDeadStones, goFileLabels, goLastMove, goNotation, goRankLabels, goSideOf, goStones, goTargets,
} from './go-view';
import styles from './GoTable.module.css';

type GoWireAction =
  | { type: 'place'; to: string }
  | { type: 'pass' }
  | { type: 'toggle-dead'; to: string }
  | { type: 'confirm-score'; dead: number[] }
  | { type: 'resume' }
  | MatchControlAction;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

const tone = (side: GoSide): 'dark' | 'light' => (side === 0 ? 'dark' : 'light');

/** Small square marking a point that counts for a side. */
function TerritoryMark({ side }: { readonly side: GoSide }): ReactNode {
  return <rect className={side === 0 ? styles.areaBlack : styles.areaWhite} x={-0.11} y={-0.11} width={0.22} height={0.22} rx={0.03} />;
}

/** The stone waiting for confirmation: a crosshair over the intersection makes the exact point unmistakable. */
function PendingStone({ side }: { readonly side: GoSide }): ReactNode {
  return <g>
    <path className={styles.cross} d="M-0.9 0H0.9M0 -0.9V0.9" />
    <StonePiece tone={tone(side)} />
  </g>;
}

const formatPoints = (value: number): string => String(value);

/** Coordinate of a node in Go notation (`D4`). */
function pointLabel(size: GoSize, node: string): string {
  const point = goPointOfNode(size, node);
  return point === null ? node : goPointName(size, point);
}

/** End of a Go match: who won, how, and the count behind it. */
function GoResultDialog({ result, viewer, pending, error, disabled, onBack }: {
  readonly result: GoMatchResult;
  readonly viewer: GameSeat | null;
  readonly pending: boolean;
  readonly error: string;
  readonly disabled: boolean;
  readonly onBack: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const { title, tone: resultTone } = boardResultTitle(result, viewer, seatName, t);
  const [black, white] = result.seats;
  const counted = result.reason !== 'resign';
  const captured = (result.captured[black] ?? 0) + (result.captured[white] ?? 0);
  return <ResultDialog title={title} tone={resultTone} pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <p className={styles.reason}>{counted ? t('go.resultMargin', { n: formatPoints(result.margin) }) : boardReasonLabel(result, t)}</p>
    {counted && <p className={styles.meta}>{t('go.resultAreas', {
      black: formatPoints(result.area[black] ?? 0), white: formatPoints(result.area[white] ?? 0), komi: formatPoints(result.komi),
    })}</p>}
    <p className={styles.meta}>{t('board.resultMoves', { n: String(result.moves) })} · {t('go.resultCaptured', { n: String(captured) })}</p>
  </ResultDialog>;
}

export function GoTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.go));
  const bottomSeat = useTablePerspective();
  const { t, locale } = useI18nStore();
  const seatName = useSeatName();
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [passAsked, setPassAsked] = useState<number | null>(null);
  const markPassed = useDeadlinePassed(game?.phase === 'marking' ? game.markDeadline : null);

  const handleActionResult: ActionCallback = useCallback((timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  }, [t]);

  const send = useCallback((action: GoWireAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'go', action }, handleActionResult);
  }, [handleActionResult]);

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const mySeat: GameSeat | null = game && !isSpectator(game) ? game.mySeat : null;
  const boardSize = game?.options.size ?? 9;
  const board = useMemo(() => goBoard(boardSize), [boardSize]);
  const targets = useMemo(() => (game ? goTargets(game, mySeat) : []), [game, mySeat]);
  const canMove = targets.length > 0 && connectionReady && !actionPending;
  const input = useBoardInput(
    { movable: [], targets: (from) => (from === null ? targets : []) },
    canMove,
    (choice) => send({ type: 'place', to: choice.to }),
  );

  if (!game) return null;

  const { size } = game.options;
  const playing = game.phase === 'playing';
  const marking = game.phase === 'marking';
  const finished = game.phase === 'scoring';
  const nextSide = goSideOf(game, game.currentTurnSeat);
  const canMark = marking && mySeat !== null && connectionReady && !actionPending && !markPassed;
  const count = goCount(game);
  const dead = new Set(goDeadStones(game));
  const colourName = (side: GoSide): string => t(side === 0 ? 'go.black' : 'go.white');

  const stonePieces = goStones(game).map((stone) => ({
    node: stone.node, key: `stone-${stone.node}`, label: colourName(stone.side),
    piece: <g opacity={dead.has(stone.index) ? 0.38 : 1}><StonePiece tone={tone(stone.side)} /></g>,
  }));
  // Territory squares sit on empty points and on the points of dead stones, for the side that counts them.
  const areaPieces = count ? count.owner.flatMap((owner, index) => (owner !== null && (game.stones[index] === null || dead.has(index))
    ? [{ node: goNode(size, index), key: `area-${index}`, piece: <TerritoryMark side={owner} /> }] : [])) : [];
  const pieces = [...stonePieces, ...areaPieces];
  const pendingMove = input.pending;

  const seatStats = (seat: GameSeat): ReactNode => {
    const side = goSideOf(game, seat);
    return <span className={styles.side} title={t(side === 0 ? 'go.sideBlack' : 'go.sideWhite')}>
      <span className={`${styles.dot} ${side === 0 ? styles.black : styles.white}`} aria-hidden="true" />
      <span>{colourName(side)}</span>
      <span className={styles.captured}>{t('go.captured', { n: String(game.captures[side]) })}</span>
    </span>;
  };

  const moveList = {
    entries: boardMoveEntries(game.log, goNotation(size), locale, t),
    columns: game.seats,
    heads: game.seats.map((seat) => colourName(goSideOf(game, seat))),
  };

  const controls = finished ? null : boardControls(
    goDefinition.matchControls, game.drawOffer, mySeat, { seats: game.seats, turnSeat: playing ? game.currentTurnSeat : null },
    (action) => send(action),
  );

  const myConfirmed = mySeat !== null && game.confirmed.includes(mySeat);
  const opponentConfirmed = game.confirmed.some((seat) => seat !== mySeat);
  const myTurn = playing && mySeat !== null && game.currentTurnSeat === mySeat;
  const askingPass = myTurn && passAsked === game.log.length;
  const lead = count
    ? t('go.markLead', { name: seatName(game.seats[count.winner]), n: formatPoints(count.margin) }) : '';

  const tools: ReactNode = marking && mySeat !== null ? <div className={styles.marking} role="group" aria-label={t('go.marking')}>
    {count && <p className={styles.totals} title={lead}>
      <span>{t('go.markTotals', {
        black: String(count.area[0]), white: String(count.area[1]), komi: formatPoints(count.komi),
      })}</span>
      <span className={styles.lead}>{lead}</span>
    </p>}
    <div className={styles.markButtons}>
      <Button variant="primary" className={styles.markButton} disabled={!canMark || myConfirmed}
        onClick={() => send({ type: 'confirm-score', dead: [...game.dead] })}>{t('go.confirmScore')}</Button>
      <Button className={styles.markButton} disabled={!canMark || game.log.length >= goMoveLimit(size)}
        onClick={() => send({ type: 'resume' })}>{t('go.resume')}</Button>
    </div>
  </div> : myTurn && !pendingMove ? <div className={styles.passTools}>
    {askingPass ? <>
      <Button variant="primary" className={styles.passButton} disabled={actionPending || !connectionReady}
        title={t('go.passHint')} onClick={() => { setPassAsked(null); send({ type: 'pass' }); }}>{t('go.passConfirm')}</Button>
      <Button className={styles.passButton} onClick={() => setPassAsked(null)}>{t('board.cancel')}</Button>
    </> : <Button className={styles.passButton} disabled={actionPending || !connectionReady} title={t('go.passHint')}
      onClick={() => setPassAsked(game.log.length)}>{t('go.pass')}</Button>}
  </div> : null;

  const lastEntry = game.log.at(-1);
  const status: ReactNode = marking
    ? (mySeat === null ? t('go.marking') : myConfirmed ? t('go.waitingConfirm')
      : opponentConfirmed ? t('go.opponentConfirmed') : t('go.markHint'))
    : playing && lastEntry && lastEntry.to === undefined && lastEntry.seat !== mySeat && mySeat !== null
      ? t('go.opponentPassed') : undefined;

  const boardView = <BoardView
    board={board} surface="go" label={t('go.board')} rotation={0} pieces={pieces}
    lastMove={goLastMove(game)}
    // Every legal point takes a tap but only the pending one is drawn: a dot on each would bury the board.
    selectable={marking ? (canMark ? stonePieces.map((piece) => piece.node) : undefined) : canMove ? targets : undefined}
    pending={pendingMove ? { to: pendingMove.to, piece: <PendingStone side={nextSide} /> } : null}
    fileLabels={goFileLabels(size)} rankLabels={goRankLabels(size)}
    onNodeClick={marking ? (canMark ? (node) => { if (node) send({ type: 'toggle-dead', to: node }); } : undefined)
      : canMove ? input.tap : undefined} />;

  return (
    <GameShell
      info={<BoardInfo data={moveList} />}
      centre={null}
      hand={null}
      board={<BoardTable
        seats={game.seats} bottomSeat={bottomSeat} board={boardView} aspect={boardAspect(board, 0, true)} moves={moveList}
        seatStats={seatStats} controls={controls}
        pending={pendingMove ? {
          text: pointLabel(size, pendingMove.to), confirm: input.confirm, cancel: input.cancel,
        } : null}
        tools={tools}
        status={status}
        error={finished ? undefined : actionError}
        busy={actionPending || !connectionReady}
        ownTurn={marking ? mySeat !== null && !myConfirmed : undefined} />}
      overlay={finished && game.result && <GoResultDialog
        result={game.result} viewer={mySeat} pending={actionPending} error={actionError}
        disabled={!connectionReady} onBack={backToRoom} />}
    />
  );
}
