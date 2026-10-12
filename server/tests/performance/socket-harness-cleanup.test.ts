import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as repositories from '../../src/database/json-repository';
import * as applications from '../../src/app';
import { createSocketHarness } from './socket-harness';

afterEach(() => vi.restoreAllMocks());

describe('socket fixture setup recovery', () => {
  it('removes its temporary directory when repository initialization fails', async () => {
    let databasePath = '';
    vi.spyOn(repositories, 'createJsonRepository').mockImplementation(async (path) => {
      databasePath = path;
      throw new Error('open failed');
    });
    await expect(createSocketHarness(1)).rejects.toThrow('open failed');
    expect(databasePath).not.toBe('');
    expect(existsSync(dirname(databasePath))).toBe(false);
  });

  it('closes an opened repository and removes partial account state when application setup fails', async () => {
    const original = repositories.createJsonRepository;
    let databasePath = '';
    const close = vi.fn<() => Promise<void>>();
    vi.spyOn(repositories, 'createJsonRepository').mockImplementation(async (path) => {
      databasePath = path;
      const repository = await original(path);
      close.mockImplementation(repository.close.bind(repository));
      repository.close = close;
      return repository;
    });
    vi.spyOn(applications, 'createApplication').mockRejectedValue(new Error('application failed'));
    await expect(createSocketHarness(1)).rejects.toThrow('application failed');
    expect(close).toHaveBeenCalledTimes(1);
    expect(existsSync(dirname(databasePath))).toBe(false);
  });
});
