# Accounts and storage

## Identity and sessions

| Item | Rule |
| --- | --- |
| Username | 3–24 ASCII letters, digits, underscores, optionally separated by single dots or hyphens; unique ignoring case |
| New password | 6–128 characters, no leading or trailing whitespace, not a listed common password |
| Existing passwords | Only the maximum length is enforced, so older passwords keep working |
| Password hashing | Salted async scrypt (`N=131072`, `r=8`, `p=1`) with bounded concurrency and HTTP rate limits |
| Identity | The account UUID is the player ID; nickname changes keep identity |
| Profile | Nickname (1–20 characters), six-digit color, avatar, optional images and opacity, seat background, history visibility |

- Login creates a seven-day opaque session; only its SHA-256 digest is stored.
- Cookies are HttpOnly and SameSite=Lax, plus Secure in production. Socket handshakes
  and actions revalidate the session.
- Logout revokes one session. Logout-all and password changes revoke every session and
  disconnect affected sockets.
- Password changes require the current password. There is no email or self-service
  recovery; administrators use the [offline reset](#administrator-password-reset).

**Players and privacy**

- Bots are `bot:<UUID>` with `isBot: true` and have no account, session, or profile.
- Any match with a bot is practice: it stays resumable but adds no history.
- History lists participants in N/E/S/W order. Blackjack and Hold'em list occupied seats
  only; legacy results without `seats` list four.
- History is public by default and owners can hide it. Schema v5 made every existing
  account public once; later choices persist.
- Seat backgrounds are shared with the room. Table backgrounds and card backs are private.

**Friends**

- Requests are unique per unordered pair, with sender and recipient permissions.
- Accepted friends see each other's online presence and hosted room code.
- Joining a friend's room rechecks friendship, host, and capacity. Invitations are
  ephemeral and limited to accepted friends.

**Direct messages and notifications**

- Only accepted friends can send private text, emoji, and stickers; the repository
  rechecks friendship atomically when storing a message. Only participants can read it.
- Messages support offline delivery and survive restart. Former friends retain read-only
  access to their existing conversation. Message records expire after 90 days, are hidden
  on every read, and are removed durably at startup and hourly while the server runs.
- Read cursors advance only to an incoming message in that conversation; older updates
  cannot make a message unread again. Read status is private to the reader.
- Sender-scoped client IDs deduplicate retries. Reusing an ID for another recipient or
  message returns a conflict. Media references preserve the original resolved content.
- Pending invitations come from friendships. Accepting an invitation creates a durable
  notice for its requester, dismissed only by that account or after 90 days.
- Notifications remain inside the site. Socket events invalidate participant data after
  persistence; reconnect reloads unread counts and history through authenticated HTTP.
- Retention applies to the active database. Backups retain their original contents and
  uploaded media follow the separate [media](media.md) lifecycle.

## Game coins

- Each human in a completed game earns `GAME_COIN_REWARD` (10) regardless of result,
  including games with bots. Spectators and aborted games earn nothing. Blackjack and
  Hold'em reward the whole match, not individual hands. Past matches were not rewarded.
- `rewardedGameIds` receipts prevent repeat awards, including after restarts.
- `Repository.saveRuntime` commits rewards, receipts, runtime, and completed history in one
  atomic write; `saveMatch` never awards coins.
- `coinRevision` increases on every balance change, including purchases, so clients can
  discard stale responses. Updates reach the owner through `account:coins`, `account:updated`,
  and resume ([API](api.md#socket-actions)).

## Avatar borders

- `purchaseAvatarBorder` checks the price, debits coins, and grants ownership in one
  atomic write. Repeat purchases are free no-ops; failed writes change nothing.
- The Repository validates catalog IDs, unique inventory, and that the equipped border is owned.

## Data compatibility

Optional fields added without a schema change; absent values use the default:

| Field | Default | Earlier servers |
| --- | --- | --- |
| `coins`, `coinRevision` | 0 | Keep the fields; award nothing |
| `rewardedGameIds` | Empty | Keep the field |
| `ownedAvatarBorders`, `avatarBorder` | Empty / original avatar | Keep the fields; cannot show or manage borders |
| `seatBackground` | Theme artwork | Ignore it; data and media stay |
| `RoomInfo.additionalSeats` (Ninety-Nine, Blackjack, Hold'em) | Four seats; up to four human-only extras | Unsupported: have players leave extra seats and the host remove them first |

- Ninety-Nine tied results (`winners`) cannot be read by earlier releases.
- Revisions before Sevens, Chinese Poker, Liar's Deck, Blackjack, or Texas Hold'em reject
  state containing those games.
- Never run two server versions against one database. Rollback steps:
  [deployment](deployment.md#rollback).

## Database

Contracts: [`Repository`](../server/src/database/repository.ts),
[schema](../server/src/database/schema.ts), [migrations](../server/src/database/migrations.ts).

| Schema version | Change |
| --- | --- |
| 6 (current) | Adds direct messages, private read cursors, and accepted-request notices |
| 5 | Makes existing match history public once |
| 4 | Card back and image opacity defaults that keep the previous look |
| 1–3 | Migrated at startup |

- Startup migrates older versions, validates the result, and saves the original as
  `database.json.v<version>.bak` first. Earlier servers reject v6 files; rollback requires
  a compatible complete backup and loses writes made after that backup.
- Invalid JSON, versions, duplicates, or references stop startup without touching the file.

| Collection | Contents |
| --- | --- |
| `accounts` | Identity, normalized username, password hash, profile, coins, timestamps |
| `sessions` | Token digest, account, creation and expiry |
| `friendships` | Account pair, status, timestamps |
| `matches` | Game ID, result, participants, completion time |
| `emojis` | Owner, unique name, media reference |
| `directMessages` | Sender, recipient, client ID, resolved content, timestamp |
| `messageReads` | Account, conversation peer, last incoming message read |
| `friendNotifications` | Requester, accepting account, timestamp |
| `runtime` | Players, rooms, readiness, games with private hands and logs, recent chat, clocks |

| Location | Path |
| --- | --- |
| Development | `server/data/database.json` (override: [`DATABASE_PATH`](development.md#configuration)) |
| Production | `/var/lib/card-together/database.json` |
| Images | `media/` beside the database: content-addressed files plus `media/owners/` quota markers |

**Write and recovery behavior**

- One process owns each JSON file. The duplicate-path guard is in-process only, not a
  cross-process lock.
- Each write serializes and validates, writes and fsyncs a temporary file in the same
  directory, then renames it. Memory updates only after success; power-loss durability
  also depends on the filesystem.
- Runtime and completed matches commit together before acknowledgment and broadcast.
- Restart keeps private hands, clocks, and deadlines, and gives disconnected players a
  fresh 60-second window ([architecture](architecture.md#state-commits)).
- Removing an empty room deletes its game and chat, not history. Chat keeps 200 messages
  per room. Voice is never stored.
- Development state is Git-ignored and never served statically; images go through the
  media endpoint.

## Backup and restore

**Backup:** stop writers, then copy the whole state directory (`database.json` and
`media/`). Backups hold password hashes and private hands: keep them private and keep an
off-host copy. Production snapshots: [deployment](deployment.md#backups).

**Restore:**

1. Stop every possible writer and save the current complete state separately.
2. Restore a compatible complete snapshot with restrictive permissions and correct ownership.
3. Start one service; verify login, history, media, and game resume.

Restoring loses newer writes. Never edit live JSON, delete data to fix startup, or
restore a database with mismatched media.

## Maintenance tools

Both tools are offline and share these requirements:

- Stop **all database writers** first and keep complete database and media backups.
  This disconnects players. `--writers-stopped` only confirms this; it neither stops
  nor detects services.
- Pass the configured database path explicitly. The file must use the current schema
  and be a regular file without symbolic or hard links; upgrade older data through a
  normal backed-up startup first.
- Run with the pinned Node.js version as the database file owner.
- Preview first (no writes), then apply. Keep the printed `.bak` file private.
- Restart a single instance afterwards.

### Administrator password reset

Resets a password without the old one. There is no web admin role or recovery endpoint.

1. Confirm the requester owns the account through a trusted channel; username,
   nickname, or history alone is not proof.
2. Preview, then apply (replace the path and the login username):

   ```sh
   npm run admin:reset-password -- /absolute/path/database.json alice
   npm run admin:reset-password -- /absolute/path/database.json alice --apply --writers-stopped
   ```

   Production, from the installed tree:

   ```sh
   sudo -u card-together sh -c 'cd /opt/card-together/server && ../node --import tsx src/auth/reset-password-cli.ts /var/lib/card-together/database.json alice'
   sudo -u card-together sh -c 'cd /opt/card-together/server && ../node --import tsx src/auth/reset-password-cli.ts /var/lib/card-together/database.json alice --apply --writers-stopped'
   ```

3. Enter the new password twice at the hidden prompts. Passwords are never accepted as
   arguments, environment variables, or redirected input.
4. Send the password through a trusted private channel and ask the owner to change it.
5. Restart and verify the new password works and old sessions are revoked.

- The username match ignores case; nicknames and account IDs are not accepted.
- Preview reports path, account ID, saved username, and session count.
- Apply writes a 0600 backup `.password-reset-<UUID>.bak`, uses the registration
  password policy and hashing, and changes only the target's password, timestamp, and sessions.
- Rejected input, wrong file owner, a concurrent source change, or a write failure leaves
  the database unchanged. "Applied with cleanup warnings" means the password **did**
  change; clean up the reported temporary or lock files.
- `.password-reset.lock` serializes reset tools only, not the application. Remove a stale
  lock only after confirming no reset is running.
- Restoring the backup restores the old password and sessions and loses newer writes.

### Legacy bot history cleanup

Older versions recorded bot matches in history. They are hidden at load time; this tool
removes them from disk. It never runs automatically.

```sh
npm run cleanup:bot-history -- /absolute/path/database.json
npm run cleanup:bot-history -- /absolute/path/database.json --apply --writers-stopped
```

- Writes a 0600 backup `.bot-history-<UUID>.bak`, then atomically replaces only `matches`.
- Keeps human history, accounts, sessions, friends, emoji, media, and runtime.
- Changed or invalid input aborts; a repeat run changes nothing.
- After restart, verify login, human history, and game resume.

## Future SQL adapter

Not implemented. An adapter must keep:

- The async Repository contract, public DTOs, and atomic username and friend-pair constraints.
- Compare-and-swap password updates, session revocation, and atomic runtime plus history writes.
- Versioned JSON/JSONB runtime is fine; multi-process room coordination needs a separate design.

Migration:

1. Pass the repository, auth, social, and runtime tests against the adapter.
2. Stop writes; back up and validate the JSON.
3. Import all collections in one transaction, keeping IDs, hashes, expiry, and media
   references; reject conflicts instead of overwriting.
4. Compare counts, uniqueness, and references; verify login, history, friends, media, and resume.
5. Switch the repository and resume traffic only after validation.

Once SQL accepts writes, the JSON backup is stale: rollback must export newer data. Do
not add dual writes without a transactional design.
