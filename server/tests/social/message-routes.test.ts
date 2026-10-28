import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectMessage, MessageHistory, SocialOverview } from '@shared/types/direct-message';
import type { MediaId } from '@shared/types';
import { createMessageService } from '../../src/social/message-service';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import { createSocketHarness, TEST_ORIGIN } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';

describe.each(REPOSITORY_ADAPTERS)('friend direct messages and notifications ($name)', (adapter) => {
  let app: SocketHarness;
  let alice: string;
  let bob: string;
  let carol: string;

  beforeEach(async () => {
    app = await createSocketHarness(1, adapter);
    [alice, bob, carol] = app.accountIds[0];
    await app.repository.createFriendship({ id: 'alice-bob', requesterId: alice, recipientId: bob,
      status: 'accepted', createdAt: Date.now(), updatedAt: Date.now() });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  function request(index: number, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<Response> {
    return fetch(`${app.baseUrl}/api/${path}`, {
      method, headers: { Cookie: app.cookies[0][index], Origin: TEST_ORIGIN, 'Content-Type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  async function overview(index: number): Promise<SocialOverview> {
    const result = await request(index, 'messages');
    expect(result.status).toBe(200);
    return await result.json() as SocialOverview;
  }

  async function send(index = 0, recipient = bob, text = 'Hello 👋', clientId = randomUUID()): Promise<DirectMessage> {
    const response = await request(index, `messages/${recipient}`, { clientId, message: text });
    expect(response.status).toBe(201);
    return (await response.json() as { message: DirectMessage }).message;
  }

  it('delivers privately to all participant tabs after persistence without changing room membership', async () => {
    const extraTab = await app.connect(app.cookies[0][0]);
    const received = [0, 0, 0, 0];
    for (const [index, client] of [app.clients[0][0], app.clients[0][1], app.clients[0][2], extraTab].entries()) {
      client.on('social:changed', () => { received[index] += 1; });
    }
    const created = await send();
    await expect.poll(() => received).toEqual([1, 1, 0, 1]);
    expect(await app.repository.listDirectMessages(alice, bob)).toMatchObject([{ id: created.id }]);
    expect((await overview(1)).conversations).toMatchObject([{ account: { id: alice }, unreadCount: 1 }]);
    expect((await overview(0)).conversations).toMatchObject([{ account: { id: bob }, unreadCount: 0 }]);
    expect((await overview(2)).conversations).toEqual([]);
    expect((await request(2, `messages/${alice}`)).status).toBe(404);
    for (const client of app.clients[0]) {
      expect((await client.timeout(5000).emitWithAck('player:resume')).room?.code).toBe(app.roomCodes[0]);
    }
    expect(JSON.stringify(created)).not.toMatch(/passwordHash|tokenHash|coinRevision|ownedAvatarBorders/);
  });

  it('requires session and friendship, validates sender-controlled fields, and protects mutation origins', async () => {
    expect((await fetch(`${app.baseUrl}/api/messages`)).status).toBe(401);
    expect((await request(0, `messages/${carol}`, { clientId: randomUUID(), message: 'No friendship' })).status).toBe(403);
    expect((await request(0, `messages/${alice}`, { clientId: randomUUID(), message: 'Self' })).status).toBe(400);
    expect((await request(0, `messages/${bob}`, { clientId: randomUUID(), message: ' ', senderId: carol })).status).toBe(400);
    expect((await request(0, `messages/${bob}`, { clientId: randomUUID(), message: 'a'.repeat(501) })).status).toBe(400);
    const forged = await fetch(`${app.baseUrl}/api/messages/${bob}`, { method: 'POST',
      headers: { Cookie: app.cookies[0][0], Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: randomUUID(), message: 'Forged' }) });
    expect(forged.status).toBe(403);
    expect(await app.repository.listDirectMessages(bob)).toEqual([]);
    await app.repository.deleteAccountSessions(alice);
    expect((await request(0, `messages/${bob}`)).status).toBe(401);
  });

  it('retains former-friend history and retries successful messages without duplicating them', async () => {
    const clientId = randomUUID();
    const first = await send(0, bob, 'Keep this history', clientId);
    expect((await send(0, bob, 'Keep this history', clientId)).id).toBe(first.id);
    expect((await request(0, `messages/${bob}`, { clientId, message: 'Different' })).status).toBe(409);
    expect((await request(0, `friends/${bob}`, {}, 'DELETE')).status).toBe(200);
    const history = await (await request(1, `messages/${alice}`)).json() as MessageHistory;
    expect(history).toMatchObject({ canSend: false, messages: [{ id: first.id }] });
    expect((await send(0, bob, 'Keep this history', clientId)).id).toBe(first.id);
    expect((await request(1, `messages/${alice}`, { clientId: randomUUID(), message: 'Blocked' })).status).toBe(403);
    expect(await app.repository.listDirectMessages(alice)).toHaveLength(1);
  });

  it('keeps offline messages and marks only observed incoming messages read', async () => {
    app.clients[0][1].disconnect();
    const first = await send(0, bob, 'First');
    const second = await send(0, bob, 'Second');
    await app.connect(app.cookies[0][1]);
    expect((await overview(1)).conversations[0].unreadCount).toBe(2);
    expect((await request(1, `messages/${alice}/read`, { messageId: first.id })).status).toBe(200);
    expect((await overview(1)).conversations[0].unreadCount).toBe(1);
    expect((await request(2, `messages/${alice}/read`, { messageId: second.id })).status).toBe(400);
    expect((await request(0, `messages/${bob}/read`, { messageId: second.id })).status).toBe(400);
    expect((await request(1, `messages/${alice}/read`, { messageId: second.id })).status).toBe(200);
    expect((await request(1, `messages/${alice}/read`, { messageId: first.id })).status).toBe(200);
    expect((await overview(1)).conversations[0].unreadCount).toBe(0);
  });

  it('returns bounded chronological pages and refuses cursors from unrelated conversations', async () => {
    const records: string[] = [];
    for (let index = 0; index < 53; index += 1) {
      const id = randomUUID();
      records.push(id);
      await app.repository.createDirectMessage({ id, clientId: randomUUID(), senderId: alice,
        recipientId: bob, content: `Message ${index}`, timestamp: Date.now() });
    }
    const newest = await (await request(1, `messages/${alice}`)).json() as MessageHistory;
    expect(newest.hasMore).toBe(true);
    expect(newest.messages.map((entry) => entry.id)).toEqual(records.slice(3));
    const older = await (await request(1, `messages/${alice}?before=${newest.messages[0].id}`)).json() as MessageHistory;
    expect(older.hasMore).toBe(false);
    expect(older.messages.map((entry) => entry.id)).toEqual(records.slice(0, 3));
    expect((await request(1, `messages/${alice}?before=other-message`)).status).toBe(400);
    expect((await request(1, `messages/${alice}?before=x&before=y`)).status).toBe(400);
  });

  it('resolves personal and site assets, rejects foreign stickers, and retries deleted-library assets', async () => {
    const mediaId = `${'a'.repeat(64)}.webp` as MediaId;
    const emojis = await app.repository.createEmojis(alice, [{ name: 'wave', mediaId }], Date.now());
    const foreign = await app.repository.createEmojis(carol, [{ name: 'foreign', mediaId }], Date.now());
    const text = await send(0, bob, 'Hi :wave: :unknown:');
    expect(text.emojis).toEqual({ wave: mediaId });
    expect((await request(0, `messages/${bob}`, { clientId: randomUUID(), stickerId: foreign[0].id })).status).toBe(400);
    const clientId = randomUUID();
    const stickerResponse = await request(0, `messages/${bob}`, { clientId, stickerId: emojis[0].id });
    expect(stickerResponse.status).toBe(201);
    const sticker = (await stickerResponse.json() as { message: DirectMessage }).message;
    await app.repository.deleteEmoji(alice, emojis[0].id);
    const retry = await request(0, `messages/${bob}`, { clientId, stickerId: emojis[0].id });
    expect((await retry.json() as { message: DirectMessage }).message.id).toBe(sticker.id);
    const provided = { name: 'wave', file: `wave-${'b'.repeat(24)}.png` };
    const service = createMessageService(app.repository, new Map([['wave', provided]]));
    const site = await service.send(alice, bob, { clientId: randomUUID(), providedSticker: 'wave' });
    expect(site.providedSticker).toEqual(provided);
    expect((await service.send(alice, bob, { clientId: randomUUID(), message: ':wave:' })).providedEmojis)
      .toEqual({ wave: provided.file });
  });

  it('publishes no social changes until a write commits and none on persistence failure', async () => {
    const broadcast = vi.spyOn(app.application.io.sockets.adapter, 'broadcast');
    const socialCalls = (): number => broadcast.mock.calls.filter(([packet]) => packet.data?.[0] === 'social:changed').length;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = app.repository.createDirectMessage.bind(app.repository);
    const save = vi.spyOn(app.repository, 'createDirectMessage').mockImplementationOnce(async (record) => {
      await gate;
      return original(record);
    });
    const pending = send();
    await expect.poll(() => save.mock.calls.length).toBe(1);
    expect(socialCalls()).toBe(0);
    expect(await app.repository.listDirectMessages(bob)).toEqual([]);
    release();
    await pending;
    expect(socialCalls()).toBe(2);
    broadcast.mockClear();
    save.mockRejectedValueOnce(new Error('Disk full'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await request(0, `messages/${bob}`, { clientId: randomUUID(), message: 'Fails' })).status).toBe(500);
    expect(socialCalls()).toBe(0);
    expect(await app.repository.listDirectMessages(bob)).toHaveLength(1);
    expect(logged).toHaveBeenCalled();
  });

  it('deduplicates overlapping retries even when emoji resolution changes between requests', async () => {
    const mediaId = `${'a'.repeat(64)}.webp` as MediaId;
    const [asset] = await app.repository.createEmojis(alice, [{ name: 'wave', mediaId }], Date.now());
    let release!: () => void;
    const secondRead = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(app.repository, 'listEmojis')
      .mockImplementationOnce(async () => { await secondRead; return [asset]; })
      .mockImplementationOnce(async () => { release(); return [{ ...asset, mediaId: `${'b'.repeat(64)}.webp` as MediaId }]; });
    const service = createMessageService(app.repository, new Map());
    const payload = { clientId: randomUUID(), message: ':wave:' };
    const results = await Promise.all([service.send(alice, bob, payload), service.send(alice, bob, payload)]);
    expect(results[0]).toEqual(results[1]);
    expect(await app.repository.listDirectMessages(bob)).toHaveLength(1);
  });

  it('recovers friend notifications from persistence and marks or clears them only for their owner', async () => {
    const sent = await request(0, 'friends/requests', { username: 'player_0_2' });
    expect(sent.status).toBe(201);
    const body = await sent.json() as { request: { id: string } };
    expect((await overview(2)).incoming).toMatchObject([{ id: body.request.id, requester: { id: alice }, readAt: null }]);
    await request(0, 'messages/notifications/read', { ids: [body.request.id] });
    expect((await overview(2)).incoming).toMatchObject([{ readAt: null }]);
    expect((await request(2, 'messages/notifications/read', { all: true })).status).toBe(200);
    const read = (await overview(2)).incoming;
    expect(read).toMatchObject([{ id: body.request.id, readAt: expect.any(Number) }]);
    await request(2, 'messages/notifications/read', { ids: [body.request.id] });
    expect((await overview(2)).incoming).toEqual(read);
    // Clearing never removes a request; only answering it does.
    await request(2, 'messages/notifications/clear', { read: true });
    expect((await overview(2)).incoming).toHaveLength(1);
    expect((await request(2, `friends/requests/${body.request.id}/accept`, {})).status).toBe(200);
    const notices = (await overview(0)).accepted;
    expect(notices).toMatchObject([{ account: { id: carol }, readAt: null }]);
    expect((await overview(2)).incoming).toEqual([]);
    await request(1, 'messages/notifications/read', { ids: notices.map((entry) => entry.id) });
    await request(1, 'messages/notifications/clear', { ids: notices.map((entry) => entry.id) });
    expect((await overview(0)).accepted).toMatchObject([{ readAt: null }]);
    await request(0, 'messages/notifications/clear', { read: true });
    expect((await overview(0)).accepted).toHaveLength(1);
    await request(0, 'messages/notifications/read', { ids: notices.map((entry) => entry.id) });
    expect((await overview(0)).accepted).toMatchObject([{ id: notices[0].id, readAt: expect.any(Number) }]);
    await request(0, 'messages/notifications/clear', { read: true });
    expect((await overview(0)).accepted).toEqual([]);
  });

  it('dismisses one accepted notification and validates notification selections', async () => {
    const sent = await request(0, 'friends/requests', { username: 'player_0_2' });
    const body = await sent.json() as { request: { id: string } };
    await request(2, `friends/requests/${body.request.id}/accept`, {});
    const [notice] = (await overview(0)).accepted;
    for (const [path, payload] of [
      ['read', {}], ['read', { all: false }], ['read', { ids: [] }], ['read', { ids: ['a', 'a'] }],
      ['read', { ids: [notice.id], all: true }], ['clear', { all: true }], ['clear', { read: 'yes' }],
    ] as const) expect((await request(0, `messages/notifications/${path}`, payload)).status).toBe(400);
    expect((await overview(0)).accepted).toMatchObject([{ id: notice.id, readAt: null }]);
    expect((await request(0, 'messages/notifications/clear', { ids: [notice.id] })).status).toBe(200);
    expect((await overview(0)).accepted).toEqual([]);
  });

  it('limits message sends before writes and returns a retry delay', async () => {
    for (let index = 0; index < 5; index += 1) await send(0, bob, `Message ${index}`);
    const limited = await request(0, `messages/${bob}`, { clientId: randomUUID(), message: 'Too many' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await app.repository.listDirectMessages(bob)).toHaveLength(5);
  });
});
