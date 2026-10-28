import { defaultGameOptions, isGameOptionsPayload, restoredGameOptions } from '@shared/games/room-options';
import { DEFAULT_TIME_CONTROL, followDefaultTimeControl, isTimeControl } from '@shared/time-control';
import { isBotDifficulty } from '@shared/bot-difficulty';
import { isRoomReplayPlayback } from '@shared/replay-session';
import { isDeepStrictEqual } from 'node:util';
import { randomInt, randomUUID } from 'node:crypto';
import type {
  BotDifficulty, GameOptionsByType, GameOptionsPayload, GameType, PlayerInfo, RoomCode, RoomInfo,
  RoomReplaySession, RoomSeatTarget, RoomStatus, Seat, SeatInfo, SeatMap, TimeControl,
} from '@shared/types';
import {
  ABORT_VOTE_COOLDOWN_MS, ABORT_VOTE_DURATION_MS, ABORT_VOTE_THRESHOLD, MAX_ROOM_MEMBERS, MAX_SPECTATORS,
} from '@shared/constants';
import type { PersistedRoom } from '../runtime/types';
import { generateRoomCode } from '../utils/id-generator';
import { botNickname, isCompassSeat, maxPlayers, roomPlayers, roomCanStart, roomSeatInfo } from '@shared/rules/seats';
import { gameDefinition, gameTimeControl } from '@shared/games/registry';
import type { GameSeat } from '@shared/types';

const rooms = new Map<RoomCode, PersistedRoom>();
const seats: Seat[] = ['N', 'E', 'S', 'W'];
type Result = { success: true } | { success: false; reason: string };

/** Configured seats in order: the four standard seats, then P5 onwards for each additional seat. */
function roomSeats(info: RoomInfo): GameSeat[] {
  return [...seats, ...(info.additionalSeats ?? []).map((_, index) => `P${index + 5}` as GameSeat)];
}

function withSeat(info: RoomInfo, seat: GameSeat, entry: SeatInfo): RoomInfo {
  if (isCompassSeat(seat)) return { ...info, seats: { ...info.seats, [seat]: entry } };
  const index = Number(seat.slice(1)) - 5;
  return { ...info, additionalSeats: (info.additionalSeats ?? []).map((current, position) => position === index ? entry : current) };
}

/** Renames every bot after the seat it now sits in, so moves and game changes keep its name accurate. */
function withBotNames(info: RoomInfo): RoomInfo {
  const rename = (entry: SeatInfo, seat: GameSeat): SeatInfo => entry.player?.isBot
    ? { ...entry, player: { ...entry.player, nickname: botNickname(info.gameType, seat) } } : entry;
  const named = Object.fromEntries(seats.map((seat) => [seat, rename(info.seats[seat], seat)])) as SeatMap;
  return { ...info, seats: named, ...(info.additionalSeats
    ? { additionalSeats: info.additionalSeats.map((entry, index) => rename(entry, roomSeats(info)[index + 4])) } : {}) };
}

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
      timeControl: { ...gameTimeControl(gameType) }, hostId: creatorId, abortVote: null, abortVoteCooldownUntil: null,
      gameOptions: defaultGameOptions(),
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

/** Members without a seat, in join order; bots always hold a seat. */
export function getSpectatorIds(code: RoomCode): string[] {
  const room = rooms.get(code);
  return room ? room.memberIds.filter((id) => !seats.some((seat) => room.info.seats[seat].player?.id === id)
    && !(room.info.additionalSeats ?? []).some((seat) => seat.player?.id === id)) : [];
}

/** New members spectate until they take a seat, so capacity is the spectator limit. */
export function hasSpectatorRoom(code: RoomCode): boolean {
  return getSpectatorIds(code).length < MAX_SPECTATORS && getRoomMemberIds(code).length < MAX_ROOM_MEMBERS;
}

/** Joining is allowed during a match: the newcomer watches it as a spectator. */
export function joinRoom(code: RoomCode, playerId: string): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.memberIds.includes(playerId)) return { success: true };
  if (!hasSpectatorRoom(code)) return { success: false, reason: 'Room is full' };
  room.memberIds.push(playerId);
  return { success: true };
}

export function leaveRoom(code: RoomCode, playerId: string): { seat: Seat | null; roomEmpty: boolean } {
  const room = rooms.get(code);
  if (!room) return { seat: null, roomEmpty: true };
  const seat = getPlayerSeat(code, playerId);
  if (seat) {
    room.info = { ...room.info, seats: { ...room.info.seats, [seat]: { player: null, isReady: false } } };
    tableChanged(room);
  }
  clearAdditionalSeat(room, playerId);
  room.memberIds = room.memberIds.filter((id) => id !== playerId);
  const humans = room.memberIds.filter((id) => !Object.values(roomPlayers(room.info))
    .some((player) => player.id === id && player.isBot));
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

/** A match needs a seated human to vote, reconnect, and own its history. */
function hasSeatedHuman(room: PersistedRoom): boolean {
  return Object.values(roomPlayers(room.info)).some((player) => !player.isBot);
}

function emptySeatCount(room: PersistedRoom): number {
  return roomSeats(room.info).filter((seat) => !roomSeatInfo(room.info, seat)?.player).length;
}

/**
 * A flexible-seat roster change asks humans to confirm the new table before the host starts it,
 * including members leaving during a shared replay.
 */
function tableChanged(room: PersistedRoom): void {
  if (room.info.status !== 'playing' && gameDefinition(room.info.gameType).seats.flexible) resetAllReady(room.info.code);
}

export function addBot(code: RoomCode, playerId: string, seat: GameSeat, difficulty: BotDifficulty = 'hard'): Result {
  const allowed = requireBotManagement(code, playerId);
  if (!allowed.success) return allowed;
  if (!isBotDifficulty(difficulty)) return { success: false, reason: 'Invalid bot difficulty.' };
  const room = rooms.get(code)!;
  const entry = roomSeatInfo(room.info, seat);
  if (!entry) return { success: false, reason: 'Invalid seat.' };
  if (entry.player) return { success: false, reason: 'Seat is occupied' };
  if (!hasSeatedHuman(room) && emptySeatCount(room) === 1) {
    return { success: false, reason: 'Leave a seat for a player.' };
  }
  const bot: PlayerInfo = {
    id: `bot:${randomUUID()}`, username: `bot-${seat.toLowerCase()}`, nickname: botNickname(room.info.gameType, seat),
    color: '#64748b', avatar: 'bot', avatarImage: null, isBot: true, botDifficulty: difficulty,
  };
  room.memberIds.push(bot.id);
  room.info = withSeat(room.info, seat, { player: bot, isReady: true });
  tableChanged(room);
  return { success: true };
}

export function setBotDifficulty(code: RoomCode, playerId: string, seat: GameSeat, difficulty: BotDifficulty): Result {
  const allowed = requireBotManagement(code, playerId);
  if (!allowed.success) return allowed;
  if (!isBotDifficulty(difficulty)) return { success: false, reason: 'Invalid bot difficulty.' };
  const room = rooms.get(code)!;
  const bot = roomSeatInfo(room.info, seat)?.player;
  if (!bot?.isBot) return { success: false, reason: 'No bot in this seat.' };
  if ((bot.botDifficulty ?? 'hard') === difficulty) return { success: true };
  room.info = withSeat(room.info, seat, { player: { ...bot, botDifficulty: difficulty }, isReady: true });
  resetAllReady(code);
  return { success: true };
}

export function removeBot(code: RoomCode, playerId: string, seat: GameSeat): Result {
  const allowed = requireBotManagement(code, playerId);
  if (!allowed.success) return allowed;
  const room = rooms.get(code)!;
  const bot = roomSeatInfo(room.info, seat)?.player;
  if (!bot?.isBot) return { success: false, reason: 'No bot in this seat.' };
  room.memberIds = room.memberIds.filter((id) => id !== bot.id);
  room.info = withSeat(room.info, seat, { player: null, isReady: false });
  tableChanged(room);
  return { success: true };
}

export function fillBots(code: RoomCode, playerId: string): Result {
  const allowed = requireBotManagement(code, playerId);
  if (!allowed.success) return allowed;
  const room = rooms.get(code)!;
  // Spectators do not reserve seats; every configured empty seat, additional ones included,
  // receives a bot, except the last one while no human is seated.
  for (const seat of roomSeats(room.info)) {
    if (!hasSeatedHuman(room) && emptySeatCount(room) === 1) break;
    if (!roomSeatInfo(room.info, seat)?.player) {
      const result = addBot(code, playerId, seat);
      if (!result.success) return result;
    }
  }
  return { success: true };
}

/**
 * Validates the host removing another human member; the caller performs the leave.
 * Spectators can be removed during a match because leaving does not affect it.
 */
export function canKick(code: RoomCode, hostId: string, targetId: string): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.hostId !== hostId) return { success: false, reason: 'Only the host can remove players.' };
  if (room.info.status !== 'waiting' && getGamePlayerSeat(code, targetId)) {
    return { success: false, reason: 'Cannot remove players during game.' };
  }
  if (targetId === hostId) return { success: false, reason: 'You cannot remove yourself.' };
  const isBot = Object.values(roomPlayers(room.info)).some((player) => player.id === targetId && player.isBot);
  if (!room.memberIds.includes(targetId) || isBot) return { success: false, reason: 'Player is not in this room.' };
  return { success: true };
}

export function changeSeat(code: RoomCode, player: PlayerInfo, target: Seat): Result {
  const room = rooms.get(code);
  if (!room || !room.memberIds.includes(player.id)) return { success: false, reason: 'Not in room' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Cannot change seat during game' };
  const occupant = room.info.seats[target].player;
  if (occupant && occupant.id !== player.id) return { success: false, reason: 'Seat is occupied' };
  const previous = getPlayerSeat(code, player.id);
  if (previous === target) return { success: true };
  clearAdditionalSeat(room, player.id);
  const next = { ...room.info.seats };
  if (previous) next[previous] = { player: null, isReady: false };
  next[target] = { player, isReady: false };
  room.info = { ...room.info, seats: next };
  tableChanged(room);
  return { success: true };
}

/** Host placement preserves membership; occupied destinations exchange their players. */
export function movePlayer(code: RoomCode, hostId: string, player: PlayerInfo, target: RoomSeatTarget): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.hostId !== hostId) return { success: false, reason: 'Only the host can manage seats.' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Cannot change seats during game.' };
  if (player.isBot || !room.memberIds.includes(player.id)) return { success: false, reason: 'Player is not in this room.' };
  const positions = [...seats.map((seat) => room.info.seats[seat]), ...(room.info.additionalSeats ?? [])];
  const previous = positions.findIndex((entry) => entry.player?.id === player.id);
  const destination = target.type === 'spectator' ? -1 : target.type === 'seat'
    ? seats.indexOf(target.seat) : Number.isInteger(target.index) && target.index >= 0 ? target.index + 4 : -1;
  if (target.type !== 'spectator' && (destination < 0 || destination >= positions.length)) {
    return { success: false, reason: 'Invalid seat.' };
  }
  if (previous === destination) return { success: true };
  if (destination === -1 && getSpectatorIds(code).length >= MAX_SPECTATORS) {
    return { success: false, reason: 'The spectator area is full.' };
  }
  const occupant = destination >= 0 ? positions[destination].player : null;
  // A bot can trade seats with a seated human but never becomes a spectator.
  if (occupant?.isBot && previous < 0) return { success: false, reason: 'Seat is occupied' };
  if (previous >= 0) positions[previous] = { player: occupant, isReady: occupant?.isBot === true };
  if (destination >= 0) positions[destination] = { player, isReady: false };
  const next = { ...room.info.seats };
  seats.forEach((seat, index) => { next[seat] = positions[index]; });
  room.info = withBotNames({ ...room.info, seats: next,
    ...(room.info.additionalSeats ? { additionalSeats: positions.slice(4) } : {}),
  });
  resetAllReady(code);
  return { success: true };
}

/** Leaves the current seat to spectate. */
export function standUp(code: RoomCode, playerId: string): Result {
  const room = rooms.get(code);
  const seat = getPlayerSeat(code, playerId);
  if (!room || (!seat && !(room.info.additionalSeats ?? []).some((entry) => entry.player?.id === playerId))) {
    return { success: false, reason: 'Not seated' };
  }
  if (room.info.status !== 'waiting') return { success: false, reason: 'Cannot change seat during game' };
  if (getSpectatorIds(code).length >= MAX_SPECTATORS) return { success: false, reason: 'The spectator area is full.' };
  if (seat) room.info = { ...room.info, seats: { ...room.info.seats, [seat]: { player: null, isReady: false } } };
  clearAdditionalSeat(room, playerId);
  tableChanged(room);
  return { success: true };
}

export function setReady(code: RoomCode, playerId: string, ready: boolean): Result {
  const room = rooms.get(code);
  const seat = getPlayerSeat(code, playerId);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Game is in progress' };
  if (!seat) {
    if (!room.info.additionalSeats?.some((entry) => entry.player?.id === playerId)) {
      return { success: false, reason: 'Not seated' };
    }
    room.info = { ...room.info, additionalSeats: room.info.additionalSeats.map((entry) =>
      entry.player?.id === playerId ? { ...entry, isReady: ready } : entry) };
    return { success: true };
  }
  room.info = { ...room.info, seats: {
    ...room.info.seats, [seat]: { ...room.info.seats[seat], isReady: ready },
  } };
  return { success: true };
}

/** Enough seats for the game are occupied and every occupied seat is ready. */
export function isAllReady(code: RoomCode): boolean {
  const room = rooms.get(code);
  return room ? roomCanStart(room.info) : false;
}

export function setShuffleSeats(code: RoomCode, playerId: string, enabled: boolean): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.hostId !== playerId) return { success: false, reason: 'Only the host can change seat shuffling.' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Game is in progress' };
  if ((room.info.shuffleSeats ?? false) === enabled) return { success: true };
  room.info = { ...room.info, shuffleSeats: enabled };
  resetAllReady(code);
  return { success: true };
}

/** Called by the start coordinator, after checking readiness. Preserve each player's ready state. */
export function shuffleReadySeats(code: RoomCode, random: (max: number) => number = randomInt): void {
  const room = rooms.get(code);
  if (!room?.info.shuffleSeats) return;
  const positions = [...seats.map((seat) => room.info.seats[seat]), ...room.info.additionalSeats ?? []];
  // Bots retain their standard seats; shuffle the humans across the remaining occupied seats.
  const occupied = positions.map((entry, index) => entry.player && !entry.player.isBot ? index : -1)
    .filter((index) => index >= 0);
  for (let index = occupied.length - 1; index > 0; index--) {
    const other = random(index + 1);
    [positions[occupied[index]], positions[occupied[other]]] = [positions[occupied[other]], positions[occupied[index]]];
  }
  const next = { ...room.info.seats };
  seats.forEach((seat, index) => { next[seat] = positions[index]; });
  room.info = { ...room.info, seats: next,
    ...(room.info.additionalSeats ? { additionalSeats: positions.slice(4) } : {}) };
}

function clearAdditionalSeat(room: PersistedRoom, playerId: string): void {
  if (!room.info.additionalSeats?.some((entry) => entry.player?.id === playerId)) return;
  room.info = { ...room.info, additionalSeats: room.info.additionalSeats.map((entry) =>
    entry.player?.id === playerId ? { player: null, isReady: false } : entry) };
  resetAllReady(room.info.code);
}

function requireSeatManagement(code: RoomCode, playerId: string): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.hostId !== playerId) return { success: false, reason: 'Only the host can manage seats.' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Cannot manage seats during game.' };
  if (!gameDefinition(room.info.gameType).seats.expandable) return { success: false, reason: 'This game uses four seats.' };
  return { success: true };
}

export function addSeat(code: RoomCode, playerId: string): Result {
  const allowed = requireSeatManagement(code, playerId);
  if (!allowed.success) return allowed;
  const room = rooms.get(code)!;
  const additional = room.info.additionalSeats ?? [];
  if (additional.length >= maxPlayers(room.info.gameType) - 4) return { success: false, reason: 'Seat limit reached.' };
  room.info = { ...room.info, additionalSeats: [...additional, { player: null, isReady: false }] };
  resetAllReady(code);
  return { success: true };
}

export function removeSeat(code: RoomCode, playerId: string): Result {
  const allowed = requireSeatManagement(code, playerId);
  if (!allowed.success) return allowed;
  const room = rooms.get(code)!;
  const additional = room.info.additionalSeats ?? [];
  if (additional.length === 0) return { success: false, reason: 'No additional seat to remove.' };
  if (additional[additional.length - 1].player) return { success: false, reason: 'Seat is occupied' };
  room.info = { ...room.info, additionalSeats: additional.slice(0, -1) };
  resetAllReady(code);
  return { success: true };
}

export function changeAdditionalSeat(code: RoomCode, player: PlayerInfo, index: number): Result {
  const room = rooms.get(code);
  if (!room || !room.memberIds.includes(player.id)) return { success: false, reason: 'Not in room' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Cannot change seat during game' };
  const target = room.info.additionalSeats?.[index];
  if (!Number.isInteger(index) || index < 0 || !target) return { success: false, reason: 'Invalid seat.' };
  if (target.player && target.player.id !== player.id) return { success: false, reason: 'Seat is occupied' };
  if (target.player?.id === player.id) return { success: true };
  const previous = getPlayerSeat(code, player.id);
  clearAdditionalSeat(room, player.id);
  room.info = { ...room.info,
    seats: previous ? { ...room.info.seats, [previous]: { player: null, isReady: false } } : room.info.seats,
    additionalSeats: room.info.additionalSeats!.map((entry, position) => position === index
      ? { player, isReady: false } : entry),
  };
  resetAllReady(code);
  return { success: true };
}

export function getPlayerSeat(code: RoomCode, playerId: string): Seat | null {
  const room = rooms.get(code);
  return room ? seats.find((seat) => room.info.seats[seat].player?.id === playerId) ?? null : null;
}

/** Players of the occupied seats; empty seats are left out. */
export function getGamePlayerSeat(code: RoomCode, playerId: string): GameSeat | null {
  const room = rooms.get(code);
  return room ? (Object.entries(roomPlayers(room.info)).find(([, player]) => player?.id === playerId)?.[0] as GameSeat | undefined) ?? null : null;
}

export function getSeatPlayers(code: RoomCode): Partial<Record<GameSeat, PlayerInfo>> | null {
  const room = rooms.get(code);
  if (!room) return null;
  return roomPlayers(room.info);
}

/** Any status change ends an abort vote and a replay session; the cooldown stays. */
export function setRoomStatus(code: RoomCode, status: Exclude<RoomStatus, 'replaying'>): void {
  const room = rooms.get(code);
  if (!room) return;
  const { replay: _replay, ...info } = room.info;
  room.info = { ...info, status, abortVote: null };
}

/** The archive facts a session needs; the caller has checked the host may view the match. */
export interface ReplaySource {
  readonly matchId: string;
  readonly subjectId: string;
  readonly gameType: GameType;
  readonly lastStep: number;
}

/** Locks the waiting room like a match and starts playback from the first step. */
export function startReplay(code: RoomCode, hostId: string, source: ReplaySource, now: number): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.hostId !== hostId) return { success: false, reason: 'Only the host can control the replay.' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Replays start from the waiting room.' };
  const replay: RoomReplaySession = {
    matchId: source.matchId, subjectId: source.subjectId, gameType: source.gameType, startedBy: hostId,
    lastStep: source.lastStep, anchorStep: 0, anchorAt: now, playing: true, speed: 1,
  };
  room.info = { ...room.info, status: 'replaying', abortVote: null, replay };
  return { success: true };
}

function requireReplayHost(room: PersistedRoom | undefined, hostId: string): Result {
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.status !== 'replaying' || !room.info.replay) return { success: false, reason: 'No replay in progress.' };
  if (room.info.hostId !== hostId) return { success: false, reason: 'Only the host can control the replay.' };
  return { success: true };
}

/** Re-anchors playback at `now`; `playback` is an untrusted payload checked against the session. */
export function controlReplay(code: RoomCode, hostId: string, playback: unknown, now: number): Result {
  const room = rooms.get(code);
  const allowed = requireReplayHost(room, hostId);
  if (!allowed.success) return allowed;
  const replay = room!.info.replay!;
  if (!isRoomReplayPlayback(playback, replay.lastStep)) return { success: false, reason: 'Invalid replay position.' };
  room!.info = { ...room!.info, replay: {
    ...replay, anchorStep: playback.step, anchorAt: now, playing: playback.playing, speed: playback.speed,
  } };
  return { success: true };
}

/** Returns every member to the waiting room. */
export function endReplay(code: RoomCode, hostId: string): Result {
  const allowed = requireReplayHost(rooms.get(code), hostId);
  if (!allowed.success) return allowed;
  setRoomStatus(code, 'waiting');
  return { success: true };
}

export function setGameType(code: RoomCode, playerId: string, gameType: GameType): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.hostId !== playerId) return { success: false, reason: 'Only the host can change the game.' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Game is in progress' };
  // Seats beyond the new game's player limit are removed together with their bots; humans must
  // vacate them first.
  const additionalLimit = gameDefinition(gameType).seats.expandable ? Math.max(0, maxPlayers(gameType) - 4) : 0;
  const removed = room.info.additionalSeats?.slice(additionalLimit) ?? [];
  if (removed.some((entry) => entry.player && !entry.player.isBot)) {
    return { success: false, reason: additionalLimit === 0
      ? 'Empty the additional seats before changing to a four-seat game.'
      : 'Empty the seats beyond this game\'s player limit first.' };
  }
  const removedBots = new Set(removed.flatMap((entry) => entry.player ? [entry.player.id] : []));
  room.memberIds = room.memberIds.filter((id) => !removedBots.has(id));
  room.info = withBotNames({ ...room.info, gameType,
    timeControl: followDefaultTimeControl(room.info.timeControl, gameTimeControl(room.info.gameType), gameTimeControl(gameType)),
    ...(room.info.additionalSeats ? { additionalSeats: room.info.additionalSeats.slice(0, additionalLimit) } : {}),
  });
  resetAllReady(code);
  return { success: true };
}

export function setTimeControl(code: RoomCode, playerId: string, timeControl: TimeControl): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.hostId !== playerId) return { success: false, reason: 'Only the host can change the timer.' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Game is in progress' };
  if (!isTimeControl(timeControl)) return { success: false, reason: 'Invalid time control.' };
  if (isDeepStrictEqual(room.info.timeControl, timeControl)) return { success: true };
  room.info = { ...room.info, timeControl: { ...timeControl } };
  resetAllReady(code);
  return { success: true };
}

export function setGameOptions(code: RoomCode, playerId: string, payload: GameOptionsPayload): Result {
  const room = rooms.get(code);
  if (!room) return { success: false, reason: 'Room not found' };
  if (room.info.hostId !== playerId) return { success: false, reason: 'Only the host can change the rules.' };
  if (room.info.status !== 'waiting') return { success: false, reason: 'Game is in progress' };
  if (!isGameOptionsPayload(payload)) return { success: false, reason: 'Invalid game options.' };
  if (room.info.gameType !== payload.gameType) return { success: false, reason: 'The room game has changed. Refresh your page.' };
  return applyGameOptions(room, code, payload.gameType, payload.options);
}

function applyGameOptions<K extends GameType>(
  room: PersistedRoom, code: RoomCode, gameType: K, options: GameOptionsByType[K],
): Result {
  const rules = gameDefinition(gameType).options;
  const previous = room.info.gameOptions?.[gameType] ?? rules?.legacyDefaults;
  if (isDeepStrictEqual(previous, options)) return { success: true };
  room.info = { ...room.info, gameOptions: { ...room.info.gameOptions, [gameType]: structuredClone(options) } };
  if (!previous || !rules?.resetsReady || rules.resetsReady(previous, options)) resetAllReady(code);
  return { success: true };
}

export type AbortVoteOutcome = 'pending' | 'passed' | 'failed';

function humanVoterIds(code: RoomCode): string[] {
  const room = rooms.get(code);
  return room ? Object.values(roomPlayers(room.info)).flatMap((player) => {
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
  room.info = { ...room.info, seats: next,
    ...(room.info.additionalSeats ? { additionalSeats: room.info.additionalSeats.map((entry) =>
      ({ ...entry, isReady: entry.player?.isBot === true })) } : {}) };
}

export function updateRoomPlayer(player: PlayerInfo, roomCode: RoomCode | null): void {
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  const seat = getPlayerSeat(roomCode, player.id);
  if (!room) return;
  if (!seat) {
    if (room.info.additionalSeats?.some((entry) => entry.player?.id === player.id && !isDeepStrictEqual(entry.player, player))) {
      room.info = { ...room.info, additionalSeats: room.info.additionalSeats.map((entry) =>
        entry.player?.id === player.id ? { ...entry, player } : entry) };
    }
    return;
  }
  if (isDeepStrictEqual(room.info.seats[seat].player, player)) return;
  room.info = { ...room.info, seats: {
    ...room.info.seats, [seat]: { ...room.info.seats[seat], player },
  } };
}

/**
 * Rooms none of whose human members is still in them; `isPresent` reports whether an account's
 * player state still points at the room.
 */
export function findAbandonedRooms(isPresent: (accountId: string, code: RoomCode) => boolean): RoomCode[] {
  return [...rooms].filter(([code, room]) => !room.memberIds.some((id) => !id.startsWith('bot:')
    && isPresent(id, code))).map(([code]) => code);
}

export function removeRoom(code: RoomCode): void {
  rooms.delete(code);
}

export function exportRooms(): PersistedRoom[] {
  return [...rooms.values()];
}

export function restoreRooms(records: PersistedRoom[]): void {
  rooms.clear();
  for (const room of records) rooms.set(room.info.code, {
    ...room, info: withBotNames({
      ...room.info, timeControl: room.info.timeControl ?? { ...DEFAULT_TIME_CONTROL },
      gameOptions: restoredGameOptions(room.info.gameOptions),
    }),
  });
}
