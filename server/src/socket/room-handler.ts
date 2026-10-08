import { isTimeControl } from '@shared/time-control';
import { GAME_TYPES } from '@shared/constants';
import type { RoomCode, RoomInvite, Seat } from '@shared/types';
import type { SocketContext, TypedSocket } from './context';
import { actionError, requireRoom, requireSuccess, runAction, leaveCurrentRoom } from './context';
import * as playerManager from '../managers/player-manager';
import * as roomManager from '../managers/room-manager';
import * as gameManager from '../managers/game-manager';
import * as chatManager from '../managers/chat-manager';
import * as inviteManager from '../managers/invite-manager';

function startIfReady(code: RoomCode): void {
  const room = roomManager.getRoomInfo(code);
  if (!room || !roomManager.isAllReady(code)) return;
  const players = roomManager.getSeatPlayers(code);
  if (!players) throw actionError('All four seats must be filled.');
  roomManager.setRoomStatus(code, 'playing');
  requireSuccess(gameManager.startGame(code, room.gameType, players, room.timeControl));
}

function requireSeat(payload: { seat: Seat }): Seat {
  if (!payload || !(['N', 'E', 'S', 'W'] as Seat[]).includes(payload.seat)) {
    throw actionError('Invalid seat.');
  }
  return payload.seat;
}

export function registerRoomHandlers(context: SocketContext, socket: TypedSocket): void {
  socket.on('room:create', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || !GAME_TYPES.includes(payload.gameType)) throw actionError('Unsupported game type.');
    const accountId = socket.data.accountId;
    if (playerManager.getPlayerState(accountId)?.currentRoomCode) throw actionError('Already in a room.');
    const roomCode = roomManager.createRoom(payload.gameType, accountId);
    chatManager.initRoomChat(roomCode);
    playerManager.setPlayerRoom(accountId, roomCode);
    return { success: true, roomCode };
  }));

  socket.on('room:join', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || typeof payload.roomCode !== 'string') throw actionError('Enter a room code.');
    const roomCode = payload.roomCode.trim().toUpperCase();
    const accountId = socket.data.accountId;
    const currentRoom = playerManager.getPlayerState(accountId)?.currentRoomCode;
    if (currentRoom && currentRoom !== roomCode) throw actionError('Leave your current room first.');
    requireSuccess(roomManager.joinRoom(roomCode, accountId));
    playerManager.setPlayerRoom(accountId, roomCode);
    return { success: true, room: roomManager.getRoomInfo(roomCode) ?? undefined };
  }));

  socket.on('room:invite', (payload, callback) => {
    if (typeof callback !== 'function') return;
    const targetId = payload?.accountId;
    if (typeof targetId !== 'string') { callback({ success: false, error: 'Choose a friend to invite.' }); return; }
    void context.friends.areFriends(socket.data.accountId, targetId).then((isFriend) => {
      let invite: RoomInvite | null = null;
      runAction(context, socket, callback, () => {
        const code = requireRoom(socket);
        const room = roomManager.getRoomInfo(code);
        const members = roomManager.getRoomMemberIds(code);
        if (!room || room.status !== 'waiting') throw actionError('The game has already started.');
        if (members.length >= 4) throw actionError('Room is full.');
        if (!isFriend) throw actionError('You can only invite friends.');
        if (members.includes(targetId)) throw actionError('This friend is already in the room.');
        if (playerManager.getPlayerState(targetId)?.connectionStatus !== 'connected') {
          throw actionError('This friend is offline.');
        }
        const from = playerManager.getPlayerInfo(socket.data.accountId);
        if (!from) throw actionError('Player not found.');
        if (!inviteManager.tryReserveInvite(from.id, targetId)) {
          throw actionError('Please wait before inviting this friend again.');
        }
        invite = { roomCode: code, gameType: room.gameType, from, seatsFree: 4 - members.length };
        return { success: true };
      }, { skipUnchanged: true, afterCommit: () => {
        if (invite) context.io.to(`account:${targetId}`).emit('room:invited', invite);
      } });
    }, (error: unknown) => {
      console.error('[room:invite]', error);
      callback({ success: false, error: 'Unable to send the invite. Please try again.' });
    });
  });

  socket.on('room:leave', (callback) => runAction(context, socket, callback, () => {
    requireRoom(socket);
    leaveCurrentRoom(socket.data.accountId);
    return { success: true };
  }));

  socket.on('room:changeSeat', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || !(['N', 'E', 'S', 'W'] as Seat[]).includes(payload.seat)) {
      throw actionError('Invalid seat.');
    }
    const player = playerManager.getPlayerInfo(socket.data.accountId);
    if (!player) throw actionError('Player not found.');
    requireSuccess(roomManager.changeSeat(requireRoom(socket), player, payload.seat));
    return { success: true };
  }));

  socket.on('room:setGameType', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || !GAME_TYPES.includes(payload.gameType)) throw actionError('Unsupported game type.');
    requireSuccess(roomManager.setGameType(requireRoom(socket), socket.data.accountId, payload.gameType));
    return { success: true };
  }));

  socket.on('room:setTimeControl', (payload, callback) => runAction(context, socket, callback, () => {
    if (!isTimeControl(payload)) throw actionError('Invalid time control.');
    requireSuccess(roomManager.setTimeControl(requireRoom(socket), socket.data.accountId, payload));
    return { success: true };
  }));

  socket.on('room:ready', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    requireSuccess(roomManager.setReady(code, socket.data.accountId, true));
    startIfReady(code);
    return { success: true };
  }));

  socket.on('room:addBot', (payload, callback) => runAction(context, socket, callback, () => {
    const seat = requireSeat(payload);
    const code = requireRoom(socket);
    requireSuccess(roomManager.addBot(code, socket.data.accountId, seat));
    startIfReady(code);
    return { success: true };
  }));

  socket.on('room:removeBot', (payload, callback) => runAction(context, socket, callback, () => {
    const seat = requireSeat(payload);
    requireSuccess(roomManager.removeBot(requireRoom(socket), socket.data.accountId, seat));
    return { success: true };
  }));

  socket.on('room:fillBots', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    requireSuccess(roomManager.fillBots(code, socket.data.accountId));
    startIfReady(code);
    return { success: true };
  }));

  socket.on('room:unready', (callback) => runAction(context, socket, callback, () => {
    requireSuccess(roomManager.setReady(requireRoom(socket), socket.data.accountId, false));
    return { success: true };
  }));
}
