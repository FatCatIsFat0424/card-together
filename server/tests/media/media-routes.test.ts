import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApplication } from '../../src/app';
import { SESSION_COOKIE_NAME, tokenHash } from '../../src/auth/auth-service';
import { createJsonRepository } from '../../src/database/json-repository';
import type { Repository } from '../../src/database/repository';
import { createMediaStore, sniffImage } from '../../src/media/media-store';

const ORIGIN = 'http://localhost:5173';
const PASSWORD_HASH = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const COOKIE = `${SESSION_COOKIE_NAME}=${'a'.repeat(43)}`;
const HEADERS = { Cookie: COOKIE, Origin: ORIGIN, 'Content-Type': 'application/json' };

describe('media HTTP routes', () => {
  let directory: string;
  let repository: Repository;
  let application: Awaited<ReturnType<typeof createApplication>>;
  let baseUrl: string;

  async function start(mediaDirectory?: string): Promise<void> {
    application = await createApplication(repository, { allowedOrigins: [ORIGIN], mediaDirectory });
    await new Promise<void>((resolve) => {
      application.httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = application.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected HTTP server address.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  function upload(bytes: Uint8Array, purpose = 'avatar', headers = HEADERS): Promise<Response> {
    return fetch(`${baseUrl}/api/media`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: Buffer.from(bytes).toString('base64'), purpose }),
    });
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-media-'));
    repository = await createJsonRepository(join(directory, 'database.json'));
    const now = Date.now();
    await repository.createAccount({
      id: 'alice', username: 'alice', usernameNormalized: 'alice', nickname: 'Alice',
      color: '#2563eb', avatar: 'cat', avatarImage: null, tableBackground: null,
      tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100,
      matchesPublic: false, passwordHash: PASSWORD_HASH, createdAt: now, updatedAt: now,
    });
    await repository.createSession({
      tokenHash: tokenHash('a'.repeat(43)), accountId: 'alice', createdAt: now,
      expiresAt: now + 60_000,
    }, PASSWORD_HASH);
  });

  afterEach(async () => {
    await application?.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('should sniff image formats from magic bytes only', () => {
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniffImage(Buffer.from('GIF89a'))).toBe('gif');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
    expect(sniffImage(Buffer.from('<svg></svg>'))).toBeNull();
  });

  it('should store an uploaded PNG and serve it immutably without a session', async () => {
    await start(join(directory, 'media'));
    const response = await upload(PNG);
    expect(response.status).toBe(200);
    const { id } = await response.json() as { id: string };
    expect(id).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(await (await upload(PNG)).json()).toEqual({ success: true, id });

    const served = await fetch(`${baseUrl}/api/media/${id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('should reject non-images, oversize avatars, bad purposes and anonymous uploads', async () => {
    await start(join(directory, 'media'));
    expect((await upload(Buffer.from('<svg onload="alert(1)"/>'))).status).toBe(400);
    expect((await upload(PNG, 'banner')).status).toBe(400);
    const oversize = Buffer.concat([PNG, Buffer.alloc(512 * 1024)]);
    expect((await upload(oversize, 'avatar')).status).toBe(413);
    expect((await upload(oversize, 'background')).status).toBe(200);
    const { Cookie: _cookie, ...anonymous } = HEADERS;
    expect((await upload(PNG, 'avatar', anonymous as typeof HEADERS)).status).toBe(401);
  });

  it('should save and serve a maximum-size background after updating the profile', async () => {
    await start(join(directory, 'media'));
    const background = Buffer.alloc(2 * 1024 * 1024);
    PNG.copy(background);
    const uploaded = await upload(background, 'background');
    expect(uploaded.status).toBe(200);
    const { id } = await uploaded.json() as { id: string };
    const updated = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify({ tableBackground: id }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ account: { tableBackground: id } });
    const served = await fetch(`${baseUrl}/api/media/${id}`);
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer()).equals(background)).toBe(true);
    expect((await upload(Buffer.concat([background, Buffer.alloc(1)]), 'background')).status)
      .toBe(413);
  });

  it('should accept emoji up to 2 MiB and reject larger ones', async () => {
    await start(join(directory, 'media'));
    const emoji = Buffer.alloc(2 * 1024 * 1024);
    Buffer.from('GIF89a').copy(emoji);
    const uploaded = await upload(emoji, 'emoji');
    expect(uploaded.status).toBe(200);
    expect(await uploaded.json()).toMatchObject({ success: true, id: expect.stringMatching(/\.gif$/) });
    expect((await upload(Buffer.concat([emoji, Buffer.alloc(1)]), 'emoji')).status).toBe(413);
  });

  it('should return 404 for malformed and missing media ids', async () => {
    await start(join(directory, 'media'));
    for (const id of ['nope', '..%2Fdatabase.json', `${'0'.repeat(64)}.png`]) {
      expect((await fetch(`${baseUrl}/api/media/${id}`)).status).toBe(404);
    }
  });

  it('should only accept uploaded media ids on the profile', async () => {
    await start(join(directory, 'media'));
    const patch = (body: object): Promise<Response> => fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify(body),
    });
    expect((await patch({ avatarImage: `${'0'.repeat(64)}.png` })).status).toBe(400);
    expect((await patch({ tableBackground: 'not-a-media-id' })).status).toBe(400);
    expect((await patch({ matchesPublic: 'true' })).status).toBe(400);
    const { id } = await (await upload(PNG)).json() as { id: string };
    const updated = await patch({ avatarImage: id, tableBackground: id, matchesPublic: true });
    expect(await updated.json()).toMatchObject({
      success: true,
      account: { avatarImage: id, tableBackground: id, matchesPublic: true },
    });
    const player = await fetch(`${baseUrl}/api/players/alice`, { headers: { Cookie: COOKIE } });
    expect((await player.json()).account).toEqual({
      id: 'alice', username: 'alice', nickname: 'Alice', color: '#2563eb', avatar: 'cat',
      avatarImage: id,
    });
    expect(await (await patch({ avatarImage: null })).json()).toMatchObject({
      account: { avatarImage: null, tableBackground: id },
    });
  });

  it('should enforce a durable per-account quota and let owned images re-upload freely', async () => {
    const image = (fill: number): Buffer => Buffer.concat([PNG, Buffer.alloc(1000, fill)]);
    const media = join(directory, 'media');
    const store = createMediaStore(media, image(1).length * 2);
    const first = await store.save(image(1), 'alice');
    expect(await store.save(image(2), 'alice')).toMatch(/\.png$/);
    expect(await store.save(image(3), 'alice')).toBeNull();
    expect(await store.save(image(1), 'alice')).toBe(first);
    expect(await store.save(image(3), 'bob')).toMatch(/\.png$/);
    const restarted = createMediaStore(media, image(1).length * 2);
    expect(await restarted.save(image(4), 'alice')).toBeNull();
    expect(await restarted.save(image(2), 'alice')).not.toBeNull();
    const parallel = createMediaStore(join(directory, 'parallel'), image(1).length);
    const results = await Promise.all([parallel.save(image(5), 'carol'), parallel.save(image(6), 'carol')]);
    expect(results.filter((id) => id === null)).toHaveLength(1);
  });

  it('should check origin and session before parsing a large upload body', async () => {
    await start(join(directory, 'media'));
    const body = `{"data":"${'A'.repeat(64 * 1024)}`;
    const { Cookie: _cookie, ...anonymous } = HEADERS;
    const send = (headers: Record<string, string>): Promise<Response> =>
      fetch(`${baseUrl}/api/media`, { method: 'POST', headers, body });
    expect((await send(anonymous)).status).toBe(401);
    expect((await send({ ...HEADERS, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await send(HEADERS)).status).toBe(400);
  });

  it('should keep a card back private to its owner and limit its size', async () => {
    await start(join(directory, 'media'));
    const patch = (body: object): Promise<Response> => fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify(body),
    });
    const back = Buffer.alloc(512 * 1024);
    PNG.copy(back);
    const uploaded = await upload(back, 'cardBack');
    expect(uploaded.status).toBe(200);
    expect((await upload(Buffer.concat([back, Buffer.alloc(1)]), 'cardBack')).status).toBe(413);
    const { id } = await uploaded.json() as { id: string };

    expect((await patch({ cardBack: `${'0'.repeat(64)}.png` })).status).toBe(400);
    expect((await patch({ cardBack: 'not-a-media-id' })).status).toBe(400);
    expect(await (await patch({ cardBack: id })).json()).toMatchObject({
      success: true, account: { cardBack: id, cardBackOpacity: 100, tableBackground: null },
    });
    const player = await fetch(`${baseUrl}/api/players/alice`, { headers: { Cookie: COOKIE } });
    expect((await player.json()).account).not.toHaveProperty('cardBack');
    expect(await (await patch({ cardBack: null })).json()).toMatchObject({
      account: { cardBack: null },
    });
  });

  it('should validate table background and card back opacity bounds', async () => {
    await start(join(directory, 'media'));
    const patch = (body: object): Promise<Response> => fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify(body),
    });
    for (const value of [19, 101, 50.5, '80', null, -1]) {
      expect((await patch({ tableBackgroundOpacity: value })).status).toBe(400);
      expect((await patch({ cardBackOpacity: value })).status).toBe(400);
    }
    expect(await (await patch({ tableBackgroundOpacity: 20, cardBackOpacity: 100 })).json())
      .toMatchObject({ account: { tableBackgroundOpacity: 20, cardBackOpacity: 100 } });
    expect(await (await patch({ cardBackOpacity: 65 })).json())
      .toMatchObject({ account: { tableBackgroundOpacity: 20, cardBackOpacity: 65 } });
    expect((await repository.getAccountById('alice'))?.cardBackOpacity).toBe(65);
  });

  it('should answer 503 when no media directory is configured', async () => {
    await start();
    expect((await upload(PNG)).status).toBe(503);
    expect((await fetch(`${baseUrl}/api/media/${'0'.repeat(64)}.png`)).status).toBe(503);
  });
});
