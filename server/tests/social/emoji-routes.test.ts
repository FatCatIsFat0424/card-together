import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connectSocket } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountProfile, ClientToServerEvents, EmojiRecord, ServerToClientEvents,
} from '@shared/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import { restoreChat, getChatHistory } from '../../src/managers/chat-manager';
import { createApplication } from '../../src/app';
import { SOCKET_RATE_LIMITS } from '../../src/socket/connection';
import { createJsonRepository } from '../../src/database/json-repository';
import type { Repository } from '../../src/database/repository';

const ORIGIN = 'http://localhost:5173';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const PROVIDED_WAVE = { name: 'wave', file: 'wave-0123456789abcdef01234567.png' };
const PROVIDED_CHEER = { name: 'cheer', file: 'cheer-89abcdef0123456789abcdef.gif' };
const PROVIDED_NEKO = { name: 'NEKO-3.v2', file: 'NEKO-3.v2-0123456789abcdef01234567.webp' };
const PROVIDED_EMOJIS = new Map([PROVIDED_WAVE, PROVIDED_CHEER, PROVIDED_NEKO]
  .map((emoji) => [emoji.name, emoji]));

describe('custom emoji routes and chat', () => {
  let directory: string;
  let repository: Repository;
  let application: Awaited<ReturnType<typeof createApplication>>;
  let baseUrl: string;
  const clients: Client[] = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-emoji-'));
    repository = await createJsonRepository(join(directory, 'database.json'));
    application = await createApplication(repository, {
      allowedOrigins: [ORIGIN], mediaDirectory: join(directory, 'media'), providedEmojis: PROVIDED_EMOJIS,
    });
    await new Promise<void>((resolve) => {
      application.httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = application.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected HTTP server address.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const client of clients.splice(0)) client.disconnect();
    await application.close();
    await rm(directory, { recursive: true, force: true });
  });

  function headers(cookie?: string): Record<string, string> {
    return { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) };
  }

  async function register(username: string): Promise<{ account: AccountProfile; cookie: string }> {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ username, password: 'A valid test password 123', nickname: username }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as { account: AccountProfile };
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Expected session cookie');
    return { account: body.account, cookie };
  }

  async function api(
    cookie: string, path: string, method = 'GET', body?: object,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: headers(cookie), body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  async function connect(cookie: string): Promise<Client> {
    const client: Client = connectSocket(baseUrl, {
      autoConnect: false, forceNew: true, reconnection: false, transports: ['websocket'],
      extraHeaders: headers(cookie),
    });
    clients.push(client);
    await new Promise<void>((resolve, reject): void => {
      client.once('connect', (): void => resolve());
      client.once('connect_error', reject);
      client.connect();
    });
    expect((await client.timeout(5_000).emitWithAck('player:resume')).success).toBe(true);
    return client;
  }

  it('should manage a library of uploaded emoji per account', async () => {
    const alice = await register('emoji_alice');
    const bob = await register('emoji_bob');
    expect((await api(alice.cookie, '/api/emojis')).body).toEqual({ success: true, emojis: [] });
    expect((await fetch(`${baseUrl}/api/emojis`, { headers: headers() })).status).toBe(401);
    const upload = await api(alice.cookie, '/api/media', 'POST',
      { data: PNG.toString('base64'), purpose: 'emoji' });
    const mediaId = upload.body.id as string;

    const created = await api(alice.cookie, '/api/emojis', 'POST',
      { items: [{ name: 'wave', mediaId }, { name: 'cat', mediaId }] });
    expect(created.status).toBe(201);
    const [wave, cat] = created.body.emojis as EmojiRecord[];
    expect(wave).toMatchObject({ name: 'wave', mediaId, accountId: alice.account.id });

    const missing = `${'d'.repeat(64)}.png`;
    for (const items of [
      [{ name: 'nope', mediaId: missing }],
      [{ name: 'Bad!', mediaId }],
      [{ name: '-dash', mediaId }],
      [{ name: 'a'.repeat(65), mediaId }],
      [{ name: 'twin', mediaId }, { name: 'twin', mediaId }],
      [],
      Array.from({ length: 51 }, (_, index) => ({ name: `e${index}`, mediaId })),
    ]) {
      expect((await api(alice.cookie, '/api/emojis', 'POST', { items })).status).toBe(400);
    }
    expect((await api(alice.cookie, '/api/emojis', 'POST', { items: [{ name: 'wave', mediaId }] })).status)
      .toBe(409);

    expect((await api(alice.cookie, `/api/emojis/${cat.id}`, 'PATCH', { name: 'wave' })).status).toBe(409);
    expect((await api(alice.cookie, `/api/emojis/${cat.id}`, 'PATCH', { name: 'X' })).status).toBe(400);
    expect((await api(alice.cookie, `/api/emojis/${cat.id}`, 'PATCH', { name: '.cat' })).status).toBe(400);
    expect((await api(alice.cookie, `/api/emojis/${cat.id}`, 'PATCH', { name: 'Wave.v2-1' })).body)
      .toMatchObject({ success: true, emoji: { id: cat.id, name: 'Wave.v2-1' } });
    expect((await api(bob.cookie, `/api/emojis/${cat.id}`, 'PATCH', { name: 'kitty' })).status).toBe(404);
    expect((await api(alice.cookie, `/api/emojis/${cat.id}`, 'PATCH', { name: 'kitty' })).body)
      .toMatchObject({ success: true, emoji: { id: cat.id, name: 'kitty' } });
    expect((await api(bob.cookie, `/api/emojis/${wave.id}`, 'DELETE')).status).toBe(404);
    expect((await api(alice.cookie, `/api/emojis/${wave.id}`, 'DELETE')).status).toBe(200);
    expect(((await api(alice.cookie, '/api/emojis')).body.emojis as EmojiRecord[]).map((emoji) => emoji.name))
      .toEqual(['kitty']);
    expect((await api(bob.cookie, '/api/emojis')).body.emojis).toEqual([]);
  }, 15_000);

  it('should batch delete only the caller\'s emoji and keep their media served', async () => {
    const alice = await register('bulk_alice');
    const bob = await register('bulk_bob');
    const upload = await api(alice.cookie, '/api/media', 'POST',
      { data: PNG.toString('base64'), purpose: 'emoji' });
    const mediaId = upload.body.id as string;
    const created = (await api(alice.cookie, '/api/emojis', 'POST', {
      items: ['a1', 'a2', 'a3'].map((name) => ({ name, mediaId })),
    })).body.emojis as EmojiRecord[];
    const [bobEmoji] = await repository.createEmojis(bob.account.id, [{ name: 'b1', mediaId }], 1);

    for (const body of [
      {}, { ids: [] }, { ids: 'x' }, { ids: [42] }, { ids: [''] }, { ids: ['x'.repeat(65)] },
      { ids: [created[0].id, created[0].id] },
      { ids: Array.from({ length: 301 }, (_, index) => `id${index}`) },
    ]) {
      expect((await api(alice.cookie, '/api/emojis/delete', 'POST', body)).status).toBe(400);
    }
    const anonymous = await fetch(`${baseUrl}/api/emojis/delete`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ ids: [created[0].id] }),
    });
    expect(anonymous.status).toBe(401);
    const foreignOrigin = await fetch(`${baseUrl}/api/emojis/delete`, {
      method: 'POST', headers: { ...headers(alice.cookie), Origin: 'https://evil.example' },
      body: JSON.stringify({ ids: [created[0].id] }),
    });
    expect(foreignOrigin.status).toBe(403);
    expect((await api(alice.cookie, '/api/emojis/delete', 'POST', {
      ids: Array.from({ length: 300 }, (_, index) => `unknown-${index}`),
    })).body).toEqual({ success: true, deleted: [] });

    const deleted = await api(alice.cookie, '/api/emojis/delete', 'POST',
      { ids: [created[2].id, bobEmoji.id, 'missing', created[0].id] });

    expect(deleted).toEqual({ status: 200, body: { success: true, deleted: [created[0].id, created[2].id] } });
    expect(((await api(alice.cookie, '/api/emojis')).body.emojis as EmojiRecord[]).map((emoji) => emoji.name))
      .toEqual(['a2']);
    expect((await api(bob.cookie, '/api/emojis')).body.emojis).toEqual([bobEmoji]);
    expect((await fetch(`${baseUrl}/api/media/${mediaId}`)).status).toBe(200);
  }, 15_000);

  it('should attach only used emoji from the sender library to chat messages', async () => {
    const alice = await register('chat_alice');
    const bob = await register('chat_bob');
    const aliceMedia = `${'a'.repeat(64)}.png`;
    const bobMedia = `${'b'.repeat(64)}.gif`;
    await repository.createEmojis(alice.account.id,
      [{ name: 'wave', mediaId: aliceMedia }, { name: 'unused', mediaId: aliceMedia }], 1);
    await repository.createEmojis(bob.account.id, [{ name: 'party', mediaId: bobMedia }], 1);
    const aliceClient = await connect(alice.cookie);
    const created = await aliceClient.timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
    expect(created.success).toBe(true);
    const bobClient = await connect(bob.cookie);
    expect((await bobClient.timeout(5_000).emitWithAck('room:join', { roomCode: created.roomCode! })).success)
      .toBe(true);

    expect(await aliceClient.timeout(5_000).emitWithAck('chat:send',
      { message: 'hi :wave: :party: :missing: :wave:' })).toEqual({ success: true });
    expect(await bobClient.timeout(5_000).emitWithAck('chat:send', { message: 'plain text' }))
      .toEqual({ success: true });
    const { chatHistory } = await bobClient.timeout(5_000).emitWithAck('player:resume');
    expect(chatHistory?.[0].emojis).toEqual({ wave: aliceMedia });
    expect(chatHistory?.[1]).not.toHaveProperty('emojis');
    expect((await repository.loadRuntime())?.chat[0].messages[0].emojis).toEqual({ wave: aliceMedia });
  }, 15_000);
  it('should send owned stickers, reject forged payloads and restore durable history', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const alice = await register('sticker_alice');
    const bob = await register('sticker_bob');
    const mediaId = `${'a'.repeat(64)}.webp`;
    const [asset] = await repository.createEmojis(alice.account.id, [{ name: 'wave', mediaId }], 1);
    const client = await connect(alice.cookie);
    expect(await client.timeout(5_000).emitWithAck('chat:send', { stickerId: asset.id }))
      .toMatchObject({ success: false });
    const created = await client.timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
    const other = await connect(bob.cookie);
    await other.timeout(5_000).emitWithAck('room:join', { roomCode: created.roomCode! });
    expect(await other.timeout(5_000).emitWithAck('chat:send', { stickerId: asset.id }))
      .toMatchObject({ success: false });
    for (const payload of [
      { stickerId: '' }, { stickerId: 'missing' }, { stickerId: 42 },
      { stickerId: asset.id, message: 'mixed' },
      { stickerId: asset.id, mediaId: 'https://example.com/image.png' },
      { stickerId: asset.id, url: 'https://example.com/image.png' },
    ]) {
      expect(await client.timeout(5_000).emitWithAck('chat:send', payload as { stickerId: string }))
        .toMatchObject({ success: false, error: expect.not.stringContaining('Too many') });
      // Rejected attempts still count toward the chat rate limit.
      now += SOCKET_RATE_LIMITS.chat.windowMs;
    }
    expect(await client.timeout(5_000).emitWithAck('chat:send', { stickerId: asset.id }))
      .toEqual({ success: true });
    const expected = { content: '', sticker: { id: asset.id, name: 'wave', mediaId } };
    const history = (await other.timeout(5_000).emitWithAck('player:resume')).chatHistory!;
    expect(history.at(-1)).toMatchObject(expected);
    await copyFile(join(directory, 'database.json'), join(directory, 'restored.json'));
    const reopened = await createJsonRepository(join(directory, 'restored.json'));
    const snapshot = (await reopened.loadRuntime())!;
    await reopened.close();
    expect(isRuntimeSnapshot(snapshot)).toBe(true);
    expect(snapshot.chat[0].messages.at(-1)).toMatchObject(expected);
    restoreChat(snapshot.chat);
    expect(getChatHistory(created.roomCode!).at(-1)).toMatchObject(expected);
    const invalid = structuredClone(snapshot);
    invalid.chat[0].messages = [{ ...history.at(-1)!, sticker: {
      id: asset.id, name: 'wave', mediaId: 'https://example.com/image.png',
    } }];
    expect(isRuntimeSnapshot(invalid)).toBe(false);
    await repository.deleteAccountSessions(alice.account.id);
    now += SOCKET_RATE_LIMITS.chat.windowMs;
    expect(await client.timeout(5_000).emitWithAck('chat:send', { stickerId: asset.id }))
      .toMatchObject({ success: false, error: expect.stringContaining('session') });
    expect((await repository.loadRuntime())?.chat[0].messages).toHaveLength(history.length);
  }, 15_000);

  it('should resolve site-provided emoji after the sender library and send provided stickers', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const alice = await register('site_alice');
    const bob = await register('site_bob');
    const aliceMedia = `${'a'.repeat(64)}.png`;
    await repository.createEmojis(alice.account.id, [{ name: 'wave', mediaId: aliceMedia }], 1);
    const aliceClient = await connect(alice.cookie);
    const created = await aliceClient.timeout(5_000).emitWithAck('room:create', { gameType: 'bridge' });
    const bobClient = await connect(bob.cookie);
    await bobClient.timeout(5_000).emitWithAck('room:join', { roomCode: created.roomCode! });

    expect(await aliceClient.timeout(5_000).emitWithAck('chat:send', { message: ':wave: :cheer: :NEKO-3.v2: :nope:' }))
      .toEqual({ success: true });
    now += SOCKET_RATE_LIMITS.chat.windowMs;
    expect(await bobClient.timeout(5_000).emitWithAck('chat:send', { message: ':wave:' }))
      .toEqual({ success: true });
    now += SOCKET_RATE_LIMITS.chat.windowMs;
    for (const payload of [
      { providedSticker: 'missing' }, { providedSticker: 'Wave' }, { providedSticker: 42 },
      { providedSticker: 'wave', message: 'mixed' }, { providedSticker: 'wave', stickerId: 'x' },
      { providedSticker: 'wave', file: 'https://example.com/image.png' },
    ]) {
      expect(await bobClient.timeout(5_000).emitWithAck('chat:send', payload as { providedSticker: string }))
        .toMatchObject({ success: false, error: expect.not.stringContaining('Too many') });
      now += SOCKET_RATE_LIMITS.chat.windowMs;
    }
    expect(await bobClient.timeout(5_000).emitWithAck('chat:send', { providedSticker: 'cheer' }))
      .toEqual({ success: true });

    const history = (await aliceClient.timeout(5_000).emitWithAck('player:resume')).chatHistory!;
    expect(history).toHaveLength(3);
    expect(history[0]).toMatchObject({
      emojis: { wave: aliceMedia },
      providedEmojis: { cheer: PROVIDED_CHEER.file, [PROVIDED_NEKO.name]: PROVIDED_NEKO.file },
    });
    expect(history[1]).toMatchObject({ providedEmojis: { wave: PROVIDED_WAVE.file } });
    expect(history[1]).not.toHaveProperty('emojis');
    expect(history[2]).toMatchObject({ content: '', providedSticker: PROVIDED_CHEER });
    expect(history[2]).not.toHaveProperty('sticker');

    const snapshot = (await repository.loadRuntime())!;
    expect(isRuntimeSnapshot(snapshot)).toBe(true);
    expect(snapshot.chat[0].messages).toEqual(history);
    const forged = structuredClone(snapshot);
    for (const message of [
      { ...history[2], providedSticker: { name: 'cheer', file: 'https://example.com/image.png' } },
      { ...history[2], content: 'text' },
      { ...history[1], providedEmojis: { wave: '../wave.png' } },
      { ...history[0], providedEmojis: { wave: PROVIDED_WAVE.file } },
      { ...history[1], providedEmojis: Object.fromEntries(Array.from({ length: 21 },
        (_, index) => [`e${index}`, PROVIDED_WAVE.file])) },
    ]) {
      forged.chat[0].messages = [message];
      expect(isRuntimeSnapshot(forged)).toBe(false);
    }
  }, 15_000);

});
