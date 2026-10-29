// ─── LandBattleTable: deployment by swapping stations, then a refereed match on the 5 × 12 board ───

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { coordinateLabel, sideRotation } from '@shared/rules/board/board-model';
import type { NodeId } from '@shared/rules/board/board-model';
import { junqiBoard } from '@shared/rules/board/boards';
import { landBattleDefinition } from '@shared/games/landbattle/definition';
import { LB_PRESETS, lbLayoutError, lbRandomLayout, lbSwapSlots } from '@shared/rules/landbattle';
import type { LbRank, LbSide } from '@shared/rules/landbattle';
import { Button } from '../../components/Button';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import type { TranslationKey } from '../../i18n';
import { GameShell } from '../GameShell';
import { isSpectator } from '../observer-view';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useTablePerspective, useViewedGame } from '../use-table-perspective';
import { BoardResultDialog } from '../board/BoardResultDialog';
import { TilePiece } from '../board/BoardPieces';
import { BoardView } from '../board/BoardView';
import type { BoardPieceItem } from '../board/BoardView';
import { boardControls } from '../board/BoardControls';
import { BoardInfo, boardMoveEntries } from '../board/BoardMoves';
import { BoardTable } from '../board/BoardTable';
import { useBoardInput } from '../board/use-board-input';
import { useDeadlinePassed } from '../board/use-deadline-passed';
import { boardAspect } from '../board/board-view';
import {
  draftPieces, draftSlot, landBattleLastMove, landBattleMovable, landBattleNotation, landBattlePath, landBattleRemaining,
  landBattleSide, landBattleTargets, swapProblem,
} from './landbattle-view';
import styles from './LandBattleTable.module.css';

const BOARD = junqiBoard();
const NOTATION = landBattleNotation(BOARD);
const ASPECT = boardAspect(BOARD, 0);
const TONES = ['red', 'blue'] as const;
const SWAP_HINT: Record<'flag' | 'mine' | 'bomb', TranslationKey> = {
  flag: 'landbattle.swapFlag', mine: 'landbattle.swapMine', bomb: 'landbattle.swapBomb',
};

type LandBattleWireAction =
  | { type: 'deploy'; layout: LbRank[] }
  | { type: 'move'; from: string; to: string }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'answer-draw'; accept: boolean };

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

interface Draft {
  readonly layout: readonly LbRank[];
  readonly selected: number | null;
}

export function LandBattleTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.landbattle));
  const bottomSeat = useTablePerspective();
  const { t, locale } = useI18nStore();
  const seatName = useSeatName();
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [draft, setDraft] = useState<Draft>({ layout: LB_PRESETS[0], selected: null });

  const handleActionResult: ActionCallback = useCallback((timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  }, [t]);

  const send = useCallback((action: LandBattleWireAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'landbattle', action }, handleActionResult);
  }, [handleActionResult]);

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const mySeat: GameSeat | null = game && !isSpectator(game) && game.seats.includes(game.mySeat) ? game.mySeat : null;
  const deploying = game?.phase === 'deploying';
  const deadlinePassed = useDeadlinePassed(deploying ? game.deployDeadline : null);
  const owesDeployment = Boolean(deploying && mySeat !== null && !game.deployed.includes(mySeat));
  const canDeploy = owesDeployment && !deadlinePassed && connectionReady && !actionPending;
  const movable = useMemo(() => (game ? landBattleMovable(game, mySeat) : []), [game, mySeat]);
  const canMove = movable.length > 0 && connectionReady && !actionPending;
  const input = useBoardInput(
    { movable, targets: (from) => (game && from !== null ? landBattleTargets(game, from).map((target) => target.node) : []) },
    canMove,
    (choice) => {
      if (choice.from) send({ type: 'move', from: choice.from, to: choice.to });
    },
  );

  if (!game) return null;

  const playing = game.phase === 'playing';
  const mySide: LbSide = landBattleSide(game, mySeat ?? bottomSeat);
  const viewSide = landBattleSide(game, bottomSeat);
  const rankLabel = (rank: LbRank): string => t(`landbattle.short.${rank}`);
  const tile = (side: LbSide, rank: LbRank | undefined, key: string): ReactNode =>
    <TilePiece key={key} tone={TONES[side]} label={rank === undefined ? undefined : rankLabel(rank)} />;
  const pieceName = (side: LbSide, rank: LbRank | undefined): string =>
    `${t(side === 0 ? 'landbattle.sideRed' : 'landbattle.sideBlue')} · ${rank ? t(`landbattle.rank.${rank}`) : t('landbattle.hidden')}`;

  // While deploying, the viewer's own half shows the draft instead of anything submitted.
  const draftShown = owesDeployment;
  const pieces: BoardPieceItem[] = [
    ...game.pieces.filter((piece) => !draftShown || piece.side !== mySide).map((piece) => ({
      node: piece.node, key: `${piece.side}-${piece.origin}`, piece: tile(piece.side, piece.rank, piece.origin),
      label: pieceName(piece.side, piece.rank),
    })),
    ...draftShown ? draftPieces(draft.layout, mySide).map((piece) => ({
      node: piece.node, key: `draft-${piece.node}`, piece: tile(mySide, piece.rank, piece.node), label: pieceName(mySide, piece.rank),
    })) : [],
  ];

  const draftSelected = draft.selected === null ? null : draftPieces(draft.layout, mySide)[draft.selected]?.node ?? null;
  const swapTargets = draftShown && draft.selected !== null
    ? draftPieces(draft.layout, mySide).filter((piece) => piece.slot !== draft.selected
      && swapProblem(draft.layout, draft.selected!, piece.slot) === null).map((piece) => ({ node: piece.node }))
    : [];

  const tapDraft = (node: NodeId | null): void => {
    if (!canDeploy || node === null) {
      setDraft({ ...draft, selected: null });
      return;
    }
    const slot = draftSlot(node, mySide);
    if (slot < 0) return;
    setActionError('');
    if (draft.selected === null || draft.selected === slot) {
      setDraft({ ...draft, selected: draft.selected === slot ? null : slot });
      return;
    }
    const swapped = lbSwapSlots(draft.layout, draft.selected, slot);
    if (!swapped) {
      const problem = swapProblem(draft.layout, draft.selected, slot);
      if (problem) setActionError(t(SWAP_HINT[problem]));
      setDraft({ ...draft, selected: null });
      return;
    }
    setDraft({ layout: swapped, selected: null });
  };

  const selected = draftShown ? draftSelected : input.selected;
  const targets = draftShown ? swapTargets
    : input.selected ? landBattleTargets(game, input.selected) : [];
  const pendingMove = input.pending;
  const pendingPiece = pendingMove?.from ? game.pieces.find((piece) => piece.node === pendingMove.from) : undefined;
  const last = landBattleLastMove(game);

  const board = <BoardView
    board={BOARD} surface="field" label={t('landbattle.board')} rotation={sideRotation(BOARD, viewSide)} pieces={pieces}
    lastMove={last} selected={selected} targets={targets}
    pending={pendingMove ? {
      from: pendingMove.from, to: pendingMove.to, path: pendingMove.from ? landBattlePath(game, pendingMove.from, pendingMove.to) : [],
      piece: pendingPiece ? tile(pendingPiece.side, pendingPiece.rank, 'pending') : undefined,
    } : null}
    selectable={draftShown ? draftPieces(draft.layout, mySide).map((piece) => piece.node) : movable}
    onNodeClick={draftShown ? (canDeploy ? tapDraft : undefined) : canMove ? input.tap : undefined} />;

  const seatStats = (seat: GameSeat): ReactNode => {
    const side = landBattleSide(game, seat);
    return <span className={styles.stats} title={t(side === 0 ? 'landbattle.sideFirst' : 'landbattle.sideSecond')}>
      <span className={`${styles.dot} ${side === 0 ? styles.red : styles.blue}`} aria-hidden="true" />
      <span className={styles.sideName}>{t(side === 0 ? 'landbattle.sideRed' : 'landbattle.sideBlue')}</span>
      {!deploying && <span>{t('landbattle.pieces', { n: String(landBattleRemaining(game, seat)) })}</span>}
      {game.flagsShown.includes(seat) && <span className={styles.flagShown}>{t('landbattle.flagShown')}</span>}
    </span>;
  };

  const moves = {
    entries: boardMoveEntries(game.log, NOTATION, locale, t),
    columns: game.seats,
    heads: [t('landbattle.sideRed'), t('landbattle.sideBlue')],
  };

  // Deployment has no turn to offer a draw on, and the phone column needs the room for the deployment tools.
  const controls = playing ? boardControls(
    landBattleDefinition.matchControls, game.drawOffer, mySeat,
    { seats: game.seats, turnSeat: playing ? game.currentTurnSeat : null }, (action) => send(action),
  ) : null;

  const layoutValid = lbLayoutError(draft.layout) === null;
  const tools = owesDeployment ? <div className={styles.deploy} role="group" aria-label={t('landbattle.deployTitle')}>
    <div className={styles.presets} role="group" aria-label={t('landbattle.presets')}>
      {LB_PRESETS.map((preset, index) => <Button key={index} className={styles.preset} disabled={!canDeploy}
        onClick={() => setDraft({ layout: preset, selected: null })}>{t(`landbattle.preset.${index}` as TranslationKey)}</Button>)}
      <Button className={styles.preset} disabled={!canDeploy}
        onClick={() => setDraft({ layout: lbRandomLayout(Math.random), selected: null })}>{t('landbattle.autoDeploy')}</Button>
    </div>
    <Button variant="primary" className={styles.submit} disabled={!canDeploy || !layoutValid}
      onClick={() => send({ type: 'deploy', layout: [...draft.layout] })}>{t('landbattle.confirmDeploy')}</Button>
  </div> : null;

  const opponent = game.seats.find((seat) => seat !== (mySeat ?? bottomSeat));
  const lastShown = last?.flagShown?.filter((seat) => game.flagsShown.includes(seat)) ?? [];
  const status = deploying
    ? (owesDeployment ? `${t('landbattle.deployHint')} ${t(opponent && game.deployed.includes(opponent)
      ? 'landbattle.opponentReady' : 'landbattle.opponentDeploying')}`
      : mySeat !== null ? t('landbattle.waitingDeploy') : undefined)
    : playing && lastShown.length > 0 ? lastShown.map((seat) => t('landbattle.flagShownNotice', { name: seatName(seat) })).join('；')
      : playing && last?.battle ? t(last.battle === 'win' ? 'landbattle.lastWin' : last.battle === 'lose' ? 'landbattle.lastLose' : 'landbattle.lastTie')
        : playing && game.log.length === 0 && mySeat !== null && game.autoDeployed.includes(mySeat) ? t('landbattle.autoDeployed')
          : undefined;

  return (
    <GameShell
      info={<BoardInfo data={moves} />}
      centre={null}
      hand={null}
      turnReady={owesDeployment ? canDeploy : undefined}
      board={<BoardTable
        seats={game.seats} bottomSeat={bottomSeat} board={board} aspect={ASPECT} moves={moves} seatStats={seatStats}
        controls={controls}
        pending={pendingMove?.from ? {
          text: `${coordinateLabel(BOARD, pendingMove.from)}→${coordinateLabel(BOARD, pendingMove.to)}`,
          confirm: input.confirm, cancel: input.cancel,
        } : null}
        tools={tools}
        status={status}
        error={game.phase !== 'scoring' ? actionError : undefined}
        busy={actionPending || !connectionReady}
        ownTurn={owesDeployment ? canDeploy : undefined} />}
      overlay={game.phase === 'scoring' && game.result && <BoardResultDialog
        outcome={game.result} viewer={mySeat} moves={game.log.length} pending={actionPending}
        error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
    />
  );
}
