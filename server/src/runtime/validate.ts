import { isTimeControl } from '@shared/time-control';
import { getTurnSeat } from '../managers/game-clock';
import {
  ABORT_VOTE_THRESHOLD, GAME_TYPES, MAX_MESSAGE_EMOJIS, isEmojiName, isMediaId, isProvidedEmojiFile,
} from '@shared/constants';
import { isDeepStrictEqual } from 'node:util';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { bigTwoPenalty, identifyCombo, isDragon, legalPlays } from '@shared/rules/bigtwo';
import { RP_HAND_SIZE, RP_TABLE_SIZE, rpPairOptions, rpScore } from '@shared/rules/redpoints';
import { NN_HAND_SIZE, NN_MAX, nnHasPlayable } from '@shared/rules/ninetynine';
import type {
  AnyGameState, BigTwoGameState, BridgeGameState, Card, GameType, NinetyNineGameState, RedPointsGameState, Seat,
} from '@shared/types';
import type { RuntimeSnapshot } from './types';

type ObjectValue = Record<string, unknown>;
const seats: Seat[] = ['N', 'E', 'S', 'W'];
const suits = ['clubs', 'diamonds', 'hearts', 'spades'];

function object(value: unknown): value is ObjectValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function oneOf(value: unknown, choices: string[]): boolean {
  return typeof value === 'string' && choices.includes(value);
}

function player(value: unknown): boolean {
  return (
    object(value) &&
    text(value.id) &&
    (value.isBot === undefined || typeof value.isBot === 'boolean') &&
    (value.isBot === true
      ? /^bot:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
      : !value.id.startsWith('bot:')) &&
    text(value.username) &&
    text(value.nickname) &&
    typeof value.color === 'string' &&
    /^#[a-fA-F0-9]{6}$/.test(value.color) &&
    oneOf(value.avatar, ['cat', 'fox', 'owl', 'bear', 'rabbit', 'panda']) &&
    (value.avatarImage === null || isMediaId(value.avatarImage))
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
function stickerOnly(message: ObjectValue, field: 'sticker' | 'providedSticker'): boolean {
  return message.content === '' && message.system === undefined &&
    message.emojis === undefined && message.providedEmojis === undefined &&
    message[field === 'sticker' ? 'providedSticker' : 'sticker'] === undefined;
}

function card(value: unknown): boolean {
  return (
    object(value) &&
    oneOf(value.suit, suits) &&
    number(value.rank) &&
    Number.isInteger(value.rank) &&
    value.rank >= 2 &&
    value.rank <= 14
  );
}

function bid(value: unknown): boolean {
  return (
    object(value) &&
    (value.type === 'pass' ||
      (value.type === 'bid' &&
        number(value.level) &&
        Number.isInteger(value.level) &&
        value.level >= 1 &&
        value.level <= 7 &&
        oneOf(value.suit, [...suits, 'nt'])))
  );
}

function contract(value: unknown): boolean {
  return object(value) && bid({ ...value, type: 'bid' }) && oneOf(value.declarer, seats);
}

function result(value: unknown): boolean {
  return (
    object(value) &&
    contract(value.contract) &&
    number(value.declarerTeamTricks) &&
    number(value.defenderTeamTricks) &&
    number(value.requiredTricks) &&
    value.declarerTeamTricks + value.defenderTeamTricks === 13 &&
    value.requiredTricks === Number((value.contract as ObjectValue).level) + 6 &&
    value.declarerTeamWins === value.declarerTeamTricks >= value.requiredTricks
  );
}

function trick(value: unknown, complete = false): boolean {
  return (
    object(value) &&
    Object.keys(value).every((seat) => seats.includes(seat as Seat)) &&
    Object.values(value).every(card) &&
    (!complete || Object.keys(value).length === 4)
  );
}

function playing(value: unknown): boolean {
  return (
    object(value) &&
    trick(value.currentTrick) &&
    oneOf(value.trickLeadSeat, seats) &&
    oneOf(value.currentTurnSeat, seats) &&
    number(value.trickCountEW) &&
    number(value.trickCountNS) &&
    Array.isArray(value.completedTricks) &&
    value.completedTricks.length <= 13 &&
    value.trickCountEW + value.trickCountNS === value.completedTricks.length &&
    value.completedTricks.every(
      (entry: unknown) =>
        object(entry) &&
        trick(entry.cards, true) &&
        oneOf(entry.leadSeat, seats) &&
        oneOf(entry.winnerSeat, seats),
    )
  );
}

function bidding(value: unknown): boolean {
  return (
    object(value) &&
    oneOf(value.currentBidderSeat, seats) &&
    number(value.consecutivePassCount) &&
    value.consecutivePassCount <= 4 &&
    typeof value.isFirstRound === 'boolean' &&
    (value.highestBid === null ||
      (object(value.highestBid) &&
        bid({ ...value.highestBid, type: 'bid' }) &&
        oneOf(value.highestBid.seat, seats))) &&
    Array.isArray(value.bids) &&
    value.bids.every(
      (entry: unknown) => object(entry) && oneOf(entry.seat, seats) && bid(entry.action),
    )
  );
}

function log(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  if (value.type === 'system') return typeof value.message === 'string';
  if (value.type === 'bid') return oneOf(value.seat, seats) && bid(value.action);
  if (value.type === 'play') return oneOf(value.seat, seats) && card(value.card);
  if (value.type === 'redeal')
    return oneOf(value.seat, seats) && typeof value.accepted === 'boolean';
  return value.type === 'trick_end' && oneOf(value.winnerSeat, seats) && number(value.trickIndex);
}

const comboTypes = ['single', 'pair', 'straight', 'fullHouse', 'fourOfAKind', 'straightFlush'];

function cards(value: unknown, max: number): boolean {
  return Array.isArray(value) && value.length <= max && value.every(card);
}

function seatCounts(value: unknown, max: number): value is Record<Seat, number> {
  return object(value) && Object.keys(value).length === 4 &&
    seats.every((seat) => number(value[seat]) && value[seat] <= max);
}

/** Big Two result: winner scores 0, losers cardsLeft × 2^twosLeft. */
export function isBigTwoResult(value: unknown): boolean {
  if (
    !object(value) || value.gameType !== 'bigtwo' || !oneOf(value.winnerSeat, seats) ||
    typeof value.dragon !== 'boolean' || !seatCounts(value.cardsLeft, 13) ||
    !seatCounts(value.twosLeft, 4) || !seatCounts(value.scores, 13 * 16)
  )
    return false;
  const { cardsLeft, twosLeft, scores } = value;
  const winner = value.winnerSeat as Seat;
  return (
    cardsLeft[winner] === (value.dragon ? 13 : 0) &&
    seats.every((seat) =>
      twosLeft[seat] <= cardsLeft[seat] &&
      scores[seat] === (seat === winner ? 0 : cardsLeft[seat] * 2 ** twosLeft[seat]))
  );
}

function bigTwoLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  if (value.type === 'play') {
    return oneOf(value.seat, seats) && cards(value.cards, 5) && oneOf(value.comboType, comboTypes);
  }
  if (value.type === 'pass' || value.type === 'dragon') return oneOf(value.seat, seats);
  return value.type === 'round_end' && oneOf(value.leaderSeat, seats);
}

function bigTwoGame(value: ObjectValue): boolean {
  const lastPlay = value.lastPlay;
  const pending = value.pendingAutoPass;
  if (pending !== undefined && (!object(pending) || !text(pending.id)
    || pending.id.length > 128 || !oneOf(pending.seat, seats) || !number(pending.executeAt)
    || Object.keys(pending).some((key) => !['id', 'seat', 'executeAt'].includes(key)))) return false;
  return (
    text(value.id) &&
    text(value.roomCode) &&
    number(value.startedAt) &&
    object(value.players) &&
    Object.keys(value.players).length === 4 &&
    seats.every((seat) => player((value.players as ObjectValue)[seat])) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    object(value.hands) &&
    Object.keys(value.hands).length === 4 &&
    seats.every((seat) => cards((value.hands as ObjectValue)[seat], 13)) &&
    oneOf(value.currentTurnSeat, seats) &&
    (lastPlay === null ||
      (object(lastPlay) && oneOf(lastPlay.seat, seats) && cards(lastPlay.cards, 5) &&
        oneOf(lastPlay.comboType, comboTypes))) &&
    Array.isArray(value.lockedSeats) &&
    value.lockedSeats.every((seat: unknown) => oneOf(seat, seats)) &&
    new Set(value.lockedSeats).size === value.lockedSeats.length &&
    typeof value.firstPlay === 'boolean' &&
    Array.isArray(value.log) &&
    value.log.every(bigTwoLog) &&
    (value.result === null || isBigTwoResult(value.result))
  );
}

function seatCards(value: unknown, max: number): boolean {
  return object(value) && Object.keys(value).length === 4 && seats.every((seat) => cards(value[seat], max));
}

/** Red Points result: winners are exactly the top-scoring seats; all red points are 208. */
export function isRedPointsResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'redpoints' || !seatCounts(value.points, 208) ||
    !Array.isArray(value.winners)) return false;
  const points = value.points;
  const best = Math.max(...seats.map((seat) => points[seat]));
  return seats.reduce((sum, seat) => sum + points[seat], 0) === 208 &&
    isDeepStrictEqual(value.winners, seats.filter((seat) => points[seat] === best));
}

function redPointsLog(value: unknown): boolean {
  return object(value) && number(value.timestamp) && oneOf(value.type, ['play', 'flip']) &&
    oneOf(value.seat, seats) && card(value.card) && (value.captured === null || card(value.captured));
}

function redPointsGame(value: ObjectValue): boolean {
  return (
    text(value.id) &&
    text(value.roomCode) &&
    number(value.startedAt) &&
    object(value.players) &&
    Object.keys(value.players).length === 4 &&
    seats.every((seat) => player((value.players as ObjectValue)[seat])) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    seatCards(value.hands, RP_HAND_SIZE) &&
    cards(value.table, 52) &&
    cards(value.stock, 52 - RP_HAND_SIZE * 4 - RP_TABLE_SIZE) &&
    seatCards(value.captured, 52) &&
    oneOf(value.currentTurnSeat, seats) &&
    oneOf(value.step, ['play', 'flip-choose']) &&
    (value.pendingFlip === null || card(value.pendingFlip)) &&
    Array.isArray(value.log) &&
    value.log.every(redPointsLog) &&
    (value.result === null || isRedPointsResult(value.result))
  );
}

/** 99 result: three distinct eliminated seats, the winner is the fourth. */
export function isNinetyNineResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'ninetynine' || !oneOf(value.winnerSeat, seats) ||
    !number(value.finalTotal) || value.finalTotal > NN_MAX || !Array.isArray(value.eliminationOrder)) return false;
  const order: unknown[] = value.eliminationOrder;
  return order.length === 3 && order.every((seat) => oneOf(seat, seats)) &&
    new Set([...order, value.winnerSeat]).size === 4;
}

function ninetyNineLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp) || !oneOf(value.seat, seats)) return false;
  if (value.type === 'eliminated') return true;
  return value.type === 'play' && card(value.card) &&
    (value.choice === null || oneOf(value.choice, ['plus', 'minus'])) &&
    (value.target === null || oneOf(value.target, seats)) &&
    number(value.total) && value.total <= NN_MAX;
}

function ninetyNineGame(value: ObjectValue): boolean {
  return (
    text(value.id) &&
    text(value.roomCode) &&
    number(value.startedAt) &&
    object(value.players) &&
    Object.keys(value.players).length === 4 &&
    seats.every((seat) => player((value.players as ObjectValue)[seat])) &&
    oneOf(value.phase, ['playing', 'scoring']) &&
    seatCards(value.hands, NN_HAND_SIZE) &&
    cards(value.stock, 52) &&
    cards(value.discard, 52) &&
    number(value.total) &&
    value.total <= NN_MAX &&
    oneOf(value.direction, ['ccw', 'cw']) &&
    oneOf(value.currentTurnSeat, seats) &&
    Array.isArray(value.eliminated) &&
    value.eliminated.every((seat: unknown) => oneOf(seat, seats)) &&
    new Set(value.eliminated).size === value.eliminated.length &&
    Array.isArray(value.log) &&
    value.log.every(ninetyNineLog) &&
    (value.result === null || isNinetyNineResult(value.result))
  );
}

const gameValidators: Record<GameType, (value: ObjectValue) => boolean> = {
  bridge: bridgeGame,
  bigtwo: bigTwoGame,
  redpoints: redPointsGame,
  ninetynine: ninetyNineGame,
};

function presentation(value: ObjectValue): boolean {
  if (value.presentation === undefined) return true;
  const metadata = value.presentation;
  return object(metadata) && text(metadata.id) && metadata.id.length <= 128 &&
    (metadata.timingVersion === undefined || metadata.timingVersion === 2) &&
    number(metadata.startedAt) && metadata.serverNow === undefined &&
    Array.isArray(value.log) && typeof metadata.logStart === 'number' &&
    Number.isInteger(metadata.logStart) && metadata.logStart >= 0 &&
    metadata.logStart <= value.log.length;
}

function gameClock(value: ObjectValue): boolean {
  if (value.clock === undefined) return true;
  const clock = value.clock;
  if (!object(clock) || !isTimeControl(clock.settings) || clock.serverNow !== undefined
    || !seatCounts(clock.bankRemainingMs, clock.settings.bankSeconds * 1000)) return false;
  if (clock.lastTimeout !== undefined && (!object(clock.lastTimeout)
    || !oneOf(clock.lastTimeout.seat, seats) || !number(clock.lastTimeout.at))) return false;
  const state = value as unknown as AnyGameState;
  const expectedSeat = getTurnSeat(state);
  if (!expectedSeat) return clock.turn === null;
  // Legacy forced passes were saved without a public turn.
  if (state.gameType === 'bigtwo' && state.pendingAutoPass && clock.turn === null) return true;
  const turn = clock.turn;
  return object(turn) && text(turn.id) && turn.id.length <= 128 && turn.seat === expectedSeat
    && number(turn.startsAt) && turn.startsAt >= getPresentationEndsAt(state)
    && number(turn.baseRemainingMs) && turn.baseRemainingMs <= clock.settings.baseSeconds * 1000
    && number(turn.deadline)
    && turn.deadline === turn.startsAt + turn.baseRemainingMs + clock.bankRemainingMs[expectedSeat];
}

function returnedSeats(value: ObjectValue): boolean {
  if (value.returnedSeats === undefined) return true;
  const returned = value.returnedSeats;
  return value.result !== null && Array.isArray(returned) && returned.length < 4
    && returned.every((seat: unknown) => oneOf(seat, seats)) && new Set(returned).size === returned.length;
}

function game(value: unknown): boolean {
  return object(value) && oneOf(value.gameType, [...GAME_TYPES]) &&
    gameValidators[value.gameType as GameType](value) && presentation(value) && gameClock(value)
    && returnedSeats(value);
}

function bridgeGame(value: ObjectValue): boolean {
  return (
    text(value.id) &&
    text(value.roomCode) &&
    number(value.startedAt) &&
    object(value.players) &&
    Object.keys(value.players).length === 4 &&
    seats.every((seat) => player((value.players as ObjectValue)[seat])) &&
    oneOf(value.phase, ['dealing', 'redeal_pending', 'bidding', 'playing', 'scoring']) &&
    object(value.hands) &&
    Object.keys(value.hands).length === 4 &&
    seats.every((seat) => {
      const hand = (value.hands as ObjectValue)[seat];
      return Array.isArray(hand) && hand.length <= 13 && hand.every(card);
    }) &&
    oneOf(value.dealerSeat, seats) &&
    (value.bidding === null || bidding(value.bidding)) &&
    (value.contract === null || contract(value.contract)) &&
    (value.playing === null || playing(value.playing)) &&
    (value.result === null || result(value.result)) &&
    Array.isArray(value.log) &&
    value.log.every(log) &&
    Array.isArray(value.redealDeclinedSeats) &&
    value.redealDeclinedSeats.every((seat: unknown) => oneOf(seat, seats)) &&
    new Set(value.redealDeclinedSeats).size === value.redealDeclinedSeats.length &&
    (value.redealPendingSeat === null || oneOf(value.redealPendingSeat, seats))
  );
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
    value.memberIds.length > 4 ||
    new Set(value.memberIds).size !== value.memberIds.length
  )
    return false;
  const info = value.info;
  const members = value.memberIds as string[];
  const humans = members.filter((id) => !id.startsWith('bot:'));
  return (
    text(info.code) &&
    (info.timeControl === undefined || isTimeControl(info.timeControl)) &&
    oneOf(info.gameType, [...GAME_TYPES]) &&
    oneOf(info.status, ['waiting', 'playing']) &&
    number(info.createdAt) &&
    oneOf(info.hostId, humans) &&
    (info.abortVoteCooldownUntil === null || number(info.abortVoteCooldownUntil)) &&
    (info.abortVote === null || (info.status === 'playing' && abortVote(info.abortVote, humans))) &&
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
  switch (state.gameType) {
    case 'bridge': return coherentBridgeGame(state);
    case 'bigtwo': return coherentBigTwoGame(state);
    case 'redpoints': return coherentRedPointsGame(state);
    case 'ninetynine': return coherentNinetyNineGame(state);
  }
}

const cardId = (entry: Card): string => `${entry.suit}-${entry.rank}`;

/** All 52 cards are accounted for, eliminations match the log, and the current seat can play. */
function coherentNinetyNineGame(state: NinetyNineGameState): boolean {
  if (new Set(seats.map((seat) => state.players[seat].id)).size !== 4) return false;
  const { eliminated, result } = state;
  const all = [...seats.flatMap((seat) => state.hands[seat]), ...state.stock, ...state.discard];
  if (all.length !== 52 || new Set(all.map(cardId)).size !== 52) return false;
  const logged = state.log.flatMap((entry) => (entry.type === 'eliminated' ? [entry.seat] : []));
  if (!isDeepStrictEqual(logged, eliminated) || eliminated.some((seat) => state.hands[seat].length > 0)) return false;
  const lastPlay = state.log.filter((entry) => entry.type === 'play').at(-1);
  if (lastPlay?.type === 'play'
    ? lastPlay.total !== state.total || !isDeepStrictEqual(state.discard.at(-1), lastPlay.card)
    : state.total !== 0 || state.discard.length > 0) return false;
  if (state.phase === 'playing') {
    return result === null && eliminated.length < 3 && !eliminated.includes(state.currentTurnSeat) &&
      nnHasPlayable(state.total, state.hands[state.currentTurnSeat]);
  }
  return (
    result !== null && eliminated.length === 3 && isDeepStrictEqual(result.eliminationOrder, eliminated) &&
    result.winnerSeat === state.currentTurnSeat && result.finalTotal === state.total
  );
}

/** All 52 cards are accounted for, piles match the log, and the pending step can resume. */
function coherentRedPointsGame(state: RedPointsGameState): boolean {
  if (new Set(seats.map((seat) => state.players[seat].id)).size !== 4) return false;
  const { pendingFlip, result } = state;
  const all = [
    ...seats.flatMap((seat) => [...state.hands[seat], ...state.captured[seat]]),
    ...state.table, ...state.stock, ...(pendingFlip ? [pendingFlip] : []),
  ];
  if (all.length !== 52 || new Set(all.map(cardId)).size !== 52) return false;
  const plays = state.log.filter((entry) => entry.type === 'play');
  const flips = state.log.length - plays.length;
  if (
    !seats.every((seat) =>
      state.hands[seat].length === RP_HAND_SIZE - plays.filter((entry) => entry.seat === seat).length &&
      state.captured[seat].length === 2 * state.log.filter((entry) => entry.seat === seat && entry.captured).length) ||
    state.stock.length !== 52 - RP_HAND_SIZE * 4 - RP_TABLE_SIZE - flips - (pendingFlip ? 1 : 0) ||
    (state.step === 'flip-choose') !== (pendingFlip !== null) ||
    (pendingFlip !== null && rpPairOptions(pendingFlip, state.table).length < 2)
  )
    return false;
  if (state.phase === 'playing') {
    return result === null && (pendingFlip !== null || state.stock.length > 0 ||
      seats.some((seat) => state.hands[seat].length > 0));
  }
  return (
    result !== null && state.step === 'play' && state.stock.length === 0 && state.table.length === 0 &&
    seats.every((seat) => state.hands[seat].length === 0 && result.points[seat] === rpScore(state.captured[seat]))
  );
}

/** All 52 cards are accounted for, and the turn state can resume legally. */
function coherentBigTwoGame(state: BigTwoGameState): boolean {
  if (new Set(seats.map((seat) => state.players[seat].id)).size !== 4) return false;
  const plays = state.log.flatMap((entry) => (entry.type === 'play' ? [entry] : []));
  const all = [...seats.flatMap((seat) => state.hands[seat]), ...plays.flatMap((entry) => entry.cards)];
  if (all.length !== 52 || new Set(all.map(cardId)).size !== 52) return false;
  if (!seats.every((seat) => state.hands[seat].length ===
    13 - plays.filter((entry) => entry.seat === seat).reduce((total, entry) => total + entry.cards.length, 0)))
    return false;
  if (plays.some((entry) => identifyCombo(entry.cards)?.type !== entry.comboType)) return false;
  const { lastPlay, lockedSeats, result } = state;
  if (state.pendingAutoPass) {
    const previous = lastPlay ? identifyCombo(lastPlay.cards) : null;
    if (state.phase !== 'playing' || state.firstPlay || !previous
      || state.pendingAutoPass.executeAt < getPresentationEndsAt(state)
      || state.pendingAutoPass.seat !== state.currentTurnSeat
      || lastPlay?.seat === state.currentTurnSeat
      || lockedSeats.includes(state.currentTurnSeat)
      || legalPlays(state.hands[state.currentTurnSeat], previous, false).length > 0) return false;
  }
  if (lastPlay) {
    const last = plays[plays.length - 1];
    if (!last || last.seat !== lastPlay.seat || !isDeepStrictEqual(last.cards, lastPlay.cards) ||
      last.comboType !== lastPlay.comboType || lockedSeats.includes(lastPlay.seat)) return false;
  } else if (lockedSeats.length > 0) return false;
  if (state.firstPlay !== (plays.length === 0)) return false;
  const dragon = state.log.some((entry) => entry.type === 'dragon');
  if (state.phase === 'playing') {
    return (
      result === null && !dragon &&
      !lockedSeats.includes(state.currentTurnSeat) &&
      seats.every((seat) => state.hands[seat].length > 0) &&
      (!state.firstPlay ||
        (lastPlay === null &&
          state.hands[state.currentTurnSeat].some((entry) => entry.suit === 'clubs' && entry.rank === 3)))
    );
  }
  const hands = state.hands;
  return (
    result !== null &&
    result.dragon === dragon &&
    (dragon ? state.firstPlay && isDragon(hands[result.winnerSeat]) : hands[result.winnerSeat].length === 0) &&
    seats.every((seat) =>
      result.cardsLeft[seat] === hands[seat].length &&
      result.twosLeft[seat] === hands[seat].filter((entry) => entry.rank === 2).length &&
      result.scores[seat] === (seat === result.winnerSeat ? 0 : bigTwoPenalty(hands[seat])))
  );
}

/** A persisted phase must contain the state needed to resume its next legal action. */
function coherentBridgeGame(state: BridgeGameState): boolean {
  if (new Set(seats.map((seat) => state.players[seat].id)).size !== 4) return false;
  if (state.phase === 'dealing' || state.phase === 'redeal_pending' || state.phase === 'bidding') {
    if (
      state.contract !== null ||
      state.playing !== null ||
      state.result !== null ||
      !seats.every((seat) => state.hands[seat].length === 13)
    )
      return false;
    if (state.phase === 'bidding') {
      return (
        state.bidding !== null &&
        state.redealPendingSeat === null &&
        state.bidding.consecutivePassCount < (state.bidding.highestBid ? 3 : 4)
      );
    }
    return (
      state.bidding === null &&
      (state.phase === 'dealing'
        ? state.redealPendingSeat === null
        : state.redealPendingSeat !== null &&
          !state.redealDeclinedSeats.includes(state.redealPendingSeat))
    );
  }
  if (
    state.bidding === null ||
    state.contract === null ||
    state.playing === null ||
    state.redealPendingSeat !== null
  )
    return false;
  const highest = state.bidding.highestBid;
  if (
    !highest ||
    highest.level !== state.contract.level ||
    highest.suit !== state.contract.suit ||
    highest.seat !== state.contract.declarer ||
    state.bidding.consecutivePassCount !== 3
  )
    return false;
  const playingState = state.playing;
  const ewTricks = playingState.completedTricks.filter(
    (entry) => entry.winnerSeat === 'E' || entry.winnerSeat === 'W',
  ).length;
  if (ewTricks !== playingState.trickCountEW) return false;
  const playedSeats = Object.keys(playingState.currentTrick);
  if (
    playedSeats.length >= 4 ||
    !seats.every(
      (seat) =>
        state.hands[seat].length ===
        13 - playingState.completedTricks.length - (playedSeats.includes(seat) ? 1 : 0),
    )
  )
    return false;
  if (state.phase === 'playing')
    return state.result === null && playingState.completedTricks.length < 13;
  const finished = state.result;
  const declarerTricks = ['N', 'S'].includes(state.contract.declarer)
    ? playingState.trickCountNS
    : playingState.trickCountEW;
  return (
    finished !== null &&
    playingState.completedTricks.length === 13 &&
    playedSeats.length === 0 &&
    finished.contract.level === state.contract.level &&
    finished.contract.suit === state.contract.suit &&
    finished.contract.declarer === state.contract.declarer &&
    finished.declarerTeamTricks === declarerTricks
  );
}

export function isRuntimeSnapshot(value: unknown): value is RuntimeSnapshot {
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
        (entry.disconnectedAt === null || number(entry.disconnectedAt)),
    ) ||
    !value.rooms.every(room) ||
    !value.games.every(game) ||
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
            (message.system === undefined || message.system === true),
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
    const occupants = seats.flatMap((seat) => entry.info.seats[seat].player?.id ?? []);
    if (new Set(occupants).size !== occupants.length) return false;
    const vote = entry.info.abortVote;
    if (vote && ![...vote.yes, ...vote.no].every((id) => occupants.includes(id))) return false;
    for (const id of entry.memberIds) {
      const bot = seats.map((seat) => entry.info.seats[seat].player).find((player) => player?.id === id && player.isBot);
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
    if (!currentRoom || !coherentGame(entry)) return false;
    if (entry.phase === 'scoring') {
      // The completed board is historical: seats and members may have changed already.
      if (currentRoom.info.status !== 'waiting') return false;
    } else if (
      currentRoom.info.status !== 'playing' ||
      currentRoom.info.gameType !== entry.gameType ||
      !seats.every((seat) => currentRoom.info.seats[seat].player?.id === entry.players[seat].id &&
        (currentRoom.info.seats[seat].player?.isBot === true) === (entry.players[seat].isBot === true))
    )
      return false;
  }
  return snapshot.chat.every((entry) => rooms.has(entry.roomCode));
}
