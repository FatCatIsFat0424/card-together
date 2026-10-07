import type { Card, Seat } from '@shared/types';
import type { SocketContext, TypedSocket } from './context';
import { actionError, requireRoom, requireSuccess, runAction } from './context';
import * as roomManager from '../managers/room-manager';
import * as gameManager from '../managers/game-manager';
import * as chatManager from '../managers/chat-manager';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

function playerSeat(socket: TypedSocket, code: string): Seat {
  const seat = roomManager.getPlayerSeat(code, socket.data.accountId);
  if (!seat) throw actionError('Select a seat first.');
  return seat;
}

function isCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) return false;
  const { suit, rank } = value as { suit?: unknown; rank?: unknown };
  return typeof rank === 'number' && Number.isInteger(rank) && rank >= 2 && rank <= 14
    && typeof suit === 'string' && ['clubs', 'diamonds', 'hearts', 'spades'].includes(suit);
}

/** Adds an abort-vote chat line about `accountId`, read from the room seats. */
export function systemLine(code: string, accountId: string, key: string): void {
  const seat = roomManager.getPlayerSeat(code, accountId);
  const subject = seat ? roomManager.getRoomInfo(code)?.seats[seat].player : null;
  if (subject) chatManager.addSystemMessage(code, subject, key);
}

export function registerGameHandlers(context: SocketContext, socket: TypedSocket): void {
  socket.on('game:redealResponse', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || typeof payload.accept !== 'boolean') throw actionError('Invalid redeal response.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleRedealResponse(code, playerSeat(socket, code), payload.accept));
    return { success: true };
  }));

  socket.on('game:bid', (payload, callback) => runAction(context, socket, callback, () => {
    const bid = payload?.bid;
    if (!bid || (bid.type !== 'pass' && (bid.type !== 'bid' || !Number.isInteger(bid.level)
      || bid.level < 1 || bid.level > 7
      || !['clubs', 'diamonds', 'hearts', 'spades', 'nt'].includes(bid.suit)))) {
      throw actionError('Invalid bid.');
    }
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleBid(code, playerSeat(socket, code), bid));
    return { success: true };
  }));

  socket.on('game:playCard', (payload, callback) => runAction(context, socket, callback, () => {
    const card = payload?.card;
    if (!isCard(card)) throw actionError('Invalid card.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handlePlayCard(code, playerSeat(socket, code), card));
    return { success: true };
  }));

  socket.on('game:bigtwo:play', (payload, callback) => runAction(context, socket, callback, () => {
    const cards: unknown = payload?.cards;
    if (!Array.isArray(cards) || cards.length < 1 || cards.length > 5 || !cards.every(isCard)
      || new Set(cards.map((card: Card) => `${card.suit}-${card.rank}`)).size !== cards.length) {
      throw actionError('Invalid cards.');
    }
    const code = requireRoom(socket);
    const played = cards.map(({ suit, rank }: Card): Card => ({ suit, rank }));
    requireSuccess(gameManager.handleBigTwoPlay(code, playerSeat(socket, code), played));
    return { success: true };
  }));

  socket.on('game:bigtwo:pass', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleBigTwoPass(code, playerSeat(socket, code)));
    return { success: true };
  }));

  socket.on('game:redpoints:play', (payload, callback) => runAction(context, socket, callback, () => {
    const card: unknown = payload?.card;
    const capture: unknown = payload?.capture;
    if (!isCard(card) || (capture !== undefined && !isCard(capture))) throw actionError('Invalid card.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleRedPointsPlay(code, playerSeat(socket, code), { suit: card.suit, rank: card.rank },
      capture === undefined ? undefined : { suit: capture.suit, rank: capture.rank }));
    return { success: true };
  }));

  socket.on('game:redpoints:chooseFlip', (payload, callback) => runAction(context, socket, callback, () => {
    const capture: unknown = payload?.capture;
    if (!isCard(capture)) throw actionError('Invalid card.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleRedPointsChooseFlip(code, playerSeat(socket, code),
      { suit: capture.suit, rank: capture.rank }));
    return { success: true };
  }));

  socket.on('game:ninetynine:play', (payload, callback) => runAction(context, socket, callback, () => {
    const card: unknown = payload?.card;
    const choice: unknown = payload?.choice;
    const target: unknown = payload?.target;
    if (!isCard(card)) throw actionError('Invalid card.');
    if (choice !== undefined && choice !== 'plus' && choice !== 'minus') throw actionError('Invalid choice.');
    if (target !== undefined && !SEATS.includes(target as Seat)) throw actionError('Invalid target.');
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleNinetyNinePlay(code, playerSeat(socket, code), { suit: card.suit, rank: card.rank },
      choice, target as Seat | undefined));
    return { success: true };
  }));

  socket.on('game:abortVote:start', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    const started = roomManager.startAbortVote(code, socket.data.accountId, Date.now());
    if (!started.success) throw actionError(started.reason);
    systemLine(code, socket.data.accountId, 'abortVote.started');
    if (started.outcome === 'passed') {
      gameManager.abortGame(code);
      roomManager.setRoomStatus(code, 'waiting');
      roomManager.resetAllReady(code);
      systemLine(code, socket.data.accountId, 'abortVote.passed');
    }
    return { success: true };
  }));

  socket.on('game:abortVote:cast', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || typeof payload.agree !== 'boolean') throw actionError('Invalid vote.');
    const code = requireRoom(socket);
    const startedBy = roomManager.getRoomInfo(code)?.abortVote?.startedBy;
    const cast = roomManager.castAbortVote(code, socket.data.accountId, payload.agree, Date.now());
    if (!cast.success) throw actionError(cast.reason);
    if (cast.outcome === 'passed') {
      gameManager.abortGame(code);
      roomManager.setRoomStatus(code, 'waiting');
      roomManager.resetAllReady(code);
    }
    if (cast.outcome !== 'pending' && startedBy) {
      systemLine(code, startedBy, cast.outcome === 'passed' ? 'abortVote.passed' : 'abortVote.failed');
    }
    return { success: true };
  }));

  socket.on('game:continue', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    if (gameManager.getGameState(code)?.phase !== 'scoring') throw actionError('The game has not ended.');
    if (gameManager.isPresentationActive(code)) {
      throw actionError('Please wait for the current action to finish.');
    }
    gameManager.removeGame(code);
    return { success: true };
  }));
}
