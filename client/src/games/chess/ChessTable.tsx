// ─── ChessTable: 8 × 8 board on the board kit, turned so each player's side is at the bottom ───

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { sideRotation } from '@shared/rules/board/board-model';
import { chessBoard } from '@shared/rules/board/boards';
import { CHESS_COLS, chessCell, chessKindOf, chessSideOf } from '@shared/rules/chess';
import type { ChessPiece, ChessPromotion, ChessSide } from '@shared/rules/chess';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { GameShell } from '../GameShell';
import { isSpectator } from '../observer-view';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useTablePerspective, useViewedGame } from '../use-table-perspective';
import { BoardResultDialog } from '../board/BoardResultDialog';
import { BoardView } from '../board/BoardView';
import { boardControls } from '../board/BoardControls';
import { BoardInfo, boardMoveEntries } from '../board/BoardMoves';
import { BoardTable } from '../board/BoardTable';
import { useBoardInput } from '../board/use-board-input';
import { boardAspect } from '../board/board-view';
import type { BoardChoice } from '../board/board-input';
import { ChessPieceIcon, ChessPieceShape } from './ChessPieces';
import { ChessPromotionPicker } from './ChessPromotion';
import {
  CHESS_FILES, CHESS_NOTATION, CHESS_RANKS, chessCaptures, chessCheck, chessLastMove, chessNodeName, chessPendingText, chessPieces,
  chessSide, chessTargets, isChessPromotion,
} from './chess-view';
import styles from './ChessTable.module.css';

const BOARD = chessBoard();
const ASPECT = boardAspect(BOARD, 0, true);
const EMPTY: readonly string[] = [];

type ChessWireAction =
  | { type: 'move'; from: string; to: string; promotion?: ChessPromotion }
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'answer-draw'; accept: boolean };

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

export function ChessTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.chess));
  const bottomSeat = useTablePerspective();
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [promoting, setPromoting] = useState<BoardChoice | null>(null);

  const handleActionResult: ActionCallback = useCallback((timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  }, [t]);

  const send = useCallback((action: ChessWireAction): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'chess', action }, handleActionResult);
  }, [handleActionResult]);

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const mySeat: GameSeat | null = game && !isSpectator(game) ? game.mySeat : null;
  const targets = useMemo(() => (game ? chessTargets(game, mySeat) : new Map<string, readonly string[]>()), [game, mySeat]);
  const movable = useMemo(() => [...targets.keys()], [targets]);
  const canMove = movable.length > 0 && connectionReady && !actionPending && promoting === null;
  const input = useBoardInput(
    { movable, targets: (from) => (from === null ? EMPTY : targets.get(from) ?? EMPTY) },
    canMove,
    (choice) => {
      if (!choice.from) return;
      // A pawn reaching the last rank waits for the player to name its new piece.
      if (game && isChessPromotion(game, choice.from, choice.to)) setPromoting(choice);
      else send({ type: 'move', from: choice.from, to: choice.to });
    },
  );

  if (!game) return null;

  const playing = game.phase === 'playing';
  const bottomSide = chessSide(game, bottomSeat);
  const captures = chessCaptures(game);
  const check = chessCheck(game);
  const sideName = (side: ChessSide): string => t(side === 0 ? 'chess.white' : 'chess.black');
  const pieceLabel = (piece: ChessPiece): string => t('chess.pieceLabel', {
    side: sideName(chessSideOf(piece)), name: t(`chess.piece.${chessKindOf(piece)}`),
  });
  const pieces = chessPieces(game.board).map((item) => ({
    // Keyed by square: a moved piece is redrawn at its new square, which the last-move marker explains.
    node: item.node, key: `piece-${item.node}`, piece: <ChessPieceShape piece={item.piece} />, label: pieceLabel(item.piece),
  }));
  const occupied = (node: string): boolean => {
    const cell = chessCell(node);
    return cell !== null && game.board[cell] !== null;
  };
  const selectedTargets = input.selected ? targets.get(input.selected) ?? EMPTY : EMPTY;
  const pendingMove = input.pending;
  const pendingFrom = pendingMove?.from ? chessCell(pendingMove.from) : null;
  const pendingPiece = pendingFrom === null ? null : game.board[pendingFrom];
  const pendingText = (): string => {
    if (!pendingMove?.from) return '';
    const text = chessPendingText(game, pendingMove.from, pendingMove.to);
    const target = chessCell(pendingMove.to);
    const taken = target === null ? null : game.board[target];
    return taken ? t('chess.pendingCapture', { move: text, piece: pieceLabel(taken) }) : text;
  };

  const seatStats = (seat: GameSeat): ReactNode => {
    const side = chessSide(game, seat);
    const taken = captures[seat] ?? [];
    return <span className={styles.stats}>
      <span className={`${styles.side} ${side === 0 ? styles.white : styles.black}`}
        title={t(side === 0 ? 'chess.sideWhite' : 'chess.sideBlack')}>
        {t(side === 0 ? 'chess.whiteSide' : 'chess.blackSide')}
      </span>
      {taken.length > 0 && <span className={styles.captured}
        aria-label={t('chess.captured', { pieces: taken.map(pieceLabel).join(', ') })}>
        {taken.map((piece, index) => <ChessPieceIcon key={index} piece={piece} className={styles.mini} />)}
      </span>}
    </span>;
  };

  const moves = {
    entries: boardMoveEntries(game.log, CHESS_NOTATION, 'en', t),
    columns: game.seats,
    heads: [t('chess.white'), t('chess.black')],
  };

  const controls = playing ? boardControls(
    { resign: true, draw: true }, game.drawOffer, mySeat, { seats: game.seats, turnSeat: game.currentTurnSeat },
    (action) => send(action),
  ) : null;

  const board = <BoardView
    board={BOARD} surface="chess" label={t('chess.board')} rotation={sideRotation(BOARD, bottomSide)} pieces={pieces}
    lastMove={chessLastMove(game)} selected={input.selected}
    targets={selectedTargets.map((node) => ({ node, capture: occupied(node) || isEnPassant(game.board, game.enPassant, input.selected, node) }))}
    pending={pendingMove ? { ...pendingMove, piece: pendingPiece ? <ChessPieceShape piece={pendingPiece} /> : undefined } : null}
    check={check} fileLabels={CHESS_FILES} rankLabels={CHESS_RANKS} nodeName={chessNodeName}
    selectable={canMove ? movable : EMPTY} onNodeClick={canMove ? input.tap : undefined} />;

  return (
    <GameShell
      info={<BoardInfo data={moves} />}
      centre={null}
      hand={null}
      board={<>
        <BoardTable
          seats={game.seats} bottomSeat={bottomSeat} board={board} aspect={ASPECT} moves={moves} seatStats={seatStats}
          controls={controls}
          pending={pendingMove ? { text: pendingText(), confirm: input.confirm, cancel: input.cancel } : null}
          status={playing && check ? t('chess.check', { name: seatName(game.currentTurnSeat) }) : undefined}
          error={game.phase !== 'scoring' ? actionError : undefined}
          busy={actionPending || !connectionReady} />
        <ChessPromotionPicker open={promoting !== null && playing} side={bottomSide} disabled={actionPending || !connectionReady}
          onCancel={() => setPromoting(null)}
          onPick={(promotion) => {
            if (promoting?.from) send({ type: 'move', from: promoting.from, to: promoting.to, promotion });
            setPromoting(null);
          }} />
      </>}
      overlay={game.phase === 'scoring' && game.result && <BoardResultDialog
        outcome={game.result} viewer={mySeat} moves={game.log.length} pending={actionPending}
        error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
    />
  );
}

/** A pawn moving diagonally onto the empty en passant square takes the pawn beside it. */
function isEnPassant(
  board: readonly (ChessPiece | null)[], enPassant: number | null, from: string | null, to: string,
): boolean {
  const origin = from === null ? null : chessCell(from);
  const target = chessCell(to);
  if (origin === null || target === null || enPassant !== target) return false;
  const piece = board[origin];
  return piece !== null && chessKindOf(piece) === 'p' && origin % CHESS_COLS !== target % CHESS_COLS;
}
