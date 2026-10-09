import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonRepository } from '../../src/database/json-repository';
import type { AccountRecord, Repository } from '../../src/database/repository';

const PASSWORD_HASH = `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`;
const MEDIA = `${'c'.repeat(64)}.webp`;

function account(username: string): AccountRecord {
  return {
    id: randomUUID(), username, usernameNormalized: username, nickname: username,
    color: '#123456', avatar: 'cat', avatarImage: null, tableBackground: null,
    tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100,
    matchesPublic: false, passwordHash: PASSWORD_HASH, createdAt: 100, updatedAt: 100,
  };
}

describe('emoji repository', () => {
  let directory: string;
  let path: string;
  let repository: Repository;
  let alice: AccountRecord;
  let bob: AccountRecord;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-emoji-db-'));
    path = join(directory, 'database.json');
    repository = await createJsonRepository(path);
    alice = await repository.createAccount(account('alice'));
    bob = await repository.createAccount(account('bob'));
  });

  afterEach(async () => {
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('should create, list per account, rename and delete emoji durably', async () => {
    const [wave, cat] = await repository.createEmojis(alice.id,
      [{ name: 'wave', mediaId: MEDIA }, { name: 'cat', mediaId: MEDIA }], 200);
    await repository.createEmojis(bob.id, [{ name: 'wave', mediaId: MEDIA }], 300);
    expect(wave).toMatchObject({ accountId: alice.id, name: 'wave', mediaId: MEDIA, createdAt: 200 });
    expect((await repository.listEmojis(alice.id)).map((emoji) => emoji.name)).toEqual(['wave', 'cat']);

    expect(await repository.renameEmoji(bob.id, wave.id, 'hello')).toBeNull();
    expect(await repository.renameEmoji(alice.id, wave.id, 'hello')).toMatchObject({ name: 'hello' });
    await expect(repository.renameEmoji(alice.id, cat.id, 'hello'))
      .rejects.toMatchObject({ code: 'EMOJI_EXISTS' });
    expect(await repository.deleteEmoji(bob.id, cat.id)).toBe(false);
    expect(await repository.deleteEmoji(alice.id, cat.id)).toBe(true);

    await repository.close();
    repository = await createJsonRepository(path);
    expect((await repository.listEmojis(alice.id)).map((emoji) => emoji.name)).toEqual(['hello']);
    expect(await repository.listEmojis(bob.id)).toHaveLength(1);
  });

  it('should reject duplicate names and the per-account limit all-or-nothing', async () => {
    await repository.createEmojis(alice.id, [{ name: 'wave', mediaId: MEDIA }], 200);
    const before = await readFile(path, 'utf8');
    await expect(repository.createEmojis(alice.id,
      [{ name: 'new_one', mediaId: MEDIA }, { name: 'wave', mediaId: MEDIA }], 300))
      .rejects.toMatchObject({ code: 'EMOJI_EXISTS' });
    await expect(repository.createEmojis(alice.id,
      [{ name: 'twin', mediaId: MEDIA }, { name: 'twin', mediaId: MEDIA }], 300))
      .rejects.toMatchObject({ code: 'EMOJI_EXISTS' });
    const many = Array.from({ length: 300 }, (_, index) => ({ name: `e${index}`, mediaId: MEDIA }));
    await expect(repository.createEmojis(alice.id, many, 300))
      .rejects.toMatchObject({ code: 'EMOJI_LIMIT' });
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(await repository.listEmojis(alice.id)).toHaveLength(1);

    await repository.createEmojis(alice.id, many.slice(0, 299), 300);
    await expect(repository.createEmojis(alice.id, [{ name: 'extra', mediaId: MEDIA }], 400))
      .rejects.toMatchObject({ code: 'EMOJI_LIMIT' });
    expect(await repository.listEmojis(alice.id)).toHaveLength(300);
  });

  it('should refuse emoji for unknown accounts or invalid names', async () => {
    await expect(repository.createEmojis('missing', [{ name: 'wave', mediaId: MEDIA }], 200)).rejects.toThrow();
    await expect(repository.createEmojis(alice.id, [{ name: 'Bad Name', mediaId: MEDIA }], 200)).rejects.toThrow();
    expect(await repository.listEmojis(alice.id)).toEqual([]);
  });

  it('should batch delete only the owner\'s entries and report which were deleted', async () => {
    const mine = await repository.createEmojis(alice.id,
      ['a1', 'a2', 'a3'].map((name) => ({ name, mediaId: MEDIA })), 200);
    const [theirs] = await repository.createEmojis(bob.id, [{ name: 'a1', mediaId: MEDIA }], 200);

    expect(await repository.deleteEmojis(alice.id, [mine[2].id, theirs.id, 'missing', mine[0].id]))
      .toEqual([mine[0].id, mine[2].id]);
    expect(await repository.deleteEmojis(alice.id, [mine[0].id])).toEqual([]);
    expect((await repository.listEmojis(alice.id)).map((emoji) => emoji.name)).toEqual(['a2']);
    expect(await repository.listEmojis(bob.id)).toEqual([theirs]);
    const reopened = JSON.parse(await readFile(path, 'utf8')) as { emojis: { id: string }[] };
    expect(reopened.emojis.map((emoji) => emoji.id).sort()).toEqual([mine[1].id, theirs.id].sort());
  });

  it('should keep relaxed names case-sensitive', async () => {
    const names = ['NEKO-3.v2', 'neko-3.v2', 'FB_IMG_1737436595895'];
    await repository.createEmojis(alice.id, names.map((name) => ({ name, mediaId: MEDIA })), 200);
    expect((await repository.listEmojis(alice.id)).map((emoji) => emoji.name)).toEqual(names);
    await expect(repository.createEmojis(alice.id, [{ name: 'NEKO-3.v2', mediaId: MEDIA }], 300))
      .rejects.toMatchObject({ code: 'EMOJI_EXISTS' });
  });
});
