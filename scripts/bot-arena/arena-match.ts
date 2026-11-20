import { performance } from 'node:perf_hooks';
import { GAME_SEAT_ORDER, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { gameDefinition } from '@shared/games/registry';
import { matchStanding } from '@shared/rules/match-standing';
import { botNickname, playerCountAllowed } from '@shared/rules/seats';
import type { GameOptions, GameSeat, GameType, PlayerInfo } from '@shared/types';
import type { BotAction } from '../../server/src/bots/bot-decisions';
import { seededRandom, seedFromText } from '../../server/src/bots/search/seeded-random';
import * as games from '../../server/src/managers/game-manager';
import { applyAutomatedAction } from '../../server/src/runtime/automated-action';
import { pendingActionSeat, skipPresentation } from '../../server/src/runtime/headless-play';
import type { ArenaBot } from './arena-bots';
import { setRandomSource, withRandomSource } from './arena-random';

export type Side = 'candidate' | 'baseline';

/** Actions per match before it is abandoned as stuck. */
const MAX_STEPS = 100_000;
/** Fallback reasons kept per match; the count is always exact. */
const MAX_REASONS = 5;

export interface SideTally {
  decisions: number;
  totalMs: number;
  maxMs: number;
  /** Decisions that threw, returned nothing, or were rejected, and so played the first legal action. */
  fallbacks: number;
}

export interface SeatOutcome {
  readonly seat: GameSeat;
  readonly side: Side;
  readonly won: boolean;
  readonly score: number | null;
}

export interface MatchRecord {
  readonly pair: number;
  /** The second match of a duplicate pair: same seed, sides exchanged. */
  readonly swapped: boolean;
  /** Null when the match did not finish; `error` then says why. */
  readonly seats: readonly SeatOutcome[] | null;
  readonly error?: string;
  readonly steps: number;
  readonly tally: Readonly<Record<Side, SideTally>>;
  readonly fallbackReasons: readonly string[];
}

/**
 * Seats for a match: every compass seat for fixed four-seat games; flexible games default to the largest
 * allowed count up to four, two facing seats for two players, and numbered seats beyond four.
 */
export function arenaSeats(gameType: GameType, players?: number): readonly GameSeat[] {
  const rules = gameDefinition(gameType).seats;
  let count = players ?? (rules.flexible ? Math.min(4, rules.maxPlayers) : 4);
  while (players === undefined && count > rules.minPlayers && !playerCountAllowed(gameType, count)) count--;
  if (!playerCountAllowed(gameType, count) || (!rules.flexible && count !== 4)) {
    throw new Error(`${gameType} cannot be played by ${count} players.`);
  }
  if (count === 2) return ['N', 'S'];
  if (count === 3) return ['N', 'E', 'S'];
  return count === 4 ? SEAT_ORDER_CLOCKWISE : GAME_SEAT_ORDER.slice(0, count);
}

/**
 * Who plays each seat. Fixed partnerships put each side on one team. Otherwise sides alternate around the
 * table, shifted by one seat per pair so that with three or five seats every split of the table occurs. The
 * swapped match of a pair exchanges every seat, so over a pair each side plays each seat once.
 */
export function seatSides(gameType: GameType, seats: readonly GameSeat[], pair: number, swapped: boolean): Record<GameSeat, Side> {
  const team = gameDefinition(gameType).result.kind === 'team';
  return Object.fromEntries(seats.map((seat, index) => {
    const candidate = team ? (index % 2 === 0) === (pair % 2 === 0) : ((index + pair) % seats.length) % 2 === 0;
    return [seat, candidate !== swapped ? 'candidate' : 'baseline'];
  })) as Record<GameSeat, Side>;
}

function botPlayer(gameType: GameType, seat: GameSeat): PlayerInfo {
  return {
    id: `bot:arena-${seat}`, username: `bot-${seat.toLowerCase()}`, nickname: botNickname(gameType, seat),
    color: '#64748b', avatar: 'bot', avatarImage: null, isBot: true,
  };
}

const emptyTally = (): SideTally => ({ decisions: 0, totalMs: 0, maxMs: 0, fallbacks: 0 });

export interface MatchPlan {
  readonly gameType: GameType;
  readonly seats: readonly GameSeat[];
  readonly pair: number;
  readonly swapped: boolean;
  /** Seeds the deals; both matches of a pair share it. */
  readonly seed: number;
  /** Room options passed to `startGame`. */
  readonly options?: GameOptions;
}

/**
 * Plays one match through the real game managers. Bots see only `getPlayerVisibleState`, as on a live table
 * (a structured clone, as the search worker receives). Presentations are skipped and a pending Big Two
 * forced pass is applied directly without asking a bot.
 */
export function playMatch(plan: MatchPlan, bots: Readonly<Record<Side, ArenaBot>>): MatchRecord {
  const { gameType, seats, pair, swapped, seed } = plan;
  const sides = seatSides(gameType, seats, pair, swapped);
  const code = `ARENA-${pair}-${swapped ? 'B' : 'A'}`;
  const tally: Record<Side, SideTally> = { candidate: emptyTally(), baseline: emptyTally() };
  const fallbackReasons: string[] = [];
  let steps = 0;
  const record = (extra: { seats: readonly SeatOutcome[] | null; error?: string }): MatchRecord =>
    ({ pair, swapped, steps, tally, fallbackReasons, ...extra });

  setRandomSource(seededRandom(seed));
  const players = Object.fromEntries(seats.map((seat) => [seat, botPlayer(gameType, seat)]));
  const started = games.startGame(code, gameType, players, undefined, plan.options);
  if (!started.success) return record({ seats: null, error: `Start failed: ${started.reason}` });
  try {
    for (; steps < MAX_STEPS; steps++) {
      const game = games.getGameState(code);
      if (!game) return record({ seats: null, error: 'The game disappeared.' });
      const result = games.getMatchResult(game);
      if (result) {
        return record({ seats: seats.map((seat) => {
          const standing = matchStanding(result, seat);
          return { seat, side: sides[seat], won: standing?.won ?? false, score: standing?.score ?? null };
        }) });
      }
      skipPresentation(game);
      const seat = pendingActionSeat(game);
      if (!seat) return record({ seats: null, error: `No seat to act in phase ${game.phase}.` });
      const visible = games.getPlayerVisibleState(code, seat);
      if (!visible) return record({ seats: null, error: `No view for ${seat}.` });
      const bot = bots[sides[seat]];
      if (games.isForcedActionPending(game)) {
        const forced = bot.firstLegal(visible);
        if (!forced || !applyAutomatedAction(code, seat, forced).success) {
          return record({ seats: null, error: `The forced action for ${seat} failed.` });
        }
        continue;
      }

      const random = seededRandom(seedFromText(`${seed}:${steps}:${seat}`));
      const view = structuredClone(visible);
      let action: BotAction | null = null;
      let failure: string | null = null;
      const began = performance.now();
      try {
        action = withRandomSource(random, () => bot.decide(view, random));
      } catch (error) {
        failure = `threw ${error instanceof Error ? error.message : String(error)}`;
      }
      const elapsed = performance.now() - began;
      const counts = tally[sides[seat]];
      counts.decisions++;
      counts.totalMs += elapsed;
      counts.maxMs = Math.max(counts.maxMs, elapsed);
      if (action) {
        const applied = applyAutomatedAction(code, seat, action);
        if (!applied.success) failure = `rejected ${action.type}: ${applied.reason ?? 'no reason'}`;
      } else failure ??= 'returned no action';
      if (failure === null) continue;

      counts.fallbacks++;
      if (fallbackReasons.length < MAX_REASONS) fallbackReasons.push(`${sides[seat]} ${seat} (${game.phase}): ${failure}`);
      const fallback = bot.firstLegal(games.getPlayerVisibleState(code, seat) ?? visible);
      const applied = fallback ? applyAutomatedAction(code, seat, fallback) : null;
      if (!applied?.success) return record({ seats: null, error: `No legal fallback for ${seat}: ${applied?.reason ?? 'none'}` });
    }
    return record({ seats: null, error: `Unfinished after ${MAX_STEPS} actions.` });
  } catch (error) {
    return record({ seats: null, error: error instanceof Error ? error.message : String(error) });
  } finally {
    games.removeGame(code);
  }
}
