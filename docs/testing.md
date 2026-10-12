# Testing

## Prerequisites

- Exact Node.js version in [.node-version](../.node-version); install workspaces with `npm ci`.
- Linux `flock` (util-linux) for imports; Bash/GNU `realpath` for deployment fixtures, matching CI.
- Use existing tests/dependencies; this workflow adds no framework.

## Editing and completion

```sh
# Preview selection.
npm run check -- focused --base main --dry-run

# Include branch commits and staged/unstaged/untracked changes.
npm run check -- focused --base main

# Repository-relative scope for the current edit.
npm run check -- focused --files client/src/stores/theme-store.ts
npm run check -- focused --files deploy/start-service.sh

# Required completion gate for behavior changes.
npm run check -- full

# Force imports and clear selected compiler incremental state.
npm run check -- full --no-cache

# Check prepared release artifacts without deploying/publishing.
VITE_BASE_PATH=/card-together/ VITE_SERVER_URL='' \
  VITE_SOCKET_PATH=/card-together/socket.io npm run check -- release
```

| Selection | Contract |
| --- | --- |
| `--base` | Exactly one `--base` or `--files` is required. Use merge base with HEAD plus dirty/untracked work; include both rename paths. No guessed default. |
| `--files` | Limits this editing check; does not certify other changes. Invalid references/unsafe paths/empty selections fail. |
| Local dependencies | Follow transitive imports, exports, literal dynamic imports, and shared alias. Runtime/security/persistence changes add boundary suites independently. |
| Full fallback | Shared contracts, dependencies/configuration, deleted/unknown paths, unresolved/nonliteral dependencies widen to full validation. |
| Deployment | Select related Python modules; unmapped helpers/templates run every module. |
| Client assets/imports | Require build and artifact validation. |
| Recommendations | UI: [browser checks](development.md#browser-verification). Database/Socket/arrange: opt-in benchmarks. |
| Documentation only | Content, local links, whitespace; report says `documentation`, not runtime verification. |

Reporting rules:

- JSON report includes scope, gates, reasons, timings, and recommendations.
- Focused success does not replace `full` before completing behavior changes.
- First failure stops checks; remaining gates are `not-run`.
- Cancellation or source/environment/config changes during execution prevent overall success.
- Fingerprints apply only to that run; no persistent blanket validation receipt.

## Complete gate and caches

Full gate order:

1. Prepare asset imports.
2. Typecheck shared, server production, server tests, client app, and client Node environments.
3. Typed lint, every Vitest test, Vite bundle, and artifact validation.
4. Every deployment shell syntax check and Python unittest discovery.

| Cache/build behavior | Guarantee |
| --- | --- |
| TypeScript | Separate incremental state per environment; affected dependencies still checked. Client app types run once, not again during bundling. |
| Typed lint | Always runs; no result cache. |
| `--no-cache` | Clears selected compiler state; runs actual imports instead of metadata reuse. |
| Asset reuse | Hashes originals, policy, importer/helper/validator code, dependencies/runtime, catalogs, and full output bytes. Changed inputs, corruption, missing/extra outputs, or renamed/deleted originals force import work. |
| Asset paths | Reject symlinks/nonregular catalog/output files. |
| Import lock | Linux `flock` serializes processes and releases on process death; never remove its lock inode. |
| Import publication | Content-addressed files precede atomic catalog/success manifest. Under lock, clean interrupted PID/UUID temporary files; preserve unrelated assets/backups/originals. |
| Import profiling | `--profile` writes phase timings to stderr; `prepare` includes codec time. |

Release mode additionally:

- Requires explicit matching base/Socket paths; validates index links, catalogs, content hashes, and source/built bytes.
- Does not install/publish/reload services or certify live proxy/TLS.
- Deployment tests use temporary paths/allowlisted command doubles; production entrypoints retain privilege checks/paths.
- Live operations require separate authorization and [deployment checks](deployment.md).

Standalone commands:

```sh
npm run typecheck
npm run lint
npm test
npm run build:client
for script in deploy/*.sh; do bash -n "$script"; done
python3 -B -m unittest discover -s deploy/tests
```

## Coverage boundaries

Consolidate equivalent setup/assertions while retaining independent behavior oracles; case count alone measures neither cost nor coverage.

| Area | Coverage |
| --- | --- |
| Rules/bots | 500 greedy + 150 rank-five hands; independent weighted selection; 163 seeded full games; exact legal actions, immutability, recipient privacy |
| Credentials | Real hash/verification, maximum credentials, dummy-user work, 2-active/16-waiting queue, limiter before derivation, HTTP windows. Session/logout/profile fixtures use real accounts/sessions and explicit time/TTL; credential tests retain derivation. |
| Persistence/rewards | Deferred commits, rollback/retry, no early broadcast, stale manual/game/window/stop jobs, reopen/replay, concurrent purchase/reward revisions, atomic batches, overflow |
| Media | Real animated GIF upload/profile/served bytes; write/rename/owner-marker failures, ownership, quota, queue recovery |
| Imports/artifacts | Shared-helper contracts and each CLI's input/output/flags/lock/security wiring; real GIF compression/no-fit animated WebP, invalidation, symlink/FIFO rejection, concurrency/SIGKILL recovery, Node stripping bootstrap, built file/hash/base validation |
| Client | Account-generation race, API failures/401 epochs, canvas crop/ratio/fallback/bitmap release, finite compact/zero geometry, bilingual rules, friend ordering |
| Deployment | Backup lock/copy/collision/owners; guarded install/publish; catalog/index guards; failure/signal recovery; timer ordering; build errors; Nginx parser; migration/configuration. Bash doubles preserve guarded native filesystem commands, exact JSON arguments, regular-file-only flock. |

- Sources: [server/tests](../server/tests), [deploy/tests](../deploy/tests).
- Pure/Node tests do not replace browser renderer lifecycle, actual codecs, or live services.
- Use isolated synthetic accounts/databases for selected real browser flows.

## Performance measurements

- Match Node version, inputs, hardware, caches, and workload; measure process wall time.
- Report cold/warm separately, preferably median/range of three samples.
- Vitest file windows overlap; do not add them as suite wall time.
- Database/Socket/arrange are opt-in; see [benchmarks](development.md#benchmarks).

## Current measurement snapshot (2026-10-12)

These are dated measurements, not current test counts or newly repeated timings.

| Condition | Recorded setup |
| --- | --- |
| Host/runtime | Linux x64, Ryzen 5 5600X (12 logical CPUs), Node 24.21.0, installed dependencies |
| Assets | 10 owner music files; 230 emoji, 12 compressed |
| Sampling | Three sequential before/after full gates; no concurrent agent checks |
| Timing | Runner excludes outer npm/tsx startup; subprocess medians are not additive |
| Cold | `--no-cache` forces imports/type rebuild; does not clear OS page caches or reinstall dependencies |
| Warm | Still hashes originals and validates complete outputs |

- Retained 650 arrangement hands/163 games and actual codec regressions, including 4-frame metadata and 640-frame no-fit input.
- Consolidated shared import contracts, used exact-byte `Buffer.equals()`, removed unrelated session-fixture derivations, and used guarded Bash doubles.

| Scope | Before | After | Change |
| --- | ---: | ---: | ---: |
| Vitest | 21.675s | 15.960s | −26.4% |
| Python deployment | 15.322s | 7.132s | −53.5% |
| Complete runner | 59.677s | 44.617s | −25.2% |
| Vitest files/cases | 142 / 1399 | 142 / 1412 | +13 contract cases |
| Python methods | 64 | 71 | +7 guard methods |

- Runner ranges: before 58.323–59.708s; after 43.331–44.885s. After outer CLI median: 45.510s.
- Forced-import/type-rebuild full gate: 62.740s runner (one sample).
- All five type environments, lint (10 existing hooks warnings), 1,412 Vitest cases, build/artifacts, eight shell checks, and 71 Python methods passed.
- Focused selection retained theme 3 files/18 cases and bidding 44 files.
- No repeated browser/opt-in benchmarks or live operations in this test-only refinement; production behavior/entrypoints were unchanged.

## First-round measurement reference (2026-10-12)

Same host/runtime/assets; sequential unchanged inputs. Outer process times include npm/runner startup; three samples except release (one). Earlier coverage was 142 files/1,399 Vitest cases and 64 Python methods.

| Scenario | Median seconds | Range | Scope |
| --- | ---: | --- | --- |
| Frontend preference | 9.244 | 9.154–9.258 | Client/test types, related lint, 3 Vitest files/18 cases |
| Bridge bidding | 14.220 | 13.827–14.493 | Server/test types, related lint, 44 Vitest files/468 cases |
| Service-start script | 1.056 | 1.053–1.058 | Selected Bash/startup Python |
| Full, warm | 58.702 | 58.624–58.820 | All correctness/build/deployment gates |
| Full, forced imports/types | 75.082 | 74.609–75.179 | All gates with imports/rebuild |
| Release, warm | 58.437 | Single sample | All gates with production base/Socket |

Historical comparison:

- Checkout `9962efa`: 63.426s for four application commands; 67.120s including Bash/Python (one sample), with 130 files/1,248 Vitest cases and 49 Python methods.
- Warm full improved about 13%; coverage/workload changed, so this is not a constant-workload benchmark or remote CI claim. Cold retained real imports and added failure/rollback coverage.
- The main editing saving comes from explicit focused scope; shared/config/unknown changes still require full validation.

Recorded validation and limits:

- Isolated DB/Socket/arrange benchmarks; real WebP resize/upload/readback; separate-account stale responses; configured-base room/chat/reconnect; compact canvas lifecycle.
- TableCollapse StrictMode sound once, stable settlement, RAF/transform cleanup; DragonSlay paint/RAF cancellation and zero-size transition.
- Account at 1366×768/360×640 without mobile horizontal overflow; temporary servers stopped.
- No live install/deploy/publish, systemd/Nginx/TLS, or remote CI. Node 22 compatibility used Node 24 with default stripping disabled, not Node 22 itself. Lint retained 10 existing hooks warnings.

Importer profiling used three cold/warm pairs with unchanged original hashes:

| Importer | Cold process median | Warm process median |
| --- | ---: | ---: |
| Music | 0.343s | 0.177s |
| Emoji | 6.188s | 0.351s |

Phase timers overlap (`prepare` includes codec; `publish` includes revalidation); never sum them. Asset reuse does not bypass the pathological/no-fit codec regression in full Vitest.
