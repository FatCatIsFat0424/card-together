import { extname, join, resolve } from 'node:path';
import type { BotWorkerConfig } from './bots/search/search-worker-pool';

export type DatabaseEngine = 'json' | 'sqlite';

export interface DatabaseConfig {
  readonly engine: DatabaseEngine;
  /** Absolute path of the database file; media and replays live beside it. */
  readonly path: string;
}

const DATABASE_FILES = { json: 'database.json', sqlite: 'database.sqlite' } as const satisfies Record<DatabaseEngine, string>;

/**
 * `DATABASE_ENGINE` selects storage and defaults to json. `DATABASE_PATH` (relative to the cwd) must
 * carry the engine's extension, so a JSON database is never opened as SQLite or the reverse.
 */
export function parseDatabaseConfig(engine: string | undefined, path: string | undefined, defaultDirectory: string): DatabaseConfig {
  const selected = engine === undefined || engine === '' ? 'json' : engine;
  if (selected !== 'json' && selected !== 'sqlite') throw new Error('DATABASE_ENGINE must be json or sqlite.');
  const resolved = path ? resolve(path) : join(defaultDirectory, DATABASE_FILES[selected]);
  const extension = selected === 'json' ? '.json' : '.sqlite';
  if (extname(resolved) !== extension) {
    throw new Error(`DATABASE_PATH must end with ${extension} when DATABASE_ENGINE is ${selected}.`);
  }
  return { engine: selected, path: resolved };
}

/**
 * Developer-only Sevens deal (`SEVENS_DEV_PRESET=near-slay`): every suit starts laid from 2 to Q so the first
 * plays close rows. Unset or empty means normal games; any other value, or any value in production, stops startup.
 */
export function parseSevensDevPreset(value: string | undefined, production: boolean): boolean {
  if (value === undefined || value === '') return false;
  if (value !== 'near-slay') throw new Error('SEVENS_DEV_PRESET must be near-slay or unset.');
  if (production) throw new Error('SEVENS_DEV_PRESET is for development only; unset it in production.');
  return true;
}

/** Parses comma-separated browser origins, rejecting paths, credentials, and non-HTTP schemes. */
export function parseAllowedOrigins(value: string): string[] {
  const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) throw new Error('CLIENT_ORIGIN must list at least one origin.');
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CLIENT_ORIGIN entry "${origin}" is not a valid URL.`);
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin) {
      throw new Error(`CLIENT_ORIGIN entry "${origin}" must be an origin such as https://example.com.`);
    }
  }
  return origins;
}

export const BOT_WORKER_DEFAULTS: BotWorkerConfig = { workers: 2, memoryMb: 128, queueLimit: 32 };

const BOT_WORKER_LIMITS = {
  BOT_WORKERS: { min: 0, max: 8 },
  BOT_WORKER_MEMORY_MB: { min: 32, max: 1024 },
  BOT_SEARCH_QUEUE: { min: 0, max: 1024 },
} as const;

function parseBounded(name: keyof typeof BOT_WORKER_LIMITS, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const { min, max } = BOT_WORKER_LIMITS[name];
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

/**
 * Search-bot worker pool: `BOT_WORKERS` threads (0 turns the pool off), each capped at
 * `BOT_WORKER_MEMORY_MB` of V8 old-generation heap, with `BOT_SEARCH_QUEUE` tasks allowed to wait.
 * Unset or empty values use the defaults; anything else that is not an in-range integer stops startup.
 */
export function parseBotWorkerConfig(
  workers: string | undefined, memoryMb: string | undefined, queueLimit: string | undefined,
): BotWorkerConfig {
  return {
    workers: parseBounded('BOT_WORKERS', workers, BOT_WORKER_DEFAULTS.workers),
    memoryMb: parseBounded('BOT_WORKER_MEMORY_MB', memoryMb, BOT_WORKER_DEFAULTS.memoryMb),
    queueLimit: parseBounded('BOT_SEARCH_QUEUE', queueLimit, BOT_WORKER_DEFAULTS.queueLimit),
  };
}
