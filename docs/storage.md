# Accounts and storage

## Identity and sessions

| Item | Rule |
| --- | --- |
| Username | 3–24 ASCII letters/digits/underscores, optionally separated by single dots or hyphens; unique case-insensitively |
| New password | 6–128 characters; no leading/trailing whitespace or listed common passwords |
| Existing password checks | Enforce the maximum length only, preserving older passwords |
| Password storage | Salted asynchronous scrypt (`N=131072`, `r=8`, `p=1`), bounded concurrency and HTTP rate limits |
| Identity | Account UUID is the player ID; changing a nickname does not change identity |
| Profile | Nickname (1–20 characters), six-digit color, avatar, optional artwork/opacity, seat background and history visibility |

**Sessions and recovery**

- Login creates a seven-day opaque session; storage contains only its SHA-256 digest.
- Cookies: HttpOnly, SameSite=Lax, and Secure in production.
- HTTP mutations require an allowed Origin and JSON; Socket handshake/actions revalidate sessions.
- Passwords and session tokens never appear in public DTOs.
- Logout revokes one session; logout-all/password changes revoke all and disconnect affected sockets.
- User password changes require the existing password. No email/self-service recovery exists;
  host administrators can use [offline password reset](#administrator-password-reset).

**Players, history, and privacy**

- Bots use `bot:<UUID>` and `isBot: true`, with no account/session/connected-player record.
- Any match containing a bot is practice: resumable runtime/result, but no new history entry.
  Legacy bot history loads but is excluded before history limits; see [cleanup](#legacy-bot-history-cleanup).
- Human history records participants in N/E/S/W order. Blackjack/Hold'em use occupied result
  seats only; legacy results without `seats` include four. Legacy snapshots without `isBot` remain valid.
- New accounts default to public history; owners can disable it. Schema v5 makes all existing
  accounts public once, including previously private accounts; later choices persist.
- Optional `AccountProfile.seatBackground` / `PlayerInfo.seatBackground` media IDs default to
  theme artwork when absent/null. Seat artwork is shared; personal table backgrounds/card backs are private.
- Seat artwork needs no schema change. Earlier servers tolerate it; rollback may hide the artwork
  while retaining data/media. Background upload limits and complete media backups still apply.

**Social state**

- Friend requests persist with unordered-pair uniqueness and sender/recipient permissions.
- Accepted friends expose transient presence and the room code they host while online.
- Joining a friend's room rechecks friendship, host identity and capacity; switching rooms is atomic.
- Invitations are ephemeral and limited to accepted friends.

## Game coins

| Field/operation | Behavior |
| --- | --- |
| `coins` | Optional nonnegative safe integer; absent means zero |
| `rewardedGameIds` | Optional unique completion receipts; prevents repeat awards, including after restart |
| `Repository.saveRuntime` | Commits rewards, receipts, runtime and completed history atomically |
| `saveMatch` | Does not award coins |
| Bot matches | Human participants earn coins, but the match remains excluded from history |

- Compatible with schema-v4 files; no historical rewards are backfilled.
- Back up balances and receipts together. Earlier servers retain these fields but award no new coins.

## Avatar border purchases

| Optional field | Default |
| --- | --- |
| `ownedAvatarBorders` | Empty inventory |
| `avatarBorder` | Original avatar |
| `coinRevision` | Zero |

- Compatible with schema-v4 accounts; preserves existing balances and media.
- Repository validates catalog IDs, inventory uniqueness and equipment ownership.
- `purchaseAvatarBorder` atomically checks/debits coins and grants ownership; repeat purchases are idempotent.
- Failed writes preserve balance/inventory; rewards and debits increment the private notification revision.
- Earlier servers preserve fields but cannot manage/display borders. Do not mix writers;
  follow [deployment/rollback](deployment.md#operations-and-rollback) and complete backups.
- No destructive migration or historical backfill is required.

## Waiting-room seats

- Ninety-Nine/Blackjack/Hold'em may persist optional `RoomInfo.additionalSeats`.
- Absent means four seats; at most four extra human-only seats (eight total), separate from spectators.
- Rooms with extra seats cannot start matches yet.
- Before rollback to an unsupported server, have players leave extra seats and the host remove them;
  preserve complete database/media backups following [deployment](deployment.md).

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

Offline maintenance only; not run by builds, tests or startup. Until applied, legacy bot
entries remain on disk but are hidden from history.

1. Stop all writers and preserve complete [database/media backups](deployment.md).
2. Use pinned Node, explicit `DATABASE_PATH` and the current schema; apply as the file owner.
   Upgrade older data through normal backed-up startup migration first.
3. Preview, then apply while writers remain stopped:

   ```sh
   npm run cleanup:bot-history -- /absolute/path/database.json
   npm run cleanup:bot-history -- /absolute/path/database.json --apply --writers-stopped
   ```

4. Retain the private `.bot-history-<UUID>.bak`; restart one instance and verify login,
   human history and game resume.

- The flag acknowledges stopped writers; it does not stop/detect them.
- Validates data, writes a complete 0600 backup, then atomically replaces only `matches`.
- Preserves human history, accounts, sessions, friendships, emoji, media references and runtime;
  do not edit runtime results or media files.
- Changed/invalid input aborts; repeated cleanup is a no-op. Backups retain original bot entries.
- Restore only with writers stopped and the corresponding complete media backup.

## Database and media

Contracts: [`Repository`](../server/src/database/repository.ts),
[`schema`](../server/src/database/schema.ts), [migrations](../server/src/database/migrations.ts).

| Schema | Compatibility |
| --- | --- |
| Current: **5** | Startup migrates versions 1–4 and validates the result |
| v4 | Adds card back/image opacity defaults that preserve the previous look |
| v5 | Makes existing match history public once |
| Migration backup | Original file saved as `database.json.v<version>.bak` before persistence |
| Rollback | v4-only servers reject v5; stop writers and restore a compatible complete backup, accounting for newer writes |

| Collection | Contents |
| --- | --- |
| `accounts` | Identity, normalized username, password hash, profile, timestamps |
| `sessions` | Token digest, account, creation/expiry |
| `friendships` | Account pair, request/accepted status, timestamps |
| `matches` | Stable game ID, result, participants, completion |
| `emojis` | Owner, unique name, media reference |
| `runtime` | Players, rooms/readiness, games/private hands/logs, recent chat |

| Location | Rule |
| --- | --- |
| Development default | `server/data/database.json`, independent of cwd |
| `DATABASE_PATH` override | Relative paths resolve from cwd |
| Production | `/var/lib/card-together/database.json` |
| Images | Adjacent `media/`; content-addressed files and `media/owners/` quota markers |

- Back up/restore **all** media. Development state is Git-ignored, never statically exposed;
  images use the controlled endpoint.
- One process owns each JSON file; the duplicate-path guard is in-process, not a cross-process lock.
- Writes serialize, validate, write/fsync a same-directory temporary file, then rename atomically.
  Memory publishes only after success; power-loss durability also depends on the filesystem.
- Invalid JSON/version, duplicates or references stop startup without replacing the original.
- Runtime snapshots and completed matches commit together before ack/broadcast; failure restores managers.
- Restart preserves private hands and gives a fresh 60-second reconnect window. Tabs share a seat;
  only the last disconnect starts expiry.
- Empty rooms remove active game/chat state, not completed history. Chat retains 200 messages per room;
  voice is neither recorded nor stored in JSON.
- Room clocks, reserves and active deadlines persist. Existing deadlines survive restart;
  legacy snapshots get defaults/fresh clocks. See [turn clocks](architecture.md#turn-clocks)
  and [timer rules](games.md#turn-timer).

## Backup and restore

**Backup**

- Stop writers; copy the **entire state directory** (`database.json` and `media/`).
- Keep backups private: they contain password hashes and private hands. Maintain an off-host copy.
- Production deployment takes protected snapshots; [daily backup](deployment.md#daily-data-backup)
  keeps 14 complete snapshots. See [operations](deployment.md#operations-and-rollback) for commands/layout.

**Restore**

1. Stop every candidate writer and preserve current complete state separately.
2. Restore a compatible complete snapshot with correct ownership/restrictive permissions.
3. Start one service; verify login, history, media and game resume.

Restoring loses newer writes. Do not edit live JSON, discard data to fix startup,
or restore JSON with mismatched media.

## Future SQL adapter

SQL is not implemented. Preserve these contracts:

- Asynchronous Repository/public DTOs; atomic username/pair constraints.
- Compare-and-swap password updates, session revocation, atomic runtime+completed-history writes.
- Versioned JSON/JSONB runtime can preserve game semantics; multi-process room coordination needs separate design.

Migration sequence:

1. Run repository/auth/social/runtime tests against the adapter.
2. Stop writes; back up and validate JSON.
3. Import accounts, sessions, friendships, matches, emoji and runtime in one transaction.
   Preserve IDs/hashes/expiry/media references; reject conflicts rather than overwrite.
4. Compare counts, uniqueness, references and runtime; verify login/history/friendships/media/resume.
5. Switch repository construction and resume traffic only after validation.

After SQL accepts writes, rollback must export/reconcile newer data; the old JSON backup
is stale. Do not add dual writes without an explicit transactional design.
