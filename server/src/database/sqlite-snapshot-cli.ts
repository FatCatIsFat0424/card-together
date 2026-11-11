import { runOfflineCli } from './offline-cli';
import { verifyDatabaseSnapshot } from './sqlite-snapshot';

const USAGE = 'Usage: sqlite-snapshot-cli.ts verify <database.sqlite|database.json>';

/** Verifies a database offline for the runbooks in docs/deployment.md; prints one JSON summary line. */
runOfflineCli(async () => {
  const [command, ...paths] = process.argv.slice(2);
  let result: unknown;
  if (command === 'verify' && paths.length === 1) result = await verifyDatabaseSnapshot(paths[0]);
  else throw new Error(USAGE);
  process.stdout.write(`${JSON.stringify({ mode: command, ...(result as object) })}\n`);
}, 'Unable to check the database snapshot.');
