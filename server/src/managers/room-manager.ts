import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { GameType, PlayerInfo, RoomCode, RoomInfo, RoomStatus, Seat, SeatMap } from '@shared/types';
import { ABORT_VOTE_COOLDOWN_MS, ABORT_VOTE_DURATION_MS, ABORT_VOTE_THRESHOLD } from '@shared/constants';
import type { PersistedRoom } from '../runtime/types';
import { generateRoomCode } from '../utils/id-generator';

const rooms = new Map<RoomCode, PersistedRoom>();
const seats: Seat[] = ['N', 'E', 'S', 'W'];
type Result = { success: true } | { success: false; reason: string };

function emptySeats(): SeatMap {
  return {
    N: { player: null, isReady: false }, E: { player: null, isReady: false },
    S: { player: null, isReady: false }, W: { player: null, isReady: false },
  };
}

export function createRoom(gameType: GameType, creatorId: string): RoomCode {
  let code = generateRoomCode();
  while (rooms.has(code)) code = generateRoomCode();
  rooms.set(code, {
    info: {
      code, gameType, status: 'waiting', seats: emptySeats(), createdAt: Date.now(),
      hostId: creatorId, abortVote: null, abortVoteCooldownUntil: null,
    },
    memberIds: [creatorId],
  });
  return code;
}

export function getRoomInfo(code: RoomCode): RoomInfo | null {
  return rooms.get(code)?.info ?? null;
}

export function getRoomMemberIds(code: RoomCode): readonly string[] {
  return rooms.get(code)?.memberIds.slice() ?? [];
}

export function joinRoom(code: RoomCode, playerId: string): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.memberIds.includes(playerId)) return { success: true };
  if (room.info.status === 'playing') return { success: false, reason: 'Game is in progress' };
  if (room.memberIds.length >= 4) return { success: false, reason: 'Room is full' };
  room.memberIds.push(playerId);
  return { success: true };
}

export function leaveRoom(code: RoomCode, playerId: string): { seat: Seat | null; roomEmpty: boolean } {
  const room = rooms.get(code);
  if (!room) return { seat: null, roomEmpty: true };
  const seat = getPlayerSeat(code, playerId);
  if (seat) room.info = {
    ...room.info, seats: { ...room.info.seats, [seat]: { player: null, isReady: false } },
  };
  room.memberIds = room.memberIds.filter((id) => id !== playerId);
  const humans = room.memberIds.filter((id) => !seats.some((seat) =>
    room.info.seats[seat].player?.id === id && room.info.seats[seat].player?.isBot));
  const roomEmpty = humans.length === 0;
  if (roomEmpty) rooms.delete(code);
  else if (room.info.hostId === playerId) room.info = { ...room.info, hostId: humans[0] };
  return { seat, roomEmpty };
}

function requireBotManagement(code: RoomCode, playerId: string): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.hostId !== playerId) return { success: false, reason: 'Only the host can manage bots.' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Cannot manage bots during game.' };
  return { success: true };
}

export function addBot(code: RoomCode, playerId: string, seat: Seat): Result {
  const allowed = requireBotManagement(code, playerId);
  if (!allowed.success) return allowed;
  const room = rooms.get(code)!;
  if (room.info.seats[seat].player) return { success: false, reason: 'Seat is occupied' };
  if (room.memberIds.length >= seats.length) return { success: false, reason: 'Room is full' };
  const bot: PlayerInfo = {
    id: `bot:${randomUUID()}`, username: `bot-${seat.toLowerCase()}`, nickname: `Bot ${seat}`,
    color: '#64748b', avatar: 'owl', avatarImage: null, isBot: true,
  };
  room.memberIds.push(bot.id);
  room.info = { ...room.info, seats: { ...room.info.seats, [seat]: { player: bot, isReady: true } } };
  return { success: true };
}

export function removeBot(code: RoomCode, playerId: string, seat: Seat): Result {
  const allowed = requireBotManagement(code, playerId);
  if (!allowed.success) return allowed;
  const room = rooms.get(code)!;
  const bot = room.info.seats[seat].player;
  if (!bot?.isBot) return { success: false, reason: 'No bot in this seat.' };
  room.memberIds = room.memberIds.filter((id) => id !== bot.id);
  room.info = { ...room.info, seats: { ...room.info.seats, [seat]: { player: null, isReady: false } } };
  return { success: true };
}

export function fillBots(code: RoomCode, playerId: string): Result {
  const allowed = requireBotManagement(code, playerId);
  if (!allowed.success) return allowed;
  const room = rooms.get(code)!;
  for (const seat of seats) {
    if (room.memberIds.length >= seats.length) break;
    if (!room.info.seats[seat].player) {
      const result = addBot(code, playerId, seat);
      if (!result.success) return result;
    }
  }
  return { success: true };
}

export function changeSeat(code: RoomCode, player: PlayerInfo, target: Seat): Result {
  const room = rooms.get(code);
  if (!room || !room.memberIds.includes(player.id)) return { success: false, reason: 'Not in room' };
  if (room.info.status === 'playing') return { success: false, reason: 'Cannot change seat during game' };
  const occupant = room.info.seats[target].player;
  if (occupant && occupant.id !== player.id) return { success: false, reason: 'Seat is occupied' };
  const previous = getPlayerSeat(code, player.id);
  if (previous === target) return { success: true };
  const next = { ...room.info.seats };
  if (previous) next[previous] = { player: null, isReady: false };
  next[target] = { player, isReady: false };
  room.info = { ...room.info, seats: next };
  return { success: true };
}

export function setReady(code: RoomCode, playerId: string, ready: boolean): Result {
  const room = rooms.get(code);
  const seat = getPlayerSeat(code, playerId);
  if (!room || !seat) return { success: false, reason: 'Not seated' };
  if (room.info.status === 'playing') return { success: false, reason: 'Game is in progress' };
  room.info = { ...room.info, seats: {
    ...room.info.seats, [seat]: { ...room.info.seats[seat], isReady: ready },
  } };
  return { success: true };
}

export function isAllReady(code: RoomCode): boolean {
  const room = rooms.get(code);
  return Boolean(room && seats.every((seat) => room.info.seats[seat].player && room.info.seats[seat].isReady));
}

export function getPlayerSeat(code: RoomCode, playerId: string): Seat | null {
  const room = rooms.get(code);
  return room ? seats.find((seat) => room.info.seats[seat].player?.id === playerId) ?? null : null;
}

export function getSeatPlayers(code: RoomCode): Record<Seat, PlayerInfo> | null {
  const room = rooms.get(code);
  if (!room || seats.some((seat) => !room.info.seats[seat].player)) return null;
  return {
    N: room.info.seats.N.player!, E: room.info.seats.E.player!,
    S: room.info.seats.S.player!, W: room.info.seats.W.player!,
  };
}

/** Any status change ends an abort vote; the cooldown stays. */
export function setRoomStatus(code: RoomCode, status: RoomStatus): void {
  const room = rooms.get(code);
  if (room) room.info = { ...room.info, status, abortVote: null };
}

export function setGameType(code: RoomCode, playerId: string, gameType: GameType): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.hostId !== playerId) return { success: false, reason: 'Only the host can change the game.' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Game is in progress' };
  room.info = { ...room.info, gameType };
  resetAllReady(code);
  return { success: true };
}

export type AbortVoteOutcome = 'pending' | 'passed' | 'failed';

function humanVoterIds(code: RoomCode): string[] {
  const room = rooms.get(code);
  return room ? seats.flatMap((seat) => {
    const player = room.info.seats[seat].player;
    return player && !player.isBot ? [player.id] : [];
  }) : [];
}

export function startAbortVote(
  code: RoomCode, playerId: string, now: number,
): { success: true; outcome: AbortVoteOutcome } | { success: false; reason: string } {
  const room = rooms.get(code);
  if (!room || room.info.status !== 'playing') return { success: false, reason: 'No game in progress.' };
  const voters = humanVoterIds(code);
  if (!voters.includes(playerId)) return { success: false, reason: 'Only seated players can vote.' };
  if (room.info.abortVote) return { success: false, reason: 'A vote is already in progress.' };
  if (room.info.abortVoteCooldownUntil !== null && now < room.info.abortVoteCooldownUntil) {
    return { success: false, reason: 'Please wait before starting another vote.' };
  }
  const outcome = voters.length === 1 ? 'passed' : 'pending';
  room.info = {
    ...room.info,
    abortVote: outcome === 'passed' ? null : {
      startedBy: playerId, startedAt: now, expiresAt: now + ABORT_VOTE_DURATION_MS, yes: [playerId], no: [],
    },
    abortVoteCooldownUntil: outcome === 'passed' ? null : now + ABORT_VOTE_COOLDOWN_MS,
  };
  return { success: true, outcome };
}

/** Records one vote; a decided vote is cleared here, the caller ends the game on `passed`. */
export function castAbortVote(
  code: RoomCode, playerId: string, agree: boolean, now: number,
): { success: true; outcome: AbortVoteOutcome } | { success: false; reason: string } {
  const room = rooms.get(code);
  const vote = room?.info.abortVote;
  if (!room || !vote || now >= vote.expiresAt) return { success: false, reason: 'No vote in progress.' };
  const voters = humanVoterIds(code);
  if (!voters.includes(playerId)) return { success: false, reason: 'Only seated players can vote.' };
  if (vote.yes.includes(playerId) || vote.no.includes(playerId)) {
    return { success: false, reason: 'You have already voted.' };
  }
  const next = agree
    ? { ...vote, yes: [...vote.yes, playerId] } : { ...vote, no: [...vote.no, playerId] };
  const threshold = Math.min(ABORT_VOTE_THRESHOLD, voters.length);
  const outcome: AbortVoteOutcome = next.yes.length >= threshold ? 'passed'
    : next.no.length > voters.length - threshold ? 'failed' : 'pending';
  room.info = {
    ...room.info,
    abortVote: outcome === 'pending' ? next : null,
    abortVoteCooldownUntil: outcome === 'passed' ? null : room.info.abortVoteCooldownUntil,
  };
  return { success: true, outcome };
}

/** Clears votes past their deadline; returns each affected room and who started the vote. */
export function expireAbortVotes(now: number): { code: RoomCode; startedBy: string }[] {
  const expired: { code: RoomCode; startedBy: string }[] = [];
  for (const room of rooms.values()) {
    const vote = room.info.abortVote;
    if (!vote || now < vote.expiresAt) continue;
    expired.push({ code: room.info.code, startedBy: vote.startedBy });
    room.info = { ...room.info, abortVote: null };
  }
  return expired;
}

export function hasExpiredAbortVote(now: number): boolean {
  return [...rooms.values()].some((room) => room.info.abortVote && now >= room.info.abortVote.expiresAt);
}

export function resetAllReady(code: RoomCode): void {
  const room = rooms.get(code);
  if (!room) return;
  const next = { ...room.info.seats };
  for (const seat of seats) next[seat] = { ...next[seat], isReady: next[seat].player?.isBot === true };
  room.info = { ...room.info, seats: next };
}

export function updateRoomPlayer(player: PlayerInfo, roomCode: RoomCode | null): void {
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  const seat = getPlayerSeat(roomCode, player.id);
  if (!room || !seat || isDeepStrictEqual(room.info.seats[seat].player, player)) return;
  room.info = { ...room.info, seats: {
    ...room.info.seats, [seat]: { ...room.info.seats[seat], player },
  } };
}

export function exportRooms(): PersistedRoom[] {
  return [...rooms.values()];
}

export function restoreRooms(records: PersistedRoom[]): void {
  rooms.clear();
  for (const room of records) rooms.set(room.info.code, room);
}
