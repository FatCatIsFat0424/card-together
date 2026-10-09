export const CURRENT_SCHEMA_VERSION = 4;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapArray(value: unknown, update: (entry: JsonObject) => JsonObject): unknown {
  return Array.isArray(value)
    ? value.map((entry: unknown) => (isObject(entry) ? update(entry) : entry))
    : value;
}

function mapValues(value: unknown, update: (entry: JsonObject) => JsonObject): unknown {
  return isObject(value)
    ? Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, isObject(entry) ? update(entry) : entry]),
    )
    : value;
}

function withAvatarImage(player: JsonObject): JsonObject {
  return { ...player, avatarImage: null };
}

/** v2: uploaded avatar/background/match visibility on accounts, custom emoji table. */
function toVersion2(document: JsonObject): JsonObject {
  const runtime = document.runtime;
  return {
    ...document,
    schemaVersion: 2,
    accounts: mapArray(document.accounts, (account) => ({
      ...account,
      avatarImage: null,
      tableBackground: null,
      matchesPublic: false,
    })),
    emojis: [],
    runtime: isObject(runtime)
      ? {
        ...runtime,
        players: mapArray(runtime.players, (entry) => ({
          ...entry,
          info: isObject(entry.info) ? withAvatarImage(entry.info) : entry.info,
        })),
        rooms: mapArray(runtime.rooms, (room) => {
          const info = room.info;
          if (!isObject(info)) return room;
          return {
            ...room,
            info: {
              ...info,
              seats: mapValues(info.seats, (seat) => ({
                ...seat,
                player: isObject(seat.player) ? withAvatarImage(seat.player) : seat.player,
              })),
            },
          };
        }),
        games: mapArray(runtime.games, (game) => ({
          ...game,
          players: mapValues(game.players, withAvatarImage),
        })),
        chat: mapArray(runtime.chat, (room) => ({
          ...room,
          messages: mapArray(room.messages, (message) => ({
            ...message,
            sender: isObject(message.sender) ? withAvatarImage(message.sender) : message.sender,
          })),
        })),
      }
      : runtime,
  };
}

/** v3: game type discriminants on games and match results, room host and abort vote. */
function toVersion3(document: JsonObject): JsonObject {
  const runtime = document.runtime;
  return {
    ...document,
    schemaVersion: 3,
    matches: mapArray(document.matches, (match) => ({
      ...match,
      result: isObject(match.result) ? { ...match.result, gameType: 'bridge' } : match.result,
    })),
    runtime: isObject(runtime)
      ? {
        ...runtime,
        rooms: mapArray(runtime.rooms, (room) => ({
          ...room,
          info: isObject(room.info)
            ? {
              ...room.info,
              hostId: Array.isArray(room.memberIds) ? room.memberIds[0] : undefined,
              abortVote: null,
              abortVoteCooldownUntil: null,
            }
            : room.info,
        })),
        games: mapArray(runtime.games, (game) => ({ ...game, gameType: 'bridge' })),
      }
      : runtime,
  };
}

/** v4: personal card back and image opacity on accounts; defaults keep the existing look. */
function toVersion4(document: JsonObject): JsonObject {
  return {
    ...document,
    schemaVersion: 4,
    accounts: mapArray(document.accounts, (account) => ({
      ...account,
      tableBackgroundOpacity: 100,
      cardBack: null,
      cardBackOpacity: 100,
    })),
  };
}

/** Index i upgrades version i + 1 to i + 2. Append new steps; never edit shipped ones. */
const STEPS: readonly ((document: JsonObject) => JsonObject)[] = [
  toVersion2, toVersion3, toVersion4,
];

/**
 * Upgrades a parsed document of any known older version to CURRENT_SCHEMA_VERSION; returns
 * input untouched if already current; throws on unknown version. Pure (deep-copies).
 */
export function migrateDocument(value: unknown): unknown {
  if (!isObject(value)) throw new Error('Database document must be a JSON object.');
  const version = value.schemaVersion;
  if (version === CURRENT_SCHEMA_VERSION) return value;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 ||
    version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported database schema version: ${String(version)}.`);
  }
  let document = structuredClone(value);
  for (const step of STEPS.slice(version - 1)) document = step(document);
  return document;
}
