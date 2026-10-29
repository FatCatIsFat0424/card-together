// ─── ChineseCheckersTable: the 121-hole star on the board kit, turned so the viewer's corner is at the bottom ───

import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ChineseCheckersMove, GameSeat } from '@shared/types';
import { coordinateLabel } from '@shared/rules/board/board-model';
import { coordinateNotation } from '@shared/rules/board/board-move';
import type { MoveNotation } from '@shared/rules/board/board-move';
import { CC_BOARD, CC_PIECES } from '@shared/rules/chinesecheckers';
import { chineseCheckersDefinition } from '@shared/games/chinesecheckers/definition';
import type { TranslationKey } from '../../i18n';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { GameShell } from '../GameShell';
import { isSpectator } from '../observer-view';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useTablePerspective, useViewedGame } from '../use-table-perspective';
import { BoardResultDialog } from '../board/BoardResultDialog';
import { MarblePiece } from '../board/BoardPieces';
import { BoardView } from '../board/BoardView';
import { boardControls } from '../board/BoardControls';
import { BoardInfo, boardMoveEntries } from '../board/BoardMoves';
import { BoardTable } from '../board/BoardTable';
import { useBoardInput } from '../board/use-board-input';
import { boardAspect } from '../board/board-view';
import { DEFAULT_BOARD_THEME } from '../board/board-theme';
import {
  chineseCheckersArrived, chineseCheckersLastMove, chineseCheckersMoveCount, chineseCheckersMovable,
  chineseCheckersPassedSeat, chineseCheckersPath, chineseCheckersPieces, chineseCheckersPlaces, chineseCheckersRotation,
  chineseCheckersSeatOrder, chineseCheckersTargets, seatCorner,
} from './chinesecheckers-view';
import styles from './ChineseCheckersTable.module.css';

const NOTATION = coordinateNotation(CC_BOARD);
// The star looks the same from every corner, so one aspect serves every perspective.
const ASPECT = boardAspect(CC_BOARD, 0);

type CheckersWireAction =
  | { type: 'move'; from: string; to: string }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'answer-draw'; accept: boolean };

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

const colourKey = (corner: number): TranslationKey => `cc.colour${corner}` as TranslationKey;

function Dot({ corner }: { readonly corner: number }): ReactNode {
  return <span className={styles.dot} aria-hidden="true"
    style={{ '--dot': DEFAULT_BOARD_THEME.pieces.marbles[corner] } as CSSProperties} />;
}

export function ChineseCheckersTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.chineseCheckers));
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

  const send = useCallback((action: CheckersWireAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'chinesecheckers', action }, handleActionResult);
  }, [handleActionResult]);

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const mySeat: GameSeat | null = game && !isSpectator(game) ? game.mySeat : null;
  const movable = useMemo(() => (game ? chineseCheckersMovable(game, mySeat) : []), [game, mySeat]);
  const canMove = movable.length > 0 && connectionReady && !actionPending;
  const targets = useCallback((from: string | null) => (game ? chineseCheckersTargets(game, mySeat, from) : []), [game, mySeat]);
  const input = useBoardInput(
    { movable, targets },
    canMove,
    (choice) => { if (choice.from) send({ type: 'move', from: choice.from, to: choice.to }); },
  );

  if (!game) return null;

  const playing = game.phase === 'playing';
  const multi = game.seats.length > 2;
  const marble = (corner: number, key: string): ReactNode => <MarblePiece key={key} corner={corner} />;
  const pieces = chineseCheckersPieces(game.holes).map((piece) => ({
    node: piece.node, key: `m-${piece.node}`, piece: marble(piece.corner, piece.node), label: t(colourKey(piece.corner)),
  }));
  const pendingMove = input.pending;
  const pendingPath = pendingMove?.from ? chineseCheckersPath(game, pendingMove.from, pendingMove.to) : [];
  const selectedTargets = input.selected ? targets(input.selected) : [];
  const myCorner = mySeat === null ? null : seatCorner(game, mySeat);

  const seatStats = (seat: GameSeat): ReactNode => {
    const corner = seatCorner(game, seat);
    if (corner === null) return null;
    const resigned = game.resigned.includes(seat);
    return <span className={styles.stats} title={t('cc.arrivedTitle')}>
      <Dot corner={corner} />
      <span className={styles.colour}>{t(colourKey(corner))}</span>
      <span>{resigned ? t('cc.resignedSeat')
        : t('cc.arrived', { n: String(chineseCheckersArrived(game, seat)), total: String(CC_PIECES) })}</span>
    </span>;
  };

  const notation: MoveNotation<ChineseCheckersMove> = (move, at) => (move.resigned ? t('cc.resignedMove') : NOTATION(move, at));
  const moves = multi
    ? { entries: boardMoveEntries(game.log, notation, locale, t, (move) => {
      const corner = seatCorner(game, move.seat);
      return corner === null ? null : <Dot corner={corner} />;
    }) }
    : {
      entries: boardMoveEntries(game.log, notation, locale, t),
      columns: game.seats,
      heads: game.corners.map((corner) => t(colourKey(corner))),
    };

  const stillPlaying = mySeat !== null && !game.resigned.includes(mySeat);
  const baseControls = playing && stillPlaying ? boardControls(
    chineseCheckersDefinition.matchControls, game.drawOffer, mySeat, { seats: game.seats, turnSeat: game.currentTurnSeat },
    (action) => send(action),
  ) : null;
  const inPlay = game.seats.filter((seat) => !game.resigned.includes(seat)).length;
  const controls = baseControls && { ...baseControls, resignContinues: inPlay > 2 };

  const passed = chineseCheckersPassedSeat(game);
  const status = !playing ? undefined
    : mySeat !== null && game.resigned.includes(mySeat) ? t('cc.youResigned')
      : passed ? t('cc.passed', { name: seatName(passed) })
        : multi && !isSpectator(game) && game.currentTurnSeat !== mySeat ? t('cc.turnOf', { name: seatName(game.currentTurnSeat) })
          : undefined;

  const lastMove = chineseCheckersLastMove(game);
  const board = <BoardView
    board={CC_BOARD} surface="star" label={t('cc.board')} rotation={chineseCheckersRotation(game, bottomSeat)}
    pieces={pieces}
    lastMove={lastMove ? { from: lastMove.from, to: lastMove.to, path: lastMove.path } : null}
    selected={input.selected}
    targets={selectedTargets.map((node) => ({ node }))}
    pending={pendingMove && myCorner !== null
      ? { from: pendingMove.from, to: pendingMove.to, path: pendingPath, piece: marble(myCorner, 'pending') } : null}
    selectable={canMove ? movable : []}
    onNodeClick={canMove ? input.tap : undefined} />;

  const result = game.result;
  const standings = result && multi ? {
    label: t('cc.standings', { n: String(result.seats.length) }),
    content: <ol className={styles.standings}>
      {[...result.seats].sort((a, b) => (result.ranks[a] ?? 0) - (result.ranks[b] ?? 0)).map((seat) => {
        const corner = result.corners[seat] ?? 0;
        const left = result.remaining[seat];
        return <li key={seat}>
          <span className={styles.place}>{t('cc.place', { n: String(result.ranks[seat] ?? '') })}</span>
          <Dot corner={corner} />
          <span className={styles.name}>{seatName(seat)}</span>
          <span className={styles.detail}>{left === undefined ? t('cc.resignedSeat') : t('cc.rowsLeft', { n: String(left) })}</span>
        </li>;
      })}
    </ol>,
  } : null;

  return (
    <GameShell
      info={<BoardInfo data={moves} />}
      centre={null}
      hand={null}
      board={<BoardTable
        // Listed by height round the board rather than turn order, so each side column reads top to bottom.
        seats={chineseCheckersSeatOrder(game, bottomSeat)}
        bottomSeat={seatCorner(game, bottomSeat) === null ? game.seats[0] : bottomSeat} board={board}
        aspect={ASPECT} moves={moves} seatStats={seatStats}
        places={chineseCheckersPlaces(game, bottomSeat)}
        controls={controls}
        pending={pendingMove ? {
          text: `${coordinateLabel(CC_BOARD, pendingMove.from ?? pendingMove.to)}-${coordinateLabel(CC_BOARD, pendingMove.to)}`
            + (pendingPath.length > 0 ? ` · ${t('cc.jumps', { n: String(pendingPath.length + 1) })}` : ''),
          confirm: input.confirm, cancel: input.cancel,
        } : null}
        status={status}
        error={game.phase !== 'scoring' ? actionError : undefined}
        busy={actionPending || !connectionReady} />}
      overlay={game.phase === 'scoring' && result && <BoardResultDialog
        outcome={result} viewer={mySeat} moves={chineseCheckersMoveCount(game)} pending={actionPending}
        error={actionError} disabled={!connectionReady} onBack={backToRoom} history={standings} />}
    />
  );
}
