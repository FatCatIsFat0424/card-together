import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsonRepository } from '../../src/database/json-repository';
import type { AccountRecord, DirectMessageRecord, Repository } from '../../src/database/repository';
import { SOCIAL_HISTORY_RETENTION_MS } from '../../src/database/repository';
import { validateDocument } from '../../src/database/schema';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, rename: vi.fn(original.rename) };
});

const PASSWORD_HASH = `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`;
const MEDIA = `${'a'.repeat(64)}.webp`;
const PROVIDED = `wave-${'a'.repeat(24)}.gif`;

function account(id: string): AccountRecord {
  return {
    id, username: id, usernameNormalized: id, nickname: id, color: '#123456', avatar: 'cat',
    avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100,
    cardBack: null, cardBackOpacity: 100, matchesPublic: false,
    passwordHash: PASSWORD_HASH, createdAt: 100, updatedAt: 100,
  };
}

describe('durable friend messages', () => {
  let directory: string;
  let path: string;
  let repository: Repository;
  let now: number;

  function message(id: string, overrides: Partial<DirectMessageRecord> = {}): DirectMessageRecord {
    return { id, clientId: `client-${id}`, senderId: 'alice', recipientId: 'bob',
      content: 'Hello', timestamp: now, ...overrides };
  }

  async function request(id = 'friend-alice-bob', requesterId = 'alice', recipientId = 'bob'): Promise<void> {
    await repository.createFriendship({ id, requesterId, recipientId, status: 'pending', createdAt: now, updatedAt: now });
  }

  async function friends(): Promise<void> {
    await request();
    await repository.acceptFriendship('friend-alice-bob', 'bob');
  }

  beforeEach(async () => {
    now = SOCIAL_HISTORY_RETENTION_MS * 10;
    directory = await mkdtemp(join(tmpdir(), 'direct-message-db-'));
    path = join(directory, 'database.json');
    repository = await createJsonRepository(path, { now: () => now });
    for (const id of ['alice', 'bob', 'charlie']) await repository.createAccount(account(id));
  });

  afterEach(async () => {
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('requires accepted friendship for new messages and retains private history after removal and reopening', async () => {
    await expect(repository.createDirectMessage(message('one'))).rejects.toMatchObject({ code: 'NOT_FRIENDS' });
    await request();
    await expect(repository.createDirectMessage(message('one'))).rejects.toMatchObject({ code: 'NOT_FRIENDS' });
    await repository.acceptFriendship('friend-alice-bob', 'bob');
    const original = await repository.createDirectMessage(message('one'));
    const visible = await repository.listDirectMessages('bob', 'alice');
    expect(visible).toEqual([original]);
    Object.assign(visible[0], { content: 'Changed' });
    expect(await repository.listDirectMessages('alice')).toEqual([original]);
    expect(await repository.listDirectMessages('charlie')).toEqual([]);
    expect(await repository.listDirectMessages('charlie', 'alice')).toEqual([]);
    await repository.deleteFriendship('friend-alice-bob', 'alice', 'accepted');
    await expect(repository.createDirectMessage(message('two'))).rejects.toMatchObject({ code: 'NOT_FRIENDS' });
    await repository.markDirectMessagesRead('bob', 'alice', 'one');
    await repository.close();
    repository = await createJsonRepository(path, { now: () => now });
    expect(await repository.listDirectMessages('alice', 'bob')).toEqual([original]);
    expect(await repository.listMessageReads('bob')).toEqual([{ accountId: 'bob', otherId: 'alice', messageId: 'one' }]);
  });

  it('deduplicates concurrent sender-scoped retries and rejects conflicting content, recipient and IDs', async () => {
    await friends();
    const original = await repository.createDirectMessage(message('one'));
    const retries = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      repository.createDirectMessage(message(`retry-${index}`, { clientId: original.clientId, timestamp: now + index }))));
    expect(retries).toEqual(Array.from({ length: 5 }, () => original));
    expect(await repository.listDirectMessages('alice')).toHaveLength(1);
    await expect(repository.createDirectMessage({ ...original, content: 'Changed' }))
      .rejects.toMatchObject({ code: 'MESSAGE_CONFLICT' });
    await expect(repository.createDirectMessage({ ...original, recipientId: 'charlie' }))
      .rejects.toMatchObject({ code: 'MESSAGE_CONFLICT' });
    await expect(repository.createDirectMessage({ ...original, clientId: 'other-client' }))
      .rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
    const reply = message('reply', { senderId: 'bob', recipientId: 'alice', clientId: original.clientId });
    await expect(repository.createDirectMessage(reply)).resolves.toEqual(reply);
    await repository.deleteFriendship('friend-alice-bob', 'bob');
    await expect(repository.createDirectMessage(original)).resolves.toEqual(original);
  });

  it('serializes sending against removal using the friendship committed at the write boundary', async () => {
    await friends();
    const sending = repository.createDirectMessage(message('before-removal'));
    const removing = repository.deleteFriendship('friend-alice-bob', 'bob');
    await Promise.all([sending, removing]);
    expect(await repository.listDirectMessages('bob')).toHaveLength(1);
    await friends();
    const results = await Promise.allSettled([
      repository.deleteFriendship('friend-alice-bob', 'bob'),
      repository.createDirectMessage(message('after-removal')),
    ]);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: true });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FRIENDS' } });
    expect(await repository.listDirectMessages('alice')).toHaveLength(1);
  });

  it('orders history chronologically and advances read cursors monotonically, including equal timestamps', async () => {
    await friends();
    await repository.createDirectMessage(message('latest'));
    await repository.createDirectMessage(message('older', { timestamp: now - 1 }));
    await repository.createDirectMessage(message('same-time'));
    expect((await repository.listDirectMessages('bob')).map((entry) => entry.id)).toEqual(['older', 'latest', 'same-time']);
    await Promise.all([
      repository.markDirectMessagesRead('bob', 'alice', 'same-time'),
      repository.markDirectMessagesRead('bob', 'alice', 'older'),
      repository.markDirectMessagesRead('bob', 'alice', 'latest'),
    ]);
    expect(await repository.listMessageReads('bob')).toEqual([{ accountId: 'bob', otherId: 'alice', messageId: 'same-time' }]);
    expect(await repository.listMessageReads('alice')).toEqual([]);
    for (const [accountId, otherId, id] of [
      ['charlie', 'alice', 'same-time'], ['bob', 'charlie', 'same-time'],
      ['alice', 'bob', 'same-time'], ['bob', 'alice', 'missing'],
    ]) await expect(repository.markDirectMessagesRead(accountId, otherId, id))
      .rejects.toMatchObject({ code: 'INVALID_MESSAGE_READ' });
  });

  it('atomically adds one recipient-scoped accepted notification and isolates dismissal', async () => {
    await request();
    expect(await repository.acceptFriendship('friend-alice-bob', 'charlie')).toBeNull();
    expect(await repository.listFriendNotifications('alice')).toEqual([]);
    const results = await Promise.all([
      repository.acceptFriendship('friend-alice-bob', 'bob'),
      repository.acceptFriendship('friend-alice-bob', 'bob'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const notifications = await repository.listFriendNotifications('alice');
    expect(notifications).toEqual([{ id: expect.any(String), accountId: 'alice', actorId: 'bob', createdAt: now }]);
    expect(await repository.listFriendNotifications('bob')).toEqual([]);
    await repository.dismissFriendNotifications('charlie', [notifications[0].id]);
    expect(await repository.listFriendNotifications('alice')).toEqual(notifications);
    await repository.close();
    repository = await createJsonRepository(path, { now: () => now });
    expect(await repository.listFriendNotifications('alice')).toEqual(notifications);
    await repository.dismissFriendNotifications('alice', [notifications[0].id]);
    expect(await repository.listFriendNotifications('alice')).toEqual([]);
  });

  it('filters expired messages, cursors and notifications before durable pruning and survives reopening', async () => {
    await friends();
    await repository.createDirectMessage(message('expires'));
    await repository.markDirectMessagesRead('bob', 'alice', 'expires');
    now += 1;
    await repository.createDirectMessage(message('retained'));
    now += SOCIAL_HISTORY_RETENTION_MS - 1;
    expect((await repository.listDirectMessages('alice')).map((entry) => entry.id)).toEqual(['retained']);
    expect(await repository.listMessageReads('bob')).toEqual([]);
    expect(await repository.listFriendNotifications('alice')).toEqual([]);
    await expect(repository.markDirectMessagesRead('bob', 'alice', 'expires'))
      .rejects.toMatchObject({ code: 'INVALID_MESSAGE_READ' });
    await expect(repository.createDirectMessage(message('retry', { clientId: 'client-expires' })))
      .rejects.toMatchObject({ code: 'MESSAGE_EXPIRED' });
    const before = JSON.parse(await readFile(path, 'utf8'));
    expect(before.directMessages).toHaveLength(2);
    await repository.pruneSocialHistory(now);
    const after = JSON.parse(await readFile(path, 'utf8'));
    expect(after.directMessages.map((entry: DirectMessageRecord) => entry.id)).toEqual(['retained']);
    expect(after.messageReads).toEqual([]);
    expect(after.friendNotifications).toEqual([]);
    await repository.close();
    repository = await createJsonRepository(path, { now: () => now });
    expect((await repository.listDirectMessages('bob')).map((entry) => entry.id)).toEqual(['retained']);
  });

  it('keeps retained read cursors during pruning and rejects invalid pruning times without deletion', async () => {
    await friends();
    await repository.createDirectMessage(message('read'));
    await repository.markDirectMessagesRead('bob', 'alice', 'read');
    const before = await readFile(path, 'utf8');
    await expect(repository.pruneSocialHistory(NaN)).rejects.toThrow('Invalid social history pruning time');
    expect(await readFile(path, 'utf8')).toBe(before);
    await repository.pruneSocialHistory(now);
    expect(await repository.listMessageReads('bob')).toHaveLength(1);
  });

  it('rolls back acceptance and its notification together after a persistence failure', async () => {
    await request();
    const before = await readFile(path, 'utf8');
    vi.mocked(rename).mockRejectedValueOnce(new Error('Disk full'));
    await expect(repository.acceptFriendship('friend-alice-bob', 'bob')).rejects.toThrow('Disk full');
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(await repository.getFriendship('friend-alice-bob')).toMatchObject({ status: 'pending' });
    expect(await repository.listFriendNotifications('alice')).toEqual([]);
    await repository.acceptFriendship('friend-alice-bob', 'bob');
    expect(await repository.listFriendNotifications('alice')).toHaveLength(1);
  });

  it('publishes neither message, cursor nor dismissal when persistence fails and permits subsequent retries', async () => {
    await friends();
    const before = await readFile(path, 'utf8');
    vi.mocked(rename).mockRejectedValueOnce(new Error('Disk full'));
    await expect(repository.createDirectMessage(message('one'))).rejects.toThrow('Disk full');
    expect(await repository.listDirectMessages('alice')).toEqual([]);
    expect(await readFile(path, 'utf8')).toBe(before);
    await repository.createDirectMessage(message('one'));
    vi.mocked(rename).mockRejectedValueOnce(new Error('Disk full'));
    await expect(repository.markDirectMessagesRead('bob', 'alice', 'one')).rejects.toThrow('Disk full');
    expect(await repository.listMessageReads('bob')).toEqual([]);
    await repository.markDirectMessagesRead('bob', 'alice', 'one');
    const notifications = await repository.listFriendNotifications('alice');
    vi.mocked(rename).mockRejectedValueOnce(new Error('Disk full'));
    await expect(repository.dismissFriendNotifications('alice', [notifications[0].id])).rejects.toThrow('Disk full');
    expect(await repository.listFriendNotifications('alice')).toEqual(notifications);
    await repository.close();
    repository = await createJsonRepository(path, { now: () => now });
    expect(await repository.listDirectMessages('bob')).toHaveLength(1);
    expect(await repository.listMessageReads('bob')).toHaveLength(1);
  });

  it('preserves expired records on disk when pruning persistence fails', async () => {
    await friends();
    await repository.createDirectMessage(message('expires'));
    await repository.markDirectMessagesRead('bob', 'alice', 'expires');
    const before = await readFile(path, 'utf8');
    now += SOCIAL_HISTORY_RETENTION_MS;
    vi.mocked(rename).mockRejectedValueOnce(new Error('Disk full'));
    await expect(repository.pruneSocialHistory(now)).rejects.toThrow('Disk full');
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(await repository.listDirectMessages('alice')).toEqual([]);
    await repository.pruneSocialHistory(now);
    expect(JSON.parse(await readFile(path, 'utf8')).directMessages).toEqual([]);
  });

  it('accepts Unicode text, resolved inline emoji, personal stickers and provided stickers', async () => {
    await friends();
    const contents = [
      { content: '你好 🙂' },
      { content: ':wave: :cat:', emojis: { cat: MEDIA }, providedEmojis: { wave: PROVIDED } },
      { content: '', sticker: { id: 'personal-1', name: 'cat', mediaId: MEDIA } },
      { content: '', providedSticker: { name: 'wave', file: PROVIDED } },
      { content: '', shopSticker: 'table-thanks' as const },
    ];
    for (const [index, content] of contents.entries()) {
      const record = message(`media-${index}`, content);
      expect(await repository.createDirectMessage(record)).toEqual(record);
    }
    await repository.close();
    repository = await createJsonRepository(path, { now: () => now });
    expect(await repository.listDirectMessages('bob')).toHaveLength(5);
  });

  it('rejects malformed content and media with the strict room-chat invariants', async () => {
    await friends();
    const sticker = { id: 'personal-1', name: 'cat', mediaId: MEDIA };
    const invalid: unknown[] = [
      { content: '', shopSticker: 'unknown' }, { content: '', shopSticker: '../outside.svg' },
      { content: 'text', shopSticker: 'table-hello' }, { content: '', shopSticker: 'table-hello', sticker },
      { content: '', shopSticker: 'table-hello', emojis: {} },
      { content: '' }, { content: ' ' }, { content: ' untrimmed ' }, { content: 'a'.repeat(501) },
      { senderId: 'bob', recipientId: 'bob' }, { clientId: '' }, { clientId: 'a'.repeat(129) },
      { timestamp: now + 1 }, { timestamp: now - SOCIAL_HISTORY_RETENTION_MS },
      { content: 'text', sticker }, { content: '', sticker, emojis: {} },
      { content: '', sticker, providedSticker: { name: 'wave', file: PROVIDED } },
      { content: '', sticker: { ...sticker, mediaId: '../outside.png' } },
      { content: '', sticker: { ...sticker, unexpected: 'value' } },
      { content: '', providedSticker: { name: 'wave', file: '../outside.gif' } },
      { emojis: null }, { emojis: { x: MEDIA } }, { emojis: { cat: 'https://example.com/x.gif' } },
      { providedEmojis: { wave: '../outside.gif' } },
      { emojis: { wave: MEDIA }, providedEmojis: { wave: PROVIDED } },
      { emojis: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`emoji${i}`, MEDIA])) },
      { system: true }, { audience: 'observers' },
    ];
    for (const patch of invalid) await expect(repository.createDirectMessage({ ...message('invalid'), ...patch as object }))
      .rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
    expect(await repository.listDirectMessages('alice')).toEqual([]);
  });

  it('rejects corrupt social references and duplicate request/read records without replacing the file', async () => {
    await friends();
    await repository.createDirectMessage(message('one'));
    await repository.markDirectMessagesRead('bob', 'alice', 'one');
    const saved = JSON.parse(await readFile(path, 'utf8'));
    for (const patch of [
      { directMessages: [{ ...saved.directMessages[0], senderId: 'unknown' }] },
      { directMessages: [saved.directMessages[0], { ...saved.directMessages[0], id: 'duplicate-client' }] },
      { messageReads: [saved.messageReads[0], saved.messageReads[0]] },
      { messageReads: [{ accountId: 'alice', otherId: 'bob', messageId: 'one' }] },
      { messageReads: [{ accountId: 'bob', otherId: 'alice', messageId: 'missing' }] },
      { friendNotifications: [{ ...saved.friendNotifications[0], actorId: 'unknown' }] },
      { friendNotifications: [saved.friendNotifications[0], saved.friendNotifications[0]] },
    ]) expect(() => validateDocument({ ...saved, ...patch })).toThrow();
    await repository.close();
    const corrupted = JSON.stringify({ ...saved, messageReads: [{ accountId: 'bob', otherId: 'alice', messageId: 'missing' }] });
    await writeFile(path, corrupted);
    await expect(createJsonRepository(path, { now: () => now })).rejects.toThrow('invalid references');
    expect(await readFile(path, 'utf8')).toBe(corrupted);
  });
});
