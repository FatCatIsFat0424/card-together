# Testing

## Prerequisites

- The exact Node.js version in [`.node-version`](../.node-version) and `npm ci`.
- Linux `flock` (util-linux) for asset imports; Bash and GNU `realpath` for deployment
  fixtures, as in CI.

## Check runner

```sh
# While editing: preview, then run checks for branch and working-tree changes.
npm run check -- focused --base main --dry-run
npm run check -- focused --base main

# While editing: check specific repository-relative files.
npm run check -- focused --files client/src/stores/theme-store.ts

# Required before completing behavior changes; CI runs this.
npm run check -- full

# Full gate with real imports and cleared compiler state.
npm run check -- full --no-cache

# Release artifacts with production paths; deploys nothing.
VITE_BASE_PATH=/card-together/ VITE_SERVER_URL='' \
  VITE_SOCKET_PATH=/card-together/socket.io npm run check -- release
```

**Focused selection**

| Rule | Behavior |
| --- | --- |
| Input | Exactly one of `--base` or `--files`. `--base` uses the merge base with HEAD plus staged, unstaged, and untracked changes, including both sides of renames |
| `--files` | Checks only the listed files and certifies nothing else; invalid, unsafe, or empty selections fail |
| Dependencies | Follows transitive imports, exports, literal dynamic imports, and the shared alias. Runtime, security, and persistence changes add their boundary suites |
| Widens to full | Shared contracts, `AGENTS.md`, dependencies or configuration, deleted or unknown paths, unresolved or dynamic imports |
| Deployment files | Run related Python modules; unmapped helpers and templates run all modules |
| Client assets | Require build and artifact validation |
| Documentation only | `docs/*.md`, `README.md`: whitespace and local link targets only; reported as `documentation`, not runtime verification |
| Recommendations | UI changes list [browser checks](development.md#browser-verification); database, Socket, and arrange changes list [benchmarks](development.md#benchmarks) |

**Reporting**

- Output is a JSON report of scope, gates, reasons, timings, and recommendations.
- The first failure stops the run; remaining gates report `not-run`.
- Cancellation, or source, environment, or configuration changes during the run, prevent success.
- Results apply only to that run; there is no persistent validation receipt.

## Full gate

1. Prepare music and emoji imports.
2. Typecheck shared, server, server tests, client app, and client Node configs.
3. Typed lint, all Vitest tests, Vite build, and artifact validation.
4. Syntax-check every deployment shell script and run Python unittest discovery.

`release` adds explicit production base and Socket paths and validates index links,
catalogs, content hashes, and source-to-build bytes. It does not install, publish, or
reload services, and does not certify the live proxy or TLS; see [deployment](deployment.md#verify).

| Cache | Behavior |
| --- | --- |
| TypeScript | Incremental state per environment; affected dependencies are always rechecked. Client app types are not rechecked during bundling |
| Lint | Never cached |
| Asset imports | Reused only when originals, policy, importer and validator code, dependencies, runtime, catalogs, and output bytes all match; otherwise reimported |
| `--no-cache` | Clears selected compiler state and runs real imports |

**Asset import safety**

- Symlinks and non-regular catalog or output files are rejected.
- Linux `flock` serializes importers and releases on process death. Never delete the lock file.
- Content-addressed files are written before the atomic catalog and success manifest.
  Interrupted temporary files are cleaned under the lock; unrelated assets, backups, and
  originals are preserved.
- `--profile` prints phase timings to stderr. Phases overlap (`prepare` includes codec
  time, `publish` includes revalidation), so never add them.

**Standalone commands**

```sh
npm run typecheck
npm run lint
npm test                 # npm run test:watch for repeated runs
npm run build:client
for script in deploy/*.sh; do bash -n "$script"; done
python3 -B -m unittest discover -s deploy/tests
```

Root `typecheck` and `lint` also cover `server/tests`, benchmarks, `scripts/`, and the
Vite and Vitest configs. Lint treats floating promises as errors and keeps the existing
React hooks warnings. Vitest discovers `server/tests/**/*.test.ts`.

## Coverage

Sources: [server/tests](../server/tests), [deploy/tests](../deploy/tests).

| Area | Covered behavior |
| --- | --- |
| Rules and bots | Exact legal actions, input immutability, recipient privacy; 650 arrangement hands and 163 seeded full games; weighted selection |
| Credentials | Real hashing and verification, maximum lengths, dummy-user work, 2-active/16-waiting queue, rate limits before derivation |
| Persistence and coins | Deferred commits, rollback and retry, no early broadcast, stale jobs, reopen and replay, concurrent purchase/reward revisions, atomic batches |
| Media | Real animated GIF upload and served bytes; write, rename, and ownership failures; quota; queue recovery |
| Imports and artifacts | Each importer's inputs, outputs, flags, lock, and security; real GIF and animated WebP compression including no-fit inputs; invalidation; symlink and FIFO rejection; SIGKILL recovery; build hash and base validation |
| Client | Account-generation races, API failures and 401 epochs, canvas cropping and cleanup, zero geometry, bilingual rules, friend ordering |
| Deployment | Backup locks and ownership, guarded install and publish, catalog guards, failure and signal recovery, timer ordering, Nginx parsing, migration and configuration |

- Server startup reads the generated [emoji catalog](media.md#site-provided-emoji);
  tests inject catalogs instead of requiring owner originals.
- Deployment tests use temporary paths and allowlisted command doubles; production
  entry points keep their privilege checks.
- Node tests do not replace browser rendering, real codecs, or live services.
- Merge equivalent setup and assertions, but keep each independent behavior check.

## Performance measurements

- Match Node version, inputs, hardware, caches, and workload; measure process wall time.
- Report cold and warm runs separately, ideally as median and range of three samples.
- Vitest per-file times overlap; do not add them up as suite time.
- Correctness tests never assert performance deadlines.
