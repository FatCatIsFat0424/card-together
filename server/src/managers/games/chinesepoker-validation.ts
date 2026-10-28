import type { ChinesePokerArrangement, Seat, ChinesePokerGameState } from '@shared/types';
import {
  object, cards, seats, cardId, oneOf, number, commonGame, seatCards, sameJson,
} from '../../runtime/validation-helpers';
import { CP_ROWS, CP_PAIRINGS, CP_HAND_SIZE, cpIsValidArrangement, cpMatchResult } from '@shared/rules/chinesepoker';
import { isDeepStrictEqual } from 'node:util';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';

function arrangementShape(value: unknown): value is ChinesePokerArrangement {
  return object(value) && Object.keys(value).length === 3 && Array.isArray(value.front) && value.front.length === 3
    && Array.isArray(value.middle) && value.middle.length === 5 && Array.isArray(value.back)
    && value.back.length === 5 && CP_ROWS.every((row) => cards(value[row], 5));
}

function signedInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function chinesePokerMatchup(value: unknown, pairing: readonly [Seat, Seat]): boolean {
  return object(value) && Array.isArray(value.seats) && isDeepStrictEqual(value.seats, [...pairing]) &&
    Array.isArray(value.rows) && value.rows.length === 3 && value.rows.every(signedInteger) &&
    (value.shooter === null || pairing.includes(value.shooter as Seat)) && signedInteger(value.points);
}

/**
 * Chinese Poker result. Stored match history must survive later scoring-rule changes, so this
 * checks the arrangements and the arithmetic linking pairings, totals, and winners instead of
 * rescoring the rows; live games are rescored in their coherence check.
 */
export function isChinesePokerResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'chinesepoker' || !object(value.arrangements)
    || Object.keys(value.arrangements).length !== 4) return false;
  const arrangements = value.arrangements;
  if (!seats.every((seat) => arrangementShape(arrangements[seat]))) return false;
  const all = seats.flatMap((seat) => CP_ROWS.flatMap((row) => (arrangements[seat] as ChinesePokerArrangement)[row]));
  const { fouls, matchups, scores, winners } = value;
  if (new Set(all.map(cardId)).size !== 52 || !Array.isArray(fouls)
    || !isDeepStrictEqual(fouls, seats.filter((seat) => fouls.includes(seat)))
    || !Array.isArray(matchups) || matchups.length !== CP_PAIRINGS.length
    || !matchups.every((matchup, index) => chinesePokerMatchup(matchup, CP_PAIRINGS[index]))
    || !(value.homeRun === null || oneOf(value.homeRun, seats))
    || !object(scores) || Object.keys(scores).length !== 4 || !seats.every((seat) => signedInteger(scores[seat]))
    || !Array.isArray(winners)) return false;
  const pairings = matchups as { seats: [Seat, Seat]; points: number }[];
  const totals = seats.map((seat) => pairings.reduce((sum, matchup) => sum
    + (matchup.seats[0] === seat ? matchup.points : matchup.seats[1] === seat ? -matchup.points : 0), 0));
  const best = Math.max(...totals);
  return seats.every((seat, index) => scores[seat] === totals[index]) &&
    isDeepStrictEqual(winners, seats.filter((_, index) => totals[index] === best));
}

function chinesePokerLog(value: unknown): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  if (value.type === 'reveal') return oneOf(value.row, [...CP_ROWS]);
  if (value.type === 'shoot') return oneOf(value.seat, seats) && oneOf(value.target, seats) && value.seat !== value.target;
  // A submission must never carry the arrangement it announces.
  if (value.type === 'submit') return oneOf(value.seat, seats) && Object.keys(value).length === 3;
  return value.type === 'homerun' && oneOf(value.seat, seats);
}

export function chinesePokerGame(value: ObjectValue, player: PlayerValidator): boolean {
  const arrangements = value.arrangements;
  return commonGame(value, player) &&
    oneOf(value.phase, ['arranging', 'scoring']) &&
    seatCards(value.hands, CP_HAND_SIZE) &&
    object(arrangements) &&
    Object.keys(arrangements).length === 4 &&
    seats.every((seat) => arrangements[seat] === null || arrangementShape(arrangements[seat])) &&
    number(value.arrangeDeadline) &&
    Array.isArray(value.autoArranged) &&
    value.autoArranged.every((seat: unknown) => oneOf(seat, seats)) &&
    Array.isArray(value.log) &&
    value.log.every(chinesePokerLog) &&
    (value.result === null || isChinesePokerResult(value.result));
}

/** Submissions match stored arrangements, and a finished showdown is exactly the recomputed one. */
export function coherentChinesePokerGame(state: ChinesePokerGameState): boolean {
  if (new Set(seats.map((seat) => state.players[seat].id)).size !== 4) return false;
  const all = seats.flatMap((seat) => state.hands[seat]);
  if (!seats.every((seat) => state.hands[seat].length === CP_HAND_SIZE) || new Set(all.map(cardId)).size !== 52
    || state.arrangeDeadline < state.startedAt) return false;
  const submitted = seats.filter((seat) => state.arrangements[seat] !== null);
  const submits = state.log.filter((entry) => entry.type === 'submit').map((entry) => entry.seat);
  if (new Set(submits).size !== submits.length || !isDeepStrictEqual([...submits].sort(), [...submitted].sort())
    || state.log.slice(0, submits.length).some((entry) => entry.type !== 'submit')
    || !seats.every((seat) => {
      const arrangement = state.arrangements[seat];
      return arrangement === null || cpIsValidArrangement(state.hands[seat], arrangement);
    })
    || !isDeepStrictEqual(state.autoArranged, seats.filter((seat) => state.autoArranged.includes(seat)))
    || state.autoArranged.some((seat) => !submitted.includes(seat) || state.players[seat].isBot)) return false;
  if (state.phase === 'arranging') {
    return state.result === null && submitted.length < 4 && state.log.length === submits.length;
  }
  if (submitted.length !== 4) return false;
  const result = cpMatchResult(state.arrangements as Record<Seat, ChinesePokerArrangement>);
  const showdown = [
    ...CP_ROWS.map((row) => ({ type: 'reveal', row })),
    ...result.matchups.flatMap((matchup) => matchup.shooter ? [{ type: 'shoot', seat: matchup.shooter,
      target: matchup.seats[0] === matchup.shooter ? matchup.seats[1] : matchup.seats[0] }] : []),
    ...(result.homeRun ? [{ type: 'homerun', seat: result.homeRun }] : []),
  ];
  const logged = state.log.slice(4).map(({ timestamp: _timestamp, ...entry }) => entry);
  return sameJson(state.result, result) && sameJson(logged, showdown);
}
