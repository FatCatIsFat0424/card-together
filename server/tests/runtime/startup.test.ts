import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../../src/app';
import { parseAllowedOrigins } from '../../src/config';
import { createJsonRepository } from '../../src/database/json-repository';
import * as autoPass from '../../src/runtime/bigtwo-auto-pass';
import * as turnTimers from '../../src/runtime/turn-timers';

describe('server startup', () => {
  afterEach(() => vi.restoreAllMocks());

  it('should accept only exact HTTP(S) origins', () => {
    expect(parseAllowedOrigins(' https://example.com , http://127.0.0.1:5173 '))
      .toEqual(['https://example.com', 'http://127.0.0.1:5173']);
    for (const value of ['', ' , ', 'example.com', 'https://example.com/', 'https://example.com/app',
      'ftp://example.com', 'https://user@example.com', 'https://example.com:443']) {
      expect(() => parseAllowedOrigins(value)).toThrow(/CLIENT_ORIGIN/);
    }
  });

  it('should fail before starting schedulers when the port is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'card-startup-'));
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const repository = await createJsonRepository(join(directory, 'database.json'));
    const passes = vi.spyOn(autoPass, 'startBigTwoAutoPass');
    const timers = vi.spyOn(turnTimers, 'startTurnTimers');
    try {
      await expect(createApplication(repository, {
        allowedOrigins: ['http://localhost:5173'], listen: { port: address.port, host: '127.0.0.1' },
      })).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(passes).not.toHaveBeenCalled();
      expect(timers).not.toHaveBeenCalled();
    } finally {
      await repository.close();
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('should listen before starting schedulers when asked to bind', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'card-startup-'));
    const repository = await createJsonRepository(join(directory, 'database.json'));
    let application: Awaited<ReturnType<typeof createApplication>> | undefined;
    const timers = vi.spyOn(turnTimers, 'startTurnTimers');
    try {
      application = await createApplication(repository, {
        allowedOrigins: ['http://localhost:5173'], listen: { port: 0, host: '127.0.0.1' },
      });
      expect(application.httpServer.listening).toBe(true);
      expect(timers).toHaveBeenCalledTimes(1);
    } finally {
      await application?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
