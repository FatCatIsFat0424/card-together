import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../../src/app';
import { parseAllowedOrigins, parseDatabaseConfig, parseSevensDevPreset } from '../../src/config';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
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

  it('should enable the developer Sevens preset only by name and never in production', () => {
    expect(parseSevensDevPreset(undefined, false)).toBe(false);
    expect(parseSevensDevPreset('', true)).toBe(false);
    expect(parseSevensDevPreset('near-slay', false)).toBe(true);
    expect(() => parseSevensDevPreset('near-slay', true)).toThrow(/development only/);
    for (const value of ['true', '1', 'NEAR-SLAY', ' near-slay']) {
      expect(() => parseSevensDevPreset(value, false)).toThrow(/SEVENS_DEV_PRESET/);
    }
  });

  it('should select the database engine explicitly and reject mismatched paths', () => {
    const data = join(tmpdir(), 'card-data');
    expect(parseDatabaseConfig(undefined, undefined, data)).toEqual({ engine: 'json', path: join(data, 'database.json') });
    expect(parseDatabaseConfig('', '', data)).toEqual({ engine: 'json', path: join(data, 'database.json') });
    expect(parseDatabaseConfig('sqlite', undefined, data)).toEqual({ engine: 'sqlite', path: join(data, 'database.sqlite') });
    expect(parseDatabaseConfig('sqlite', 'state/card.sqlite', data))
      .toEqual({ engine: 'sqlite', path: join(process.cwd(), 'state/card.sqlite') });
    expect(parseDatabaseConfig('json', '/var/lib/card-together/database.json', data).path).toBe('/var/lib/card-together/database.json');
    for (const engine of ['SQLite', 'postgres', ' json']) {
      expect(() => parseDatabaseConfig(engine, undefined, data)).toThrow(/DATABASE_ENGINE/);
    }
    for (const [engine, path] of [['sqlite', '/var/lib/card-together/database.json'], ['json', '/data/database.sqlite'],
      [undefined, '/data/database.db'], ['sqlite', '/data/database']] as const) {
      expect(() => parseDatabaseConfig(engine, path, data)).toThrow(/DATABASE_PATH/);
    }
  });
});

describe.each(REPOSITORY_ADAPTERS)('server startup with $name storage', (adapter) => {
  afterEach(() => vi.restoreAllMocks());

  it('should fail before starting schedulers when the port is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'card-startup-'));
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const repository = await adapter.open(join(directory, adapter.fileName));
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
    const repository = await adapter.open(join(directory, adapter.fileName));
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
