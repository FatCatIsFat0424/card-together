import { GAME_TYPES } from '@shared/constants';
import type { GameType } from '@shared/types';
import type { DatabaseEngine } from '../../src/config';

export interface RoomPlan {
  readonly gameType: GameType;
  /** Scripted human seats, the first of which hosts. */
  readonly humans: number;
  readonly bots: number;
  readonly spectators: number;
}

export interface LoadPlan {
  readonly rooms: readonly RoomPlan[];
  /** Clients that stay in the lobby and generate social traffic. */
  readonly lobby: number;
}

const SEATS_PER_ROOM = 4;

/**
 * Cycles through every game; every third room seats two humans with two bots, the rest four
 * humans. Every other room gets a spectator. Rooms are dropped when clients run out.
 */
export function planRooms(clients: number, rooms: number, gameTypes: readonly GameType[] = GAME_TYPES): LoadPlan {
  if (!Number.isInteger(clients) || clients < 1) throw new RangeError('Clients must be a positive integer.');
  if (!Number.isInteger(rooms) || rooms < 0) throw new RangeError('Rooms must be a non-negative integer.');
  if (gameTypes.length === 0) throw new RangeError('At least one game type is required.');
  const plans: RoomPlan[] = [];
  let remaining = clients;
  for (let index = 0; index < rooms; index += 1) {
    const wanted = index % 3 === 2 ? 2 : SEATS_PER_ROOM;
    const humans = Math.min(wanted, remaining);
    if (humans === 0) break;
    remaining -= humans;
    plans.push({ gameType: gameTypes[index % gameTypes.length], humans, bots: SEATS_PER_ROOM - humans, spectators: 0 });
  }
  for (let index = 0; index < plans.length && remaining > 0; index += 2) {
    plans[index] = { ...plans[index], spectators: 1 };
    remaining -= 1;
  }
  return { rooms: plans, lobby: remaining };
}

export interface LoadOptions {
  /** Storage under test; a SQLite run imports the generated JSON document first. */
  readonly engine: DatabaseEngine;
  readonly durationSeconds: number;
  readonly clients: number;
  readonly rooms: number;
  readonly accounts: number;
  readonly friendsPerAccount: number;
  readonly matchesPerAccount: number;
  readonly messagesPerAccount: number;
  readonly replays: number;
  readonly templatesPerGame: number;
  readonly thinkMs: readonly [number, number];
  readonly chatEveryMs: readonly [number, number];
  readonly lobbyEveryMs: readonly [number, number];
  readonly socialEveryMs: readonly [number, number];
  readonly reconnectEveryMs: number;
  readonly ackTimeoutMs: number;
  readonly writePhaseSamples: number;
  readonly output: string | null;
}

export const DEFAULT_LOAD_OPTIONS: LoadOptions = {
  engine: 'json', durationSeconds: 600, clients: 100, rooms: 20, accounts: 2_000, friendsPerAccount: 20, matchesPerAccount: 100,
  messagesPerAccount: 5, replays: 1_000, templatesPerGame: 3, thinkMs: [1_000, 3_000], chatEveryMs: [20_000, 60_000],
  lobbyEveryMs: [5_000, 15_000], socialEveryMs: [30_000, 90_000], reconnectEveryMs: 30_000, ackTimeoutMs: 30_000,
  writePhaseSamples: 5, output: null,
};

export const SMOKE_DURATION_SECONDS = 30;

const INTEGER_FLAGS = {
  '--duration': 'durationSeconds', '--clients': 'clients', '--rooms': 'rooms', '--accounts': 'accounts',
  '--friends': 'friendsPerAccount', '--matches': 'matchesPerAccount', '--messages': 'messagesPerAccount',
  '--replays': 'replays', '--templates': 'templatesPerGame', '--reconnect-every-ms': 'reconnectEveryMs',
  '--ack-timeout-ms': 'ackTimeoutMs',
} as const satisfies Record<string, keyof LoadOptions>;

const USAGE = `Options: --smoke (${SMOKE_DURATION_SECONDS} s), --engine json|sqlite, --output <file>, `
  + `${Object.keys(INTEGER_FLAGS).join(', ')} <integer>.`;

/** Parses `bench:load` flags; `--smoke` only shortens the duration unless `--duration` is also given. */
export function parseLoadOptions(args: readonly string[]): LoadOptions {
  const options: { -readonly [Key in keyof LoadOptions]: LoadOptions[Key] } = { ...DEFAULT_LOAD_OPTIONS };
  let smoke = false;
  let durationSet = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--smoke') { smoke = true; continue; }
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value. ${USAGE}`);
    index += 1;
    if (flag === '--output') { options.output = value; continue; }
    if (flag === '--engine') {
      if (value !== 'json' && value !== 'sqlite') throw new Error('--engine must be json or sqlite.');
      options.engine = value;
      continue;
    }
    if (!Object.hasOwn(INTEGER_FLAGS, flag)) throw new Error(`Unknown option ${flag}. ${USAGE}`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer.`);
    const key = INTEGER_FLAGS[flag as keyof typeof INTEGER_FLAGS];
    options[key] = parsed;
    if (key === 'durationSeconds') durationSet = true;
  }
  if (smoke && !durationSet) options.durationSeconds = SMOKE_DURATION_SECONDS;
  if (options.durationSeconds < 1) throw new Error('--duration must be at least 1 second.');
  if (options.clients < 1) throw new Error('--clients must be at least 1.');
  if (options.accounts < options.clients) throw new Error('--accounts must be at least --clients.');
  if (options.ackTimeoutMs < 1_000) throw new Error('--ack-timeout-ms must be at least 1000.');
  if (options.templatesPerGame < 1) throw new Error('--templates must be at least 1.');
  return options;
}
