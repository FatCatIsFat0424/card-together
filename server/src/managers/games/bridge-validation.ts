import { object, number, oneOf, suits, seats, card, text } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { Seat, BridgeGameState } from '@shared/types';

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

export function bridgeGame(value: ObjectValue, player: PlayerValidator): boolean {
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

/** A persisted phase must contain the state needed to resume its next legal action. */
export function coherentBridgeGame(state: BridgeGameState): boolean {
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
