import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createJsonRepository } from '../../src/database/json-repository';
import { CURRENT_SCHEMA_VERSION, migrateDocument } from '../../src/database/migrations';
import { emptyDocument, validateDocument } from '../../src/database/schema';

const PASSWORD_HASH = `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`;

it('preserves older zero-balance accounts and validates coin balances and completion receipts', () => {
  const legacy = migrateDocument(version1()) as ReturnType<typeof emptyDocument>;
  expect(legacy.accounts[0].coins).toBeUndefined();
  expect(() => validateDocument(legacy)).not.toThrow();
  const rewarded = { ...legacy, accounts: [{ ...legacy.accounts[0], coins: 10 }], rewardedGameIds: ['game-1'] };
  expect(() => validateDocument(rewarded)).not.toThrow();
  for (const coins of [-1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, null, '10']) {
    expect(() => validateDocument({ ...rewarded, accounts: [{ ...rewarded.accounts[0], coins }] })).toThrow();
  }
  for (const rewardedGameIds of [null, [1], [''], ['game-1', 'game-1']]) {
    expect(() => validateDocument({ ...rewarded, rewardedGameIds })).toThrow();
  }
});
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
  it('backs up v6, recovers historical achievements once, and preserves balances and titles on reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'achievement-migration-'));
    const path = join(directory, 'database.json');
    let repository: Awaited<ReturnType<typeof createJsonRepository>> | undefined;
    try {
      const current = migrateDocument(version2()) as ReturnType<typeof emptyDocument>;
      const legacy = { ...current, schemaVersion: 6,
        accounts: current.accounts.map(({ achievements: _old, ...account }) => ({ ...account, coins: 45,
          ownedAchievementNameplates: ['nameplate-table-traveler'], nameplate: 'nameplate-table-traveler' })),
        matches: Array.from({ length: 110 }, (_, index) => ({ ...current.matches[0], id: `old-${index}` })),
      };
      const original = JSON.stringify(legacy);
      await writeFile(path, original);
      repository = await createJsonRepository(path);
      expect(await readFile(`${path}.v6.bak`, 'utf8')).toBe(original);
      const account = await repository.getAccountById('account-2');
      expect(account).toMatchObject({ coins: 45, achievements: { games: 110, wins: 110 },
        nameplate: 'nameplate-table-traveler', ownedAchievementNameplates: ['nameplate-table-traveler'] });
      expect((await repository.getAchievements('account-2'))!.categories[0]).toMatchObject({ claimed: true,
        items: expect.arrayContaining([{ id: 'hundred-wins', progress: 100 }, { id: 'two-fifty-wins', progress: 110 }]) });
      await repository.close();
      repository = await createJsonRepository(path);
      expect(await repository.getAccountById('account-2')).toEqual(account);
      expect(await readFile(`${path}.v6.bak`, 'utf8')).toBe(original);
    } finally {
      await repository?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should upgrade a v1 document to current defaults without mutating the input', () => {
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
        cardBack: null, cardBackOpacity: 100, matchesPublic: true,
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

  it('should add empty social history to v5 while preserving account visibility choices', () => {
    const current = migrateDocument(version2()) as ReturnType<typeof emptyDocument>;
    const { directMessages: _messages, messageReads: _reads, friendNotifications: _notifications, ...legacy } = current;
    const input = { ...legacy, schemaVersion: 5,
      accounts: legacy.accounts.map((account) => ({ ...account, matchesPublic: false })) };
    const before = structuredClone(input);
    const migrated = migrateDocument(input);
    expect(input).toEqual(before);
    expect(migrated).toEqual({ ...input, schemaVersion: CURRENT_SCHEMA_VERSION,
      directMessages: [], messageReads: [], friendNotifications: [] });
    expect(() => validateDocument(migrated)).not.toThrow();
    const migratedAgain = migrateDocument(migrated);
    expect(migratedAgain).toBe(migrated);
  });

  it('should back up v5 data and persist social tables without changing later account choices', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bridge-social-migration-'));
    const path = join(directory, 'database.json');
    let repository: Awaited<ReturnType<typeof createJsonRepository>> | undefined;
    try {
      const current = migrateDocument(version2()) as ReturnType<typeof emptyDocument>;
      const { directMessages: _messages, messageReads: _reads, friendNotifications: _notifications, ...legacy } = current;
      const original = JSON.stringify({ ...legacy, schemaVersion: 5,
        accounts: legacy.accounts.map((account) => ({ ...account, matchesPublic: false })) });
      await writeFile(path, original);
      repository = await createJsonRepository(path);
      expect(await readFile(`${path}.v5.bak`, 'utf8')).toBe(original);
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
        schemaVersion: CURRENT_SCHEMA_VERSION, directMessages: [], messageReads: [], friendNotifications: [],
      });
      await repository.close();
      repository = await createJsonRepository(path);
      expect((await repository.getAccountById('account-2'))?.matchesPublic).toBe(false);
      expect(await repository.listDirectMessages('account-2')).toEqual([]);
      expect(await repository.listMessageReads('account-2')).toEqual([]);
      expect(await repository.listFriendNotifications('account-2')).toEqual([]);
      expect(await readFile(`${path}.v5.bak`, 'utf8')).toBe(original);
    } finally {
      await repository?.close();
      await rm(directory, { recursive: true, force: true });
    }
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
      expect(await repository.getAccountById('account-1')).toMatchObject({ matchesPublic: true });
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
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    for (const account of migrated.accounts) {
      expect(account).toMatchObject({
        tableBackground: `${'a'.repeat(64)}.webp`, tableBackgroundOpacity: 100,
        cardBack: null, cardBackOpacity: 100,
      });
    }
  });

  it('should make every v4 account history public without changing other data or the input', () => {
    const current = migrateDocument(version2()) as ReturnType<typeof emptyDocument>;
    const input = {
      ...current,
      schemaVersion: 4,
      accounts: current.accounts.map((account, index) => ({
        ...account, matchesPublic: index % 2 === 0, coins: 10,
      })),
      rewardedGameIds: ['game-1'],
    };
    const before = structuredClone(input);
    const migrated = migrateDocument(input);
    expect(input).toEqual(before);
    expect(() => validateDocument(migrated)).not.toThrow();
    expect(migrated).toEqual({
      ...input,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      accounts: input.accounts.map((account) => ({ ...account, matchesPublic: true })),
    });
  });

  it('should back up v4 data and preserve later private choices across reopening', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bridge-migration-'));
    const path = join(directory, 'database.json');
    let repository: Awaited<ReturnType<typeof createJsonRepository>> | undefined;
    try {
      const current = migrateDocument(version2()) as ReturnType<typeof emptyDocument>;
      const original = JSON.stringify({
        ...current, schemaVersion: 4,
        accounts: current.accounts.map((account) => ({ ...account, matchesPublic: false })),
      });
      await writeFile(path, original);
      repository = await createJsonRepository(path);
      for (const account of current.accounts) {
        expect((await repository.getAccountById(account.id))?.matchesPublic).toBe(true);
      }
      expect(await readFile(`${path}.v4.bak`, 'utf8')).toBe(original);
      const account = await repository.getAccountById('account-2');
      await repository.updateProfile('account-2', { ...account!, matchesPublic: false }, 200);
      await repository.close();
      repository = await createJsonRepository(path);
      expect((await repository.getAccountById('account-2'))?.matchesPublic).toBe(false);
      expect((await repository.getAccountById('account-3'))?.matchesPublic).toBe(true);
      expect(await readFile(`${path}.v4.bak`, 'utf8')).toBe(original);
      expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    } finally {
      await repository?.close();
      await rm(directory, { recursive: true, force: true });
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

  it('should retain legacy accounts without seat artwork and validate optional new artwork', () => {
    const migrated = migrateDocument(version2()) as ReturnType<typeof emptyDocument>;
    const withSeatBackground = (seatBackground: unknown): unknown => ({
      ...migrated, accounts: [{ ...migrated.accounts[0], seatBackground }, ...migrated.accounts.slice(1)],
    });
    expect(() => validateDocument(migrated)).not.toThrow();
    expect(() => validateDocument(withSeatBackground(null))).not.toThrow();
    expect(() => validateDocument(withSeatBackground(`${'a'.repeat(64)}.webp`))).not.toThrow();
    expect(() => validateDocument(withSeatBackground('not-a-media-id'))).toThrow();
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
