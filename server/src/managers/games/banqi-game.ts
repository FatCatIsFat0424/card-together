// ─── Banqi Game: two seats flip, move, and capture on a shuffled face-down half board ───
//
// The shuffled identities live only in `hidden`; every public field (board, log, result) reveals a piece
// at the moment it is flipped and never before.

import { randomInt, randomUUID } from 'node:crypto';
import type { GameSeat, PlayerInfo, RoomCode } from '@shared/types';
import type { BanqiGameState, BanqiMatchResult, BanqiMove, BanqiOptions, BanqiVisibleState } from '@shared/games/banqi/types';
import { occupiedSeats } from '@shared/rules/seats';
import {
  BQ_CELLS, BQ_DOWN, BQ_EMPTY, BQ_QUIET_LIMIT, bqApplyBlind, bqApplyMove, bqCell, bqColour, bqFullSet, bqHasAction, bqMovesFrom, bqNode,
  bqOpposite, isBqPiece,
} from '@shared/rules/banqi';
import type { BqColour } from '@shared/rules/banqi';
import { nodeId } from '@shared/rules/board/board-model';
import { resignationOutcome } from '@shared/rules/board/board-result';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import { NO_DRAW_OFFER, afterBoardMove, applyMatchControl } from '@shared/rules/board/match-controls';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { banqiDefinition } from '@shared/games/banqi/definition';
import { DEFAULT_BANQI_OPTIONS, banqiMatchOptions, banqiRules } from '@shared/banqi-options';
import { shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → BanqiGameState */
const games: Map<RoomCode, BanqiGameState> = new Map();

/** The two seats in play order: the first mover first. */
export function banqiSeats(game: Pick<BanqiGameState, 'players'>): GameSeat[] {
  return occupiedSeats(game.players);
}

/**
 * Deals a match: the 32 pieces shuffled by the injected generator, all face down. The first occupied seat
 * moves first; colours are decided by the first flip.
 */
export function startGame(
  roomCode: RoomCode,
  players: Partial<Record<GameSeat, PlayerInfo>>,
  options: BanqiOptions = DEFAULT_BANQI_OPTIONS,
  random: () => number = secureRandom,
  now: number = Date.now(),
): void {
  const seats = occupiedSeats(players);
  games.set(roomCode, {
    gameType: 'banqi',
    id: randomUUID(),
    startedAt: now,
    options: banqiMatchOptions(options),
    players: structuredClone(players),
    roomCode,
    phase: 'playing',
    board: new Array<number>(BQ_CELLS).fill(BQ_DOWN),
    hidden: shuffleDeck(bqFullSet(), random),
    colours: null,
    currentTurnSeat: seats[0],
    chain: null,
    quietMoves: 0,
    drawOffer: NO_DRAW_OFFER,
    log: [],
    result: null,
  });
}

function fail(reason: string): Result {
  return { success: false, reason };
}

/** Colour of a seat, or null before the first flip. */
export function seatColour(game: Pick<BanqiGameState, 'players' | 'colours'>, seat: GameSeat): BqColour | null {
  const index = banqiSeats(game).indexOf(seat);
  return game.colours === null || index < 0 ? null : game.colours[index];
}

/** Pieces of `colour` still in play: face up on the board plus the face-down ones. */
export function piecesLeft(game: Pick<BanqiGameState, 'board' | 'hidden'>, colour: BqColour): number {
  let count = 0;
  for (let index = 0; index < BQ_CELLS; index++) {
    const slot = game.board[index] === BQ_DOWN ? game.hidden[index] : game.board[index];
    if (isBqPiece(slot) && bqColour(slot) === colour) count++;
  }
  return count;
}

/** Closes the match with the given outcome and the board as it stands. */
function finish(game: BanqiGameState, outcome: BoardOutcome): void {
  const seats = banqiSeats(game);
  const remaining: Partial<Record<GameSeat, number>> = {};
  seats.forEach((seat) => {
    const colour = seatColour(game, seat);
    if (colour !== null) remaining[seat] = piecesLeft(game, colour);
  });
  const result: BanqiMatchResult = {
    gameType: 'banqi',
    seats,
    remaining,
    moves: game.log.length,
    winners: [...outcome.winners],
    reason: outcome.reason,
  };
  game.phase = 'scoring';
  game.chain = null;
  game.result = result;
}

/** Ends `seat`'s turn: a win by wipeout or by leaving the opponent without an action, a draw, or the opponent's turn. */
function endTurn(game: BanqiGameState, seat: GameSeat): void {
  const seats = banqiSeats(game);
  const opponent = seats.find((other) => other !== seat) as GameSeat;
  game.chain = null;
  const colour = seatColour(game, opponent);
  if (colour !== null) {
    if (piecesLeft(game, colour) === 0) return finish(game, { winners: [seat], reason: 'all-captured' });
    if (!bqHasAction(game.board, colour, banqiRules(game.options))) {
      return finish(game, { winners: [seat], reason: 'no-moves' });
    }
  }
  if (game.quietMoves >= BQ_QUIET_LIMIT) return finish(game, { winners: [], reason: 'no-capture-limit' });
  game.currentTurnSeat = opponent;
}

function turnCheck(roomCode: RoomCode, seat: GameSeat): BanqiGameState | Result {
  const game = games.get(roomCode);
  if (!game) return fail('Game not found');
  if (game.phase !== 'playing') return fail('The game is over');
  if (game.currentTurnSeat !== seat) return fail('Not your turn');
  return game;
}

/** Turns a face-down piece over. The first flip decides both colours. */
export function flip(roomCode: RoomCode, seat: GameSeat, to: string, now: number = Date.now()): Result {
  const game = turnCheck(roomCode, seat);
  if ('success' in game) return game;
  const index = bqCell(to);
  if (game.chain !== null) return fail('Finish or end the capture chain first');
  if (index === null || game.board[index] !== BQ_DOWN) return fail('Illegal move');

  const piece = game.hidden[index];
  game.board = game.board.map((slot, cell) => (cell === index ? piece : slot));
  game.hidden = game.hidden.map((slot, cell) => (cell === index ? BQ_EMPTY : slot));
  if (game.colours === null) {
    const first = bqColour(piece);
    game.colours = banqiSeats(game).indexOf(seat) === 0 ? [first, bqOpposite(first)] : [bqOpposite(first), first];
  }
  game.quietMoves = 0;
  game.log.push({ seat, to: bqNode(index), revealed: piece, timestamp: now });
  game.drawOffer = afterBoardMove(game.drawOffer, seat);
  endTurn(game, seat);
  return { success: true };
}

/**
 * Moves or captures with one of the seat's face-up pieces, continuing a chain when the room allows it. A blind
 * attack reveals the face-down target: a capturable enemy is taken as by a capture, anything else stays face up
 * and the turn ends. It needs a face-up piece of the seat's colour, so it never comes before the colour-setting flip.
 */
export function move(roomCode: RoomCode, seat: GameSeat, from: string, to: string, now: number = Date.now()): Result {
  const game = turnCheck(roomCode, seat);
  if ('success' in game) return game;
  const source = bqCell(from);
  const target = bqCell(to);
  const colour = seatColour(game, seat);
  if (source === null || target === null || colour === null) return fail('Illegal move');
  const piece = game.board[source];
  if (!isBqPiece(piece) || bqColour(piece) !== colour) return fail('Illegal move');
  const continuing = game.chain !== null;
  if (continuing && game.chain !== bqNode(source)) return fail('Illegal move');
  const rules = banqiRules(game.options);
  const chosen = bqMovesFrom(game.board, source, rules, continuing).find((candidate) => candidate.to === target);
  if (!chosen) return fail('Illegal move');

  const revealed = chosen.blind ? game.hidden[target] : null;
  const applied = revealed === null ? bqApplyMove(game.board, chosen) : bqApplyBlind(game.board, chosen, revealed);
  game.board = applied.board;
  if (revealed !== null) game.hidden = game.hidden.map((slot, cell) => (cell === target ? BQ_EMPTY : slot));
  const record: BanqiMove = {
    seat, from: bqNode(source), to: bqNode(target), piece,
    ...revealed === null ? {} : { blind: true, revealed },
    ...applied.captured === null ? {} : { capture: true, captured: applied.captured },
    ...continuing ? { chain: true } : {},
    timestamp: now,
  };
  game.log.push(record);
  // A blind attack always reveals a piece, so like a flip it restarts the count even when it takes nothing.
  game.quietMoves = chosen.capture || chosen.blind ? 0 : game.quietMoves + 1;
  if (!continuing) game.drawOffer = afterBoardMove(game.drawOffer, seat);

  if (applied.captured !== null && rules.chain && bqMovesFrom(game.board, target, rules, true).length > 0) {
    // The same seat keeps the turn; the next action must be another capture by this piece, or `stop`.
    game.chain = bqNode(target);
    return { success: true };
  }
  endTurn(game, seat);
  return { success: true };
}

/** Gives up the rest of a capture chain. */
export function stop(roomCode: RoomCode, seat: GameSeat): Result {
  const game = turnCheck(roomCode, seat);
  if ('success' in game) return game;
  if (game.chain === null) return fail('There is no capture chain to end');
  endTurn(game, seat);
  return { success: true };
}

/** Resignation and draw offers; they never move the turn or its clock. */
export function control(roomCode: RoomCode, seat: GameSeat, action: MatchControlAction): Result {
  const game = games.get(roomCode);
  if (!game) return fail('Game not found');
  if (game.phase !== 'playing') return fail('The game is over');
  const seats = banqiSeats(game);
  const applied = applyMatchControl(game.drawOffer, seat, action, banqiDefinition.matchControls!, {
    seats, turnSeat: game.currentTurnSeat,
  });
  if (typeof applied === 'string') return fail(applied);
  game.drawOffer = applied.state;
  if (applied.effect?.kind === 'resigned') finish(game, resignationOutcome(applied.effect.seat, seats));
  else if (applied.effect?.kind === 'agreed-draw') finish(game, { winners: [], reason: 'agreed-draw' });
  return { success: true };
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

/**
 * One seat's view: public cells only. Both players are equally in the dark about face-down pieces, so every
 * seat gets the same board; only `mySeat` differs. `hidden` is never copied into a view.
 */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): BanqiVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  return {
    gameType: 'banqi',
    phase: game.phase,
    mySeat: seat,
    seats: banqiSeats(game),
    options: game.options,
    board: game.board,
    colours: game.colours,
    currentTurnSeat: game.currentTurnSeat,
    chain: game.chain,
    quietMoves: game.quietMoves,
    drawOffer: game.drawOffer,
    log: game.log,
    result: game.result,
  };
}

/** God view for unseated spectators: the piece under every face-down cell. */
export function hiddenPieces(game: Pick<BanqiGameState, 'board' | 'hidden'>): Record<string, number> {
  const pieces: Record<string, number> = {};
  for (let index = 0; index < BQ_CELLS; index++) {
    if (game.board[index] === BQ_DOWN) pieces[nodeId(index % 8, Math.floor(index / 8))] = game.hidden[index];
  }
  return pieces;
}

export function getGameState(roomCode: RoomCode): BanqiGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): BanqiGameState[] {
  return [...games.values()];
}

export function restoreGames(records: BanqiGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
