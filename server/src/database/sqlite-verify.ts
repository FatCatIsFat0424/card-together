import type { DatabaseSync } from 'node:sqlite';
import { dropUnplayableRecordings } from './match-replay';
import type { DatabaseDocument } from './schema';
import { validateDocument } from './schema';
import { createStatements, integerColumn, readDocument, textColumn } from './sqlite-store';

export interface SqliteVerification {
  readonly quickCheck: 'ok';
  readonly foreignKeyViolations: 0;
  /** Rows per SQLite table, including derived tables such as `match_participants`. */
  readonly tables: Readonly<Record<string, number>>;
}

/** Runs SQLite's structural checks and counts every table; throws when a check fails. */
export function checkSqliteStructure(database: DatabaseSync): SqliteVerification {
  const quickCheck = database.prepare('PRAGMA quick_check').all().map((row) => textColumn(row, 'quick_check'));
  if (quickCheck.length !== 1 || quickCheck[0] !== 'ok') {
    throw new Error(`SQLite quick_check failed: ${quickCheck.slice(0, 5).join('; ')}`);
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length > 0) {
    throw new Error('SQLite foreign_key_check found broken references.');
  }
  const names = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((row) => textColumn(row, 'name'));
  const tables = Object.fromEntries(names.map((name) => {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get();
    if (!row) throw new Error(`Unable to count ${name}.`);
    return [name, integerColumn(row, 'count')];
  }));
  return { quickCheck: 'ok', foreignKeyViolations: 0, tables };
}

/**
 * Reads the whole database in one read transaction and applies the server's startup validation.
 * Replay recordings that no longer apply are dropped, as at startup, and reported.
 */
export function readValidatedDocument(database: DatabaseSync): { document: DatabaseDocument; droppedRecordings: string[] } {
  database.exec('BEGIN');
  let document: DatabaseDocument;
  try {
    document = readDocument(createStatements(database));
  } finally {
    database.exec('COMMIT');
  }
  const droppedRecordings = dropUnplayableRecordings(document);
  validateDocument(document);
  return { document, droppedRecordings };
}
