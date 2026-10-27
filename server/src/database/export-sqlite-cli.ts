import { exportSqliteToJson, previewJsonExport } from './export-sqlite';
import { parseOfflineArguments, runOfflineCli } from './offline-cli';

const USAGE = 'Usage: npm run admin:export-json -- <database.sqlite> <new-file.json> [--apply --writers-stopped]';

runOfflineCli(async () => {
  const parsed = parseOfflineArguments(process.argv.slice(2), 2, USAGE);
  if (!parsed) {
    process.stdout.write(`${USAGE}\nDefaults to a read-only preview. Never overwrites an existing file.\n`);
    return;
  }
  const [source, target] = parsed.paths;
  const result = parsed.apply
    ? await exportSqliteToJson(source, target, { writersStopped: true })
    : await previewJsonExport(source, target);
  process.stdout.write(`${JSON.stringify({ mode: parsed.apply ? 'applied' : 'dry-run', ...result }, null, 2)}\n`);
}, 'Unable to export the database.');
