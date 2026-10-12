import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsonRepository } from '../../src/database/json-repository';
import { seedAuthenticatedAccount, seedAuthenticatedSession } from './account-fixture';
import { createAuthService } from '../../src/auth/auth-service';
import { inspectPasswordReset, resetAccountPassword } from '../../src/auth/reset-password';
import * as passwords from '../../src/auth/password';
import { validateNewPassword } from '../../src/auth/password-policy';
import type { DatabaseDocument } from '../../src/database/schema';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), open: vi.fn(actual.open), unlink: vi.fn(actual.unlink) };
});

const run = promisify(execFile);
const NEW_PASSWORD = 'New-private-secret-738';
const OLD_PASSWORD = 'Previous-private-secret-519';
const HASH = `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`;

describe('offline administrator password reset', () => {
  let directory: string;
  let path: string;
  let accountId: string;
  let targetTokens: string[];
  let otherToken: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'card-admin-reset-'));
    path = join(directory, 'database.json');
    const repository = await createJsonRepository(path);
    try {
      const first = await seedAuthenticatedAccount(repository, 'Alice', { nickname: 'Another name', coins: 42 });
      accountId = first.account.id;
      const second = await seedAuthenticatedSession(repository, accountId);
      targetTokens = [first.token, second.token];
      const other = await seedAuthenticatedAccount(repository, 'bravo');
      otherToken = other.token;
      await repository.saveRuntime({ players: [], rooms: [], games: [], chat: [] });
    } finally { await repository.close(); }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.open).mockReset().mockImplementation(actual.open);
    vi.mocked(fs.rename).mockReset().mockImplementation(actual.rename);
    vi.mocked(fs.unlink).mockReset().mockImplementation(actual.unlink);
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('previews a case-insensitive username without changing any file', async () => {
    const original = await fs.readFile(path);
    expect(await inspectPasswordReset(path, ' ALICE ')).toEqual({
      databasePath: path, accountId, username: 'Alice', sessionsRevoked: 2,
    });
    expect((await fs.readFile(path)).equals(original)).toBe(true);
    expect(await fs.readdir(directory)).toEqual(['database.json']);
  });

  it('backs up all bytes, preserves other data, changes login and revokes every target session', async () => {
    const originalDocument = JSON.parse(await fs.readFile(path, 'utf8')) as DatabaseDocument;
    originalDocument.accounts[0] = { ...originalDocument.accounts[0], passwordHash: await passwords.hashPassword(OLD_PASSWORD) };
    await fs.writeFile(path, `${JSON.stringify(originalDocument)}\n`);
    const original = await fs.readFile(path);
    const result = await resetAccountPassword(path, 'alice', NEW_PASSWORD, { writersStopped: true, now: () => 1 });
    expect(result).toMatchObject({ accountId, username: 'Alice', sessionsRevoked: 2 });
    expect((await fs.readFile(result.backupPath)).equals(original)).toBe(true);
    expect((await fs.stat(result.backupPath)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(await fs.readFile(path, 'utf8')) as DatabaseDocument;
    expect(saved).toEqual({ ...originalDocument,
      accounts: [{ ...originalDocument.accounts[0], passwordHash: saved.accounts[0].passwordHash,
        updatedAt: originalDocument.accounts[0].updatedAt + 1 }, originalDocument.accounts[1]],
      sessions: originalDocument.sessions.filter((session) => session.accountId !== accountId),
    });
    expect(saved.accounts[0].passwordHash).not.toBe(originalDocument.accounts[0].passwordHash);
    expect(await fs.readdir(directory)).toEqual(expect.arrayContaining(['database.json', result.backupPath.slice(directory.length + 1)]));
    expect((await fs.readdir(directory)).length).toBe(2);
    const repository = await createJsonRepository(path);
    try {
      const auth = createAuthService(repository);
      await expect(auth.login({ username: 'alice', password: OLD_PASSWORD })).rejects.toThrow('Invalid username or password');
      expect((await auth.login({ username: 'alice', password: NEW_PASSWORD })).account.id).toBe(accountId);
      for (const token of targetTokens) expect(await auth.resolveToken(token)).toBeNull();
      expect((await auth.resolveToken(otherToken))?.account.username).toBe('bravo');
    } finally { await repository.close(); }
  });

  it.each(['short', 'password', ' leading-secret', 'trailing-secret ', 'x'.repeat(129)])(
    'uses the same password policy without writing rejected input: %s', async (password) => {
      const original = await fs.readFile(path);
      expect(() => validateNewPassword(password)).toThrow();
      await expect(resetAccountPassword(path, 'alice', password, { writersStopped: true })).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
      expect((await fs.readFile(path)).equals(original)).toBe(true);
      expect(await fs.readdir(directory)).toEqual(['database.json']);
    },
  );

  it('requires stopped writers and refuses a replaced preview account', async () => {
    await expect(resetAccountPassword(path, 'alice', NEW_PASSWORD, { writersStopped: false })).rejects.toThrow('Stop all database writers');
    await expect(resetAccountPassword(path, 'alice', NEW_PASSWORD, { writersStopped: true, expectedAccountId: 'different-account' })).rejects.toThrow('target account changed');
    expect(await fs.readdir(directory)).toEqual(['database.json']);
  });

  it('does not create or migrate missing, malformed or incompatible databases', async () => {
    await expect(inspectPasswordReset(join(directory, 'missing.json'), 'alice')).rejects.toThrow();
    await expect(inspectPasswordReset(path, 'unknown')).rejects.toThrow('Account not found');
    for (const original of ['{', JSON.stringify({ schemaVersion: 999 }), JSON.stringify({ schemaVersion: 4 })]) {
      await fs.writeFile(path, original);
      await expect(resetAccountPassword(path, 'alice', NEW_PASSWORD, { writersStopped: true })).rejects.toThrow();
      expect(await fs.readFile(path, 'utf8')).toBe(original);
      expect(await fs.readdir(directory)).toEqual(['database.json']);
    }
  });

  it('refuses symbolic links and hard links rather than replacing a different path', async () => {
    const original = await fs.readFile(path);
    const alias = join(directory, 'alias.json');
    await fs.symlink(path, alias);
    await expect(resetAccountPassword(alias, 'alice', NEW_PASSWORD, { writersStopped: true })).rejects.toThrow();
    expect((await fs.lstat(alias)).isSymbolicLink()).toBe(true);
    await fs.unlink(alias);
    await fs.link(path, alias);
    await expect(resetAccountPassword(path, 'alice', NEW_PASSWORD, { writersStopped: true })).rejects.toThrow('regular file');
    expect((await fs.readFile(path)).equals(original)).toBe(true);
  });

  it('rejects directories and named pipes without blocking on input', async () => {
    const folder = join(directory, 'folder');
    await fs.mkdir(folder);
    await expect(inspectPasswordReset(folder, 'alice')).rejects.toThrow('regular file');
    const pipe = join(directory, 'pipe');
    await run('mkfifo', [pipe]);
    await expect(inspectPasswordReset(pipe, 'alice')).rejects.toThrow('regular file');
  });

  it.runIf(typeof process.getuid === 'function')('refuses a different UID', async () => {
    const source = await fs.stat(path);
    vi.spyOn(process, 'getuid').mockReturnValue(source.uid + 1);
    await expect(resetAccountPassword(path, 'alice', NEW_PASSWORD, { writersStopped: true })).rejects.toThrow('database file owner');
    expect(await fs.readdir(directory)).toEqual(['database.json']);
  });

  it('refuses concurrent reset tools and never removes their lock', async () => {
    const lockPath = `${path}.password-reset.lock`;
    await fs.writeFile(lockPath, 'other reset');
    await expect(resetAccountPassword(path, 'alice', NEW_PASSWORD, { writersStopped: true })).rejects.toThrow('reset lock exists');
    expect(await fs.readFile(lockPath, 'utf8')).toBe('other reset');
  });

  it('uses the same reset lock through a parent-directory symlink', async () => {
    const alias = `${directory}-alias`;
    await fs.symlink(directory, alias);
    try {
      expect((await inspectPasswordReset(join(alias, 'database.json'), 'alice')).databasePath).toBe(path);
      await fs.writeFile(`${path}.password-reset.lock`, 'other reset');
      await expect(resetAccountPassword(join(alias, 'database.json'), 'alice', NEW_PASSWORD, { writersStopped: true })).rejects.toThrow('reset lock exists');
      expect(await fs.readFile(`${path}.password-reset.lock`, 'utf8')).toBe('other reset');
    } finally { await fs.unlink(alias); }
  });

  it('keeps a concurrent writer update and aborts reset before replacing it', async () => {
    const original = await fs.readFile(path);
    const changed = JSON.parse(original.toString('utf8')) as DatabaseDocument;
    changed.accounts[1] = { ...changed.accounts[1], nickname: 'Changed by writer' };
    const replacement = `${JSON.stringify(changed)}\n`;
    vi.spyOn(passwords, 'hashPassword').mockImplementationOnce(async () => {
      await fs.writeFile(path, replacement);
      return HASH;
    });
    await expect(resetAccountPassword(path, 'alice', NEW_PASSWORD, { writersStopped: true })).rejects.toThrow('Database changed');
    expect(await fs.readFile(path, 'utf8')).toBe(replacement);
    const names = await fs.readdir(directory);
    expect(names.some((name) => name.endsWith('.lock') || name.endsWith('.tmp'))).toBe(false);
    const backup = names.find((name) => name.endsWith('.bak'));
    expect(backup).toBeDefined();
    expect((await fs.readFile(join(directory, backup!))).equals(original)).toBe(true);
  });

  it('preserves the source and cleans temporary/lock files on replacement failure', async () => {
    const original = await fs.readFile(path);
    vi.spyOn(passwords, 'hashPassword').mockResolvedValueOnce(HASH);
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('Replacement failed'));
    await expect(resetAccountPassword(path, 'alice', NEW_PASSWORD, { writersStopped: true })).rejects.toThrow('Replacement failed');
    expect((await fs.readFile(path)).equals(original)).toBe(true);
    const names = await fs.readdir(directory);
    expect(names.some((name) => name.endsWith('.tmp') || name.endsWith('.lock'))).toBe(false);
    expect(names.filter((name) => name.endsWith('.bak'))).toHaveLength(1);
  });

  it('removes a partial backup if its write fails and leaves the database unchanged', async () => {
    const original = await fs.readFile(path);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.spyOn(passwords, 'hashPassword').mockResolvedValueOnce(HASH);
    vi.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await actual.open(file, flags, mode);
      if (typeof file === 'string' && file.endsWith('.bak')) {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
          await write('partial backup');
          throw new Error('Backup write failed');
        });
      }
      return handle;
    });
    await expect(resetAccountPassword(path, 'alice', NEW_PASSWORD, { writersStopped: true })).rejects.toThrow('Backup write failed');
    expect((await fs.readFile(path)).equals(original)).toBe(true);
    expect(await fs.readdir(directory)).toEqual(['database.json']);
  });

  it('reports an applied reset with warnings when post-commit lock cleanup fails', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.spyOn(passwords, 'hashPassword').mockResolvedValueOnce(HASH);
    vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
      if (file === `${path}.password-reset.lock`) throw new Error('Lock cleanup failed');
      await actual.unlink(file);
    });
    const result = await resetAccountPassword(path, 'alice', NEW_PASSWORD, { writersStopped: true });
    expect(result.warnings).toEqual([`Unable to remove password reset lock: ${path}.password-reset.lock`]);
    const saved = JSON.parse(await fs.readFile(path, 'utf8')) as DatabaseDocument;
    expect(saved.sessions.every((session) => session.accountId !== accountId)).toBe(true);
    expect(await fs.readFile(result.backupPath, 'utf8')).not.toBe(await fs.readFile(path, 'utf8'));
  });

  it('exposes preview/help but rejects unsafe or noninteractive CLI inputs without secret output', async () => {
    const args = [resolve('../node_modules/tsx/dist/cli.mjs'), resolve('src/auth/reset-password-cli.ts')];
    const original = await fs.readFile(path);
    const preview = await run(process.execPath, [...args, path, 'alice']);
    expect(JSON.parse(preview.stdout)).toMatchObject({ mode: 'dry-run', accountId, sessionsRevoked: 2 });
    expect((await run(process.execPath, [...args, '--help'])).stdout).toContain('read-only preview');
    for (const flags of [['--apply'], ['--apply', '--writers-stopped'], ['--password', NEW_PASSWORD], ['--apply', '--apply']]) {
      try {
        await run(process.execPath, [...args, path, 'alice', ...flags]);
        expect.fail('Unsafe/noninteractive CLI invocation succeeded');
      } catch (error) {
        expect(error).toMatchObject({ code: 1, stdout: '' });
        const stderr = (error as { stderr: string }).stderr;
        expect(stderr).not.toContain(NEW_PASSWORD);
        expect(stderr).not.toContain(HASH);
      }
    }
    expect((await fs.readFile(path)).equals(original)).toBe(true);
    expect(await fs.readdir(directory)).toEqual(['database.json']);
  });

  it('does not print malformed database contents in CLI errors', async () => {
    await fs.writeFile(path, `{ "privateData": "${NEW_PASSWORD}", broken`);
    try {
      await run(process.execPath, [resolve('../node_modules/tsx/dist/cli.mjs'),
        resolve('src/auth/reset-password-cli.ts'), path, 'alice']);
      expect.fail('Malformed database was accepted');
    } catch (error) {
      expect(error).toMatchObject({ code: 1, stdout: '', stderr: expect.stringContaining('Invalid JSON database') });
      expect((error as { stderr: string }).stderr).not.toContain(NEW_PASSWORD);
    }
  });

  it.each(['apply', 'mismatch', 'cancel', 'eof'])(
    'runs real hidden terminal prompts safely: %s', async (scenario) => {
      const original = await fs.readFile(path);
      const script = `
import errno, json, os, select, subprocess, sys, time
master, slave = os.openpty()
process = subprocess.Popen([sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], 'alice', '--apply', '--writers-stopped'],
                           stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)
output = bytearray()
stage = 0
deadline = time.monotonic() + 15
try:
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try:
                chunk = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            output.extend(chunk)
        if stage == 0 and b'New password: ' in output:
            if sys.argv[5] == 'cancel':
                os.write(master, b'\\x03')
            elif sys.argv[5] == 'eof':
                os.write(master, b'\\x04')
            else:
                os.write(master, b'New-private-secret-738\\n')
            stage = 1
        if stage == 1 and b'Confirm new password: ' in output:
            answer = b'Different-private-secret-892\\n' if sys.argv[5] == 'mismatch' else b'New-private-secret-738\\n'
            os.write(master, answer)
            stage = 2
    process.wait(timeout=2)
    print(json.dumps({'code': process.returncode, 'output': output.decode('utf-8', 'replace')}))
finally:
    if process.poll() is None:
        process.kill()
        process.wait()
    os.close(master)
`;
      const result = await run('python3', ['-B', '-c', script, process.execPath,
        resolve('../node_modules/tsx/dist/cli.mjs'), resolve('src/auth/reset-password-cli.ts'), path, scenario]);
      const terminal = JSON.parse(result.stdout) as { code: number; output: string };
      expect(terminal.output).not.toContain(NEW_PASSWORD);
      expect(terminal.output).not.toContain('Different-private-secret-892');
      if (scenario === 'apply') {
        expect(terminal.code).toBe(0);
        expect(terminal.output).toContain('"mode":"applied"');
        expect((await fs.readFile(path)).equals(original)).toBe(false);
        const repository = await createJsonRepository(path);
        try {
          expect((await createAuthService(repository).login({ username: 'alice', password: NEW_PASSWORD })).account.id).toBe(accountId);
        } finally { await repository.close(); }
      } else {
        expect(terminal.code).toBe(1);
        expect(terminal.output).toContain(scenario === 'mismatch' ? 'Passwords do not match' : scenario === 'cancel'
          ? 'Password reset cancelled' : 'Password input ended');
        expect((await fs.readFile(path)).equals(original)).toBe(true);
        expect(await fs.readdir(directory)).toEqual(['database.json']);
      }
    }, 25_000,
  );
});
