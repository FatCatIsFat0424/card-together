import { object, oneOf, seats, seatCounts, number, cards, text, cardId } from '../../runtime/validation-helpers';
import type { Seat, BigTwoGameState } from '@shared/types';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import { identifyCombo, legalPlays, isDragon, bigTwoPenalty } from '@shared/rules/bigtwo';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { isDeepStrictEqual } from 'node:util';

const comboTypes = ['single', 'pair', 'straight', 'fullHouse', 'fourOfAKind', 'straightFlush'];

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

export function bigTwoGame(value: ObjectValue, player: PlayerValidator): boolean {
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

/** All 52 cards are accounted for, and the turn state can resume legally. */
export function coherentBigTwoGame(state: BigTwoGameState): boolean {
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
