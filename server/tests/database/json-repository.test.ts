import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonRepository } from '../../src/database/json-repository';
import type { AccountRecord } from '../../src/database/repository';
import { emptyDocument } from '../../src/database/schema';

const PASSWORD_HASH = `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`;

function account(username: string): AccountRecord {
  return {
    id: randomUUID(), username, usernameNormalized: username.toLowerCase(), nickname: username, color: '#123456',
    avatar: 'cat', avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100, cardBack: null,
    cardBackOpacity: 100, matchesPublic: false, passwordHash: PASSWORD_HASH, createdAt: 100, updatedAt: 100,
  };
}

// Engine-independent behavior is in repository.test.ts; these cases need a hand-written JSON file.
describe('JSON repository files', () => {
  let directory: string;
  let path: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bridge-db-test-'));
    path = join(directory, 'database.json');
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('should refuse corrupt and unsupported documents without modifying the file', async () => {
    for (const content of [
      '{broken',
      JSON.stringify({ schemaVersion: 99 }),
      JSON.stringify({ schemaVersion: 1, accounts: [] }),
    ]) {
      await writeFile(path, content);
      await expect(createJsonRepository(path)).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe(content);
    }
  });

  it.each([null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid persisted last-seen timestamps: %s', async (lastSeenAt) => {
    await writeFile(path, JSON.stringify({ ...emptyDocument(), accounts: [{ ...account('alice'), lastSeenAt }] }));
    await expect(createJsonRepository(path)).rejects.toThrow();
  });
});
