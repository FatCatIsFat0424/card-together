import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../src/database/repository';
import { acquireDatabaseLock, databaseLockPath } from '../../src/database/owner-lock';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';

interface ServerProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<{ code: number | null; stderr: string }>;
  readonly listening: Promise<void>;
}

const children: ChildProcess[] = [];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  await new Promise<void>((done) => server.close(() => done()));
  if (address === null || typeof address === 'string') throw new Error('No port was assigned.');
  return address.port;
}

/** Starts the real server entry point, as systemd does, on a private database and port. */
async function startServer(engine: string, path: string): Promise<ServerProcess> {
  const { NODE_ENV: _environment, ...environment } = process.env;
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/index.ts')], {
    env: { ...environment, DATABASE_ENGINE: engine, DATABASE_PATH: path, HOST: '127.0.0.1', PORT: String(await freePort()) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.push(child);
  let stderr = '';
  let announce: () => void = () => undefined;
  const listening = new Promise<void>((done) => { announce = done; });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
    if (stderr.includes('listening on port')) announce();
  });
  const exited = new Promise<{ code: number | null; stderr: string }>((done) => {
    child.once('exit', (code) => done({ code, stderr }));
  });
  const ready = Promise.race([listening, exited.then(({ stderr: output }) => {
    throw new Error(`Server exited before listening: ${output}`);
  })]);
  // Processes expected to fail are awaited through `exited` instead.
  ready.catch(() => undefined);
  return { child, exited, listening: ready };
}

describe.each(REPOSITORY_ADAPTERS)('$name database owner lock', (adapter) => {
  let directory: string;
  let path: string;
  let repository: Repository | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), `card-owner-lock-${adapter.name}-`));
    path = join(directory, adapter.fileName);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await repository?.close();
    repository = undefined;
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await rm(directory, { recursive: true, force: true });
  });

  it('makes a second process fail fast and releases the lock on clean shutdown', async () => {
    const owner = await startServer(adapter.name, path);
    await owner.listening;
    expect(JSON.parse(await readFile(databaseLockPath(path), 'utf8'))).toMatchObject({ pid: owner.child.pid, hostname: hostname() });
    expect((await stat(databaseLockPath(path))).mode & 0o777).toBe(0o600);

    const second = await startServer(adapter.name, path);
    const refused = await second.exited;
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(`Another process (PID ${owner.child.pid}) owns this database`);
    await expect(adapter.open(path)).rejects.toMatchObject({ code: 'DATABASE_IN_USE' });

    owner.child.kill('SIGTERM');
    expect((await owner.exited).code).toBe(0);
    expect(await adapter.otherFiles(directory)).toEqual([]);
    expect((await readdir(directory)).filter((name) => name.endsWith('.lock'))).toEqual([]);
    repository = await adapter.open(path);
    expect(await repository.loadRuntime()).not.toBeUndefined();
  }, 60_000);

  it('replaces the lock of an owner that was killed, after checking its PID', async () => {
    const owner = await startServer(adapter.name, path);
    await owner.listening;
    owner.child.kill('SIGKILL');
    await owner.exited;
    expect(JSON.parse(await readFile(databaseLockPath(path), 'utf8'))).toMatchObject({ pid: owner.child.pid });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    repository = await adapter.open(path);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Replaced a stale lock left by PID ${owner.child.pid}`));
    expect(JSON.parse(await readFile(databaseLockPath(path), 'utf8'))).toMatchObject({ pid: process.pid });
    await repository.close();
    repository = undefined;
    expect((await readdir(directory)).filter((name) => name.includes('.lock'))).toEqual([]);
  }, 60_000);
});

describe('database lock ownership rules', () => {
  let directory: string;
  let database: string;
  let lockPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'card-owner-lock-rules-'));
    database = join(directory, 'database.json');
    lockPath = databaseLockPath(database);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  async function currentOwner(): Promise<Record<string, unknown>> {
    const lock = await acquireDatabaseLock(database);
    const owner = JSON.parse(await readFile(lockPath, 'utf8')) as Record<string, unknown>;
    await lock.release();
    return owner;
  }

  async function expectReplaced(owner: Record<string, unknown>): Promise<void> {
    await writeFile(lockPath, JSON.stringify(owner));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lock = await acquireDatabaseLock(database);
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({ pid: process.pid });
    expect(JSON.parse(await readFile(lockPath, 'utf8')).token).not.toBe(owner.token);
    await lock.release();
    expect(await readdir(directory)).toEqual([]);
  }

  async function expectKept(contents: string, message: string): Promise<void> {
    await writeFile(lockPath, contents);
    await expect(acquireDatabaseLock(database)).rejects.toMatchObject({ code: 'DATABASE_IN_USE', message: expect.stringContaining(message) });
    expect(await readFile(lockPath, 'utf8')).toBe(contents);
    expect(await readdir(directory)).toEqual(['database.json.lock']);
  }

  it('refuses a live owner, including this process, and keeps its lock', async () => {
    const lock = await acquireDatabaseLock(database);
    const contents = await readFile(lockPath, 'utf8');
    await expect(acquireDatabaseLock(database)).rejects.toMatchObject({ code: 'DATABASE_IN_USE' });
    expect(await readFile(lockPath, 'utf8')).toBe(contents);
    await lock.release();
    await lock.release();
    expect(await readdir(directory)).toEqual([]);
  });

  it('replaces locks whose owner provably ended', async () => {
    const owner = await currentOwner();
    // A PID that no longer exists on this host.
    await expectReplaced({ ...owner, pid: 2 ** 22 + 1, token: 'dead-pid' });
    if (owner.startTime !== null) await expectReplaced({ ...owner, startTime: '1', token: 'reused-pid' });
    if (owner.bootId !== null) await expectReplaced({ ...owner, bootId: 'earlier-boot', token: 'earlier-boot' });
  });

  it('never removes unverifiable or unreadable locks', async () => {
    const owner = await currentOwner();
    await expectKept(JSON.stringify({ ...owner, hostname: `${hostname()}-other` }), 'cannot be checked here');
    await expectKept('', 'unreadable');
    await expectKept('{"pid": 0}', 'unreadable');
    await expectKept('other tool', 'unreadable');
  });

  it('leaves a lock that another process took over in place on release', async () => {
    const lock = await acquireDatabaseLock(database);
    const owner = JSON.parse(await readFile(lockPath, 'utf8')) as Record<string, unknown>;
    const replacement = JSON.stringify({ ...owner, token: 'another-owner' });
    await writeFile(lockPath, replacement);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await lock.release();
    expect(await readFile(lockPath, 'utf8')).toBe(replacement);
  });
});
