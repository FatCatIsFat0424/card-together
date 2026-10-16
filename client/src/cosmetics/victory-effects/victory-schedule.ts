import { VICTORY_EFFECTS } from '@shared/constants';
import type { GameSeat, MatchResult, PlayerInfo, PlayerVisibleGameState, VictoryEffectId } from '@shared/types';

export type VictorySeries = typeof VICTORY_EFFECTS[number]['design'];

/** Particle effects run this long; every particle has faded out by then. */
export const VICTORY_DURATION_MS = 3000;
/** The reduced-motion glow stays briefly, without movement. */
export const VICTORY_STATIC_MS = 2000;

export interface VictoryPlay {
  readonly seat: GameSeat;
  readonly effect: VictoryEffectId;
  readonly series: VictorySeries;
}

const SERIES_BY_ID: ReadonlyMap<string, VictorySeries> = new Map(VICTORY_EFFECTS.map((item) => [item.id, item.design]));

export function victorySeries(id: VictoryEffectId): VictorySeries {
  return SERIES_BY_ID.get(id) ?? 'aurora';
}

/** Winning seats whose human player has an effect equipped, once per seat. */
export function victoryPlays(
  winners: readonly GameSeat[],
  playerAt: (seat: GameSeat) => PlayerInfo | null | undefined,
): VictoryPlay[] {
  const plays: VictoryPlay[] = [];
  for (const seat of new Set(winners)) {
    const player = playerAt(seat);
    const effect = player && !player.isBot ? player.victoryEffect : null;
    if (effect && SERIES_BY_ID.has(effect)) plays.push({ seat, effect, series: victorySeries(effect) });
  }
  return plays;
}

/** The visible game's settlement in the shape match history records; Bridge adds its game type. */
export function visibleMatchResult(game: PlayerVisibleGameState): MatchResult | null {
  if (game.gameType === 'bridge') return game.result ? { ...game.result, gameType: 'bridge' } : null;
  return game.result;
}

function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}

/**
 * Identifies one settlement across re-renders and reconnects: the result alone can repeat
 * between matches, so the log length and final timestamp are included.
 */
export function settlementKey(roomCode: string, game: PlayerVisibleGameState): string | null {
  const result = visibleMatchResult(game);
  if (!result) return null;
  const last: unknown = game.log[game.log.length - 1];
  const timestamp = typeof last === 'object' && last !== null && 'timestamp' in last ? String(last.timestamp) : '';
  return `${roomCode}:${game.gameType}:${game.log.length}:${timestamp}:${hash(JSON.stringify(result))}`;
}

/** Minimal storage surface so tests can run without a browser. */
export interface VictoryStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface VictorySchedule {
  /**
   * Milliseconds already played for this settlement, so a remount resumes instead of
   * restarting; null once the effect has finished.
   */
  claim(key: string, now: number, durationMs: number): number | null;
}

const STORE_KEY = 'card-together.victoryEffects';
const MAX_RECORDS = 24;

function readRecords(store: VictoryStore | null): [string, number][] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(STORE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is [string, number] => Array.isArray(entry)
      && typeof entry[0] === 'string' && typeof entry[1] === 'number');
  } catch {
    return [];
  }
}

export function createVictorySchedule(store: VictoryStore | null = null): VictorySchedule {
  const started = new Map<string, number>(readRecords(store));
  return {
    claim(key, now, durationMs) {
      const startedAt = started.get(key);
      if (startedAt === undefined) {
        started.set(key, now);
        while (started.size > MAX_RECORDS) started.delete(started.keys().next().value as string);
        try {
          store?.setItem(STORE_KEY, JSON.stringify([...started]));
        } catch {
          // Persistence only prevents replays after a reload; memory still covers this page.
        }
        return 0;
      }
      const elapsed = now - startedAt;
      return elapsed >= 0 && elapsed < durationMs ? elapsed : null;
    },
  };
}
