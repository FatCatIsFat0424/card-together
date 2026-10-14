import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopItemId } from '@shared/types';
import { SHOP_ITEMS } from '@shared/constants';
import { createJsonRepository } from '../../src/database/json-repository';
import type { AccountRecord, Repository } from '../../src/database/repository';
import { emptyDocument } from '../../src/database/schema';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const account: AccountRecord = {
  id: 'shop-owner', username: 'shop_owner', usernameNormalized: 'shop_owner', nickname: 'Owner',
  color: '#123456', avatar: 'cat', avatarImage: null, seatBackground: null,
  tableBackground: null, tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100,
  matchesPublic: false, coins: 1000, createdAt: 1, updatedAt: 1,
  passwordHash: `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`,
};

describe('permanent shop item transactions', () => {
  let directory: string;
  let path: string;
  let repository: Repository;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shop-items-'));
    path = join(directory, 'database.json');
    repository = await createJsonRepository(path);
  });
  afterEach(async () => {
    vi.mocked(rename).mockClear();
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  it.each(SHOP_ITEMS)('charges the catalog price for $id and shares legacy border ownership', async (item) => {
    await repository.createAccount(account);
    const updated = await repository.purchaseShopItem(account.id, item.id, 2);
    expect(updated).toMatchObject({ coins: 1000 - item.price, coinRevision: 1, updatedAt: 2 });
    if (item.type === 'avatarBorder') {
      expect(updated?.ownedAvatarBorders).toEqual([item.id]);
      expect(updated?.ownedShopItems).toBeUndefined();
      expect(await repository.purchaseAvatarBorder(account.id, item.id, 3)).toEqual(updated);
    } else {
      expect(updated?.ownedShopItems).toEqual([item.id]);
      expect(updated?.ownedAvatarBorders).toBeUndefined();
    }
    expect(updated?.cardBackStyle).toBeUndefined();
    expect(updated?.nameplate).toBeUndefined();
    expect(await repository.purchaseShopItem(account.id, item.id, 3)).toEqual(updated);
  });

  it('serializes concurrent retries and competing purchases, then retains ownership after reopening', async () => {
    await repository.createAccount({ ...account, coins: 200 });
    await Promise.all(Array.from({ length: 6 }, () => repository.purchaseShopItem(account.id, 'card-back-aurora', 2)));
    expect(await repository.getAccountById(account.id)).toMatchObject({
      coins: 80, coinRevision: 1, ownedShopItems: ['card-back-aurora'],
    });
    const results = await Promise.allSettled([
      repository.purchaseShopItem(account.id, 'copper', 3),
      repository.purchaseShopItem(account.id, 'seat-tide', 3),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1]).toMatchObject({ reason: { code: 'INSUFFICIENT_COINS' } });
    await repository.close();
    repository = await createJsonRepository(path);
    const restored = await repository.getAccountById(account.id);
    expect(restored).toMatchObject({ coins: 30, coinRevision: 2,
      ownedAvatarBorders: ['copper'], ownedShopItems: ['card-back-aurora'] });
    expect(await repository.purchaseShopItem(account.id, 'card-back-aurora', 4)).toEqual(restored);
  });

  it('rolls back failed purchase and equipment saves without losing the uploaded artwork', async () => {
    const image = `${'a'.repeat(64)}.png`;
    const initial = { ...account, cardBack: image, tableBackground: image, seatBackground: image };
    await repository.createAccount(initial);
    const saved = await readFile(path, 'utf8');
    vi.mocked(rename).mockRejectedValueOnce(new Error('Disk full'));
    await expect(repository.purchaseShopItem(account.id, 'card-back-aurora', 2)).rejects.toThrow('Disk full');
    expect(await readFile(path, 'utf8')).toBe(saved);
    expect(await repository.getAccountById(account.id)).toEqual(initial);
    const purchased = (await repository.purchaseShopItem(account.id, 'card-back-aurora', 3))!;
    vi.mocked(rename).mockRejectedValueOnce(new Error('Equipment save failed'));
    await expect(repository.updateProfile(account.id, { ...purchased, cardBackStyle: 'card-back-aurora' }, 4))
      .rejects.toThrow('Equipment save failed');
    expect(await repository.getAccountById(account.id)).toEqual(purchased);
    const equipped = (await repository.updateProfile(account.id, { ...purchased, cardBackStyle: 'card-back-aurora' }, 5))!;
    expect(equipped).toMatchObject({ cardBack: image, tableBackground: image, seatBackground: image,
      cardBackStyle: 'card-back-aurora', coins: 880, coinRevision: 1 });
    expect(await repository.updateProfile(account.id, { ...equipped, cardBackStyle: null }, 6))
      .toMatchObject({ cardBack: image, cardBackStyle: null, coins: 880 });
  });

  it('enforces equipment ownership and slot types independently of the service', async () => {
    await repository.createAccount(account);
    await expect(repository.updateProfile(account.id, { ...account, nameplate: 'nameplate-aurora' }, 2))
      .rejects.toMatchObject({ code: 'SHOP_ITEM_NOT_OWNED' });
    const owned = (await repository.purchaseShopItem(account.id, 'card-back-aurora', 2))!;
    await expect(repository.updateProfile(account.id, { ...owned, nameplate: 'card-back-aurora' } as unknown as AccountRecord, 3))
      .rejects.toMatchObject({ code: 'INVALID_SHOP_ITEM' });
    expect(await repository.getAccountById(account.id)).toEqual(owned);
  });

  it('keeps older accounts readable and rejects purchases without coins', async () => {
    const { coins: _coins, ...legacy } = account;
    await repository.createAccount(legacy);
    await expect(repository.purchaseShopItem(account.id, 'card-back-aurora', 2))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_COINS' });
    await expect(repository.purchaseShopItem(account.id, 'missing' as ShopItemId, 2))
      .rejects.toMatchObject({ code: 'INVALID_SHOP_ITEM' });
    expect(await repository.purchaseShopItem('missing-account', 'card-back-aurora', 2)).toBeNull();
    await repository.close();
    repository = await createJsonRepository(path);
    expect(await repository.getAccountById(account.id)).toEqual(legacy);
  });

  it.each([
    { ownedShopItems: ['unknown'] },
    { ownedShopItems: ['cat'] },
    { ownedShopItems: ['card-back-aurora', 'card-back-aurora'] },
    { ownedShopItems: 'card-back-aurora' },
    { nameplate: 'nameplate-aurora' },
    { ownedShopItems: ['card-back-aurora'], tableBackgroundStyle: 'card-back-aurora' },
    { ownedShopItems: ['table-tide'], seatBackgroundStyle: 'seat-tide' },
    { ownedShopItems: ['nameplate-aurora'], cardBackStyle: 'nameplate-aurora' },
  ])('rejects malformed account fields at startup: %j', async (invalid) => {
    await repository.close();
    await writeFile(path, JSON.stringify({ ...emptyDocument(), accounts: [{ ...account, ...invalid }] }));
    await expect(createJsonRepository(path)).rejects.toThrow();
  });
});
