import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientToServerEvents, ShopItemId } from '@shared/types';
import { createMessageService } from '../../src/social/message-service';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import { createSocketHarness } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';

describe('authoritative paid sticker messaging', () => {
  let app: SocketHarness;
  let owned: readonly ShopItemId[];
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    app = await createSocketHarness(1);
    [alice, bob] = app.accountIds[0];
    owned = [];
    const original = app.repository.getAccountById.bind(app.repository);
    vi.spyOn(app.repository, 'getAccountById').mockImplementation(async (id) => {
      const account = await original(id);
      return account && id === alice ? { ...account, ownedShopItems: owned } : account;
    });
    await app.repository.createFriendship({ id: 'paid-sticker-friends', requesterId: alice, recipientId: bob,
      status: 'accepted', createdAt: Date.now(), updatedAt: Date.now() });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  function sendRoom(payload: unknown): Promise<{ success: boolean; error?: string }> {
    return app.clients[0][0].timeout(5000).emitWithAck('chat:send', payload as Parameters<ClientToServerEvents['chat:send']>[0]);
  }

  it('checks durable ownership per room send, broadcasts IDs to non-owners, and retains valid history', async () => {
    expect((await sendRoom({ shopSticker: 'table-hello' })).success).toBe(false);
    owned = ['stickers-table-talk'];
    // The connected runtime player has no inventory and is never trusted for this grant.
    expect((await sendRoom({ shopSticker: 'table-hello' })).success).toBe(true);
    const other = await app.clients[0][1].timeout(5000).emitWithAck('player:resume');
    expect(other.chatHistory?.at(-1)).toMatchObject({ content: '', shopSticker: 'table-hello' });
    expect(other.chatHistory?.at(-1)).not.toHaveProperty('sticker');
    const snapshot = await app.repository.loadRuntime();
    expect(isRuntimeSnapshot(snapshot)).toBe(true);
    expect(snapshot?.chat[0].messages.at(-1)).toMatchObject({ shopSticker: 'table-hello' });
    owned = [];
    expect((await sendRoom({ shopSticker: 'table-nice' })).success).toBe(false);
    expect((await app.clients[0][1].timeout(5000).emitWithAck('player:resume')).chatHistory)
      .toEqual(other.chatHistory);
  });

  it('rolls back room stickers and broadcasts nothing when runtime persistence fails', async () => {
    owned = ['stickers-table-talk'];
    const before = (await app.clients[0][1].timeout(5000).emitWithAck('player:resume')).chatHistory;
    app.resetMetrics();
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await sendRoom({ shopSticker: 'table-thanks' })).success).toBe(false);
    expect(app.metrics.chatMessages).toBe(0);
    expect((await app.clients[0][1].timeout(5000).emitWithAck('player:resume')).chatHistory).toEqual(before);
    expect((await sendRoom({ shopSticker: 'table-thanks' })).success).toBe(true);
  });

  it('rejects unknown, mixed, URL, and malformed room sticker payloads without committing chat', async () => {
    owned = ['stickers-table-talk'];
    const before = (await app.clients[0][1].timeout(5000).emitWithAck('player:resume')).chatHistory;
    for (const payload of [
      { shopSticker: 'forest-cheer' }, { shopSticker: 'unknown' }, { shopSticker: null },
      { shopSticker: { id: 'table-hello' } }, { shopSticker: 'https://example.com/a.svg' },
      { shopSticker: 'table-hello', message: 'mixed' }, { shopSticker: 'table-hello', stickerId: 'foreign' },
      { shopSticker: 'table-hello', url: 'https://example.com/a.svg' },
    ]) expect((await sendRoom(payload)).success).toBe(false);
    expect((await app.clients[0][1].timeout(5000).emitWithAck('player:resume')).chatHistory).toEqual(before);
  });

  it('authorizes DM ownership per send and retry while recipients retain ID-based history', async () => {
    const service = createMessageService(app.repository, new Map());
    const input = { clientId: randomUUID(), shopSticker: 'forest-wow' };
    await expect(service.send(alice, bob, input)).rejects.toMatchObject({ status: 403 });
    owned = ['stickers-forest-friends'];
    const sent = await service.send(alice, bob, input);
    expect(sent).toMatchObject({ content: '', shopSticker: 'forest-wow' });
    expect(await service.send(alice, bob, input)).toEqual(sent);
    expect((await service.history(bob, alice)).messages).toEqual([sent]);
    expect((await service.overview(bob)).conversations[0].lastMessage.shopSticker).toBe('forest-wow');
    await expect(service.send(alice, bob, { ...input, shopSticker: 'forest-rest' }))
      .rejects.toMatchObject({ status: 409 });
    owned = [];
    await expect(service.send(alice, bob, input)).rejects.toMatchObject({ status: 403 });
    expect((await service.history(bob, alice)).messages).toEqual([sent]);
    expect(await app.repository.listDirectMessages(alice, bob)).toMatchObject([{ shopSticker: 'forest-wow' }]);
  });

  it('rejects malformed and mixed DM stickers and publishes no history on persistence failure', async () => {
    owned = ['stickers-table-talk'];
    const service = createMessageService(app.repository, new Map());
    for (const patch of [
      { shopSticker: 'unknown' }, { shopSticker: null }, { shopSticker: '../a.svg' },
      { shopSticker: { id: 'table-hello' } }, { shopSticker: 'table-hello', message: 'mixed' },
      { shopSticker: 'table-hello', providedSticker: 'wave' }, { shopSticker: 'table-hello', file: 'evil.svg' },
    ]) await expect(service.send(alice, bob, { clientId: randomUUID(), ...patch }))
      .rejects.toMatchObject({ status: 400 });
    vi.spyOn(app.repository, 'createDirectMessage').mockRejectedValueOnce(new Error('Disk full'));
    await expect(service.send(alice, bob, { clientId: randomUUID(), shopSticker: 'table-hello' }))
      .rejects.toThrow('Disk full');
    expect(await app.repository.listDirectMessages(bob)).toEqual([]);
  });
});
