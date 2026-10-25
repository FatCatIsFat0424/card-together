import { isTimeControl } from '@shared/time-control';
import { isSevensOptions } from '@shared/sevens-options';
import { isNinetyNineOptions } from '@shared/ninetynine-options';
import { isBlackjackOptions } from '@shared/blackjack-options';
import { isNapoleonOptions } from '@shared/napoleon-options';
import { isBotDifficulty } from '@shared/bot-difficulty';
import { GAME_SEAT_ORDER, GAME_TYPES } from '@shared/constants';
import type { GameSeat, RoomCode, RoomInvite, RoomSeatTarget, Seat } from '@shared/types';
import type { SocketContext, TypedSocket } from './context';
import { actionError, requireRoom, requireSuccess, runAction, leaveCurrentRoom } from './context';
import * as playerManager from '../managers/player-manager';
import * as roomManager from '../managers/room-manager';
import * as gameManager from '../managers/game-manager';
import * as chatManager from '../managers/chat-manager';
import * as inviteManager from '../managers/invite-manager';

function startPreparedRoom(code: RoomCode, hostId: string): void {
  const room = roomManager.getRoomInfo(code);
  if (!room) throw actionError('Room not found.');
  if (room.hostId !== hostId) throw actionError('Only the host can start the game.');
  if (room.status === 'replaying') throw actionError('A replay is in progress.');
  if (!roomManager.isAllReady(code)) throw actionError('Meet the player count requirement and prepare every seated player first.');
  roomManager.shuffleReadySeats(code);
  const players = roomManager.getSeatPlayers(code);
  if (!players) throw actionError('Room not found.');
  roomManager.setRoomStatus(code, 'playing');
  requireSuccess(gameManager.startGame(
    code, room.gameType, players, room.timeControl, room.sevensOptions, room.ninetyNineOptions, room.blackjackOptions,
    room.napoleonOptions,
  ));
}

/** Any standard or additional seat; the room manager checks that it exists. */
function requireGameSeat(payload: { seat: GameSeat }): GameSeat {
  if (!payload || !(GAME_SEAT_ORDER as readonly unknown[]).includes(payload.seat)) throw actionError('Invalid seat.');
  return payload.seat;
}

function requireSeatTarget(target: unknown): RoomSeatTarget {
  if (target && typeof target === 'object' && 'type' in target) {
    if (target.type === 'spectator') return { type: 'spectator' };
    if (target.type === 'seat' && 'seat' in target
      && (['N', 'E', 'S', 'W'] as readonly unknown[]).includes(target.seat)) {
      return { type: 'seat', seat: target.seat as Seat };
    }
    if (target.type === 'additional' && 'index' in target && typeof target.index === 'number'
      && Number.isInteger(target.index) && target.index >= 0) {
      return { type: 'additional', index: target.index };
    }
  }
  throw actionError('Invalid seat.');
}

function announceRoomJoin(code: RoomCode, accountId: string): void {
  const player = playerManager.getPlayerInfo(accountId);
  if (player) chatManager.addSystemMessage(code, player, 'chat.playerJoined');
}

function joinRoom(code: RoomCode, accountId: string): void {
  const alreadyJoined = roomManager.getRoomMemberIds(code).includes(accountId);
  // Check admission before leaving; both membership changes commit or roll back together.
  requireSuccess(roomManager.joinRoom(code, accountId));
  const current = playerManager.getPlayerState(accountId)?.currentRoomCode;
  if (current && current !== code) leaveCurrentRoom(accountId);
  playerManager.setPlayerRoom(accountId, code);
  if (!alreadyJoined) announceRoomJoin(code, accountId);
}

export function registerRoomHandlers(context: SocketContext, socket: TypedSocket): void {
  socket.on('room:create', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || !GAME_TYPES.includes(payload.gameType)) throw actionError('Unsupported game type.');
    const accountId = socket.data.accountId;
    if (playerManager.getPlayerState(accountId)?.currentRoomCode) throw actionError('Already in a room.');
    const roomCode = roomManager.createRoom(payload.gameType, accountId);
    chatManager.initRoomChat(roomCode);
    playerManager.setPlayerRoom(accountId, roomCode);
    announceRoomJoin(roomCode, accountId);
    return { success: true, roomCode };
  }));

  socket.on('room:join', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || typeof payload.roomCode !== 'string') throw actionError('Enter a room code.');
    const roomCode = payload.roomCode.trim().toUpperCase();
    const accountId = socket.data.accountId;
    const currentRoom = playerManager.getPlayerState(accountId)?.currentRoomCode;
    if (currentRoom && currentRoom !== roomCode) throw actionError('Leave your current room first.');
    joinRoom(roomCode, accountId);
    return { success: true, room: roomManager.getRoomInfo(roomCode) ?? undefined };
  }));

  socket.on('room:joinFriend', (payload, callback) => runAction(context, socket, callback, async () => {
    if (!payload || typeof payload.accountId !== 'string' || !payload.accountId.trim()
      || typeof payload.roomCode !== 'string' || !payload.roomCode.trim()) {
      throw actionError('Choose a friend room to join.');
    }
    const accountId = socket.data.accountId;
    if (!await context.friends.areFriends(accountId, payload.accountId)) {
      throw actionError('You can only join rooms hosted by friends.');
    }
    const host = playerManager.getPlayerState(payload.accountId);
    const code = payload.roomCode.trim().toUpperCase();
    const room = roomManager.getRoomInfo(code);
    if (host?.connectionStatus !== 'connected' || host.currentRoomCode !== code
      || room?.hostId !== payload.accountId) {
      throw actionError('This friend is no longer hosting this room. Refresh your friends list.');
    }
    joinRoom(code, accountId);
    return { success: true, room: roomManager.getRoomInfo(code) ?? undefined };
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
        if (!room) throw actionError('Room not found.');
        // Invitees join as spectators, so only the spectator area limits invitations.
        if (!roomManager.hasSpectatorRoom(code)) throw actionError('Room is full.');
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
        const seatsFree = [...Object.values(room.seats), ...room.additionalSeats ?? []].filter((seat) => !seat.player).length;
        invite = { roomCode: code, gameType: room.gameType, from, seatsFree: room.status === 'waiting' ? seatsFree : 0 };
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

  socket.on('room:kick', (payload, callback) => {
    if (typeof callback !== 'function') return;
    const targetId = payload?.accountId;
    if (typeof targetId !== 'string') { callback({ success: false, error: 'Choose a player to remove.' }); return; }
    let kickedFrom: RoomCode | null = null;
    runAction(context, socket, callback, () => {
      const code = requireRoom(socket);
      requireSuccess(roomManager.canKick(code, socket.data.accountId, targetId));
      if (playerManager.getPlayerState(targetId)?.currentRoomCode !== code) {
        throw actionError('Player is not in this room.');
      }
      leaveCurrentRoom(targetId);
      kickedFrom = code;
      return { success: true };
    }, { afterCommit: () => {
      if (kickedFrom) context.io.to(`account:${targetId}`).emit('room:kicked', { roomCode: kickedFrom });
    } });
  });

  socket.on('room:changeSeat',(payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || !(['N', 'E', 'S', 'W'] as Seat[]).includes(payload.seat)) {
      throw actionError('Invalid seat.');
    }
    const player = playerManager.getPlayerInfo(socket.data.accountId);
    if (!player) throw actionError('Player not found.');
    requireSuccess(roomManager.changeSeat(requireRoom(socket), player, payload.seat));
    return { success: true };
  }));

  socket.on('room:movePlayer', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || typeof payload.accountId !== 'string' || !payload.accountId) throw actionError('Invalid player.');
    const code = requireRoom(socket);
    const target = requireSeatTarget(payload.target);
    const player = playerManager.getPlayerInfo(payload.accountId);
    if (!player || playerManager.getPlayerState(player.id)?.currentRoomCode !== code) {
      throw actionError('Player is not in this room.');
    }
    requireSuccess(roomManager.movePlayer(code, socket.data.accountId, player, target));
    return { success: true };
  }));

  socket.on('room:standUp', (callback) => runAction(context, socket, callback, () => {
    requireSuccess(roomManager.standUp(requireRoom(socket), socket.data.accountId));
    return { success: true };
  }));

  socket.on('room:addSeat', (callback) => runAction(context, socket, callback, () => {
    requireSuccess(roomManager.addSeat(requireRoom(socket), socket.data.accountId));
    return { success: true };
  }));

  socket.on('room:removeSeat', (callback) => runAction(context, socket, callback, () => {
    requireSuccess(roomManager.removeSeat(requireRoom(socket), socket.data.accountId));
    return { success: true };
  }));

  socket.on('room:changeAdditionalSeat', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || !Number.isInteger(payload.index) || payload.index < 0) throw actionError('Invalid seat.');
    const player = playerManager.getPlayerInfo(socket.data.accountId);
    if (!player) throw actionError('Player not found.');
    requireSuccess(roomManager.changeAdditionalSeat(requireRoom(socket), player, payload.index));
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

  socket.on('room:setSevensOptions', (payload, callback) => runAction(context, socket, callback, () => {
    if (!isSevensOptions(payload)) throw actionError('Invalid Sevens options.');
    requireSuccess(roomManager.setSevensOptions(requireRoom(socket), socket.data.accountId, payload));
    return { success: true };
  }));

  socket.on('room:setNinetyNineOptions', (payload, callback) => runAction(context, socket, callback, () => {
    if (!isNinetyNineOptions(payload)) throw actionError('Invalid Ninety-Nine options.');
    requireSuccess(roomManager.setNinetyNineOptions(requireRoom(socket), socket.data.accountId, payload));
    return { success: true };
  }));

  socket.on('room:setBlackjackOptions', (payload, callback) => runAction(context, socket, callback, () => {
    if (!isBlackjackOptions(payload)) throw actionError('Invalid Blackjack options.');
    requireSuccess(roomManager.setBlackjackOptions(requireRoom(socket), socket.data.accountId, payload));
    return { success: true };
  }));

  socket.on('room:setNapoleonOptions', (payload, callback) => runAction(context, socket, callback, () => {
    if (!isNapoleonOptions(payload)) throw actionError('Invalid Napoleon options.');
    requireSuccess(roomManager.setNapoleonOptions(requireRoom(socket), socket.data.accountId, payload));
    return { success: true };
  }));

  socket.on('room:ready', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    requireSuccess(roomManager.setReady(code, socket.data.accountId, true));
    return { success: true };
  }));

  socket.on('room:start', (callback) => runAction(context, socket, callback, () => {
    startPreparedRoom(requireRoom(socket), socket.data.accountId);
    return { success: true };
  }));

  socket.on('room:setShuffleSeats', (payload, callback) => runAction(context, socket, callback, () => {
    if (!payload || typeof payload.enabled !== 'boolean') throw actionError('Invalid seat shuffle setting.');
    requireSuccess(roomManager.setShuffleSeats(requireRoom(socket), socket.data.accountId, payload.enabled));
    return { success: true };
  }));

  socket.on('room:addBot', (payload, callback) => runAction(context, socket, callback, () => {
    const seat = requireGameSeat(payload);
    if (payload.difficulty !== undefined && !isBotDifficulty(payload.difficulty)) throw actionError('Invalid bot difficulty.');
    const code = requireRoom(socket);
    requireSuccess(roomManager.addBot(code, socket.data.accountId, seat, payload.difficulty));
    return { success: true };
  }));

  socket.on('room:setBotDifficulty', (payload, callback) => runAction(context, socket, callback, () => {
    const seat = requireGameSeat(payload);
    if (!isBotDifficulty(payload.difficulty)) throw actionError('Invalid bot difficulty.');
    requireSuccess(roomManager.setBotDifficulty(requireRoom(socket), socket.data.accountId, seat, payload.difficulty));
    return { success: true };
  }));

  socket.on('room:removeBot', (payload, callback) => runAction(context, socket, callback, () => {
    const seat = requireGameSeat(payload);
    requireSuccess(roomManager.removeBot(requireRoom(socket), socket.data.accountId, seat));
    return { success: true };
  }));

  socket.on('room:fillBots', (callback) => runAction(context, socket, callback, () => {
    const code = requireRoom(socket);
    requireSuccess(roomManager.fillBots(code, socket.data.accountId));
    return { success: true };
  }));

  socket.on('room:unready', (callback) => runAction(context, socket, callback, () => {
    requireSuccess(roomManager.setReady(requireRoom(socket), socket.data.accountId, false));
    return { success: true };
  }));
}
