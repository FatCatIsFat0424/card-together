import { distinctPlayers, flexibleSeatGame, gameSeatList, gameSeats, number, object, oneOf, sameJson } from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import type { CodeBreakerGameState, CodeBreakerLogEntry } from '@shared/types';
import { occupiedSeats } from '@shared/rules/seats';
import { CODEBREAKER_MAX_PLAYERS } from '@shared/games/codebreaker/definition';
import {
  CB_MAX_GUESSES, CB_VARIANTS, cbFeedback, cbSolved, cbWinners, isCbCode, isCodeBreakerOptions,
} from '@shared/rules/codebreaker';
import type { CbVariant } from '@shared/rules/codebreaker';

const LOG_KEYS = ['seat', 'round', 'code', 'exact', 'partial', 'solved', 'auto', 'timestamp'];

function logShape(value: unknown, variant: CbVariant): boolean {
  return object(value) && Object.keys(value).length === LOG_KEYS.length && LOG_KEYS.every((key) => key in value)
    && oneOf(value.seat, gameSeats) && number(value.round) && value.round >= 1 && isCbCode(value.code, variant)
    && number(value.exact) && number(value.partial) && typeof value.solved === 'boolean'
    && typeof value.auto === 'boolean' && number(value.timestamp);
}

/** Code Breaker result: every seat's guess count, the solvers, and the winners among them. */
export function isCodeBreakerResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'codebreaker' || !gameSeatList(value.seats)
    || value.seats.length < 2 || value.seats.length > CODEBREAKER_MAX_PLAYERS
    || !sameJson(value.seats, gameSeats.filter((seat) => (value.seats as string[]).includes(seat)))
    || !oneOf(value.variant, [...CB_VARIANTS]) || !isCbCode(value.secret, value.variant as CbVariant)
    || !number(value.rounds) || value.rounds < 1 || value.rounds > CB_MAX_GUESSES) return false;
  const seats = value.seats;
  const guesses = value.guesses;
  if (!object(guesses) || Object.keys(guesses).length !== seats.length
    || !seats.every((seat) => number(guesses[seat]) && guesses[seat] >= 1 && guesses[seat] <= CB_MAX_GUESSES)
    || !gameSeatList(value.solved) || !value.solved.every((seat) => seats.includes(seat))
    || !gameSeatList(value.winners)) return false;
  const finishes = seats.map((seat) => ({ seat, guesses: guesses[seat] as number, solved: (value.solved as string[]).includes(seat) }));
  return sameJson(value.winners, cbWinners(finishes))
    // A seat that did not crack the code used every guess.
    && finishes.every((finish) => finish.solved || finish.guesses === CB_MAX_GUESSES)
    && Math.max(...finishes.map((finish) => finish.guesses)) === value.rounds;
}

export function codeBreakerGame(value: ObjectValue, player: PlayerValidator): boolean {
  if (!flexibleSeatGame(value, player) || Object.keys(value.players as ObjectValue).length > CODEBREAKER_MAX_PLAYERS) return false;
  if (!isCodeBreakerOptions(value.options)) return false;
  const seats = occupiedSeats(value.players as ObjectValue);
  const variant = value.options.variant;
  const pending = value.pending;
  return oneOf(value.phase, ['playing', 'scoring']) && isCbCode(value.secret, variant)
    && number(value.round) && value.round >= 1 && number(value.roundMs) && number(value.roundDeadline)
    && object(pending) && Object.keys(pending).length === seats.length
    && seats.every((seat) => pending[seat] === null || isCbCode(pending[seat], variant))
    && gameSeatList(value.pendingAuto) && value.pendingAuto.every((seat) => seats.includes(seat) && Boolean(pending[seat]))
    && Array.isArray(value.log) && value.log.length <= seats.length * CB_MAX_GUESSES
    && value.log.every((entry) => logShape(entry, variant))
    && (value.result === null || isCodeBreakerResult(value.result));
}

/**
 * Replaying the log against the secret reproduces every feedback: each round holds at most one guess per
 * seat that was still active, in seat order, and the match ends exactly when no seat can guess again.
 */
export function coherentCodeBreakerGame(state: CodeBreakerGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const seats = occupiedSeats(state.players);
  if (seats.length < 2 || seats.length > CODEBREAKER_MAX_PLAYERS || (state.phase === 'scoring') !== (state.result !== null)) return false;
  const used: Record<string, number> = Object.fromEntries(seats.map((seat) => [seat, 0]));
  const solved = new Set<string>();
  let previousRound = 0;
  let previousSeat = -1;
  for (const entry of state.log as readonly CodeBreakerLogEntry[]) {
    const index = seats.indexOf(entry.seat);
    if (index < 0 || entry.round < previousRound || (entry.round === previousRound && index <= previousSeat)) return false;
    // Rounds are consecutive: a new round starts only after the previous one resolved.
    if (entry.round > previousRound + 1) return false;
    if (solved.has(entry.seat) || used[entry.seat] >= CB_MAX_GUESSES) return false;
    const feedback = cbFeedback(state.secret, entry.code);
    if (feedback.exact !== entry.exact || feedback.partial !== entry.partial || entry.solved !== cbSolved(feedback)) return false;
    used[entry.seat] += 1;
    if (entry.solved) solved.add(entry.seat);
    previousRound = entry.round;
    previousSeat = index;
  }
  // A seat guesses in every round until it is done, so its n-th guess belongs to round n.
  if (!seats.every((seat) => state.log.filter((entry) => entry.seat === seat).every((entry, position) => entry.round === position + 1))) return false;
  const active = seats.filter((seat) => !solved.has(seat) && used[seat] < CB_MAX_GUESSES);
  if (state.result) {
    if (active.length > 0 || state.round !== previousRound || previousRound < 1 || Object.values(state.pending).some(Boolean)) return false;
    const finishes = seats.map((seat) => ({ seat, guesses: used[seat], solved: solved.has(seat) }));
    return sameJson(state.result, { gameType: 'codebreaker', seats, variant: state.options.variant, secret: state.secret,
      guesses: Object.fromEntries(finishes.map((entry) => [entry.seat, entry.guesses])),
      solved: finishes.filter((entry) => entry.solved).map((entry) => entry.seat), winners: cbWinners(finishes),
      rounds: previousRound });
  }
  // An unfinished match is collecting the round after the last resolved one, from active seats only.
  return active.length > 0 && state.round === previousRound + 1
    && seats.every((seat) => !state.pending[seat] || active.includes(seat));
}
