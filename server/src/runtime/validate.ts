import { isBotDifficulty } from '@shared/bot-difficulty';
import {
  isAvatarBorderId, MAX_MESSAGE_EMOJIS, isEmojiName, isMediaId, isProvidedEmojiFile, ABORT_VOTE_THRESHOLD,
  MAX_ROOM_MEMBERS, MAX_ROOM_SEATS, isShopStickerId, MAX_SPECTATORS,
} from '@shared/constants';
import { isEquipmentStyle } from '../database/shop-equipment';
import { object, text, number, gameSeats, seats, oneOf } from './validation-helpers';
import type { ObjectValue } from './validation-helpers';
import { isTimeControl } from '@shared/time-control';
import { isGameType, gameDefinition } from '@shared/games/registry';
import type { AnyGameState, GameSeat } from '@shared/types';
import { getTurnSeat } from '../managers/game-clock';
import { gameAdapter } from '../managers/games/registry';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { isReplayRecording } from '../database/match-replay';
import { normalizeFlexibleGame } from '@shared/game-seat-compat';
import { gameValidator } from '../managers/games/validation-registry';
import { maxPlayers, roomSeatInfo } from '@shared/rules/seats';
import { isGameOptions } from '@shared/games/room-options';
import { isRoomReplaySession } from '@shared/replay-session';
import type { RuntimeSnapshot } from './types';

export { isBigTwoResult } from '../managers/games/bigtwo-validation';
export { isRedPointsResult } from '../managers/games/redpoints-validation';
export { isNinetyNineResult } from '../managers/games/ninetynine-validation';
export { isSevensResult } from '../managers/games/sevens-validation';
export { isChinesePokerResult } from '../managers/games/chinesepoker-validation';
export { isLiarsDeckResult } from '../managers/games/liarsdeck-validation';
export { isBlackjackResult } from '../managers/games/blackjack-validation';
export { isHoldemResult } from '../managers/games/holdem-validation';
export { isStudResult } from '../managers/games/stud-validation';
export { isNapoleonResult } from '../managers/games/napoleon-validation';
export { isTenHalfResult } from '../managers/games/tenhalf-validation';
export { isLiarsDiceResult } from '../managers/games/liarsdice-validation';
export { isCrazyEightsResult } from '../managers/games/crazyeights-validation';
export { isReversiResult } from '../managers/games/reversi-validation';
export { isGomokuResult } from '../managers/games/gomoku-validation';
export { isOldMaidResult } from '../managers/games/oldmaid-validation';
export { isGoFishResult } from '../managers/games/gofish-validation';
export { isDouDizhuResult } from '../managers/games/doudizhu-validation';
export { isJungleResult } from '../managers/games/jungle-validation';
export { isXiangqiResult } from '../managers/games/xiangqi-validation';
export { isBanqiResult } from '../managers/games/banqi-validation';
export { isChineseCheckersResult } from '../managers/games/chinesecheckers-validation';

function player(value: unknown): boolean {
  return (
    object(value) &&
    text(value.id) &&
    (value.isBot === undefined || typeof value.isBot === 'boolean') &&
    (value.botDifficulty === undefined || (value.isBot === true && isBotDifficulty(value.botDifficulty))) &&
    (value.isBot === true
      ? /^bot:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
      : !value.id.startsWith('bot:')) &&
    text(value.username) &&
    text(value.nickname) &&
    typeof value.color === 'string' &&
    /^#[a-fA-F0-9]{6}$/.test(value.color) &&
    oneOf(value.avatar, ['cat', 'fox', 'owl', 'bear', 'rabbit', 'panda', 'bot']) &&
    (value.avatarImage === null || isMediaId(value.avatarImage)) &&
    (value.avatarBorder === undefined || value.avatarBorder === null || isAvatarBorderId(value.avatarBorder)) &&
    (value.nameplate === undefined || value.nameplate === null || isEquipmentStyle('nameplate', value.nameplate)) &&
    (value.seatBackgroundStyle === undefined || value.seatBackgroundStyle === null || isEquipmentStyle('seatBackgroundStyle', value.seatBackgroundStyle)) &&
    (['seatFrame', 'victoryEffect', 'chatFrame'] as const).every((slot) =>
      value[slot] === undefined || value[slot] === null || isEquipmentStyle(slot, value[slot])) &&
    (value.seatBackground === undefined || value.seatBackground === null || isMediaId(value.seatBackground))
  );
}

function messageEmojis(value: unknown): boolean {
  if (!object(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_MESSAGE_EMOJIS &&
    entries.every(([name, mediaId]) => isEmojiName(name) && isMediaId(mediaId));
}

function providedMessageEmojis(value: unknown): boolean {
  if (!object(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_MESSAGE_EMOJIS &&
    entries.every(([name, file]) => isEmojiName(name) && isProvidedEmojiFile(file));
}

/** Personal and provided inline emoji share the per-message cap and never overlap. */
function inlineEmojiTotal(message: ObjectValue): boolean {
  const personal = object(message.emojis) ? Object.keys(message.emojis) : [];
  const provided = object(message.providedEmojis) ? Object.keys(message.providedEmojis) : [];
  return personal.length + provided.length <= MAX_MESSAGE_EMOJIS &&
    !provided.some((name) => personal.includes(name));
}

/** A sticker message carries exactly one image and no text, inline emoji, or system flag. */
function stickerOnly(message: ObjectValue, field: 'sticker' | 'providedSticker' | 'shopSticker'): boolean {
  return message.content === '' && message.system === undefined &&
    message.emojis === undefined && message.providedEmojis === undefined &&
    ['sticker', 'providedSticker', 'shopSticker'].every((key) => key === field || message[key] === undefined);
}

function presentation(value: ObjectValue): boolean {
  if (value.presentation === undefined) return true;
  const metadata = value.presentation;
  return object(metadata) && text(metadata.id) && metadata.id.length <= 128 &&
    (metadata.timingVersion === undefined || metadata.timingVersion === 2 || metadata.timingVersion === 3) &&
    number(metadata.startedAt) && metadata.serverNow === undefined &&
    Array.isArray(value.log) && typeof metadata.logStart === 'number' &&
    Number.isInteger(metadata.logStart) && metadata.logStart >= 0 &&
    metadata.logStart <= value.log.length;
}

function gameClock(value: ObjectValue): boolean {
  if (value.clock === undefined) return true;
  const clock = value.clock;
  if (!object(clock) || !isTimeControl(clock.settings) || clock.serverNow !== undefined
    || !object(clock.bankRemainingMs) || !object(value.players)) return false;
  const banks = clock.bankRemainingMs;
  const bankLimit = clock.settings.bankSeconds * 1000;
  const allowedSeats = isGameType(value.gameType) && gameDefinition(value.gameType).seats.expandable ? gameSeats : seats;
  const required = new Set([...seats, ...Object.keys(value.players)]);
  if (![...required].every((seat) => number(banks[seat]) && banks[seat] <= bankLimit)
    || !Object.entries(banks).every(([seat, bank]) => (allowedSeats as readonly string[]).includes(seat)
      && number(bank) && bank <= bankLimit)) return false;
  if (clock.lastTimeout !== undefined && (!object(clock.lastTimeout)
    || !oneOf(clock.lastTimeout.seat, Object.keys(value.players)) || !number(clock.lastTimeout.at))) return false;
  const state = value as unknown as AnyGameState;
  const expectedSeat = getTurnSeat(state);
  if (!expectedSeat) return clock.turn === null;
  // Legacy forced passes were saved without a public turn.
  if (gameAdapter(state.gameType).forcedActionPending?.(state) && clock.turn === null) return true;
  const turn = clock.turn;
  return object(turn) && text(turn.id) && turn.id.length <= 128 && turn.seat === expectedSeat
    && number(turn.startsAt) && turn.startsAt >= getPresentationEndsAt(state)
    && number(turn.baseRemainingMs) && turn.baseRemainingMs <= clock.settings.baseSeconds * 1000
    && number(turn.deadline)
    && turn.deadline === turn.startsAt + turn.baseRemainingMs + (clock.bankRemainingMs as Record<string, number>)[expectedSeat];
}

function returnedSeats(value: ObjectValue): boolean {
  if (value.returnedSeats === undefined) return true;
  const returned = value.returnedSeats;
  return value.result !== null && Array.isArray(returned) && returned.length < 8
    && returned.every((seat: unknown) => oneOf(seat, gameSeats)) && new Set(returned).size === returned.length;
}

function returnedViewers(value: ObjectValue): boolean {
  if (value.returnedViewers === undefined) return true;
  const returned = value.returnedViewers;
  return value.result !== null && Array.isArray(returned) && returned.every(text)
    && new Set(returned).size === returned.length;
}

function autoPlaySeats(value: ObjectValue): boolean {
  if (value.autoPlaySeats === undefined) return true;
  const players = value.players;
  return object(players) && Array.isArray(value.autoPlaySeats)
    && new Set(value.autoPlaySeats).size === value.autoPlaySeats.length
    && value.autoPlaySeats.every((seat: unknown) => typeof seat === 'string' && gameSeats.includes(seat as GameSeat)
      && object(players[seat]) && players[seat].isBot !== true);
}

function earlyLeaveSeats(value: ObjectValue): boolean {
  if (value.earlyLeaveSeats === undefined) return true;
  const automatic = value.autoPlaySeats;
  return Array.isArray(value.earlyLeaveSeats) && new Set(value.earlyLeaveSeats).size === value.earlyLeaveSeats.length
    && value.earlyLeaveSeats.every((seat: unknown) => Array.isArray(automatic) && automatic.includes(seat));
}

function replayRecording(game: AnyGameState, applySteps: boolean): boolean {
  if (game.replayRecording === undefined) return true;
  return isReplayRecording(game.replayRecording, game.gameType, applySteps);
}

function game(value: unknown, applyReplaySteps: boolean): boolean {
  if (object(value) && typeof value.gameType === 'string') value = normalizeFlexibleGame({ ...value, gameType: value.gameType });
  return object(value) && isGameType(value.gameType) &&
    gameValidator(value.gameType).shape(value, player) && presentation(value) && gameClock(value)
    && returnedSeats(value) && returnedViewers(value) && autoPlaySeats(value) && earlyLeaveSeats(value)
    && replayRecording(value as unknown as AnyGameState, applyReplaySteps);
}

function abortVote(value: unknown, members: string[]): boolean {
  if (
    !object(value) ||
    !oneOf(value.startedBy, members) ||
    !number(value.startedAt) ||
    !number(value.expiresAt) ||
    value.expiresAt <= value.startedAt ||
    !Array.isArray(value.yes) ||
    !Array.isArray(value.no)
  )
    return false;
  const voters = [...value.yes, ...value.no] as unknown[];
  return (
    value.yes.includes(value.startedBy) &&
    voters.every((id) => oneOf(id, members)) &&
    new Set(voters).size === voters.length &&
    value.yes.length < Math.min(ABORT_VOTE_THRESHOLD, members.length) &&
    value.no.length <= members.length - Math.min(ABORT_VOTE_THRESHOLD, members.length)
  );
}

function room(value: unknown): boolean {
  if (
    !object(value) ||
    !object(value.info) ||
    !Array.isArray(value.memberIds) ||
    !value.memberIds.every(text) ||
    value.memberIds.length < 1 ||
    value.memberIds.length > MAX_ROOM_MEMBERS ||
    new Set(value.memberIds).size !== value.memberIds.length
  )
    return false;
  const info = value.info;
  const members = value.memberIds as string[];
  const humans = members.filter((id) => !id.startsWith('bot:'));
  if (info.additionalSeats !== undefined && (!Array.isArray(info.additionalSeats)
    || info.additionalSeats.length > MAX_ROOM_SEATS - 4
    || (isGameType(info.gameType) && info.additionalSeats.length > maxPlayers(info.gameType) - 4)
    || (info.additionalSeats.length > 0 && !(isGameType(info.gameType) && gameDefinition(info.gameType).seats.expandable))
    || !info.additionalSeats.every((entry: unknown) => object(entry) && typeof entry.isReady === 'boolean'
      && ((entry.player === null && !entry.isReady) || (player(entry.player) && object(entry.player)
        && (entry.player.isBot !== true || entry.isReady) && members.includes(String(entry.player.id))))))) return false;
  // Only seated humans vote; spectators are members without a seat.
  const voters = object(info.seats) ? [...Object.values(info.seats),
    ...Array.isArray(info.additionalSeats) ? info.additionalSeats : []].flatMap((entry: unknown) => {
    const occupant = object(entry) && object(entry.player) ? entry.player : null;
    return occupant && occupant.isBot !== true && text(occupant.id) ? [occupant.id] : [];
  }) : [];
  return (
    text(info.code) &&
    (info.shuffleSeats === undefined || typeof info.shuffleSeats === 'boolean') &&
    (info.timeControl === undefined || isTimeControl(info.timeControl)) &&
    (info.gameOptions === undefined || isGameOptions(info.gameOptions)) &&
    ['sevensOptions', 'ninetyNineOptions', 'blackjackOptions', 'napoleonOptions'].every((key) => !(key in info)) &&
    isGameType(info.gameType) &&
    oneOf(info.status, ['waiting', 'playing', 'replaying']) &&
    (info.status === 'replaying' ? isRoomReplaySession(info.replay) : info.replay === undefined) &&
    number(info.createdAt) &&
    oneOf(info.hostId, humans) &&
    (info.abortVoteCooldownUntil === null || number(info.abortVoteCooldownUntil)) &&
    (info.abortVote === null || (info.status === 'playing' && abortVote(info.abortVote, voters))) &&
    object(info.seats) &&
    Object.keys(info.seats).length === 4 &&
    seats.every((seat) => {
      const entry = (info.seats as ObjectValue)[seat];
      return (
        object(entry) &&
        typeof entry.isReady === 'boolean' &&
        ((entry.player === null && !entry.isReady) ||
          (player(entry.player) &&
            ((entry.player as ObjectValue).isBot !== true || entry.isReady) &&
            (value.memberIds as unknown[]).includes((entry.player as ObjectValue).id)))
      );
    })
  );
}

function coherentGame(state: AnyGameState): boolean {
  return gameValidator(state.gameType).coherent(state);
}

export interface RuntimeValidationOptions {
  /** False checks recording structure only; every load and restore applies each step. */
  readonly applyReplaySteps?: boolean;
  /**
   * True for a game already validated in identical form, such as an unchanged stored row: its own
   * checks are skipped, while checks against players and rooms still run.
   */
  readonly validatedGame?: (game: unknown) => boolean;
}

export function isRuntimeSnapshot(value: unknown, options: RuntimeValidationOptions = {}): value is RuntimeSnapshot {
  const applyReplaySteps = options.applyReplaySteps ?? true;
  if (
    !object(value) ||
    !Array.isArray(value.players) ||
    !Array.isArray(value.rooms) ||
    !Array.isArray(value.games) ||
    !Array.isArray(value.chat)
  )
    return false;
  if (
    !value.players.every(
      (entry: unknown) =>
        object(entry) &&
        player(entry.info) &&
        (entry.info as ObjectValue).isBot !== true &&
        (entry.currentRoomCode === null || text(entry.currentRoomCode)) &&
        (entry.disconnectedAt === null || number(entry.disconnectedAt)) &&
        (entry.lastSeenAt === undefined || entry.lastSeenAt === null
          || (Number.isSafeInteger(entry.lastSeenAt) && (entry.lastSeenAt as number) >= 0)),
    ) ||
    !value.rooms.every(room) ||
    !value.games.every((entry: unknown) => options.validatedGame?.(entry) || game(entry, applyReplaySteps)) ||
    !value.chat.every(
      (entry: unknown) =>
        object(entry) &&
        text(entry.roomCode) &&
        Array.isArray(entry.messages) &&
        entry.messages.every(
          (message: unknown) =>
            object(message) &&
            text(message.id) &&
            player(message.sender) &&
            typeof message.content === 'string' &&
            number(message.timestamp) &&
            (message.shopSticker === undefined || (
              isShopStickerId(message.shopSticker) && stickerOnly(message, 'shopSticker') &&
              Object.keys(message).every((key) => ['id', 'sender', 'content', 'timestamp', 'shopSticker', 'audience'].includes(key))
            )) &&
            (message.sticker === undefined || (
              object(message.sticker) && text(message.sticker.id) &&
              isEmojiName(message.sticker.name) && isMediaId(message.sticker.mediaId) &&
              Object.keys(message.sticker).every((key) => ['id', 'name', 'mediaId'].includes(key)) &&
              stickerOnly(message, 'sticker')
            )) &&
            (message.providedSticker === undefined || (
              object(message.providedSticker) && isEmojiName(message.providedSticker.name) &&
              isProvidedEmojiFile(message.providedSticker.file) &&
              Object.keys(message.providedSticker).every((key) => ['name', 'file'].includes(key)) &&
              stickerOnly(message, 'providedSticker')
            )) &&
            (message.emojis === undefined || messageEmojis(message.emojis)) &&
            (message.providedEmojis === undefined || providedMessageEmojis(message.providedEmojis)) &&
            inlineEmojiTotal(message) &&
            (message.system === undefined || message.system === true) &&
            (message.audience === undefined || message.audience === 'observers'),
        ),
    )
  )
    return false;
  const snapshot = value as unknown as RuntimeSnapshot;
  const players = new Map(snapshot.players.map((entry) => [entry.info.id, entry]));
  const rooms = new Map(snapshot.rooms.map((entry) => [entry.info.code, entry]));
  const games = new Map(snapshot.games.map((entry) => [entry.roomCode, entry]));
  if (
    players.size !== snapshot.players.length ||
    rooms.size !== snapshot.rooms.length ||
    games.size !== snapshot.games.length ||
    new Set(snapshot.games.map((entry) => entry.id)).size !== snapshot.games.length ||
    new Set(snapshot.chat.map((entry) => entry.roomCode)).size !== snapshot.chat.length
  )
    return false;
  const memberships = new Map<string, string>();
  for (const entry of snapshot.rooms) {
    const occupants = [...seats.flatMap((seat) => entry.info.seats[seat].player?.id ?? []),
      ...(entry.info.additionalSeats ?? []).flatMap((seat) => seat.player?.id ?? [])];
    if (new Set(occupants).size !== occupants.length) return false;
    if (entry.memberIds.filter((id) => !occupants.includes(id)).length > MAX_SPECTATORS) return false;
    const vote = entry.info.abortVote;
    if (vote && ![...vote.yes, ...vote.no].every((id) => occupants.includes(id))) return false;
    for (const id of entry.memberIds) {
      const bot = [...seats.map((seat) => entry.info.seats[seat].player),
        ...(entry.info.additionalSeats ?? []).map((seat) => seat.player)].find((player) => player?.id === id && player.isBot);
      if (bot) {
        if (players.has(id) || memberships.has(id)) return false;
        memberships.set(id, entry.info.code);
        continue;
      }
      if (
        !players.has(id) ||
        memberships.has(id) ||
        players.get(id)?.currentRoomCode !== entry.info.code
      )
        return false;
      memberships.set(id, entry.info.code);
    }
    if (
      entry.info.status === 'playing' &&
      (!games.has(entry.info.code) || games.get(entry.info.code)?.phase === 'scoring')
    )
      return false;
  }
  if (
    !snapshot.players.every(
      (entry) => (memberships.get(entry.info.id) ?? null) === entry.currentRoomCode,
    )
  )
    return false;
  for (const entry of snapshot.games) {
    const currentRoom = rooms.get(entry.roomCode);
    if (!currentRoom || !(options.validatedGame?.(entry) || coherentGame(normalizeFlexibleGame(entry)))) return false;
    if (entry.phase === 'scoring') {
      // The completed board is historical: seats and members may have changed already.
      if (currentRoom.info.status !== 'waiting') return false;
    } else if (
      currentRoom.info.status !== 'playing' ||
      currentRoom.info.gameType !== entry.gameType ||
      !gameSeats.every((seat) => roomSeatInfo(currentRoom.info, seat)?.player?.id === (entry.players as Partial<Record<GameSeat, { id: string }>>)[seat]?.id
        && (roomSeatInfo(currentRoom.info, seat)?.player?.isBot === true) === ((entry.players as Partial<Record<GameSeat, { isBot?: boolean }>>)[seat]?.isBot === true)
        && (roomSeatInfo(currentRoom.info, seat)?.player?.botDifficulty ?? 'hard')
          === ((entry.players as Partial<Record<GameSeat, { botDifficulty?: string }>>)[seat]?.botDifficulty ?? 'hard'))
    )
      return false;
  }
  return snapshot.chat.every((entry) => rooms.has(entry.roomCode));
}
