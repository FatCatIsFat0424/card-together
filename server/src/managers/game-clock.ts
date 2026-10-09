import { randomUUID } from 'node:crypto';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import type { AnyGameState, GameClock, Seat, TimeControl } from '@shared/types';

export function getTurnSeat(game: AnyGameState): Seat | null {
  if (game.phase === 'scoring') return null;
  if (game.gameType !== 'bridge') return game.currentTurnSeat;
  if (game.phase === 'redeal_pending') return game.redealPendingSeat;
  if (game.phase === 'bidding') return game.bidding?.currentBidderSeat ?? null;
  return game.phase === 'playing' ? game.playing?.currentTurnSeat ?? null : null;
}

function createTurn(game: AnyGameState, clock: GameClock, baseRemainingMs: number, now: number): GameClock['turn'] {
  const seat = getTurnSeat(game);
  // Forced Big Two passes publish an ordinary turn so other seats cannot infer the hand.
  if (!seat) return null;
  const startsAt = Math.max(now, getPresentationEndsAt(game));
  return { id: randomUUID(), seat, startsAt, baseRemainingMs,
    deadline: startsAt + baseRemainingMs + clock.bankRemainingMs[seat] };
}

export function initializeGameClock(
  game: AnyGameState, settings: TimeControl = DEFAULT_TIME_CONTROL, now = Date.now(),
): void {
  const bank = settings.bankSeconds * 1000;
  const clock: GameClock = {
    settings: { ...settings }, bankRemainingMs: { N: bank, E: bank, S: bank, W: bank }, turn: null,
  };
  game.clock = { ...clock, turn: createTurn(game, clock, settings.baseSeconds * 1000, now) };
}

/**
 * Settles only decision time; the next presentation shifts the start without charging the bank.
 * Forced turns offered no decision, so they never charge the bank.
 */
export function advanceGameClock(
  game: AnyGameState, previous: GameClock, sameTurn: boolean, redealt: boolean, now: number, forced = false,
): void {
  if (redealt) {
    initializeGameClock(game, previous.settings, now);
    return;
  }
  const bankRemainingMs = { ...previous.bankRemainingMs };
  const turn = previous.turn;
  const elapsed = turn ? Math.max(0, now - turn.startsAt) : 0;
  if (turn && !forced) bankRemainingMs[turn.seat] = Math.max(0,
    bankRemainingMs[turn.seat] - Math.max(0, elapsed - turn.baseRemainingMs));
  const baseRemainingMs = sameTurn && turn
    ? Math.max(0, turn.baseRemainingMs - elapsed) : previous.settings.baseSeconds * 1000;
  const clock = { ...previous, bankRemainingMs };
  game.clock = { ...clock, turn: createTurn(game, clock, baseRemainingMs, now) };
}
