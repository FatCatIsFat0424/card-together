import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createJsonRepository } from '../../src/database/json-repository';
import { CURRENT_SCHEMA_VERSION, migrateDocument } from '../../src/database/migrations';
import { emptyDocument, validateDocument } from '../../src/database/schema';

const PASSWORD_HASH = `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`;
const V1_PLAYER = {
  id: 'account-1', username: 'alice', nickname: 'Alice', color: '#123456', avatar: 'cat',
};

/** The shape emptyDocument() produced at schema v1, plus one account. */
function version1(runtime: unknown = null): Record<string, unknown> {
  return {
    schemaVersion: 1,
    accounts: [{
      id: 'account-1', username: 'alice', usernameNormalized: 'alice', nickname: 'Alice',
      color: '#123456', avatar: 'cat', passwordHash: PASSWORD_HASH, createdAt: 100, updatedAt: 100,
    }],
    sessions: [],
    friendships: [],
    matches: [],
    runtime,
  };
}

function version1Runtime(): unknown {
  return {
    players: [{ info: V1_PLAYER, currentRoomCode: 'ABC123', disconnectedAt: null }],
    rooms: [{
      info: {
        code: 'ABC123', gameType: 'bridge', status: 'waiting', createdAt: 100,
        seats: {
          N: { player: V1_PLAYER, isReady: false },
          E: { player: null, isReady: false },
          S: { player: null, isReady: false },
          W: { player: null, isReady: false },
        },
      },
      memberIds: ['account-1'],
    }],
    games: [],
    chat: [{
      roomCode: 'ABC123',
      messages: [{ id: 'message-1', sender: V1_PLAYER, content: 'hi', timestamp: 100 }],
    }],
  };
}

describe('database migrations', () => {
  it('should upgrade a v1 document to v2 defaults without mutating the input', () => {
    const input = version1();
    const before = structuredClone(input);
    const migrated = migrateDocument(input);
    expect(input).toEqual(before);
    expect(() => validateDocument(migrated)).not.toThrow();
    expect(migrated).toMatchObject({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      emojis: [],
      accounts: [{
        avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100,
        cardBack: null, cardBackOpacity: 100, matchesPublic: false,
      }],
    });
  });

  it('should add avatarImage to every persisted runtime player', () => {
    const migrated = migrateDocument(version1(version1Runtime()));
    expect(() => validateDocument(migrated)).not.toThrow();
    const runtime = (migrated as { runtime: ReturnType<typeof emptyDocument>['runtime'] }).runtime!;
    expect(runtime.players[0].info.avatarImage).toBeNull();
    expect(runtime.rooms[0].info.seats.N.player?.avatarImage).toBeNull();
    expect(runtime.rooms[0].info.seats.E.player).toBeNull();
    expect(runtime.chat[0].messages[0].sender.avatarImage).toBeNull();
  });

  it('should return a current document untouched and reject unknown versions', () => {
    const current = emptyDocument();
    expect(migrateDocument(current)).toBe(current);
    expect(() => migrateDocument({ ...current, schemaVersion: 99 })).toThrow();
    expect(() => migrateDocument({ ...current, schemaVersion: 0 })).toThrow();
    expect(() => migrateDocument([])).toThrow();
  });

  it('should keep a v1 backup and persist the migrated document on open', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bridge-migration-'));
    const path = join(directory, 'database.json');
    try {
      const original = JSON.stringify(version1(version1Runtime()));
      await writeFile(path, original);
      const repository = await createJsonRepository(path);
      expect(await repository.getAccountById('account-1')).toMatchObject({ matchesPublic: false });
      await repository.close();
      expect(await readFile(`${path}.v1.bak`, 'utf8')).toBe(original);
      expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should upgrade v2 games, match results and rooms to v3', () => {
    const migrated = migrateDocument(version2()) as ReturnType<typeof emptyDocument>;
    expect(() => validateDocument(migrated)).not.toThrow();
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.matches[0].result).toMatchObject({ gameType: 'bridge', requiredTricks: 7 });
    expect(migrated.runtime!.rooms[0].info).toMatchObject({
      hostId: 'account-2', abortVote: null, abortVoteCooldownUntil: null,
    });
    const games = migrateDocument({
      ...version2(), runtime: { ...version2().runtime as object, games: [{ id: 'board' }] },
    }) as { runtime: { games: unknown[] } };
    expect(games.runtime.games[0]).toEqual({ id: 'board', gameType: 'bridge' });
  });

  it('should default v3 accounts to no card back and full image opacity', () => {
    const version3 = migrateDocument(version2()) as Record<string, unknown> & {
      accounts: Record<string, unknown>[];
    };
    const input = {
      ...version3,
      schemaVersion: 3,
      accounts: version3.accounts.map((account) => {
        const { tableBackgroundOpacity: _table, cardBack: _back, cardBackOpacity: _opacity, ...rest } =
          account;
        return { ...rest, tableBackground: `${'a'.repeat(64)}.webp` };
      }),
    };
    const migrated = migrateDocument(input) as ReturnType<typeof emptyDocument>;
    expect(() => validateDocument(migrated)).not.toThrow();
    expect(migrated.schemaVersion).toBe(4);
    for (const account of migrated.accounts) {
      expect(account).toMatchObject({
        tableBackground: `${'a'.repeat(64)}.webp`, tableBackgroundOpacity: 100,
        cardBack: null, cardBackOpacity: 100,
      });
    }
  });

  it('should reject accounts with an invalid card back or opacity', () => {
    const migrated = migrateDocument(version2()) as ReturnType<typeof emptyDocument>;
    const withAccount = (patch: Record<string, unknown>): unknown => ({
      ...migrated, accounts: [{ ...migrated.accounts[0], ...patch }, ...migrated.accounts.slice(1)],
    });
    expect(() => validateDocument(withAccount({ cardBackOpacity: 20 }))).not.toThrow();
    expect(() => validateDocument(withAccount({ cardBack: 'not-a-media-id' }))).toThrow();
    expect(() => validateDocument(withAccount({ cardBackOpacity: 19 }))).toThrow();
    expect(() => validateDocument(withAccount({ tableBackgroundOpacity: 101 }))).toThrow();
    expect(() => validateDocument(withAccount({ cardBackOpacity: undefined }))).toThrow();
  });

  it('should keep a v2 backup when opening a v2 file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bridge-migration-'));
    const path = join(directory, 'database.json');
    try {
      const original = JSON.stringify(version2());
      await writeFile(path, original);
      const repository = await createJsonRepository(path);
      await repository.close();
      expect(await readFile(`${path}.v2.bak`, 'utf8')).toBe(original);
      expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/** A v2 document: four accounts, one bridge match, one waiting room joined by two members. */
function version2(): Record<string, unknown> {
  const ids = ['account-2', 'account-3', 'account-4', 'account-5'];
  const players = ids.map((id) => ({ ...V1_PLAYER, id, username: id.replace('-', '_'), avatarImage: null }));
  return {
    schemaVersion: 2,
    accounts: players.map((player) => ({
      ...player, usernameNormalized: player.username, passwordHash: PASSWORD_HASH,
      tableBackground: null, matchesPublic: false, createdAt: 100, updatedAt: 100,
    })),
    sessions: [],
    friendships: [],
    matches: [{
      id: 'match-1', roomCode: 'ABC123', accountIds: ids, finishedAt: 200,
      result: {
        contract: { level: 1, suit: 'nt', declarer: 'N' }, declarerTeamTricks: 7,
        defenderTeamTricks: 6, requiredTricks: 7, declarerTeamWins: true,
      },
    }],
    emojis: [],
    runtime: {
      players: players.slice(0, 2).map((info) => ({ info, currentRoomCode: 'ABC123', disconnectedAt: null })),
      rooms: [{
        info: {
          code: 'ABC123', gameType: 'bridge', status: 'waiting', createdAt: 100,
          seats: {
            N: { player: players[1], isReady: false }, E: { player: null, isReady: false },
            S: { player: null, isReady: false }, W: { player: null, isReady: false },
          },
        },
        memberIds: ['account-2', 'account-3'],
      }],
      games: [],
      chat: [],
    },
  };
}
