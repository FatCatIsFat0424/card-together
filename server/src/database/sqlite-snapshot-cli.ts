import { runOfflineCli } from './offline-cli';
import { snapshotSqliteDatabase, verifyDatabaseSnapshot } from './sqlite-snapshot';

const USAGE = 'Usage: sqlite-snapshot-cli.ts backup <database.sqlite> <new-snapshot.sqlite> | verify <database.sqlite|database.json>';

/** Used by deploy/backup-data.sh and deploy/restore-data.sh; prints one JSON summary line. */
runOfflineCli(async () => {
  const [command, ...paths] = process.argv.slice(2);
  let result: unknown;
  if (command === 'backup' && paths.length === 2) result = await snapshotSqliteDatabase(paths[0], paths[1]);
  else if (command === 'verify' && paths.length === 1) result = await verifyDatabaseSnapshot(paths[0]);
  else throw new Error(USAGE);
  process.stdout.write(`${JSON.stringify({ mode: command, ...(result as object) })}\n`);
}, 'Unable to check the database snapshot.');
