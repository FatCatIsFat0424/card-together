import { afterEach, describe, expect, it, vi } from 'vitest';

const derivations = vi.hoisted(() => ({ callbacks: [] as Array<(error: Error | null, key: Buffer) => void> }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    scrypt: vi.fn((_password: string, _salt: Buffer, _length: number, _options: object,
      callback: (error: Error | null, key: Buffer) => void) => { derivations.callbacks.push(callback); }),
  };
});
import { scrypt } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../src/auth/password';

function complete(error: Error | null = null): void {
  const callback = derivations.callbacks.shift();
  if (!callback) throw new Error('Expected a pending derivation');
  callback(error, Buffer.alloc(64));
}

const OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

describe('bounded password derivation', () => {
  afterEach(() => {
    expect(derivations.callbacks).toEqual([]);
    vi.clearAllMocks();
  });

  it('derives a dummy hash for an unknown account and refuses malformed stored hashes', async () => {
    const result = verifyPassword('unknown password', null);
    expect(scrypt).toHaveBeenCalledWith('unknown password', Buffer.alloc(16), 64, OPTIONS, expect.any(Function));
    complete();
    await expect(result).resolves.toBe(false);
    await expect(verifyPassword('password', 'invalid hash')).resolves.toBe(false);
    expect(scrypt).toHaveBeenCalledTimes(1);
  });

  it('allows two active and sixteen waiting requests, rejects overflow and releases failed slots', async () => {
    const requests = Array.from({ length: 18 }, (_, index) => hashPassword(`password-${index}`));
    const failed = expect(requests[0]).rejects.toThrow('derivation failed');
    expect(scrypt).toHaveBeenCalledTimes(2);
    expect(derivations.callbacks).toHaveLength(2);
    await expect(hashPassword('overflow')).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(scrypt).toHaveBeenCalledTimes(2);
    complete(new Error('derivation failed'));
    await failed;
    await Promise.resolve();
    expect(scrypt).toHaveBeenCalledTimes(3);
    expect(derivations.callbacks).toHaveLength(2);
    for (let index = 1; index < 18; index++) {
      complete();
      await requests[index];
      await Promise.resolve();
      expect(derivations.callbacks.length).toBeLessThanOrEqual(2);
    }
    expect(scrypt).toHaveBeenCalledTimes(18);
    for (const call of vi.mocked(scrypt).mock.calls) expect(call[3]).toEqual(OPTIONS);
    const recovered = hashPassword('after queue drained');
    expect(scrypt).toHaveBeenCalledTimes(19);
    complete();
    await expect(recovered).resolves.toMatch(/^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  });
});
