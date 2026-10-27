import { extname, join, resolve } from 'node:path';

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
