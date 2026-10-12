# HTTP and Socket API

Authoritative types: [`shared/src/types/`](../shared/src/types). Paths are
backend-relative; production Nginx serves them below `/card-together/`.

## HTTP

- JSON bodies: `{ success: true, ... }` or `{ success: false, error }` with a matching status.
- Mutations require an allowed Origin and JSON Content-Type; send `{}` for an empty body.
- Session cookies authenticate. No session is needed for register, login, logout
  (which revokes any presented valid sessions), image reads, and health.
- Only immutable image reads are cached.

| Method and path | Input | Result |
| --- | --- | --- |
| `POST /api/auth/register` | `username, password, nickname?, color?, avatar?` | 201, account, session cookie |
| `POST /api/auth/login` | `username, password` | Account, session cookie |
| `GET /api/auth/me` | — | Current account |
| `PATCH /api/auth/profile` | [Profile fields](#profile-fields) | Updated account; synchronizes connected players |
| `POST /api/auth/shop/avatar-borders` | `border` (catalog ID) | Updated account after purchase |
| `POST /api/auth/password` | `currentPassword, newPassword` | Revokes all sessions |
| `POST /api/auth/logout` | `{}` | Revokes presented sessions, clears cookies |
| `POST /api/auth/logout-all` | `{}` | Revokes every session of the account |
| `GET /api/account/history` | — | Own human-only matches, newest first |
| `GET /api/players/:accountId` | — | Public profile |
| `GET /api/players/:accountId/history` | — | Matches and participant map, if owner or public |
| `GET /api/friends` | — | `friends, incoming, outgoing`; friends include presence and nullable `hostedRoomCode` |
| `GET /api/friends/search?username=` | Exact username | Public account or null |
| `POST /api/friends/requests` | `username` | 201, request |
| `POST /api/friends/requests/:id/accept` | `{}` | Recipient accepts |
| `DELETE /api/friends/requests/:id` | `{}` | Recipient declines or sender cancels |
| `DELETE /api/friends/:accountId` | `{}` | Removes the friendship |
| `GET /api/messages` | — | Incoming invitations, accepted-request notices, conversations with unread counts |
| `GET /api/messages/:accountId` | Optional `before` message ID | Latest 50 messages before the cursor, chronological; account, `hasMore`, `canSend` |
| `POST /api/messages/:accountId` | `clientId` plus `message`, `stickerId`, or `providedSticker` | 201, message; accepted friends only |
| `POST /api/messages/:accountId/read` | `messageId` | Advances the reader's incoming-message cursor |
| `POST /api/messages/notifications/read` | `ids`: 1–100 unique notice IDs | Dismisses only the authenticated account's accepted-request notices |
| `POST /api/media` | `data` (base64), `purpose`: `avatar`, `emoji`, `background`, `cardBack` | Image ID |
| `GET /api/media/:id` | — | Immutable image bytes |
| `GET /api/emojis` | — | Own emoji entries |
| `POST /api/emojis` | `items: [{ name, mediaId }]`, 1–50 unique names | 201, created entries |
| `PATCH /api/emojis/:id` | `name` | Renames an owned entry |
| `DELETE /api/emojis/:id` | `{}` | Deletes an owned entry |
| `POST /api/emojis/delete` | `ids`: 1–300 unique IDs | `deleted` IDs, in one atomic write; unknown or foreign IDs are ignored |
| `GET /health` | — | `{ status: 'ok' }` |

### Profile fields

| Field | Accepted values |
| --- | --- |
| `nickname`, `color`, `avatar`, history visibility | Validated profile values ([storage](storage.md#identity-and-sessions)) |
| `avatarImage`, `seatBackground`, `tableBackground`, `cardBack` | Uploaded media ID or null; `seatBackground` uses the `background` purpose and is shared in room `PlayerInfo` |
| `tableBackgroundOpacity`, `cardBackOpacity` | Integer percent 20–100 |
| `avatarBorder` | Null (original) or an owned catalog ID; unowned returns 403 |
| `coins`, `coinRevision`, `ownedAvatarBorders` | Server-owned; never set by register or profile requests |

Omitted fields keep their values; invalid values return 400.

### Status codes

| Case | Status |
| --- | --- |
| Invalid player ID / unknown player / private history | 400 / 404 / 403 |
| Unknown border / insufficient coins | 400 / 409 |
| Oversized image or quota exceeded ([limits](media.md#uploads)) | 413 |
| Image storage unavailable | 503 |

### Response contents

- `AccountProfile` (owner only): preferences, timestamps, coins, owned borders.
- `PublicAccount`: ID, username, nickname, color, avatar, avatar image, equipped border.
  No balance or inventory.
- No response contains password hashes or session digests.
- History endpoints return every eligible record without pagination; participant maps
  include accounts from older matches. Search, filters, and statistics run in the client.
- Shop prices come from [`shop.ts`](../shared/src/constants/shop.ts), never from the
  client. Repeat purchases do not charge again and do not equip. Coin rules:
  [storage](storage.md#game-coins).
- Direct-message contracts: [`direct-message.ts`](../shared/src/types/direct-message.ts).
  Reads require an accepted friendship or retained participant history. Sending allows
  1–500 trimmed characters or one owned/site sticker. `clientId` uses 8–64 ASCII letters,
  digits, underscores, or hyphens; retry the same ID and content after an uncertain result.
  Non-friends return 403, conflicting retries 409, inaccessible conversations 404,
  malformed or expired cursors 400. Retention and removal: [storage](storage.md#identity-and-sessions).

## Socket actions

- The handshake and every action require a valid session and allowed Origin. The actor
  comes from the session, never from the payload.
- The last argument must be a callback, or the action is ignored. Actions without a
  payload take only the callback.
- Failures return `{ success: false, error }`. Success is acknowledged after persistence,
  except for ephemeral signaling and unchanged state.
- Game types: `bridge`, `bigtwo`, `redpoints`, `ninetynine`, `sevens`, `chinesepoker`,
  `liarsdeck`, `blackjack`, `holdem`. Standard seats: `N`, `E`, `S`, `W`.
- Exact payloads and results: [`socket-events.ts`](../shared/src/types/socket-events.ts).

**Rooms**

| Action | Payload | Effect |
| --- | --- | --- |
| `player:resume` | — | Returns `PlayerSnapshot`; attaches or restores the account |
| `room:create` | `{ gameType }` | Returns `roomCode` |
| `room:join` | `{ roomCode }` | Joins as a spectator, also during a match |
| `room:joinFriend` | `{ accountId, roomCode }` | Joins an online friend's hosted room as a spectator, leaving the previous room atomically |
| `room:invite` | `{ accountId }` | Invites an accepted friend while spectator space remains |
| `room:leave` | — | Leaves; a seated player's leave aborts an unfinished game |
| `room:kick` | `{ accountId }` | Host removes another human (spectators also during a match); they may rejoin by code |
| `room:changeSeat` | `{ seat }` | Takes an available standard seat |
| `room:changeAdditionalSeat` | `{ index }` | Takes an extra seat; zero-based index into `RoomInfo.additionalSeats` |
| `room:standUp` | — | Becomes a spectator while waiting |
| `room:movePlayer` | `{ accountId, target }` | Host moves a human while waiting; `target` is a [`RoomSeatTarget`](../shared/src/types/room.ts) |
| `room:addSeat`, `room:removeSeat` | — | Host adds an extra seat (eight total) or removes the last empty one; waiting Ninety-Nine, Blackjack, Hold'em only |
| `room:addBot`, `room:removeBot` | `{ seat }` | Host adds or removes a bot while waiting |
| `room:fillBots` | — | Host fills empty seats with ready bots |
| `room:ready`, `room:unready` | — | Sets readiness; four ready seats start the match |

**Waiting-room settings** (host only; each clears human readiness unless noted)

| Action | Payload |
| --- | --- |
| `room:setGameType` | `{ gameType }` |
| `room:setTimeControl` | [`TimeControl`](../shared/src/types/room.ts) |
| `room:setSevensOptions` | `SevensOptions`; `slayEffect` is `dragon` (default) or `fire`. Changing only the effect keeps readiness |
| `room:setNinetyNineOptions` | `NinetyNineOptions` |
| `room:setBlackjackOptions` | `BlackjackOptions` (player dealer) |

**Games**

| Action | Payload | Effect |
| --- | --- | --- |
| `game:redealResponse` | `{ accept }` | Bridge redeal decision |
| `game:bid` | `{ bid }` | Bridge bid or pass |
| `game:playCard` | `{ card }` | Bridge card |
| `game:bigtwo:play` / `pass` | `{ cards }` / — | Big Two group or pass |
| `game:redpoints:play` | `{ card, capture? }` | Play with an optional chosen capture |
| `game:redpoints:chooseFlip` | `{ capture }` | Chooses the flipped card's capture |
| `game:ninetynine:play` | `{ card, choice?, target? }` | Plus/minus choice or target seat |
| `game:sevens:play` / `cover` | `{ card }` | Plays a legal card, or covers one when blocked |
| `game:chinesepoker:arrange` | `{ arrangement: { front, middle, back } }` | Final 3/5/5 arrangement |
| `game:liarsdeck:play` | `{ cardIds }` | One to three distinct card IDs (0–19), face down |
| `game:liarsdeck:challenge` | — | Calls LIAR on the previous play |
| `game:blackjack:bet` | `{ amount }` | 10–200 in steps of 10, within chips |
| `game:blackjack:action` | `{ action }` | `hit`, `stand`, `double`, or `split` |
| `game:blackjack:dealerAction` | `{ action }` | Player dealer `hit` or `stand`; standing below 17 is rejected |
| `game:holdem:action` | `{ action }` | `{ type: 'fold' \| 'check' \| 'call' }` or `{ type: 'raise', to }`, where `to` is the street total |
| `game:continue` | — | Leaves the result for the waiting room; others keep it |
| `game:abortVote:start` / `cast` | — / `{ agree }` | Starts or votes on an abort ([rules](games.md#shared-room-lifecycle)) |
| `chat:send` | `{ message }`, `{ stickerId }`, or `{ providedSticker }` | Text, an owned sticker, or a site emoji sticker by name |

**Authority**

- The server checks turn, card, and room authority and waits for the
  [presentation deadline](architecture.md#presentation-timeline). Rules: [games](games.md).
- [`GameClock`](../shared/src/types/game.ts) exposes the active seat, deadlines, reserves,
  and server time. Only the server enforces expiry.
- `isBot` absent or false means human. `bot:<UUID>` identities cannot authenticate or
  receive snapshots.
- `room:movePlayer`: occupied destinations swap occupants; a spectator taking a human's
  seat swaps spectator status. Bots never move into spectators or extra seats. Moves
  respect spectator capacity, reset human readiness, and keep bots ready.

**Server events**

| Event | Contents |
| --- | --- |
| `player:state` | `PlayerSnapshot` as from resume: optional player, room, game state, chat, error. Missing room or game clears client state |
| `chat:message` | `{ roomCode, message }`; clients append once per ID |
| `room:invited` | Ephemeral invitation: room, game, sender, seat availability |
| `room:kicked` | `{ roomCode }`, after the removed member's room-less snapshot |
| `account:coins` | Private balance and `coinRevision` after rewards |
| `account:updated` | Private account after purchases or saved profile changes, to all owner tabs |
| `social:changed` | No payload; affected accounts reload invitations, conversations, and unread counts |

- Snapshots go to the actor's tabs and affected room members only. Game state is
  recipient-filtered ([spectators](games.md#spectators-and-god-view)).
- Resume always includes chat history, replacing the client copy; broadcasts include it
  only when the recipient's room changed.
- [`ChatMessage`](../shared/src/types/chat.ts) images are resolved by the server:
  `emojis` (personal media IDs) and `providedEmojis` (site files), at most 20 names
  combined with no overlap. Sticker messages have empty content and one `sticker` or
  `providedSticker: { name, file }`, served from `<base>/provided-emoji/<file>`.

## Voice signaling

Voice membership is ephemeral and checked against committed room membership.
Socket.IO carries negotiation; audio flows over WebRTC without database writes.
Operation and configuration: [media](media.md#voice).

| Client action | Payload | Success |
| --- | --- | --- |
| `voice:join` | `{ muted, deafened }` | `{ success, peerId, state }` |
| `voice:leave` | — | `{ success }` |
| `voice:settings` | `{ muted, deafened }` | `{ success }` |
| `voice:signal` | `{ targetPeerId, description?, candidate? }` | `{ success }` |

| Server event | Payload |
| --- | --- |
| `voice:state` | `{ roomCode, participants }` with peer ID, account ID, muted, deafened |
| `voice:signal` | `{ fromPeerId, description?, candidate? }` |
| `voice:left` | `{ reason }` |

- Join, leave, and settings run in the runtime queue. `voice:signal` relays immediately,
  checking connection, session expiry, and that the target is a current same-room peer.
- Each signal has exactly one description (SDP ≤ 12,000 characters) or candidate
  (≤ 2,048 characters). The server assigns the source.
- One voice tab per account; every join gets a fresh peer ID.

## Rate limits

Per account, shared across tabs:

| Actions | Limit |
| --- | --- |
| Voice | 1,200 per minute |
| All other Socket actions | 240 per minute |
| `chat:send` | Also 5 per 5 seconds |

HTTP credential and upload routes have their own limits ([storage](storage.md#identity-and-sessions)).
Direct-message sends allow 5 requests per 5 seconds per account across tabs, including
retries. HTTP 429 includes `Retry-After`; reading history and marking read do not consume
the sending budget.
