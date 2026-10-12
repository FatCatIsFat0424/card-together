# Testing

Use the exact Node.js version in [.node-version](../.node-version) and existing npm
workspaces. Imports additionally require Linux `flock` from util-linux. Deployment
fixtures use Bash and GNU coreutils `realpath`, matching the Linux CI environment.
Install with `npm ci`; this workflow adds no test framework or npm dependency.

## Editing and completion

```sh
# Review selection without executing checks.
npm run check -- focused --base main --dry-run

# Include branch commits, staged/unstaged changes, and untracked files.
npm run check -- focused --base main

# Explicit scope for the current edit; filenames are repository-relative.
npm run check -- focused --files client/src/stores/theme-store.ts
npm run check -- focused --files deploy/start-service.sh

# Complete correctness gate before finishing a behavior change.
npm run check -- full

# Force actual asset imports and clear compiler-owned incremental state.
npm run check -- full --no-cache

# Validate prepared release artifacts without deploying or publishing.
VITE_BASE_PATH=/card-together/ VITE_SERVER_URL='' \
  VITE_SOCKET_PATH=/card-together/socket.io npm run check -- release
```

Focused mode requires exactly one explicit `--base` or `--files`. Base selection uses
the merge base with HEAD and includes dirty/untracked work; renames include both paths.
An invalid reference, unsafe path, or empty selection fails. No default base is guessed.
Explicit filenames limit the editing check; they do not certify other changes in the tree.
The JSON report lists scope, selected gates, reasons, timings, and recommendations.
A focused pass does not replace the complete completion gate.

Selection follows transitive local imports, exports, literal dynamic imports, and the
shared alias. Runtime/security/persistence changes add real boundary suites independently
of import edges. Shared contracts, dependency/config changes, deleted inputs, unknown
paths, and unresolved/nonliteral dependencies widen to full validation. Deployment
sources map to Python modules; unmapped deployment helpers/templates run every module.
Client assets/import changes also require build and artifact validation. UI changes
recommend browser checks; database/Socket/arrange changes recommend opt-in benchmarks.
Browser recommendations follow [development scope](development.md#browser-verification).

Documentation-only selection checks content, local links, and whitespace; its report
says `documentation`, not full runtime verification. Checks stop at the first failure
and identify remaining gates as `not-run`. Cancellation and source/environment/config
changes during execution cannot produce a successful overall report. Input fingerprints
are local to the run; there is no persistent blanket validation receipt.

## Complete gate and caches

The complete gate runs imports first, then shared/server production/server tests/client
app/client Node type environments, typed lint, every Vitest test, Vite bundling, artifact
validation, every deployment shell syntax check, and Python unittest discovery.
Client app typechecking runs once; bundling does not repeat it. TypeScript owns separate
incremental build-info files for each environment and still checks affected dependencies.
Typed lint always runs without a result cache. `--no-cache` clears the selected compiler
state and performs actual imports rather than trusting reuse metadata.

Asset reuse hashes originals, policy, importer/helper/validator code, dependency/runtime
versions, catalogs, and complete output bytes. Corruption, missing or extra managed
outputs, renamed/deleted originals, or changed inputs require import work. Catalog and
output paths reject symlinks and nonregular files. Linux `flock` serializes competing
processes and releases automatically after process death; do not remove its lock inode.
Content-addressed files publish before an atomic catalog and successful manifest.
Interrupted importer PID/UUID temporary files are cleaned under the lock; unrelated
assets/backups and owner originals are preserved. `--profile` prints import phase timings
on stderr; `prepare` includes codec time rather than being an additional independent phase.

Release mode additionally requires explicit matching base/Socket paths and validates
actual index links, catalogs, content hashes, and source/built asset bytes. It does not
install, publish, reload services, or certify a live proxy/TLS environment. Deployment
orchestration tests use temporary host paths and allowlisted command doubles. Production
entrypoints retain privilege checks and production paths. Follow [deployment](deployment.md)
for live operational checks; these require their own authorization.

Standalone equivalents remain available:

```sh
npm run typecheck
npm run lint
npm test
npm run build:client
for script in deploy/*.sh; do bash -n "$script"; done
python3 -B -m unittest discover -s deploy/tests
```

## Coverage boundaries

Consolidate equivalent assertions and setup, while retaining independent behavior
oracles. Test-case count alone does not measure cost or coverage. Current protection includes:

| Area | Retained or strengthened oracle |
| --- | --- |
| Rules and bots | 500 greedy + 150 rank-five hands, independent weighted-selection boundaries, 163 seeded full games, exact legal actions, input immutability, and recipient privacy. |
| Credentials | Real password hashing/verification, legal maximum credentials, dummy-user work, 2-active/16-waiting queue bounds, limiter rejection before derivation, and HTTP windows. Cookie/session/logout/profile fixtures seed real repository accounts/sessions with explicit time and TTL; credential oracles keep actual derivation. |
| Persistence and rewards | Deferred commit ordering, rollback/retry, no early broadcast, stale manual/game/window/stop jobs, reopen/replay, concurrent purchase/reward revisions, atomic batches, overflow rejection. |
| Media | Real animated GIF upload/profile/served bytes; write/rename/owner-marker failure, owner isolation, quota, and queue recovery. |
| Imports and artifacts | One complete direct shared-helper contract suite plus each CLI's input/output/flags/lock/security wiring; true GIF compression and irreducible/no-fit animated WebP codec integration, content invalidation, symlink/FIFO rejection, concurrency/SIGKILL recovery, Node stripping bootstrap, and built file/hash/base validation. |
| Client | Deferred account-generation race, API failures/401 epochs, canvas crop/ratio/fallback/bitmap release, finite compact/zero geometry, nonempty bilingual rules, and meaningful friend ordering. |
| Deployment | Backup lock/copy/collision/owners, guarded install/publish flows, catalog/index guards, deploy failure/signal recovery, timer ordering, build failure propagation, Nginx parser, migration, and runtime configuration. Bash doubles retain native temporary filesystem operations with command/options/helper-path guards, exact JSON arguments, and regular-file-only flock descriptors. |

See tests under [server/tests](../server/tests) and [deploy/tests](../deploy/tests).
Pure/Node tests do not replace browser renderer lifecycle, actual codecs, or live service
checks. Use isolated synthetic accounts/databases for the selected real browser flow.

## Performance measurements

Measure process wall time with the same Node version, inputs, hardware, cache conditions,
and workload. File windows overlap under Vitest and must not be added as suite wall time.
Report cold and warm runs separately, preferably median and range from three samples.
Database, Socket, and arrange benchmarks remain opt-in; see
[benchmarks](development.md#benchmarks) for commands and metric meanings.

## Current measurement snapshot (2026-10-12)

Second-round refinement changed six test/fixture files, preserving all production code,
configuration, previous uncommitted work, 650 arrangement hands, and 163 seeded games.
The import contract matrix moved shared implementation checks into one in-process suite;
both native CLI entrypoints retain wiring, integrity, no-cache, security, and lock checks.
Large exact-copy bytes use `Buffer.equals()` instead of a matcher traversing two million
numeric properties. All cold/warm/forced actual codecs, 4-frame metadata, and the
640-frame no-fit regression remain. Session-only fixtures avoid seven unrelated password
derivations while actual registration explicitly checks session timestamps/TTL.
Deployment doubles use Bash builtins rather than starting Python for every command;
actual filesystem commands remain guarded, and service commands remain doubles.

Measurement conditions match the first-round machine/runtime/asset inventory below.
Before and after each have three sequential full-gate samples without concurrent agent
checks. Complete runner time below excludes the outer npm/tsx startup; subprocess gate
medians are measured separately and are not additive parallel file windows.

| Scope | Before | After | Change |
| --- | ---: | ---: | ---: |
| Vitest (unit + integration) | 21.675s | 15.960s | −5.715s (26.4%) |
| Python deployment checks | 15.322s | 7.132s | −8.190s (53.5%) |
| Complete runner | 59.677s | 44.617s | −15.060s (25.2%) |
| Vitest files / cases | 142 / 1399 | 142 / 1412 | +13 cheap direct contract cases |
| Python methods | 64 | 71 | +7 execution-boundary guard methods |
| Native Node launches in asset-state suite | 154 | 74 | −80 (52%) |

Before runner range: 58.323–59.708s. After runner range: 43.331–44.885s. After outer CLI process median: 45.510s.

The direct asset contract suite has 58 cases instead of 45 CLI-heavy cases, with
391 executed assertions instead of 379. Its scoped runtime decreased from 11.253s to
5.551–6.165s. The normal codec case decreased from 4.362s to 0.472–0.490s by changing
only exact-byte comparison, preserving codec calls. These focused numbers diagnose
workload; complete-gate results above establish the end-to-end saving.

All warm full gates passed: five type environments, typed lint (same 10 existing hooks
warnings), 1412 Vitest cases, build/artifacts, eight shell syntax checks, and 71 Python
methods. Actual theme focused selection remained 3 files / 18 cases; bidding remained
44 files. Forced-import/type-rebuild cold validation also passed in 62.740s runner time (one sample); this does not drop OS page caches or reinstall dependencies. Browser and opt-in benchmarks
were not repeated for this test-only refinement; production behavior, visuals, workloads,
and deployment entrypoints are unchanged. No live installation/deployment/publication
or host service operations were performed.

The historical first-round measurements below use outer process time and earlier test
coverage. They are a reference, not the current gate count or a cold timing for this round.

## First-round measurement reference (2026-10-12)

Measured on Linux x64, AMD Ryzen 5 5600X (12 logical CPUs), Node 24.21.0,
installed dependencies, and the owner's 10 music files / 230 emoji (12 compressed).
Samples run sequentially with unchanged source/configuration. Cold means `--no-cache`
forces imports and clears compiler state; it does not drop OS page caches or reinstall
dependencies. Warm mode still hashes originals and validates complete outputs.
The table includes npm/runner startup and uses three samples except release (one).

The previous checkout (`9962efa`) took 63.426s for the four application commands,
or 67.120s including Bash/Python, in one local sample. It had 130 Vitest files /
1248 cases and 49 Python methods. The first-round checks retained required oracles and added
failure coverage: 142 files / 1399 Vitest cases and 64 Python methods. The difference
is not a constant-workload benchmark or a remote CI timing claim.

| Scenario | Median process seconds | Range | Executed scope |
| --- | ---: | --- | --- |
| Frontend preference edit | 9.244 | 9.154–9.258 | Client/test types, related lint, 3 Vitest files / 18 cases |
| Bridge bidding edit | 14.220 | 13.827–14.493 | Server/test types, related lint, 44 Vitest files / 468 cases |
| Service-start script edit | 1.056 | 1.053–1.058 | Selected Bash syntax + startup Python module |
| Complete gate, warm | 58.702 | 58.624–58.820 | Every correctness/build/deployment gate |
| Complete gate, forced imports/type rebuild | 75.082 | 74.609–75.179 | Every gate with actual imports and type rebuild |
| Release gate, warm | 58.437 | 58.437–58.437 | Every gate with explicit production base/Socket settings |

Per-gate medians below exclude the outer npm startup and runner fingerprint overhead.
Individual medians are not additive measurements of the complete process.
The old build included another client typecheck; the new bundle row excludes types,
which are already checked once in the five-environment row.

| Component | Previous local seconds | First-round warm seconds | First-round cold seconds |
| --- | ---: | ---: | ---: |
| Five type environments | 15.895 | 4.835 | 15.068 |
| Typed lint | 12.963 | 13.491 | 13.537 |
| Vitest | 21.538 | 21.930 | 21.751 |
| Music/emoji imports | Included in old build | 0.539 | 6.700 |
| Vite bundle + artifact validation | 13.030 | 1.222 | 1.247 |
| Bash syntax | 0.010 | 0.035 | 0.043 |
| Python deployment tests | 3.684 | 14.805 | 14.813 |

Warm full checks improved by about 13% against the old all-check snapshot. Cold full
checks are longer because real import work and additional failure/rollback tests remain.
The larger daily saving comes from the explicit focused scope, rather than deleting
security/corpus coverage. Shared/config/unknown changes still widen to the full gate.

Validation also passed the isolated DB/Socket/arrange benchmarks and real browser
WebP resize/upload/readback, separate-account stale-response protection, configured-base
Socket room/chat/reconnect, and compact canvas lifecycle. TableCollapse's StrictMode
sound ran once, settled rendering stabilized, and RAF/transform cleanup passed;
DragonSlay painted and canceled RAF, including a zero-size transition. Account rendering
was checked at 1366×768 and 360×640; mobile horizontal overflow was absent.
Temporary frontend/backend processes were closed. Live installation, deployment,
publication, systemd/Nginx/TLS checks and remote CI were not executed. Node 22 compatibility
was exercised with Node 24's default stripping disabled, not a direct Node 22 run.
Lint passed with the same 10 pre-existing React hooks warnings.

The same inventory was also profiled directly with three cold/warm importer pairs.
Original content hashes were unchanged afterwards. Native importer process medians
were music 0.343s cold / 0.177s warm; emoji 6.188s cold / 0.351s warm. Import phase medians:

| Importer / mode | Scan ms | Source hashing ms | Codec ms | Prepare ms | Validate outputs ms | Publish ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| music / cold | 0.5 | 102.0 | — | — | — | 206.3 |
| music / warm | 0.2 | 57.1 | — | — | 47.5 | — |
| emoji / cold | 1.3 | 259.5 | 5386.5 | 5561.9 | — | 343.6 |
| emoji / warm | 0.7 | 137.3 | — | — | 114.2 | — |

Phase timers overlap: prepare includes codec, and publish includes input revalidation.
Do not sum them. The real pathological/no-fit animated codec fixture remains in every
full Vitest run; ordinary asset reuse does not bypass that regression.
