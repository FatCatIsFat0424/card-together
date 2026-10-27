import { randomUUID } from 'node:crypto';
import { link, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  assertDatabaseOwner, assertSpace, availableBytes, engineForPath, pathExists, resolveDatabasePath, statDatabaseFile,
} from './offline-database';
import { acquireDatabaseLock } from './owner-lock';
import type { DatabaseDocument } from './schema';
import { validateDocument } from './schema';
import type { ImportCounts } from './sqlite-import';
import { documentCounts } from './sqlite-import';
import { openCurrentSqliteDatabase } from './sqlite-schema';
import { readValidatedDocument } from './sqlite-verify';

export interface JsonExportPreview {
  readonly source: string;
  readonly target: string;
  readonly collections: ImportCounts;
  readonly runtime: boolean;
  /** In-progress games whose replay recording no longer applies; they continue unrecorded. */
  readonly droppedRecordings: readonly string[];
  readonly targetBytes: number;
  readonly availableBytes: number;
}

export interface JsonExportResult extends JsonExportPreview {
  readonly validated: true;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function inspect(sourcePath: string, targetPath: string): Promise<{ preview: JsonExportPreview; text: string; document: DatabaseDocument }> {
  const source = await resolveDatabasePath(sourcePath);
  const target = await resolveDatabasePath(targetPath);
  if (engineForPath(source) !== 'sqlite') throw new Error('The source must be a .sqlite database.');
  if (engineForPath(target) !== 'json') throw new Error('The target must be a .json file.');
  if (await pathExists(target)) throw new Error(`The target ${target} already exists. Choose a new file; exports never overwrite.`);
  await statDatabaseFile(source);
  const database = openCurrentSqliteDatabase(source);
  let read: ReturnType<typeof readValidatedDocument>;
  try {
    read = readValidatedDocument(database);
  } finally {
    database.close();
  }
  // The same compact form the JSON adapter writes.
  const text = `${JSON.stringify(read.document)}\n`;
  return {
    preview: {
      source, target, collections: documentCounts(read.document), runtime: read.document.runtime !== null,
      droppedRecordings: read.droppedRecordings, targetBytes: Buffer.byteLength(text), availableBytes: await availableBytes(dirname(target)),
    },
    text, document: read.document,
  };
}

/** Read-only: validates the SQLite database and reports what the JSON export would contain. */
export async function previewJsonExport(sourcePath: string, targetPath: string): Promise<JsonExportPreview> {
  return (await inspect(sourcePath, targetPath)).preview;
}

/** Publishes the file only if the name is still free: link() fails instead of replacing anything. */
async function writeNewFile(target: string, text: string): Promise<void> {
  const temporaryPath = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, target);
  } catch (error) {
    if (hasCode(error, 'EEXIST')) throw new Error(`The target ${target} already exists. Choose a new file; exports never overwrite.`, { cause: error });
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

/**
 * Offline only: writes the SQLite database as a new JSON database file for rollback. Holds the
 * SQLite database lock, validates the written file with the production validator, and never
 * overwrites an existing file.
 */
export async function exportSqliteToJson(
  sourcePath: string, targetPath: string, options: { readonly writersStopped: boolean },
): Promise<JsonExportResult> {
  if (!options.writersStopped) throw new Error('Stop all database writers before exporting.');
  const source = await resolveDatabasePath(sourcePath);
  assertDatabaseOwner(await statDatabaseFile(source), 'the export');
  const lock = await acquireDatabaseLock(source);
  try {
    const { preview, text, document } = await inspect(source, targetPath);
    assertSpace(preview.availableBytes, preview.targetBytes, dirname(preview.target));
    await writeNewFile(preview.target, text);
    try {
      const written: unknown = JSON.parse(await readFile(preview.target, 'utf8'));
      validateDocument(written);
      if (!isDeepStrictEqual(written, JSON.parse(text))) throw new Error('The exported JSON does not read back unchanged.');
      if (!isDeepStrictEqual(documentCounts(written), documentCounts(document))) throw new Error('Exported counts do not match.');
    } catch (error) {
      await unlink(preview.target).catch(() => undefined);
      throw error;
    }
    return { ...preview, validated: true };
  } finally {
    await lock.release();
  }
}
