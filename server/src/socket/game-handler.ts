import { roomSeatInfo } from '@shared/rules/seats';
import type { GameSeat } from '@shared/types';
import { parseGameAction } from '@shared/games/actions';
import type { SocketContext, TypedSocket } from './context';
import { actionError, requireRoom, requireSuccess, runAction } from './context';
import * as roomManager from '../managers/room-manager';
import * as gameManager from '../managers/game-manager';
import * as chatManager from '../managers/chat-manager';

function playerGameSeat(socket: TypedSocket, code: string): GameSeat {
  const seat = roomManager.getGamePlayerSeat(code, socket.data.accountId);
  if (!seat) throw actionError('Select a seat first.');
  return seat;
}

/** Adds an abort-vote chat line about `accountId`, read from the room seats. */
export function systemLine(code: string, accountId: string, key: string): void {
  const seat = roomManager.getGamePlayerSeat(code, accountId);
  const room = roomManager.getRoomInfo(code);
  const subject = seat && room ? roomSeatInfo(room, seat)?.player : null;
  if (subject) chatManager.addSystemMessage(code, subject, key);
}

export function registerGameHandlers(context: SocketContext, socket: TypedSocket): void {
  socket.on('game:leaveEarly', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    if (roomManager.getRoomInfo(code)?.status !== 'playing') throw actionError('No active game.');
    requireSuccess(gameManager.leaveEarly(code, playerGameSeat(socket, code)));
    return { success: true };
  }));

  socket.on('game:autoPlay', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || typeof payload.enabled !== 'boolean') throw actionError('Invalid auto-play setting.');
    const code = requireRoom(socket);
    if (roomManager.getRoomInfo(code)?.status !== 'playing') throw actionError('No active game.');
    requireSuccess(gameManager.setAutoPlay(code, playerGameSeat(socket, code), payload.enabled));
    return { success: true };
  }));

  socket.on('game:action', (payload, callback) => runAction(context, socket, callback, () => {
    const request = parseGameAction(payload);
    if (typeof request === 'string') throw actionError(request);
    const code = requireRoom(socket);
    requireSuccess(gameManager.handleGameAction(code, playerGameSeat(socket, code), request));
    return { success: true };
  }));

  const refreshRequired = (): never => { throw actionError('Please refresh the page to continue playing.'); };
  socket.on('game:redealResponse', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:bid', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:playCard', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:bigtwo:play', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:bigtwo:pass', (callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:redpoints:play', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:redpoints:chooseFlip', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:sevens:play', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:sevens:cover', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:chinesepoker:arrange', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:ninetynine:play', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:liarsdeck:play', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:liarsdeck:challenge', (callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:blackjack:bet', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:blackjack:action', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:blackjack:dealerAction', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:holdem:action', (_payload, callback) => runAction(context, socket, callback, refreshRequired));
  socket.on('game:napoleon:action', (_payload, callback) => runAction(context, socket, callback, refreshRequired));

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
    const accountId = socket.data.accountId;
    const seat = roomManager.getGamePlayerSeat(code, accountId);
    const spectating = gameManager.isSpectating(code, accountId);
    if (!seat && !spectating) throw actionError('Select a seat first.');
    if (gameManager.getGameState(code)?.phase !== 'scoring') throw actionError('The game has not ended.');
    if (gameManager.isPresentationActive(code)) {
      throw actionError('Please wait for the current action to finish.');
    }
    // Each player and spectator returns on their own; the others keep viewing the result.
    if (seat && gameManager.isViewingGame(code, seat, accountId)) gameManager.returnFromResult(code, seat);
    else if (spectating) gameManager.returnViewerFromResult(code, accountId);
    return { success: true };
  }));
}
