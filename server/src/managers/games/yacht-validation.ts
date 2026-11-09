import {
  EMPTY_YACHT_SCORECARD, YACHT_DICE, YACHT_MAX_ROLLS, YACHT_ROUNDS, isYachtBox, isYachtFace, isYachtJoker,
  isYachtOptions, isYachtScorecard, yachtCount, yachtTotals, yachtWinners, yachtWrite,
} from '@shared/rules/yacht';
import type { YachtScorecard } from '@shared/rules/yacht';
import { occupiedSeats } from '@shared/rules/seats';
import type { YachtGameState, YachtLogEntry } from '@shared/games/yacht/types';
import {
  distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson,
} from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';

/** A generous bound on one card's total: thirteen boxes plus a 100-point bonus for every round after the first. */
const MAX_TOTAL = 6000;

function diceList(value: unknown, length: number): boolean {
  return Array.isArray(value) && value.length === length && value.every(isYachtFace);
}

function maskShape(value: unknown): boolean {
  return Array.isArray(value) && value.length === YACHT_DICE && value.every((entry) => typeof entry === 'boolean');
}

function turnShape(value: unknown): boolean {
  if (!object(value) || Object.keys(value).length !== 4 || !number(value.rolls) || value.rolls > YACHT_MAX_ROLLS
    || typeof value.done !== 'boolean' || !maskShape(value.held)) return false;
  if (value.rolls === 0) return !value.done && diceList(value.dice, 0) && (value.held as boolean[]).every((held) => !held);
  return diceList(value.dice, YACHT_DICE);
}

function logShape(value: unknown): boolean {
  return object(value) && Object.keys(value).length === 9 && value.type === 'score' && number(value.round)
    && value.round >= 1 && value.round <= YACHT_ROUNDS && oneOf(value.seat, gameSeats) && isYachtBox(value.box)
    && number(value.score) && typeof value.bonus === 'boolean' && diceList(value.dice, YACHT_DICE)
    && number(value.rolls) && value.rolls >= 1 && value.rolls <= YACHT_MAX_ROLLS && number(value.timestamp);
}

function seatRecord(value: unknown, seats: readonly string[], valid: (entry: unknown) => boolean): boolean {
  return object(value) && Object.keys(value).length === seats.length && seats.every((seat) => valid(value[seat]));
}

/** Yacht Dice result: the winners hold the best total, and the seats agree with the room's order. */
export function isYachtResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'yacht' || !gameSeatList(value.seats) || value.seats.length < 2
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !oneOf(value.mode, ['turns', 'simultaneous'])) return false;
  const seats = value.seats;
  const total = (entry: unknown): boolean => number(entry) && entry <= MAX_TOTAL;
  const yachts = (entry: unknown): boolean => number(entry) && entry <= YACHT_ROUNDS;
  if (!seatRecord(value.totals, seats, total) || !seatRecord(value.upperBonus, seats, (entry) => typeof entry === 'boolean')
    || !seatRecord(value.yachts, seats, yachts) || !gameSeatList(value.winners)) return false;
  return sameJson(value.winners, yachtWinners(value.totals as Record<string, number>, seats));
}

export function yachtGame(value: ObjectValue, player: PlayerValidator): boolean {
  if (!flexibleSeatGame(value, player) || !isYachtOptions(value.options)) return false;
  const seats = occupiedSeats(value.players as ObjectValue);
  return oneOf(value.phase, ['playing', 'scoring']) && number(value.round) && value.round >= 1 && value.round <= YACHT_ROUNDS
    && (value.currentTurnSeat === null || oneOf(value.currentTurnSeat, seats))
    && number(value.roundMs) && value.roundMs > 0 && (value.roundDeadline === null || number(value.roundDeadline))
    && seatRecord(value.turns, seats, turnShape) && seatRecord(value.cards, seats, isYachtScorecard)
    && Array.isArray(value.log) && value.log.length <= YACHT_ROUNDS * seats.length && value.log.every(logShape)
    && (value.result === null || isYachtResult(value.result));
}

/**
 * Replaying the public log reproduces every scorecard: each entry is a legal box for its dice, scores what the
 * rules give, and comes in turn order (turn mode) or once per seat in each round (simultaneous mode). The turn
 * and the dice still on the table agree with what the log leaves open.
 */
export function coherentYachtGame(state: YachtGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  const simultaneous = state.options.mode === 'simultaneous';
  const cards: Record<string, YachtScorecard> = Object.fromEntries(seats.map((seat) => [seat, EMPTY_YACHT_SCORECARD]));
  let round = 1;
  let scored: YachtLogEntry[] = [];
  for (const entry of state.log) {
    if (round > YACHT_ROUNDS || entry.round !== round || !seats.includes(entry.seat)
      || scored.some((earlier) => earlier.seat === entry.seat)
      || (!simultaneous && entry.seat !== seats[scored.length])) return false;
    const card = cards[entry.seat];
    const written = yachtWrite(card, entry.box, entry.dice);
    if (!written || written.boxes[entry.box] !== entry.score || entry.bonus !== isYachtJoker(card, entry.dice)) return false;
    cards[entry.seat] = written;
    scored.push(entry);
    if (scored.length === seats.length) {
      if (round === YACHT_ROUNDS) round += 1;
      else {
        round += 1;
        scored = [];
      }
    }
  }
  const finished = round > YACHT_ROUNDS;
  if (!sameJson(state.cards, cards) || (state.phase === 'scoring') !== finished || state.round !== Math.min(round, YACHT_ROUNDS)) {
    return false;
  }
  if (finished) {
    const totals = Object.fromEntries(seats.map((seat) => [seat, yachtTotals(cards[seat]).total]));
    return state.currentTurnSeat === null && state.roundDeadline === null && sameJson(state.result, {
      gameType: 'yacht', seats, mode: state.options.mode, winners: yachtWinners(totals, seats), totals,
      upperBonus: Object.fromEntries(seats.map((seat) => [seat, yachtTotals(cards[seat]).upperBonus > 0])),
      yachts: Object.fromEntries(seats.map((seat) => [seat, yachtCount(cards[seat])])),
    }) && seats.every((seat) => state.turns[seat]?.done === true);
  }
  if (state.result !== null) return false;
  const open = simultaneous ? null : seats[scored.length];
  if (state.currentTurnSeat !== open || (simultaneous ? state.roundDeadline === null : state.roundDeadline !== null)) return false;
  return seats.every((seat) => {
    const turn = state.turns[seat]!;
    const entry = scored.find((candidate) => candidate.seat === seat);
    if (entry) return turn.done && sameJson(turn.dice, entry.dice) && turn.rolls === entry.rolls;
    // A seat that has not scored holds no finished turn, and in turn mode only the seat on turn may have rolled.
    return !turn.done && (simultaneous || seat === open || turn.rolls === 0);
  });
}
