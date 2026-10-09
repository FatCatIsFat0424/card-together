import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsonRepository } from '../../src/database/json-repository';
import type { AccountRecord, MatchRecord, Repository } from '../../src/database/repository';
import { emptyDocument } from '../../src/database/schema';

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

describe('JSON repository', () => {
  let directory: string;
  let path: string;
  let repository: Repository | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-db-test-'));
    path = join(directory, 'database.json');
  });
  afterEach(async () => {
    await repository?.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('should serialize concurrent writes and preserve every committed account after reopening', async () => {
    repository = await createJsonRepository(path);
    const accounts = Array.from({ length: 12 }, (_, index) => account(`player_${index}`));
    await Promise.all(accounts.map((entry) => repository!.createAccount(entry)));
    await repository.close();
    repository = await createJsonRepository(path);
    for (const entry of accounts) expect(await repository.getAccountById(entry.id)).toEqual(entry);
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(4);
  });

  it('should enforce case-normalized uniqueness atomically during concurrent registration', async () => {
    repository = await createJsonRepository(path);
    const results = await Promise.allSettled([
      repository.createAccount(account('Alice')),
      repository.createAccount(account('alice')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await repository.searchAccounts('alice', '')).toHaveLength(1);
  });

  it('should return detached values and exclude credentials from public search results', async () => {
    repository = await createJsonRepository(path);
    const entry = account('alice');
    await repository.createAccount(entry);
    const first = await repository.getAccountById(entry.id);
    Object.assign(first!, { nickname: 'tampered' });
    expect((await repository.getAccountById(entry.id))?.nickname).toBe('alice');
    expect(await repository.searchAccounts('alice', '')).toEqual([
      expect.not.objectContaining({ passwordHash: expect.anything() }),
    ]);
  });

  it('should refuse corrupt and unsupported documents without modifying the file', async () => {
    for (const content of [
      '{broken',
      JSON.stringify({ schemaVersion: 99 }),
      JSON.stringify({ schemaVersion: 1, accounts: [] }),
    ]) {
      await writeFile(path, content);
      await expect(createJsonRepository(path)).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe(content);
    }
  });

  it('should preserve prior state after a rejected write and allow subsequent writes', async () => {
    repository = await createJsonRepository(path);
    const alice = account('alice');
    await repository.createAccount(alice);
    await expect(repository.createAccount({ ...account('bob'), color: 'bad' })).rejects.toThrow();
    expect(await repository.getAccountByUsername('bob')).toBeNull();
    await repository.createAccount(account('charlie'));
    expect(await repository.getAccountByUsername('charlie')).not.toBeNull();
  });

  it('should prevent simultaneous adapters from overwriting each other', async () => {
    repository = await createJsonRepository(path);
    await expect(createJsonRepository(path)).rejects.toMatchObject({ code: 'DATABASE_IN_USE' });
    await repository.close();
    repository = await createJsonRepository(path);
    expect(await repository.loadRuntime()).toBeNull();
  });

  it('should atomically revoke sessions on password change and reject in-flight stale logins', async () => {
    repository = await createJsonRepository(path);
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

  it('should persist runtime and deduplicated match history in the same write', async () => {
    repository = await createJsonRepository(path);
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
    repository = await createJsonRepository(path);
    expect(await repository.loadRuntime()).toEqual(snapshot);
    expect(await repository.listMatches(players[0].id)).toEqual([match]);
    expect(await repository.listMatches('unrelated')).toEqual([]);
  });

  it('should reject runtime player identities that have no durable account', async () => {
    repository = await createJsonRepository(path);
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
    repository = await createJsonRepository(path);
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
    const saved = await readFile(path, 'utf8');
    const newHash = PASSWORD_HASH.replace('ab'.repeat(16), '12'.repeat(16));
    vi.mocked(rename).mockRejectedValueOnce(
      Object.assign(new Error('Disk full'), { code: 'ENOSPC' }),
    );
    await expect(repository.changePassword(alice.id, PASSWORD_HASH, newHash, 200)).rejects.toThrow(
      'Disk full',
    );
    expect(await readFile(path, 'utf8')).toBe(saved);
    expect(await readdir(directory)).toEqual(['database.json']);
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
    repository = await createJsonRepository(path);
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
    await writeFile(path, JSON.stringify({ ...emptyDocument(), accounts }));
    repository = await createJsonRepository(path);
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
    await writeFile(path, JSON.stringify({ ...emptyDocument(), accounts }));
    repository = await createJsonRepository(path);
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
    await writeFile(path, JSON.stringify({ ...emptyDocument(), accounts }));
    repository = await createJsonRepository(path);
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
    await writeFile(path, JSON.stringify({ ...emptyDocument(), accounts }));
    repository = await createJsonRepository(path);
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
    repository = await createJsonRepository(path);
    const alice = await repository.createAccount(account('alice'));
    const media = `${'c'.repeat(64)}.webp`;
    const created = await repository.createEmojis(alice.id,
      ['one', 'two', 'three'].map((name) => ({ name, mediaId: media })), 100);
    const saved = await readFile(path, 'utf8');
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('Disk full'), { code: 'ENOSPC' }));

    await expect(repository.deleteEmojis(alice.id, created.map((emoji) => emoji.id))).rejects.toThrow('Disk full');

    expect(await readFile(path, 'utf8')).toBe(saved);
    expect(await repository.listEmojis(alice.id)).toEqual(created);
    expect(await repository.deleteEmojis(alice.id, [created[0].id, created[2].id]))
      .toEqual([created[0].id, created[2].id]);
    expect((await repository.listEmojis(alice.id)).map((emoji) => emoji.name)).toEqual(['two']);
  });
});
