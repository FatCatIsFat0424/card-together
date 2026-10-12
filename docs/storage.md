# Accounts and storage

## Identity and sessions

Usernames contain 3–24 ASCII letters/digits/underscores, optionally separated by single
dots or hyphens, and are unique case-insensitively.
New passwords contain 6–128 characters, cannot start or end with whitespace, and cannot
be a listed common password. Sign-in and the current-password check only enforce the
maximum length, so passwords set under earlier rules keep working. Hashes use salted
asynchronous scrypt (`N=131072`, `r=8`, `p=1`) with bounded concurrency and HTTP rate limits.
Account UUIDs are player IDs; editable nicknames do not change identity.
Bots use reserved `bot:<UUID>` player IDs and `isBot: true` in room/game snapshots.
They have no account, session, or connected-player record. Match history records only
human games, with participant IDs in N/E/S/W order: all four seats, or for Blackjack and
Texas Hold'em only the occupied seats that the result's `seats` lists (legacy results
without `seats` had four). Any game containing a bot is
practice: its current runtime and result remain resumable but no match-history entry is
created. Legacy bot history remains loadable and is excluded before applying history limits;
remove it with the [offline cleanup](#legacy-bot-history-cleanup). Legacy human snapshots
without `isBot` remain valid.
Profiles include a 1–20-character nickname, six-digit color, avatar preset/optional
uploaded avatar, optional personal table background and card back with their image
opacity, an optional room seat background, and match-history visibility.

`AccountProfile.seatBackground` and `PlayerInfo.seatBackground` are optional uploaded
media IDs. Missing/null retains the theme seat artwork, so existing accounts and
runtime snapshots remain readable without a schema-version change. Seat artwork is
shared in room player identities; personal table backgrounds and card backs stay
private. The existing background upload limits and complete database/media backups
apply. Earlier servers tolerate this optional field; rollback can hide the seat
artwork while retaining the account data and uploaded images.

Login creates a seven-day opaque session. Storage contains only its SHA-256 digest;
the browser uses an HttpOnly, SameSite=Lax cookie, Secure in production. Mutating HTTP
requests require an allowed Origin and JSON content type. Socket handshake/actions
revalidate sessions. Passwords and session tokens are never public DTO fields.
Logout revokes the current session; logout-all/password changes revoke all sessions
and disconnect affected sockets. Password changes require the existing password.
There is no email/password-reset delivery workflow.
Administrators with host access can use the [offline password reset](#administrator-password-reset).

Friend requests are persisted with unordered-pair uniqueness and sender/recipient
permissions. Accepted friends include transient online/in-room presence and the room code
they currently host while online. Players can join that room without an invitation; the
server rechecks friendship, host identity and capacity, and commits room switching atomically.
Room invitations are ephemeral and only available to accepted friends. New accounts default to public
match history, readable by other signed-in players. Owners can disable visibility in their account
settings. The one-time schema-v5 migration makes every existing account's history public,
including accounts that previously disabled visibility. Later owner choices remain saved
across restarts.

## Game coins

Accounts may contain optional `coins`, a nonnegative safe integer; an absent field
means zero. The optional `rewardedGameIds` table stores unique completion receipts.
Both are compatible with existing schema-v4 files; no historical games are backfilled.
`Repository.saveRuntime` commits completed game IDs, account balance increments,
receipts, runtime, and match history in one atomic write. Retrying an already-rewarded
game, including after a restart, does not credit it again. `saveMatch` does not grant
coins. Human participants in bot matches earn coins even though those matches remain
excluded from history. Preserve balances and receipts together in complete database
backups; earlier servers retain these optional fields while awarding no new coins.

## Avatar border purchases

Schema-v4 accounts may contain optional `ownedAvatarBorders`, `avatarBorder`, and
`coinRevision`. Missing fields mean an empty inventory, original avatar and revision
zero; existing balances and media remain unchanged. The repository validates catalog
IDs, inventory uniqueness and equipment ownership. `purchaseAvatarBorder` serializes
the balance check, debit and ownership grant in one durable write. Repeated purchases
are idempotent; failed writes preserve both the previous balance and inventory.
Rewards and debits increment the revision to order private notifications and HTTP
responses. Preserve these fields with the complete database backup.

Earlier servers preserve these optional account fields but cannot manage purchases
or display borders. Do not run mixed writers; stop the service and preserve complete
database/media backups before deploying or rolling back, following
[deployment](deployment.md#operations-and-rollback). No destructive migration or
historical reward backfill is required.

## Waiting-room seats

Waiting Ninety-Nine/Blackjack/Hold'em rooms may contain optional `RoomInfo.additionalSeats`;
older snapshots without it retain four seats. At most four additional seats are
accepted, for eight total. Additional seats are human-only,
persisted in runtime snapshots, and excluded from spectators. Rooms with additional
seats cannot start matches yet. Before rolling back to a server version without
this field, have players leave these seats and the host remove them, then preserve
the complete database/media backup using the deployment procedure.

## Administrator password reset

Host-only CLI: resets a password without the old one; no website admin role or recovery endpoint.

| Preparation | Requirement |
| --- | --- |
| Requester | Establish ownership through a trusted channel; username/nickname/history alone is not proof |
| Database | Explicit configured `DATABASE_PATH`; current schema; regular file without symbolic/hard links |
| Account | Login username, case-insensitive; not nickname or account ID |
| Runtime | Pinned Node version; apply as the database file owner |
| Input | Interactive terminal; two hidden password prompts; no password arguments/env/redirected input |

1. Stop **all database writers** and preserve complete database/media backups;
   this interrupts players. See [operations](deployment.md#operations-and-rollback).
2. Preview from the repository root (no password prompt or writes):

   ```sh
   npm run admin:reset-password -- /absolute/path/database.json alice
   ```

3. Apply as the file owner while writers stay stopped:

   ```sh
   npm run admin:reset-password -- /absolute/path/database.json alice --apply --writers-stopped
   ```

4. Keep the printed `.password-reset-<UUID>.bak` privately. Deliver the new password through
   a trusted private channel and ask the owner to change it after signing in.
5. Restart one instance. Verify the new password and revoked sessions; the old password fails
   only if a different value was set. Replacement passwords do not expire or force a later change.

**Installed production commands** (after stopping writers):

```sh
sudo -u card-together sh -c 'cd /opt/card-together/server && ../node --import tsx src/auth/reset-password-cli.ts /var/lib/card-together/database.json alice'
sudo -u card-together sh -c 'cd /opt/card-together/server && ../node --import tsx src/auth/reset-password-cli.ts /var/lib/card-together/database.json alice --apply --writers-stopped'
```

Replace `/absolute/path/database.json` (or the production path) with the configured database;
replace `alice` with the target login username. Preview reports path, ID, saved username and session count.

| Outcome | Handling |
| --- | --- |
| Applied | Complete 0600 backup/replacement; same password policy/scrypt as registration; changes only target password/timestamp and revokes its sessions |
| Rejected | Invalid data/account/password, wrong UID, source change or write failure leaves the database unreplaced; assess any retained backup |
| Applied with cleanup warnings | Password is already changed; resolve reported temporary/lock files instead of treating it as an unapplied reset |
| Stale `.password-reset.lock` | Confirm no reset process is active before removal; never remove an active lock |
| Restore backup | Stop writers first; restores old password/sessions and loses newer writes |

- `--writers-stopped` acknowledges the prerequisite; it neither stops nor detects services.
- The lock serializes reset tools only; it does **not** lock out application writers.
- No database creation or migration; other accounts/runtime/history/media/coins/preferences stay intact.
- Stopping the application closes its live Socket connections.

## Legacy bot history cleanup

Cleanup is an offline operation, separate from deployment. Until it is run, legacy bot
entries are hidden from both personal and public history but remain in the file.
Use the pinned Node.js version and an absolute path to the configured `DATABASE_PATH`.
Run apply as the existing database file owner (normally the application service user);
the tool rejects a different UID so replacement does not remove the service's access.
The tool requires the current schema; upgrade older data through the normal backed-up
startup migration before cleanup. Do not edit runtime game results or media files.

1. Stop the application service and every other writer; preserve complete database/media
   backups as described in [deployment](deployment.md).
2. Preview the number of history entries to remove:
   `npm run cleanup:bot-history -- /absolute/path/database.json`.
3. Apply while writers remain stopped:
   `npm run cleanup:bot-history -- /absolute/path/database.json --apply --writers-stopped`.
   The flag acknowledges that writers are stopped; it does not stop or detect services.
4. Keep the printed `.bot-history-<UUID>.bak` file. The tool validates the database, writes
   a complete backup with mode 0600, and atomically replaces only the `matches` collection.
   It preserves human matches, accounts, sessions, friendships, emoji, media references and
   runtime. Changed source contents or invalid data abort cleanup; a repeated run is a no-op.
5. Restart one application instance and verify login, human history and game resume. Restore
   from the backup only after stopping writers again; preserve the corresponding media backup.

This maintenance step must be scheduled for each existing installation; it is not run by
the build, tests, or application startup. Backups deliberately retain the original bot entries.

## Database and media

The authoritative contracts are `server/src/database/repository.ts` and
`server/src/database/schema.ts`. `migrations.ts` defines the current version **5**;
startup migrates supported version 1–4 data and validates the result. Version 4 adds the
account card back and image opacity settings with defaults that keep the previous look.
Version 5 sets match-history visibility to public for all existing accounts once. Opening
an older database preserves its original file as `database.json.v<version>.bak` before
persisting the migration. Follow the complete database/media backup procedure before
deployment. Servers supporting only schema v4 reject v5 files; stop writers and restore a
compatible complete backup before rollback, accounting for writes made since that backup.

| Collection | Contents |
| --- | --- |
| `accounts` | Identity, normalized username, password hash, profile and timestamps |
| `sessions` | Token digest, account, creation/expiry |
| `friendships` | Account pair, request/accepted status, timestamps |
| `matches` | Stable game ID, game-specific result, participants, completion |
| `emojis` | Owner, unique name, media reference |
| `runtime` | Players, rooms/seats/readiness, games/private hands/logs, recent room chat |

The default database is `server/data/database.json`, independent of cwd. Relative
`DATABASE_PATH` overrides resolve from cwd. Production uses
`/var/lib/card-together/database.json`; uploaded content-addressed images live alongside
it in `media/`, with empty per-account ownership markers in `media/owners/` that back the
upload quota. Back up and restore `media/` as a whole. Git ignores development state;
it is never exposed as a static directory. Image reads are served through the controlled media endpoint.

Only one server process may own a JSON file. An in-process duplicate-path guard is
not a cross-process lock. Repository mutations serialize, validate schema/references,
write a temporary file in the same directory, fsync, and atomically rename. In-memory
state changes only after success. Invalid JSON, unsupported versions, duplicate records,
or invalid references stop startup without replacing the original file. Atomic rename
prevents partial files; power-loss durability also depends on the filesystem.

Runtime actions commit a consistent game snapshot and completed match in one write,
then acknowledge/broadcast; failure restores managers. Restarts restore private hands
and provide a fresh 60-second reconnect window. Multiple tabs share a seat; only the
last disconnect starts expiry. Empty rooms remove active game/chat records; completed
matches remain. Chat retains the last 200 messages per room. Voice is not recorded or
saved in JSON.

Runtime snapshots also persist room time controls, per-seat reserves, and the active
turn deadline. Existing deadlines survive restart; legacy snapshots without these fields
receive default settings and fresh clocks. Timer metadata is validated with the rest of
the snapshot. See [turn clocks](architecture.md#turn-clocks) and
[timer rules](games.md#turn-timer).

## Backup and restore

Stop the writer before copying the **entire state directory**, including `database.json`
and `media/`. Keep backups private: they contain password hashes and private hands.
Production deployment already creates protected snapshots, and a daily timer keeps the last
14 database-and-media snapshots (see [deployment](deployment.md#daily-data-backup)); also
maintain an off-host backup. See [deployment](deployment.md#operations-and-rollback) for
systemd commands and backup layout.

To restore, stop all candidate writers, preserve current complete state separately,
restore a compatible complete snapshot, set directory/file ownership and restrictive
permissions, then start one service and verify login/history/media/game resume.
Restoring a snapshot loses newer writes. Do not edit live JSON, discard a database to
fix startup, or restore JSON while leaving mismatched media.

## Future SQL adapter

SQL is not implemented. Preserve the asynchronous Repository/public DTO contracts,
atomic username/pair constraints, compare-and-swap password updates, session revocation,
and atomic runtime+completed-match writes. Initially a versioned JSON/JSONB runtime
can preserve game semantics; multi-process room coordination needs a separate design.

Implement and run repository/auth/social/runtime tests against the adapter first.
Stop writes and back up/validate JSON before a single-transaction import of accounts,
sessions, friendships, matches, emoji, and runtime. Preserve IDs/hashes/expiry/media
references; reject conflicts rather than overwrite. Compare counts, uniqueness,
references, and runtime contents, then verify login, history, friendships, media, and resume.
Switch repository construction and resume traffic only after validation. After accepting
SQL writes, rollback requires exporting/reconciling newer data; an old JSON snapshot is
no longer current. Do not introduce dual writes without an explicit transactional design.
