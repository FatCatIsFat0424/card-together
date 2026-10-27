import { migrateJsonToSqlite, previewSqliteMigration } from './migrate-sqlite';
import { parseOfflineArguments, runOfflineCli } from './offline-cli';

const USAGE = 'Usage: npm run admin:migrate-sqlite -- <database.json> <database.sqlite> [--apply --writers-stopped]';

runOfflineCli(async () => {
  const parsed = parseOfflineArguments(process.argv.slice(2), 2, USAGE);
  if (!parsed) {
    process.stdout.write(`${USAGE}\nDefaults to a read-only preview. The JSON database is never modified.\n`);
    return;
  }
  const [source, target] = parsed.paths;
  const result = parsed.apply
    ? await migrateJsonToSqlite(source, target, { writersStopped: true })
    : await previewSqliteMigration(source, target);
  process.stdout.write(`${JSON.stringify({ mode: parsed.apply ? 'applied' : 'dry-run', ...result }, null, 2)}\n`);
}, 'Unable to migrate the database.');
