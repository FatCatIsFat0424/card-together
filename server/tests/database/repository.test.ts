import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountRecord, MatchRecord, Repository } from '../../src/database/repository';
import { emptyDocument } from '../../src/database/schema';
import { CURRENT_SCHEMA_VERSION } from '../../src/database/migrations';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import * as players from '../../src/managers/player-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, rename: vi.fn(original.rename) };
});

const PASSWORD_HASH = `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`;

function account(username: string): AccountRecord {
  return {
    id: randomUUID(),
    username,
    usernameNormalized: username.toLowerCase(),
    nickname: username,
    color: '#123456',
    avatar: 'cat',
    avatarImage: null,
    tableBackground: null,
    tableBackgroundOpacity: 100,
    cardBack: null,
    cardBackOpacity: 100,
    matchesPublic: false,
    passwordHash: PASSWORD_HASH,
    createdAt: 100,
    updatedAt: 100,
  };
}

const PROFILE_DEFAULTS = { avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100, matchesPublic: false };

function match(id: string, accounts: readonly AccountRecord[], finishedAt: number): MatchRecord {
  return {
    id,
    accountIds: accounts.map((entry) => entry.id),
    finishedAt,
    roomCode: 'ABC123',
    result: {
      gameType: 'bridge',
      contract: { level: 1, suit: 'nt', declarer: 'N' },
      declarerTeamTricks: 7,
      defenderTeamTricks: 6,
      requiredTricks: 7,
      declarerTeamWins: true,
    },
  };
}

describe.each(REPOSITORY_ADAPTERS)('$name repository', (adapter) => {
  let directory: string;
  let path: string;
  let repository: Repository | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-db-test-'));
    path = join(directory, adapter.fileName);
  });
  afterEach(async () => {
    await repository?.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('should debit permanent borders once, serialize overspending and retain purchases after reopening', async () => {
    repository = await adapter.open(path);
    const alice = { ...account('alice'), coins: 200 };
    await repository.createAccount(alice);
    await Promise.all(Array.from({ length: 5 }, () => repository!.purchaseAvatarBorder(alice.id, 'cat', 101)));
    expect(await repository.getAccountById(alice.id)).toMatchObject({
      coins: 50, coinRevision: 1, ownedAvatarBorders: ['cat'],
    });
    const results = await Promise.allSettled([
      repository.purchaseAvatarBorder(alice.id, 'copper', 102),
      repository.purchaseAvatarBorder(alice.id, 'silver', 102),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    await repository.close();
    repository = await adapter.open(path);
    expect(await repository.getAccountById(alice.id)).toMatchObject({
      coins: 0, coinRevision: 2, ownedAvatarBorders: ['cat', 'copper'],
    });
    await expect(repository.purchaseAvatarBorder(alice.id, 'cat', 103)).resolves.toMatchObject({ coins: 0 });
  });

  it('should leave balance and inventory intact when purchase persistence fails', async () => {
    repository = await adapter.open(path);
    const alice = { ...account('alice'), coins: 50 };
    await repository.createAccount(alice);
    const saved = await adapter.persisted(path);
    adapter.failNextCommit(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }));
    await expect(repository.purchaseAvatarBorder(alice.id, 'copper', 101)).rejects.toThrow('Disk full');
    expect(await adapter.persisted(path)).toBe(saved);
    expect(await repository.getAccountById(alice.id)).toEqual(alice);
    await expect(repository.purchaseAvatarBorder(alice.id, 'copper', 102)).resolves.toMatchObject({
      coins: 0, ownedAvatarBorders: ['copper'],
    });
  });

  it('should reject malformed inventories and equipment without changing older accounts', async () => {
    repository = await adapter.open(path);
    const alice = account('alice');
    await repository.createAccount(alice);
    await expect(repository.purchaseAvatarBorder(alice.id, 'copper', 101))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_COINS' });
    for (const invalid of [
      { ownedAvatarBorders: ['unknown'] }, { ownedAvatarBorders: ['cat', 'cat'] },
      { avatarBorder: 'gold' }, { coinRevision: -1 },
    ]) {
      await expect(repository.createAccount({ ...account('bob'), ...invalid } as AccountRecord)).rejects.toThrow();
    }
    await repository.close();
    repository = await adapter.open(path);
    expect(await repository.getAccountById(alice.id)).toEqual(alice);
  });

  it('should serialize concurrent writes and preserve every committed account after reopening', async () => {
    repository = await adapter.open(path);
    const accounts = Array.from({ length: 12 }, (_, index) => account(`player_${index}`));
    await Promise.all(accounts.map((entry) => repository!.createAccount(entry)));
    await repository.close();
    repository = await adapter.open(path);
    for (const entry of accounts) expect(await repository.getAccountById(entry.id)).toEqual(entry);
    expect((await adapter.readDocument(path)).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('should enforce case-normalized uniqueness atomically during concurrent registration', async () => {
    repository = await adapter.open(path);
    const results = await Promise.allSettled([
      repository.createAccount(account('Alice')),
      repository.createAccount(account('alice')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await repository.searchAccounts('alice', '')).toHaveLength(1);
  });

  it('should return detached values and exclude credentials from public search results', async () => {
    repository = await adapter.open(path);
    const entry = account('alice');
    await repository.createAccount(entry);
    const first = await repository.getAccountById(entry.id);
    Object.assign(first!, { nickname: 'tampered' });
    expect((await repository.getAccountById(entry.id))?.nickname).toBe('alice');
    expect(await repository.searchAccounts('alice', '')).toEqual([
      expect.not.objectContaining({ passwordHash: expect.anything() }),
    ]);
  });

  it('should preserve prior state after a rejected write and allow subsequent writes', async () => {
    repository = await adapter.open(path);
    const alice = account('alice');
    await repository.createAccount(alice);
    await expect(repository.createAccount({ ...account('bob'), color: 'bad' })).rejects.toThrow();
    expect(await repository.getAccountByUsername('bob')).toBeNull();
    await repository.createAccount(account('charlie'));
    expect(await repository.getAccountByUsername('charlie')).not.toBeNull();
  });

  it('should prevent simultaneous adapters from overwriting each other', async () => {
    repository = await adapter.open(path);
    await expect(adapter.open(path)).rejects.toMatchObject({ code: 'DATABASE_IN_USE' });
    await repository.close();
    repository = await adapter.open(path);
    expect(await repository.loadRuntime()).toBeNull();
  });

  it('should atomically revoke sessions on password change and reject in-flight stale logins', async () => {
    repository = await adapter.open(path);
    const alice = account('alice');
    await repository.createAccount(alice);
    const session = {
      tokenHash: 'ab'.repeat(32),
      accountId: alice.id,
      createdAt: 100,
      expiresAt: 1000,
    };
    expect(await repository.createSession(session, PASSWORD_HASH)).toBe(true);
    const newHash = PASSWORD_HASH.replace('ab'.repeat(16), '12'.repeat(16));
    expect(await repository.changePassword(alice.id, PASSWORD_HASH, newHash, 200)).toBe(true);
    expect(await repository.getSession(session.tokenHash)).toBeNull();
    expect(await repository.createSession(session, PASSWORD_HASH)).toBe(false);
    expect(await repository.changePassword(alice.id, PASSWORD_HASH, newHash, 201)).toBe(false);
  });

  it('retains last-seen history through multiple tabs, restart, cleanup and reopening without refreshing offline players', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      repository = await adapter.open(path, { now: () => now });
      const alice = await repository.createAccount(account('alice'));
      const legacy = await repository.createAccount(account('legacy'));
      let runtime = await createRuntimeCoordinator(repository);
      await runtime.mutate(() => {
        players.attachPlayer('tab-one', players.toPlayerInfo(alice));
        players.attachPlayer('tab-two', players.toPlayerInfo(alice));
      });
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(1_000);
      now = 2_000;
      await runtime.mutate(() => players.markDisconnected('tab-one'));
      expect(players.getPlayerState(alice.id)?.connectionStatus).toBe('connected');
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(2_000);
      now = 3_000;
      await runtime.mutate(() => players.markDisconnected('tab-two'));
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(3_000);
      now = 30_000;
      await runtime.mutate(() => {});
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(3_000);
      await repository.close();
      repository = await adapter.open(path, { now: () => now });
      runtime = await createRuntimeCoordinator(repository);
      expect(players.getPlayerState(alice.id)?.disconnectedAt).toBe(3_000);
      await runtime.mutate(() => {});
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(3_000);
      await runtime.mutate(() => players.removePlayer(alice.id));
      await repository.close();
      repository = await adapter.open(path, { now: () => now });
      expect((await repository.loadRuntime())?.players).toEqual([]);
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(3_000);
      expect(await repository.getAccountById(legacy.id)).not.toHaveProperty('lastSeenAt');
      expect((await repository.searchAccounts('alice', ''))[0]).not.toHaveProperty('lastSeenAt');
    } finally {
      vi.restoreAllMocks();
      players.restorePlayers([], true);
    }
  });

  it('preserves activity across a long outage while granting a fresh reconnection grace period', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      repository = await adapter.open(path, { now: () => now });
      const alice = await repository.createAccount(account('alice'));
      let runtime = await createRuntimeCoordinator(repository);
      await runtime.mutate(() => players.attachPlayer('tab-one', players.toPlayerInfo(alice)));
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(1_000);
      await repository.close();
      now = 31 * 86_400_000;
      repository = await adapter.open(path, { now: () => now });
      runtime = await createRuntimeCoordinator(repository);
      expect(players.getPlayerState(alice.id)?.disconnectedAt).toBe(now);
      expect(players.getExpiredPlayers(60_000)).toEqual([]);
      await runtime.mutate(() => {});
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(1_000);
      await repository.close();
      repository = await adapter.open(path, { now: () => now });
      runtime = await createRuntimeCoordinator(repository);
      await runtime.mutate(() => players.removePlayer(alice.id));
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(1_000);
      now += 1_000;
      await runtime.mutate(() => players.attachPlayer('tab-two', players.toPlayerInfo(alice)));
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(now);
      now += 1_000;
      await runtime.mutate(() => players.markDisconnected('tab-two'));
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(now);
    } finally {
      vi.restoreAllMocks();
      players.restorePlayers([], true);
    }
  });

  it('never decreases last-seen time when a clock moves backwards or an older disconnected snapshot is saved', async () => {
    let now = 1_000;
    repository = await adapter.open(path, { now: () => now });
    const alice = await repository.createAccount(account('alice'));
    const snapshot = { players: [{ info: players.toPlayerInfo(alice), currentRoomCode: null,
      disconnectedAt: null as number | null }], rooms: [], games: [], chat: [] };
    await repository.saveRuntime(snapshot);
    now = 500;
    await repository.saveRuntime(snapshot);
    snapshot.players[0].disconnectedAt = 200;
    await repository.saveRuntime(snapshot);
    expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(1_000);
    snapshot.players[0].disconnectedAt = 1_100;
    await repository.saveRuntime(snapshot);
    expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(1_100);
  });

  it('rolls back runtime, history and last-seen together after a durable write failure and recovers on retry', async () => {
    let now = 1_000;
    try {
      repository = await adapter.open(path, { now: () => now });
      const accounts = ['alice', 'bravo', 'charlie', 'delta'].map(account);
      for (const entry of accounts) await repository.createAccount(entry);
      const runtime = await createRuntimeCoordinator(repository);
      const alice = accounts[0];
      await runtime.mutate(() => players.attachPlayer('tab-one', players.toPlayerInfo(alice)));
      const before = await repository.loadRuntime();
      const saved = await adapter.persisted(path);
      now = 2_000;
      adapter.failNextCommit(new Error('Disk full'));
      await expect(runtime.mutate(() => players.updatePlayerInfo({ ...players.toPlayerInfo(alice), nickname: 'Uncommitted' })))
        .rejects.toThrow('Disk full');
      expect(runtime.snapshot()).toEqual(before);
      expect(await repository.loadRuntime()).toEqual(before);
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(1_000);
      expect(await adapter.persisted(path)).toBe(saved);
      const completed = match('last-seen-match', accounts, 2_000);
      adapter.failNextCommit(new Error('Disk full'));
      await expect(repository.saveRuntime(runtime.snapshot(), [completed])).rejects.toThrow('Disk full');
      expect(await repository.listMatches(alice.id)).toEqual([]);
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(1_000);
      await repository.saveRuntime(runtime.snapshot(), [completed]);
      expect((await repository.getAccountById(alice.id))?.lastSeenAt).toBe(2_000);
      expect(await repository.listMatches(alice.id)).toEqual([completed]);
      expect(await adapter.otherFiles(directory)).toEqual([]);
    } finally {
      players.restorePlayers([], true);
    }
  });

  it.each([null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid last-seen timestamps: %s', async (lastSeenAt) => {
    repository = await adapter.open(path);
    await expect(repository.createAccount({ ...account('alice'), lastSeenAt } as AccountRecord)).rejects.toThrow();
    expect(await repository.getAccountByUsername('alice')).toBeNull();
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid runtime activity overrides without publishing history: %s', async (lastSeenAt) => {
    repository = await adapter.open(path);
    const alice = await repository.createAccount(account('alice'));
    await expect(repository.saveRuntime({
      players: [{ info: players.toPlayerInfo(alice), currentRoomCode: null, disconnectedAt: 100, lastSeenAt }],
      rooms: [], games: [], chat: [],
    })).rejects.toThrow();
    expect(await repository.loadRuntime()).toBeNull();
    expect(await repository.getAccountById(alice.id)).not.toHaveProperty('lastSeenAt');
  });

  it('should persist runtime and deduplicated match history in the same write', async () => {
    repository = await adapter.open(path);
    const players = ['alice', 'bravo', 'charlie', 'delta'].map(account);
    for (const player of players) await repository.createAccount(player);
    const snapshot = { players: [], rooms: [], games: [], chat: [] };
    const match = {
      id: randomUUID(),
      roomCode: 'ABC123',
      accountIds: players.map((player) => player.id),
      finishedAt: 500,
      result: {
        gameType: 'bridge' as const,
        contract: { level: 1 as const, suit: 'nt' as const, declarer: 'N' as const },
        declarerTeamTricks: 7,
        defenderTeamTricks: 6,
        requiredTricks: 7,
        declarerTeamWins: true,
      },
    };
    await repository.saveRuntime(snapshot, [match]);
    await repository.saveRuntime(snapshot, [match]);
    await repository.close();
    repository = await adapter.open(path);
    expect(await repository.loadRuntime()).toEqual(snapshot);
    expect(await repository.listMatches(players[0].id)).toEqual([match]);
    expect(await repository.listMatches('unrelated')).toEqual([]);
  });

  it('should retain only the latest 100 matches while preserving smaller limits', async () => {
    repository = await adapter.open(path);
    const players = ['alice', 'bravo', 'charlie', 'delta'].map(account);
    for (const player of players) await repository.createAccount(player);
    const matches = Array.from({ length: 125 }, (_, index) => match(`history-${index}`, players, index));
    await repository.saveRuntime({ players: [], rooms: [], games: [], chat: [] }, matches);
    const expected = matches.slice(-100).reverse();
    expect(await repository.listMatches(players[0].id)).toEqual(expected);
    expect(await repository.listMatches(players[0].id, 1)).toEqual(expected.slice(0, 1));
    expect(await repository.listMatches(players[0].id, 100)).toEqual(expected.slice(0, 100));
    expect(await repository.listMatches(players[0].id, 0)).toEqual([]);
    expect(await repository.listMatches('unrelated')).toEqual([]);
    expect((await adapter.readDocument(path)).matches).toHaveLength(100);
  });

  it('should reject runtime player identities that have no durable account', async () => {
    repository = await adapter.open(path);
    await expect(
      repository.saveRuntime({
        players: [
          {
            info: {
              id: 'unknown-account',
              username: 'unknown',
              nickname: 'Unknown',
              color: '#123456',
              avatar: 'cat',
              avatarImage: null,
            },
            currentRoomCode: null,
            disconnectedAt: 100,
          },
        ],
        rooms: [],
        games: [],
        chat: [],
      }),
    ).rejects.toThrow('invalid references');
    expect(await repository.loadRuntime()).toBeNull();
  });

  it('should preserve warmed account and session indexes when an atomic rename fails', async () => {
    repository = await adapter.open(path);
    const alice = account('alice');
    await repository.createAccount(alice);
    const session = {
      tokenHash: 'ab'.repeat(32),
      accountId: alice.id,
      createdAt: 100,
      expiresAt: 1000,
    };
    await repository.createSession(session, PASSWORD_HASH);
    expect(await repository.getAccountById(alice.id)).toEqual(alice);
    expect(await repository.getAccountByUsername('alice')).toEqual(alice);
    expect(await repository.getSession(session.tokenHash)).toEqual(session);
    const saved = await adapter.persisted(path);
    const newHash = PASSWORD_HASH.replace('ab'.repeat(16), '12'.repeat(16));
    adapter.failNextCommit(
      Object.assign(new Error('Disk full'), { code: 'ENOSPC' }),
    );
    await expect(repository.changePassword(alice.id, PASSWORD_HASH, newHash, 200)).rejects.toThrow(
      'Disk full',
    );
    expect(await adapter.persisted(path)).toBe(saved);
    expect(await adapter.otherFiles(directory)).toEqual([]);
    expect(await repository.getAccountById(alice.id)).toEqual(alice);
    expect(await repository.getAccountByUsername('alice')).toEqual(alice);
    expect(await repository.getSession(session.tokenHash)).toEqual(session);
    expect(await repository.changePassword(alice.id, PASSWORD_HASH, newHash, 200)).toBe(true);
    expect((await repository.getAccountById(alice.id))?.passwordHash).toBe(newHash);
    expect((await repository.getAccountByUsername('alice'))?.passwordHash).toBe(newHash);
    expect(await repository.getSession(session.tokenHash)).toBeNull();
    expect(await repository.createSession(session, PASSWORD_HASH)).toBe(false);
  });

  it('should publish updated profiles only after successful validation and keep both lookup keys consistent', async () => {
    repository = await adapter.open(path);
    const alice = account('alice');
    await repository.createAccount(alice);
    await repository.getAccountById(alice.id);
    await repository.getAccountByUsername('alice');
    await expect(
      repository.updateProfile(
        alice.id,
        { ...PROFILE_DEFAULTS, nickname: 'Invalid', color: 'broken', avatar: 'fox' },
        200,
      ),
    ).rejects.toThrow();
    expect(await repository.getAccountById(alice.id)).toEqual(alice);
    expect(await repository.getAccountByUsername('alice')).toEqual(alice);
    const updated = await repository.updateProfile(
      alice.id,
      { ...PROFILE_DEFAULTS, nickname: 'Updated', color: '#abcdef', avatar: 'fox' },
      201,
    );
    expect(await repository.getAccountById(alice.id)).toEqual(updated);
    expect(await repository.getAccountByUsername('alice')).toEqual(updated);
    expect((await repository.searchAccounts('updated', ''))[0].nickname).toBe('Updated');
  });

  it('should preserve friendship ordering, ownership checks and isolation across index refreshes', async () => {
    const accounts = ['alice', 'bravo', 'charlie'].map(account);
    await adapter.seed(path, { ...emptyDocument(), accounts });
    repository = await adapter.open(path);
    const [alice, bravo, charlie] = accounts;
    const first = {
      id: 'first',
      requesterId: alice.id,
      recipientId: bravo.id,
      status: 'pending' as const,
      createdAt: 100,
      updatedAt: 100,
    };
    const second = {
      id: 'second',
      requesterId: charlie.id,
      recipientId: alice.id,
      status: 'pending' as const,
      createdAt: 100,
      updatedAt: 100,
    };
    await repository.createFriendship(first);
    await repository.createFriendship(second);
    const friends = await repository.listFriendships(alice.id);
    expect(friends.map((entry) => entry.id)).toEqual(['first', 'second']);
    Object.assign(friends[0], { status: 'accepted', recipientId: charlie.id });
    expect(await repository.getFriendship('first')).toEqual(first);
    await expect(
      repository.createFriendship({
        ...first,
        requesterId: bravo.id,
        recipientId: alice.id,
        id: 'reverse',
      }),
    ).rejects.toMatchObject({ code: 'FRIENDSHIP_EXISTS' });
    await expect(
      repository.createFriendship({
        ...second,
        id: 'first',
        requesterId: bravo.id,
        recipientId: charlie.id,
      }),
    ).rejects.toThrow();
    expect(await repository.getFriendship('first')).toEqual(first);
    expect(await repository.acceptFriendship('first', charlie.id)).toBeNull();
    expect(await repository.acceptFriendship('first', bravo.id)).toMatchObject({
      status: 'accepted',
    });
    expect(await repository.deleteFriendship('first', alice.id, 'pending')).toBe(false);
    expect(await repository.deleteFriendship('first', alice.id, 'accepted')).toBe(true);
    expect(await repository.getFriendship('first')).toBeNull();
    expect((await repository.listFriendships(alice.id)).map((entry) => entry.id)).toEqual([
      'second',
    ]);
    expect(await repository.listFriendships(bravo.id)).toEqual([]);
  });

  it('should keep stable history ordering and update membership when a match is replaced', async () => {
    const accounts = ['alice', 'bravo', 'charlie', 'delta', 'edgar'].map(account);
    await adapter.seed(path, { ...emptyDocument(), accounts });
    repository = await adapter.open(path);
    const original = accounts.slice(0, 4);
    const snapshot = { players: [], rooms: [], games: [], chat: [] };
    await repository.saveRuntime(snapshot, [
      match('first', original, 100),
      match('second', original, 100),
      match('newest', original, 200),
    ]);
    const history = await repository.listMatches(accounts[0].id);
    expect(history.map((entry) => entry.id)).toEqual(['newest', 'first', 'second']);
    const result = history[0].result;
    if (result.gameType !== 'bridge') throw new Error('Expected a Bridge result');
    Object.assign(result.contract, { level: 7 });
    (history[0].accountIds as string[]).splice(0, 1);
    expect((await repository.listMatches(accounts[0].id))[0]).toEqual(
      match('newest', original, 200),
    );
    const replacement = match('second', accounts.slice(1), 300);
    await repository.saveMatch(replacement);
    expect((await repository.listMatches(accounts[0].id)).map((entry) => entry.id)).toEqual([
      'newest',
      'first',
    ]);
    expect(await repository.listMatches(accounts[4].id)).toEqual([replacement]);
    expect((await repository.listMatches(accounts[1].id, 1)).map((entry) => entry.id)).toEqual([
      'second',
    ]);
    await repository.saveRuntime(snapshot, [
      match('same-batch', original, 400),
      match('same-batch', original, 500),
    ]);
    expect(
      (await repository.listMatches(accounts[0].id)).filter((entry) => entry.id === 'same-batch'),
    ).toEqual([match('same-batch', original, 500)]);
  });

  it('should roll back staged runtime and match replacements together without poisoning history indexes', async () => {
    const accounts = ['alice', 'bravo', 'charlie', 'delta'].map(account);
    await adapter.seed(path, { ...emptyDocument(), accounts });
    repository = await adapter.open(path);
    const original = match('board', accounts, 100);
    await repository.saveMatch(original);
    expect(await repository.listMatches(accounts[0].id)).toEqual([original]);
    const replacement = match('board', accounts, 200);
    await expect(
      repository.saveRuntime(
        {
          players: [
            {
              info: {
                id: 'unknown',
                username: 'unknown',
                nickname: 'Unknown',
                color: '#123456',
                avatar: 'cat',
                avatarImage: null,
              },
              currentRoomCode: null,
              disconnectedAt: 100,
            },
          ],
          rooms: [],
          games: [],
          chat: [],
        },
        [replacement],
      ),
    ).rejects.toThrow();
    expect(await repository.loadRuntime()).toBeNull();
    expect(await repository.listMatches(accounts[0].id)).toEqual([original]);
    await repository.saveRuntime({ players: [], rooms: [], games: [], chat: [] }, [replacement]);
    expect(await repository.listMatches(accounts[0].id)).toEqual([replacement]);
  });

  it('should preserve search order, exclusion and slice limits when stopping after enough matches', async () => {
    const accounts = Array.from({ length: 65 }, (_, index) => account(`player_${index}`));
    await adapter.seed(path, { ...emptyDocument(), accounts });
    repository = await adapter.open(path);
    expect(
      (await repository.searchAccounts('PLAYER', accounts[1].id, 2)).map((entry) => entry.id),
    ).toEqual([accounts[0].id, accounts[2].id]);
    expect(await repository.searchAccounts('PLAYER', '', -1)).toEqual([]);
    expect(await repository.searchAccounts('PLAYER', '', Number.NaN)).toEqual([]);
    expect(await repository.searchAccounts('PLAYER', '', 0.9)).toEqual([]);
    expect(await repository.searchAccounts('PLAYER', '', 2.9)).toHaveLength(2);
    expect(await repository.searchAccounts('PLAYER', '', Infinity)).toHaveLength(50);
    expect(await repository.searchAccounts('missing', '')).toEqual([]);
  });

  it('should delete a batch of emoji all-or-nothing when persistence fails', async () => {
    repository = await adapter.open(path);
    const alice = await repository.createAccount(account('alice'));
    const media = `${'c'.repeat(64)}.webp`;
    const created = await repository.createEmojis(alice.id,
      ['one', 'two', 'three'].map((name) => ({ name, mediaId: media })), 100);
    const saved = await adapter.persisted(path);
    adapter.failNextCommit(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }));

    await expect(repository.deleteEmojis(alice.id, created.map((emoji) => emoji.id))).rejects.toThrow('Disk full');

    expect(await adapter.persisted(path)).toBe(saved);
    expect(await repository.listEmojis(alice.id)).toEqual(created);
    expect(await repository.deleteEmojis(alice.id, [created[0].id, created[2].id]))
      .toEqual([created[0].id, created[2].id]);
    expect((await repository.listEmojis(alice.id)).map((emoji) => emoji.name)).toEqual(['two']);
  });
});
