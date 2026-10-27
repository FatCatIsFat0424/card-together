/** Arguments shared by offline database tools: positional paths, then an optional apply acknowledgement. */
export interface OfflineArguments {
  readonly paths: readonly string[];
  readonly apply: boolean;
}

/**
 * Accepts exactly `count` paths and either no flags (preview) or both `--apply --writers-stopped`.
 * Returns null for `--help`.
 */
export function parseOfflineArguments(args: readonly string[], count: number, usage: string): OfflineArguments | null {
  if (args.length === 1 && args[0] === '--help') return null;
  const paths = args.slice(0, count);
  const flags = args.slice(count);
  if (paths.length !== count || paths.some((path) => path.startsWith('--'))
    || flags.some((flag) => !['--apply', '--writers-stopped'].includes(flag)) || new Set(flags).size !== flags.length) {
    throw new Error(usage);
  }
  const apply = flags.includes('--apply');
  if (apply && !flags.includes('--writers-stopped')) throw new Error('Stop all database writers, then use --apply --writers-stopped.');
  if (!apply && flags.length > 0) throw new Error(usage);
  return { paths, apply };
}

/** Runs a CLI entry point, printing only error messages so database contents never reach the terminal. */
export function runOfflineCli(main: () => Promise<void>, fallback: string): void {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : fallback);
    process.exitCode = 1;
  });
}
