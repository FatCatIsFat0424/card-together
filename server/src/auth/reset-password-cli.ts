import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { inspectPasswordReset, resetAccountPassword } from './reset-password';
import { readHiddenPassword } from './hidden-password-prompt';

const USAGE = 'Usage: npm run admin:reset-password -- <database.json|database.sqlite> <username> [--apply --writers-stopped]';

export async function runPasswordResetCli(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${USAGE}\nDefaults to a read-only preview. Apply prompts for a new password without echo.\n`);
    return;
  }
  const [path, username, ...flags] = args;
  if (!path || !username || path.startsWith('--') || username.startsWith('--')
    || flags.some((flag) => !['--apply', '--writers-stopped'].includes(flag))
    || new Set(flags).size !== flags.length) {
    throw new Error(USAGE);
  }
  const apply = flags.includes('--apply');
  if (apply && !flags.includes('--writers-stopped')) {
    throw new Error('Stop all database writers, then use --apply --writers-stopped.');
  }
  if (!apply && flags.length) throw new Error(USAGE);
  if (apply && (!process.stdin.isTTY || !process.stderr.isTTY)) {
    throw new Error('Apply requires an interactive terminal. Password arguments, environment variables, and redirected input are not supported.');
  }
  const target = await inspectPasswordReset(path, username);
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', ...target })}\n`);
    return;
  }
  process.stderr.write(`Reset ${target.username} (${target.accountId}) in ${target.databasePath}.\n`
    + `This revokes ${target.sessionsRevoked} session(s). All database writers must remain stopped.\n`);
  const password = await readHiddenPassword('New password: ');
  const confirmation = await readHiddenPassword('Confirm new password: ');
  if (password !== confirmation) throw new Error('Passwords do not match; no reset was applied.');
  const result = await resetAccountPassword(path, username, password, {
    writersStopped: true, expectedAccountId: target.accountId,
  });
  process.stdout.write(`${JSON.stringify({ mode: 'applied', ...result })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runPasswordResetCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Unable to reset the password.');
    process.exitCode = 1;
  });
}
