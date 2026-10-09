import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsonRepository } from '../../src/database/json-repository';
import type { AccountRecord, Repository } from '../../src/database/repository';
import { createFriendService } from '../../src/social/friend-service';
import type { FriendService } from '../../src/social/friend-service';

const STORED_PASSWORD_HASH = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;

function account(id: string, username: string): AccountRecord {
  return {
    id,
    username,
    usernameNormalized: username.toLowerCase(),
    passwordHash: STORED_PASSWORD_HASH,
    nickname: `${username} nickname`,
    color: '#2563eb',
    avatar: 'cat',
    avatarImage: null,
    tableBackground: null,
    tableBackgroundOpacity: 100,
    cardBack: null,
    cardBackOpacity: 100,
    matchesPublic: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('friend service', () => {
  let directory: string;
  let filePath: string;
  let repository: Repository;
  let friends: FriendService;

  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-friends-'));
    filePath = join(directory, 'database.json');
    repository = await createJsonRepository(filePath);
    await repository.createAccount(account('alice-id', 'Alice'));
    await repository.createAccount(account('bob-id', 'Bob'));
    await repository.createAccount(account('carol-id', 'Carol'));
    friends = createFriendService(repository);
  });

  afterEach(async (): Promise<void> => {
    vi.restoreAllMocks();
    await repository?.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('should request, accept, persist and remove a friendship for both players', async () => {
    const requested = await friends.request('alice-id', '  BOB  ');
    expect(requested.success).toBe(true);
    if (!requested.success) throw new Error('Expected friend request');
    const request = requested.data;
    expect(await friends.list('alice-id')).toEqual({
      friends: [], incoming: [], outgoing: [request],
    });
    expect(await friends.list('bob-id')).toEqual({
      friends: [], incoming: [request], outgoing: [],
    });
    expect(await friends.accept('bob-id', request.id)).toEqual({ success: true, data: null });
    expect(await friends.list('alice-id')).toEqual({
      friends: [request.recipient], incoming: [], outgoing: [],
    });
    expect(await friends.list('bob-id')).toEqual({
      friends: [request.requester], incoming: [], outgoing: [],
    });

    await repository.close();
    repository = await createJsonRepository(filePath);
    friends = createFriendService(repository);
    expect((await friends.list('alice-id')).friends).toEqual([request.recipient]);
    expect(await friends.remove('bob-id', 'alice-id')).toEqual({ success: true, data: null });
    expect((await friends.list('alice-id')).friends).toEqual([]);
    expect((await friends.list('bob-id')).friends).toEqual([]);
  });

  it('should display the latest nickname, color and avatar without exposing credentials', async () => {
    const requested = await friends.request('alice-id', 'bob');
    if (!requested.success) throw new Error('Expected friend request');
    await repository.updateProfile('bob-id', {
      nickname: 'New nickname', color: '#ff0000', avatar: 'fox',
      avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100, matchesPublic: false,
    }, 2);
    const pending = await friends.list('alice-id');
    expect(pending.outgoing[0].recipient).toEqual({
      id: 'bob-id', username: 'Bob', nickname: 'New nickname', color: '#ff0000', avatar: 'fox',
      avatarImage: null,
    });
    await friends.accept('bob-id', requested.data.id);
    const accepted = await friends.list('alice-id');
    expect(accepted.friends).toEqual([pending.outgoing[0].recipient]);
    expect(JSON.stringify({ requested, pending, accepted })).not.toContain('passwordHash');
    expect(JSON.stringify({ requested, pending, accepted })).not.toContain(STORED_PASSWORD_HASH);
    expect(JSON.stringify({ requested, pending, accepted })).not.toContain('usernameNormalized');
  });

  it('should let the requester cancel and the recipient decline pending requests', async () => {
    for (const actor of ['alice-id', 'bob-id']) {
      const requested = await friends.request('alice-id', 'bob');
      if (!requested.success) throw new Error('Expected friend request');
      expect(await friends.dismiss(actor, requested.data.id)).toEqual({ success: true, data: null });
      expect((await friends.list('alice-id')).outgoing).toEqual([]);
      expect((await friends.list('bob-id')).incoming).toEqual([]);
    }
  });

  it('should only let the recipient accept a pending request', async () => {
    const requested = await friends.request('alice-id', 'bob');
    if (!requested.success) throw new Error('Expected friend request');
    for (const actor of ['alice-id', 'carol-id']) {
      expect(await friends.accept(actor, requested.data.id)).toMatchObject({
        success: false, status: 404,
      });
    }
    expect((await friends.list('bob-id')).incoming).toHaveLength(1);
    expect(await friends.accept('bob-id', requested.data.id)).toMatchObject({ success: true });
    expect(await friends.accept('bob-id', requested.data.id)).toMatchObject({
      success: false, status: 404,
    });
  });

  it('should reject unrelated deletions and request deletion after acceptance', async () => {
    const requested = await friends.request('alice-id', 'bob');
    if (!requested.success) throw new Error('Expected friend request');
    expect(await friends.dismiss('carol-id', requested.data.id)).toMatchObject({
      success: false, status: 404,
    });
    await friends.accept('bob-id', requested.data.id);
    expect(await friends.dismiss('alice-id', requested.data.id)).toMatchObject({
      success: false, status: 404,
    });
    expect(await friends.remove('carol-id', 'bob-id')).toMatchObject({
      success: false, status: 404,
    });
    expect((await friends.list('alice-id')).friends).toHaveLength(1);
  });

  it('should atomically allow one of simultaneous duplicate or crossed requests', async () => {
    const results = await Promise.all([
      friends.request('alice-id', 'bob'),
      friends.request('alice-id', 'bob'),
      friends.request('bob-id', 'alice'),
    ]);
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(results.filter(result => !result.success)).toEqual([
      expect.objectContaining({ success: false, status: 409 }),
      expect.objectContaining({ success: false, status: 409 }),
    ]);
    expect(await repository.listFriendships('alice-id')).toHaveLength(1);
    expect(await repository.listFriendships('bob-id')).toHaveLength(1);
  });

  it('should not cancel a friendship when an acceptance races with cancellation', async () => {
    const requested = await friends.request('alice-id', 'bob');
    if (!requested.success) throw new Error('Expected friend request');
    const [accepted, canceled] = await Promise.all([
      friends.accept('bob-id', requested.data.id),
      friends.dismiss('alice-id', requested.data.id),
    ]);
    expect(accepted).toEqual({ success: true, data: null });
    expect(canceled).toMatchObject({ success: false, status: 404 });
    expect((await friends.list('alice-id')).friends).toHaveLength(1);
    expect((await friends.list('bob-id')).friends).toHaveLength(1);
  });

  it('should reject a new request for an accepted friendship', async () => {
    const requested = await friends.request('alice-id', 'bob');
    if (!requested.success) throw new Error('Expected friend request');
    await friends.accept('bob-id', requested.data.id);
    expect(await friends.request('bob-id', 'alice')).toMatchObject({ success: false, status: 409 });
  });

  it('should reject malformed, missing and self targets without creating relationships', async () => {
    for (const username of [undefined, null, {}, ['bob'], '', '   ', 'a'.repeat(65)]) {
      expect(await friends.request('alice-id', username)).toMatchObject({ success: false, status: 400 });
    }
    expect(await friends.request('alice-id', 'missing')).toMatchObject({ success: false, status: 404 });
    expect(await friends.request('alice-id', 'ALICE')).toMatchObject({ success: false, status: 400 });
    expect(await friends.request('missing-id', 'bob')).toMatchObject({ success: false, status: 401 });
    expect(await repository.listFriendships('alice-id')).toEqual([]);
  });

  it('should find only an exact username and return public fields', async () => {
    expect(await friends.findByUsername('  aLiCe ')).toEqual({
      success: true,
      data: {
        id: 'alice-id', username: 'Alice', nickname: 'Alice nickname', color: '#2563eb', avatar: 'cat',
        avatarImage: null,
      },
    });
    expect(await friends.findByUsername('ali')).toEqual({ success: true, data: null });
    expect(await friends.findByUsername({ username: 'Alice' })).toMatchObject({
      success: false, status: 400,
    });
  });

  it('should leave a pending request intact when removing a friendship', async () => {
    await friends.request('alice-id', 'bob');
    expect(await friends.remove('alice-id', 'bob-id')).toMatchObject({ success: false, status: 404 });
    expect((await friends.list('alice-id')).outgoing).toHaveLength(1);
  });

  it('should propagate storage failures instead of reporting a successful request', async () => {
    vi.spyOn(repository, 'createFriendship').mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(friends.request('alice-id', 'bob')).rejects.toThrow('Disk unavailable');
    expect(await repository.listFriendships('alice-id')).toEqual([]);
  });
});
