import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopItemId } from '@shared/types';
import { EQUIPMENT_SLOTS, NAMEPLATES, SHOP_ITEMS } from '@shared/constants';
import type { EquipmentSlot } from '@shared/constants/shop';
import { toPlayerInfo } from '../../src/managers/player-manager';
import { publicAccount } from '../../src/database/repository';
import { publicProfile } from '../../src/social/friend-service';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
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

describe.each(REPOSITORY_ADAPTERS)('permanent shop item transactions ($name)', (adapter) => {
  let directory: string;
  let path: string;
  let repository: Repository;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'shop-items-'));
    path = join(directory, adapter.fileName);
    repository = await adapter.open(path);
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

  it.each(NAMEPLATES)('requires ownership to equip $id and restores it after reopening', async (item) => {
    await repository.createAccount(account);
    await expect(repository.updateProfile(account.id, { nameplate: item.id }, 2))
      .rejects.toMatchObject({ code: 'SHOP_ITEM_NOT_OWNED' });
    await repository.purchaseShopItem(account.id, item.id, 3);
    await repository.updateProfile(account.id, { nameplate: item.id }, 4);
    await repository.close();
    repository = await adapter.open(path);
    expect(await repository.getAccountById(account.id)).toMatchObject({
      nameplate: item.id, ownedShopItems: [item.id], coins: 1000 - item.price,
    });
    expect(await repository.updateProfile(account.id, { nameplate: null }, 5)).toMatchObject({
      nameplate: null, ownedShopItems: [item.id], coins: 1000 - item.price,
    });
  });

  const NEW_SLOTS = ['cardFaceStyle', 'soundPack', 'chipStyle', 'seatFrame', 'victoryEffect', 'chatFrame'] as const;
  it.each(NEW_SLOTS)('equips every owned %s product of its type only, and persists it', async (slot) => {
    const items = SHOP_ITEMS.filter((item) => item.type === EQUIPMENT_SLOTS[slot]);
    expect(items.length).toBeGreaterThanOrEqual(10);
    await repository.createAccount({ ...account, coins: 10_000 });
    for (const item of items) {
      await expect(repository.updateProfile(account.id, { [slot]: item.id }, 2))
        .rejects.toMatchObject({ code: 'SHOP_ITEM_NOT_OWNED' });
      await repository.purchaseShopItem(account.id, item.id, 3);
      await repository.updateProfile(account.id, { [slot]: item.id }, 4);
    }
    const other = (Object.keys(EQUIPMENT_SLOTS) as EquipmentSlot[]).find((candidate) => candidate !== slot)!;
    await expect(repository.updateProfile(account.id, { [other]: items[0].id }, 5))
      .rejects.toMatchObject({ code: 'INVALID_SHOP_ITEM' });
    await repository.close();
    repository = await adapter.open(path);
    const saved = (await repository.getAccountById(account.id))!;
    expect(saved[slot]).toBe(items.at(-1)!.id);
    expect(publicAccount(saved)[slot]).toBe(items.at(-1)!.id);
  });

  it('shares only public equipment with tables and other players', () => {
    const equipped = { ...account, cardFaceStyle: 'card-face-aurora', soundPack: 'sound-tide', chipStyle: 'chips-dune',
      seatFrame: 'seat-frame-frost', victoryEffect: 'victory-ember', chatFrame: 'chat-frame-lotus' } as const;
    const info = toPlayerInfo(publicAccount(equipped));
    expect(info).toMatchObject({ seatFrame: 'seat-frame-frost', victoryEffect: 'victory-ember', chatFrame: 'chat-frame-lotus' });
    expect(publicProfile(equipped)).toMatchObject({ chatFrame: 'chat-frame-lotus' });
    for (const shared of [info, publicProfile(equipped)]) {
      expect(shared).not.toHaveProperty('cardFaceStyle');
      expect(shared).not.toHaveProperty('soundPack');
      expect(shared).not.toHaveProperty('chipStyle');
    }
    expect(publicProfile(equipped)).not.toHaveProperty('victoryEffect');
  });

  it('accepts public equipment in persisted room identities only for the matching type', () => {
    const snapshot = (player: Record<string, unknown>): unknown => ({
      players: [{ info: { id: 'p1', username: 'p1', nickname: 'P1', color: '#123456', avatar: 'cat', avatarImage: null,
        ...player }, currentRoomCode: null, disconnectedAt: null }],
      rooms: [], games: [], chat: [],
    });
    expect(isRuntimeSnapshot(snapshot({}))).toBe(true);
    expect(isRuntimeSnapshot(snapshot({ seatFrame: 'seat-frame-tide', victoryEffect: 'victory-tide', chatFrame: null })))
      .toBe(true);
    expect(isRuntimeSnapshot(snapshot({ seatFrame: 'victory-tide' }))).toBe(false);
    expect(isRuntimeSnapshot(snapshot({ chatFrame: 'unknown' }))).toBe(false);
  });

  it('purchases and equips in one write, and re-equips an owned product without charging again', async () => {
    await repository.createAccount(account);
    const bought = await repository.purchaseShopItem(account.id, 'card-back-aurora', 2, true);
    expect(bought).toMatchObject({ cardBackStyle: 'card-back-aurora', ownedShopItems: ['card-back-aurora'],
      coins: 1000 - 120, coinRevision: 1 });
    const border = await repository.purchaseShopItem(account.id, 'copper', 3, true);
    expect(border).toMatchObject({ avatarBorder: 'copper', ownedAvatarBorders: ['copper'], coinRevision: 2 });
    // Sticker packs have no slot, so the flag only grants ownership.
    const pack = await repository.purchaseShopItem(account.id, 'stickers-table-talk', 4, true);
    expect(pack).toMatchObject({ ownedShopItems: ['card-back-aurora', 'stickers-table-talk'] });
    expect(Object.keys(EQUIPMENT_SLOTS).filter((slot) => pack?.[slot as EquipmentSlot] !== undefined)).toEqual(['cardBackStyle']);
    await repository.purchaseShopItem(account.id, 'card-back-tide', 5);
    await repository.updateProfile(account.id, { cardBackStyle: 'card-back-tide' }, 6);
    const again = await repository.purchaseShopItem(account.id, 'card-back-aurora', 7, true);
    expect(again).toMatchObject({ cardBackStyle: 'card-back-aurora', coins: pack!.coins - 120, coinRevision: 4 });
  });

  it('leaves the equipment untouched when an equipping purchase fails', async () => {
    await repository.createAccount({ ...account, coins: 10, cardBackStyle: undefined });
    await expect(repository.purchaseShopItem(account.id, 'card-back-aurora', 2, true))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_COINS' });
    expect(await repository.getAccountById(account.id)).toMatchObject({ coins: 10 });
    expect((await repository.getAccountById(account.id))?.cardBackStyle).toBeUndefined();
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
    repository = await adapter.open(path);
    const restored = await repository.getAccountById(account.id);
    expect(restored).toMatchObject({ coins: 30, coinRevision: 2,
      ownedAvatarBorders: ['copper'], ownedShopItems: ['card-back-aurora'] });
    expect(await repository.purchaseShopItem(account.id, 'card-back-aurora', 4)).toEqual(restored);
  });

  it('rolls back failed purchase and equipment saves without losing the uploaded artwork', async () => {
    const image = `${'a'.repeat(64)}.png`;
    const initial = { ...account, cardBack: image, tableBackground: image, seatBackground: image };
    await repository.createAccount(initial);
    const saved = await adapter.persisted(path);
    adapter.failNextCommit(new Error('Disk full'));
    await expect(repository.purchaseShopItem(account.id, 'card-back-aurora', 2)).rejects.toThrow('Disk full');
    expect(await adapter.persisted(path)).toBe(saved);
    expect(await repository.getAccountById(account.id)).toEqual(initial);
    const purchased = (await repository.purchaseShopItem(account.id, 'card-back-aurora', 3))!;
    adapter.failNextCommit(new Error('Equipment save failed'));
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

  it('atomically preserves omitted equipment slots across partial profile transactions', async () => {
    await repository.createAccount({ ...account, ownedShopItems: ['nameplate-aurora', 'card-back-aurora'] });
    await Promise.all([
      repository.updateProfile(account.id, { nameplate: 'nameplate-aurora' }, 2),
      repository.updateProfile(account.id, { cardBackStyle: 'card-back-aurora' }, 3),
    ]);
    expect(await repository.getAccountById(account.id)).toMatchObject({
      nameplate: 'nameplate-aurora', cardBackStyle: 'card-back-aurora', coins: 1000,
      ownedShopItems: ['nameplate-aurora', 'card-back-aurora'],
    });
    await expect(repository.updateProfile(account.id, { tableBackgroundStyle: 'table-tide' }, 4))
      .rejects.toMatchObject({ code: 'SHOP_ITEM_NOT_OWNED' });
    expect(await repository.updateProfile(account.id, { nameplate: null }, 5)).toMatchObject({
      nameplate: null, cardBackStyle: 'card-back-aurora', coins: 1000,
    });
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
    repository = await adapter.open(path);
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
    await adapter.writeUnchecked(path, { ...emptyDocument(), accounts: [{ ...account, ...invalid }] });
    await expect(adapter.open(path)).rejects.toThrow();
  });
});
