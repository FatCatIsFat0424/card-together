// ─── Land Battle Chess Game: simultaneous deployment, then a refereed match with hidden identities ───

import { randomUUID } from 'node:crypto';
import type {
  GameSeat, LandBattleGameState, LandBattleMatchResult, LandBattleMove, LandBattleStoredPiece,
  LandBattleVisiblePiece, LandBattleVisibleState, ObserverRole, PlayerInfo, RoomCode,
} from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  LB_NODES, LB_QUIET_LIMIT, lbApplyMove, lbCell, lbDeploySlots, lbHasMove, lbLayoutError, lbNode, lbOpponent,
} from '@shared/rules/landbattle';
import type { LbPiece, LbRank, LbSide } from '@shared/rules/landbattle';
import { resignationOutcome } from '@shared/rules/board/board-result';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import { NO_DRAW_OFFER, afterBoardMove, applyMatchControl } from '@shared/rules/board/match-controls';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { landBattleDefinition } from '@shared/games/landbattle/definition';

type Result = { success: true } | { success: false; reason: string };

/** roomCode → LandBattleGameState */
const games: Map<RoomCode, LandBattleGameState> = new Map();

/** The two seats in play order: the first deploys at the bottom and moves first. */
export function landBattleSeats(game: Pick<LandBattleGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

/** The seat's side, or null for a seat outside the match. */
export function landBattleSide(game: Pick<LandBattleGameState, 'players'>, seat: GameSeat): LbSide | null {
  const index = landBattleSeats(game).indexOf(seat);
  return index === 0 ? 0 : index === 1 ? 1 : null;
}

export function startGame(
  roomCode: RoomCode, players: Partial<Record<GameSeat, PlayerInfo>>, deployMs: number, now: number = Date.now(),
): void {
  const seats = occupiedSeats(players);
  games.set(roomCode, {
    gameType: 'landbattle',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    phase: 'deploying',
    deployDeadline: now + deployMs,
    layouts: Object.fromEntries(seats.map((seat) => [seat, null])),
    autoDeployed: [],
    pieces: [],
    currentTurnSeat: seats[0],
    drawOffer: NO_DRAW_OFFER,
    quietMoves: 0,
    flagsShown: [],
    log: [],
    result: null,
  });
}

/** Seats that have not deployed yet, in play order. */
export function pendingSeats(game: LandBattleGameState): GameSeat[] {
  return game.phase === 'deploying' ? landBattleSeats(game).filter((seat) => !game.layouts[seat]) : [];
}

/** Both deployments placed on the board, in deployment order (first seat's slots, then the second's). */
export function initialPieces(layouts: readonly [readonly LbRank[], readonly LbRank[]]): LandBattleStoredPiece[] {
  return ([0, 1] as const).flatMap((side) => lbDeploySlots(side).map((index, slot) => {
    const origin = lbNode(index);
    return { side, rank: layouts[side][slot], origin, node: origin };
  }));
}

/** The stored pieces as a rules board. */
export function piecesBoard(pieces: readonly LandBattleStoredPiece[]): (LbPiece | null)[] {
  const board: (LbPiece | null)[] = new Array<LbPiece | null>(LB_NODES).fill(null);
  for (const piece of pieces) {
    board[lbCell(piece.node)!] = { side: piece.side, rank: piece.rank, origin: lbCell(piece.origin)! };
  }
  return board;
}

function finish(game: LandBattleGameState, outcome: BoardOutcome): void {
  const seats = landBattleSeats(game);
  const result: LandBattleMatchResult = {
    gameType: 'landbattle',
    seats,
    remaining: Object.fromEntries(seats.map((seat, side) => [seat, game.pieces.filter((piece) => piece.side === side).length])),
    moves: game.log.length,
    winners: [...outcome.winners],
    reason: outcome.reason,
  };
  game.phase = 'scoring';
  game.result = result;
}

/**
 * A deployment is final. `automatic` marks server-made deployments, which are accepted past the deadline.
 * The last deployment starts play with the first seat to move.
 */
export function deploy(
  roomCode: RoomCode, seat: GameSeat, layout: readonly LbRank[], automatic: boolean, now: number = Date.now(),
): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'deploying') return { success: false, reason: 'Deployment is over' };
  const side = landBattleSide(game, seat);
  if (side === null) return { success: false, reason: 'Only players in this match can deploy.' };
  if (game.layouts[seat]) return { success: false, reason: 'Already deployed' };
  const error = lbLayoutError(layout);
  if (error) return { success: false, reason: error };
  if (!automatic && now >= game.deployDeadline) return { success: false, reason: 'The deployment time is over' };

  game.layouts = { ...game.layouts, [seat]: [...layout] };
  if (automatic && !game.players[seat]?.isBot && !game.autoDeployed.includes(seat)) {
    game.autoDeployed = landBattleSeats(game).filter((other) => other === seat || game.autoDeployed.includes(other));
  }
  if (pendingSeats(game).length === 0) {
    const [first, second] = landBattleSeats(game);
    game.pieces = initialPieces([game.layouts[first]!, game.layouts[second]!]);
    game.phase = 'playing';
    game.currentTurnSeat = first;
  }
  return { success: true };
}

/**
 * Moves the seat's piece on its turn. The server resolves any battle with both identities and records only
 * the outcome; a fallen marshal shows its side's flag. The match ends when a flag falls, when the next side
 * cannot move, or after `LB_QUIET_LIMIT` moves without a battle.
 */
export function move(roomCode: RoomCode, seat: GameSeat, from: string, to: string, now: number = Date.now()): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase !== 'playing') return { success: false, reason: game.phase === 'deploying' ? 'Deployment is not finished' : 'The game is over' };
  if (game.currentTurnSeat !== seat) return { success: false, reason: 'Not your turn' };
  const side = landBattleSide(game, seat);
  const fromIndex = lbCell(from);
  const toIndex = lbCell(to);
  const board = piecesBoard(game.pieces);
  if (side === null || fromIndex === null || toIndex === null || board[fromIndex]?.side !== side) {
    return { success: false, reason: 'Illegal move' };
  }
  const applied = lbApplyMove(board, fromIndex, toIndex);
  if (!applied) return { success: false, reason: 'Illegal move' };

  const seats = landBattleSeats(game);
  const path = applied.path;
  const fallen = applied.removed.filter((piece) => piece.rank === 'marshal').map((piece) => seats[piece.side]);
  const entry: LandBattleMove = {
    seat, from: lbNode(fromIndex), to: lbNode(toIndex),
    ...path.length > 0 ? { path: path.map(lbNode) } : {},
    ...applied.outcome === 'move' ? {} : { capture: true, battle: applied.outcome },
    ...fallen.length > 0 ? { flagShown: seats.filter((other) => fallen.includes(other)) } : {},
    timestamp: now,
  };
  game.pieces = movedPieces(game.pieces, fromIndex, toIndex, applied.outcome);
  game.log.push(entry);
  game.drawOffer = afterBoardMove(game.drawOffer, seat);
  game.quietMoves = applied.outcome === 'move' ? game.quietMoves + 1 : 0;
  for (const shown of fallen) if (!game.flagsShown.includes(shown)) game.flagsShown.push(shown);
  game.flagsShown = seats.filter((other) => game.flagsShown.includes(other));

  const opponent = lbOpponent(side);
  if (applied.flagCaptured) finish(game, { winners: [seat], reason: 'flag-captured' });
  else if (!lbHasMove(applied.board, opponent)) finish(game, { winners: [seat], reason: 'no-moves' });
  else if (game.quietMoves >= LB_QUIET_LIMIT) finish(game, { winners: [], reason: 'no-capture-limit' });
  else game.currentTurnSeat = seats[opponent];
  return { success: true };
}

/** The stored pieces after a resolved move, keeping deployment order. */
export function movedPieces(
  pieces: readonly LandBattleStoredPiece[], from: number, to: number, outcome: 'move' | 'win' | 'lose' | 'tie',
): LandBattleStoredPiece[] {
  const fromNode = lbNode(from);
  const toNode = lbNode(to);
  return pieces.flatMap((piece): LandBattleStoredPiece[] => {
    if (piece.node === fromNode) return outcome === 'move' || outcome === 'win' ? [{ ...piece, node: toNode }] : [];
    if (piece.node === toNode) return outcome === 'win' || outcome === 'tie' ? [] : [piece];
    return [piece];
  });
}

/** Resignation and draw offers; they never move the turn or its clock. Resigning also works while deploying. */
export function control(roomCode: RoomCode, seat: GameSeat, action: MatchControlAction): Result {
  const game = games.get(roomCode);
  if (!game) return { success: false, reason: 'Game not found' };
  if (game.phase === 'scoring') return { success: false, reason: 'The game is over' };
  const seats = landBattleSeats(game);
  const applied = applyMatchControl(game.drawOffer, seat, action, landBattleDefinition.matchControls!, {
    seats, turnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
  });
  if (typeof applied === 'string') return { success: false, reason: applied };
  game.drawOffer = applied.state;
  if (applied.effect?.kind === 'resigned') finish(game, resignationOutcome(applied.effect.seat, seats));
  else if (applied.effect?.kind === 'agreed-draw') finish(game, { winners: [], reason: 'agreed-draw' });
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/** Whether play has begun: both deployments are on the board. */
function deployedBoth(game: LandBattleGameState): boolean {
  return landBattleSeats(game).every((seat) => Boolean(game.layouts[seat]));
}

/**
 * Pieces as `reveal` allows: before play, the submitted deployments (an opponent's tiles show that it is
 * ready, never what it placed); afterwards the pieces on the board.
 */
function visiblePieces(
  game: LandBattleGameState, reveal: (piece: LandBattleStoredPiece) => boolean,
): LandBattleVisiblePiece[] {
  const seats = landBattleSeats(game);
  const pieces = deployedBoth(game) ? game.pieces : seats.flatMap((seat, side) => {
    const layout = game.layouts[seat];
    return layout ? lbDeploySlots(side as LbSide).map((index, slot): LandBattleStoredPiece => ({
      side: side as LbSide, rank: layout[slot], origin: lbNode(index), node: lbNode(index),
    })) : [];
  });
  return pieces.map((piece) => (reveal(piece)
    ? { side: piece.side, node: piece.node, origin: piece.origin, rank: piece.rank }
    : { side: piece.side, node: piece.node, origin: piece.origin }));
}

/**
 * The seat sees its own identities, any flag whose marshal has fallen, and everything once the match is
 * over; opponent identities otherwise never leave the server.
 */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): LandBattleVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  const seats = landBattleSeats(game);
  const side = landBattleSide(game, seat);
  const shownSides = game.flagsShown.map((shown) => seats.indexOf(shown));
  return {
    gameType: 'landbattle',
    phase: game.phase,
    mySeat: seat,
    seats,
    deployDeadline: game.deployDeadline,
    deployed: seats.filter((other) => Boolean(game.layouts[other])),
    autoDeployed: game.autoDeployed,
    myLayout: side === null ? null : game.layouts[seat] ?? null,
    pieces: visiblePieces(game, (piece) => game.phase === 'scoring' || piece.side === side
      || (piece.rank === 'flag' && shownSides.includes(piece.side))),
    flagsShown: game.flagsShown,
    currentTurnSeat: game.currentTurnSeat,
    drawOffer: game.drawOffer,
    quietMoves: game.quietMoves,
    log: game.log,
    result: game.result,
  };
}

/** God view for unseated spectators: every identity on the board. */
export function withObserverView(
  visible: LandBattleVisibleState, game: LandBattleGameState, observer: ObserverRole,
): LandBattleVisibleState {
  return { ...visible, observer, pieces: visiblePieces(game, () => true) };
}

export function getGameState(roomCode: RoomCode): LandBattleGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): LandBattleGameState[] {
  return [...games.values()];
}

export function restoreGames(records: LandBattleGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
