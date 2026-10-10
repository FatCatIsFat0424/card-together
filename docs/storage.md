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
four-human games, with participant IDs in N/E/S/W order. Any game containing a bot is
practice: its current runtime and result remain resumable but no match-history entry is
created. Legacy bot history remains loadable and is excluded before applying history limits;
remove it with the [offline cleanup](#legacy-bot-history-cleanup). Legacy human snapshots
without `isBot` remain valid.
Profiles include a 1–20-character nickname, six-digit color, avatar preset/optional
uploaded avatar, optional personal table background and card back with their image
opacity, and match-history visibility.

Login creates a seven-day opaque session. Storage contains only its SHA-256 digest;
the browser uses an HttpOnly, SameSite=Lax cookie, Secure in production. Mutating HTTP
requests require an allowed Origin and JSON content type. Socket handshake/actions
revalidate sessions. Passwords and session tokens are never public DTO fields.
Logout revokes the current session; logout-all/password changes revoke all sessions
and disconnect affected sockets. Password changes require the existing password.
There is no email/password-reset delivery workflow.

Friend requests are persisted with unordered-pair uniqueness and sender/recipient
permissions. Accepted friends include transient online/in-room presence and the room code
they currently host while online. Players can join that room without an invitation; the
server rechecks friendship, host identity and capacity, and commits room switching atomically.
Room invitations are ephemeral and only available to accepted friends. Match history defaults to private;
other signed-in players can read it only when the owner enables visibility.

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
`server/src/database/schema.ts`. `migrations.ts` defines the current version **4**;
startup migrates supported version 1–3 data and validates the result. Version 4 adds the
account card back and image opacity settings with defaults that keep the previous look.

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
