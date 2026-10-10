import { cleanupBotHistory } from './cleanup-bot-history';

async function main(): Promise<void> {
  const [path, ...flags] = process.argv.slice(2);
  if (!path || path.startsWith('--') || flags.some((flag) => !['--apply', '--writers-stopped'].includes(flag))) {
    throw new Error('Usage: npm run cleanup:bot-history -- <database.json> [--apply --writers-stopped]');
  }
  const apply = flags.includes('--apply');
  if (apply && !flags.includes('--writers-stopped')) {
    throw new Error('Stop all database writers, then use --apply --writers-stopped.');
  }
  const result = await cleanupBotHistory(path, apply);
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'applied' : 'dry-run', ...result })}\n`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unable to clean up bot history.');
  process.exitCode = 1;
});
