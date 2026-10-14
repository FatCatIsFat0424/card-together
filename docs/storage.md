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
- History lists participants in N/E/S/W/P5/P6/P7/P8 order. Ninety-Nine, Blackjack, and
  Hold'em list occupied seats only; legacy results without `seats` list four.
- Flexible game snapshots restore legacy four-seat value maps with empty additional
  values. New matches persist up to eight seats; missing `shuffleSeats` means false.
  These extended snapshots/results require this version or newer: when rolling back
  to an older server, restore the complete compatible backup following the deployment guide.
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

## Daily rewards

- Private optional `AccountRecord.dailyRewards` stores the active Taiwan date, distinct
  completed game types, per-game counts and wins (capped at two), three assigned task IDs,
  the once-per-day replacement receipt, task claim receipts, and check-in dates.
  The [record and date rules](../server/src/database/daily-rewards.ts) are validated on
  every write. Older accounts start empty; historical matches are not backfilled.
- Daily progress is committed with game coins under the existing `rewardedGameIds`
  receipt. Retries and restarts cannot increment progress twice. Read-time reset at
  00:00 Asia/Taipei requires no scheduler or database write; the next mutation persists it.
- Initial assignments use a deterministic SHA-256 shuffle of account ID, Taiwan date,
  and pool IDs. Read-only refreshes do not change them. Existing same-day claim receipts
  are preserved when upgrading from fixed tasks; known played types seed a count of one.
- `Repository.replaceDailyTask` serializes the allowance check and assignment change.
  It excludes the original three tasks, retains today's counters, and never changes coins.
  Retries for the original task return the saved replacement; competing swaps cannot
  consume more than one allowance. Claiming requires a currently assigned task.
- `Repository.claimDailyReward` checks the date and eligibility inside the serialized
  transaction, then updates the receipt, coins, and `coinRevision` together. Repeated
  claims return the saved state; failed writes leave the reward available. No client
  progress, amount, account ID, or past/future check-in date is trusted.
- All check-in receipts are retained. The owner API returns only this month's dates;
  private progress and receipts are omitted from public account/profile responses.

## Achievements

- Optional private `AccountRecord.achievements` stores cumulative completed games,
  unique variants, wins, and claimed daily-task counts, capped at catalog targets.
  See the [record and validation](../server/src/database/achievements.ts).
  Missing counters start at zero; existing history is not replayed. Check-in progress
  uses all retained daily check-in receipts, including those from before this feature.
- Game progress commits atomically with coins and `rewardedGameIds`. Daily task counts
  increment only in the first successful task-claim transaction and survive daily resets.
  Retries or failed persistence cannot inflate either counter.
- `Repository.claimAchievement` checks every catalog milestone inside the serialized
  transaction and grants the exclusive title to `ownedAchievementNameplates` once.
  This permanent owner-only inventory is separate from `ownedShopItems` and cannot be
  purchased. Claims preserve coins and equipped cosmetics, advance `updatedAt`, and
  publish owner updates only after persistence. Private counters never enter profiles.

## Avatar borders

- Legacy border inventory and purchase routes remain supported by the
  [cosmetic inventory](#cosmetic-inventory).

## Cosmetic inventory

- `Repository.purchaseShopItem` uses the shared [catalog](../shared/src/constants/shop.ts),
  debits coins, increments `coinRevision`, and grants permanent ownership in one atomic
  write. Repeat purchases are no-ops; failed writes change neither inventory nor balance.
  Purchases do not equip items.
- Product and sticker IDs are durable references. Renaming or removing them requires
  a compatible data migration and retained artwork for owned products and history.
- Borders retain `ownedAvatarBorders`; other products use private `ownedShopItems`.
  Equipment fields are defined in [AccountProfile](../shared/src/types/account.ts).
  Both the service and Repository validate the item type and ownership before equipping.
  The database rejects unknown IDs, duplicate inventories, and unowned equipment.
- Official image styles override retained uploads while equipped. Null restores the
  upload or theme without losing media. Public profiles contain the cosmetic nameplate;
  room identities also contain the seat style. Inventories and card/table styles remain
  owner-only. Purchases and equipment changes refresh every connected owner tab.
- Sticker messages store stable catalog IDs. Sending requires the containing pack;
  recipients can render them without ownership. Existing emoji and uploaded stickers
  keep their separate, free behavior.

## Data compatibility

Optional fields added without a schema change; absent values use the default:

| Field | Default | Earlier servers |
| --- | --- | --- |
| `coins`, `coinRevision` | 0 | Keep the fields; award nothing |
| `rewardedGameIds` | Empty | Keep the field |
| `AccountRecord.dailyRewards` | No progress or claims | Keep the field; games completed on older servers do not advance daily tasks |
| `AccountRecord.achievements`, `ownedAchievementNameplates` | Zero counters / empty earned inventory | Counters do not advance; equipped earned titles in accounts or runtime are unsupported. Restore a compatible complete backup before rollback |
| `ownedAvatarBorders`, `avatarBorder` | Empty / original avatar | Keep the fields; cannot show or manage borders |
| `ownedShopItems`, official image style fields, `nameplate` | Empty inventory / uploaded image or theme / no nameplate | Cannot show or manage products; older profile writes may drop equipment |
| `shopSticker` in room/private messages | Absent | Unsupported: restore a compatible complete backup before rollback |
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
