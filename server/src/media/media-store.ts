import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { MediaId } from '@shared/types';
import { isMediaId } from '@shared/constants';

export type ImageKind = 'png' | 'jpg' | 'gif' | 'webp';

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Magic bytes only; the extension and Content-Type come from this, never from the client. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'webp';
  return null;
}

/** Total bytes each account may upload; covers a full emoji library plus profile images. */
export const MEDIA_QUOTA_BYTES = 100 * 1024 * 1024;

/** Ownership markers live beside the images; media IDs can never resolve into it. */
const OWNERS_DIRECTORY = 'owners';

export interface MediaStore {
  /**
   * Stores bytes for `ownerId`. Resolves null when the new image would exceed the owner's
   * quota; images the owner already uploaded are free. Rejects unsupported images.
   */
  save(bytes: Uint8Array, ownerId: string): Promise<MediaId | null>;
  /** Absolute file path, or null when the id is malformed or not stored. */
  path(id: MediaId): string | null;
}

async function writeAtomically(target: string, bytes: Uint8Array): Promise<void> {
  const temporaryPath = `${target}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, target);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Content-addressed: identical uploads share one file, so saves are idempotent. Each
 * account's uploads are recorded as empty marker files so quotas survive restarts.
 */
export function createMediaStore(directory: string, quotaBytes = MEDIA_QUOTA_BYTES): MediaStore {
  const root = resolve(directory);
  const usage = new Map<string, number>();
  const pending = new Map<string, Promise<unknown>>();

  function ownerDirectory(ownerId: string): string {
    return join(root, OWNERS_DIRECTORY, createHash('sha256').update(ownerId).digest('hex'));
  }

  /** Lazily sums the owner's recorded images once; this process then keeps it current. */
  async function usedBytes(ownerId: string): Promise<number> {
    const cached = usage.get(ownerId);
    if (cached !== undefined) return cached;
    const owned = await readdir(ownerDirectory(ownerId)).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    });
    let total = 0;
    for (const id of owned) {
      if (isMediaId(id)) total += await stat(join(root, id)).then((file) => file.size, () => 0);
    }
    usage.set(ownerId, total);
    return total;
  }

  async function saveOwned(bytes: Uint8Array, ownerId: string): Promise<MediaId | null> {
    const kind = sniffImage(bytes);
    if (!kind) throw new Error('Unsupported image format.');
    const id = `${createHash('sha256').update(bytes).digest('hex')}.${kind}`;
    const owner = ownerDirectory(ownerId);
    const marker = join(owner, id);
    if (existsSync(marker) && existsSync(join(root, id))) return id;
    const used = await usedBytes(ownerId);
    if (used + bytes.length > quotaBytes) return null;
    const target = join(root, id);
    if (!existsSync(target)) {
      await mkdir(root, { recursive: true });
      await writeAtomically(target, bytes);
    }
    await mkdir(owner, { recursive: true });
    await writeFile(marker, '', { mode: 0o600 });
    usage.set(ownerId, used + bytes.length);
    return id;
  }

  return {
    // Serialize per owner so concurrent uploads cannot both pass the quota check.
    save: (bytes, ownerId) => {
      const previous = pending.get(ownerId) ?? Promise.resolve();
      const result = previous.then(() => saveOwned(bytes, ownerId));
      const settled = result.catch(() => undefined);
      pending.set(ownerId, settled);
      void settled.then(() => { if (pending.get(ownerId) === settled) pending.delete(ownerId); });
      return result;
    },
    // ponytail: sync existence check per lookup; fine for profile edits and cached GETs.
    path: (id) => {
      if (!isMediaId(id)) return null;
      const target = join(root, id);
      return existsSync(target) ? target : null;
    },
  };
}
