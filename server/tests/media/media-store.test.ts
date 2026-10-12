import { createHash } from 'node:crypto';
import { mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMediaStore } from '../../src/media/media-store';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename), writeFile: vi.fn(actual.writeFile) };
});
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const idOf = (bytes: Buffer): string => `${createHash('sha256').update(bytes).digest('hex')}.png`;

describe('media store durable publication', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'media-store-')); });
  afterEach(async () => {
    vi.restoreAllMocks();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(open).mockReset().mockImplementation(actual.open);
    vi.mocked(rename).mockReset().mockImplementation(actual.rename);
    vi.mocked(writeFile).mockReset().mockImplementation(actual.writeFile);
    await rm(directory, { recursive: true, force: true });
  });

  it.each(['write', 'rename', 'ownership'] as const)('does not publish on %s failure and recovers the owner queue', async (failure) => {
    const store = createMediaStore(directory, PNG.length);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    if (failure === 'write') vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(new Error('write failed'));
      return handle;
    });
    else if (failure === 'rename') vi.mocked(rename).mockRejectedValueOnce(new Error('rename failed'));
    else vi.mocked(writeFile).mockRejectedValueOnce(new Error('ownership failed'));
    await expect(store.save(PNG, 'alice')).rejects.toThrow(`${failure} failed`);
    expect(store.path(idOf(PNG))).toBeNull();
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(await store.save(PNG, 'alice')).toBe(idOf(PNG));
    const other = Buffer.concat([PNG.subarray(0, -1), Buffer.from([2])]);
    expect(await store.save(other, 'alice')).toBeNull();
    expect(store.path(idOf(other))).toBeNull();
    expect(await store.save(PNG, 'alice')).toBe(idOf(PNG));
    expect(await createMediaStore(directory, PNG.length).save(other, 'alice')).toBeNull();
  });

  it('charges shared bytes to each owner and preserves another owner after a marker failure', async () => {
    const store = createMediaStore(directory, PNG.length);
    expect(await store.save(PNG, 'alice')).toBe(idOf(PNG));
    vi.mocked(writeFile).mockRejectedValueOnce(new Error('marker failed'));
    await expect(store.save(PNG, 'bob')).rejects.toThrow('marker failed');
    expect(store.path(idOf(PNG))).not.toBeNull();
    expect(await store.save(PNG, 'bob')).toBe(idOf(PNG));
    const other = Buffer.concat([PNG.subarray(0, -1), Buffer.from([2])]);
    expect(await store.save(other, 'bob')).toBeNull();
    expect(await store.save(other, 'carol')).toBe(idOf(other));
  });
});
