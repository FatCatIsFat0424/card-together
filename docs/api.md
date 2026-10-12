# HTTP and Socket API

- Paths are backend-relative; production Nginx mounts them below `/card-together/`.
- Requests/responses use JSON: `{ success: true, ... }` or `{ success: false, error: string }`, with appropriate HTTP status.
- Mutations require an allowed Origin and JSON Content-Type; send `{}` for an empty body.
- Protected routes use session cookies. Only immutable uploaded-image reads are cached.
- Authoritative contracts: `shared/src/types/`.

## HTTP

| Method/path | Input | Result |
| --- | --- | --- |
| `POST /api/auth/register` | `username, password, nickname?, color?, avatar?` | 201, account and session cookie |
| `POST /api/auth/login` | `username, password` | Account and session cookie |
| `GET /api/auth/me` | — | Current account |
| `PATCH /api/auth/profile` | Profile fields | Updated account and connected-player synchronization |
| `POST /api/auth/shop/avatar-borders` | `border`: catalog ID | Updated account; permanent border purchase using the server price |
| `POST /api/auth/password` | `currentPassword, newPassword` | Revoke all sessions; sign in again |
| `POST /api/auth/logout` | `{}` | Revoke presented sessions and clear cookies |
| `POST /api/auth/logout-all` | `{}` | Revoke every account session |
| `GET /api/account/history` | — | All of the current account's completed human-only matches, newest first |
| `GET /api/players/:accountId` | — | Public profile |
| `GET /api/players/:accountId/history` | — | All human-only matches, newest first, and participant map; owner/public only |
| `GET /api/friends` | — | `friends, incoming, outgoing`; friends include online/in-room presence and nullable `hostedRoomCode` |
| `GET /api/friends/search?username=...` | Exact username | Public account or null |
| `POST /api/friends/requests` | `username` | 201, request |
| `POST /api/friends/requests/:id/accept` | `{}` | Recipient accepts |
| `DELETE /api/friends/requests/:id` | `{}` | Recipient declines or sender cancels |
| `DELETE /api/friends/:accountId` | `{}` | Remove accepted friendship |
| `POST /api/media` | `data` (base64), `purpose` | Uploaded image ID; purpose: avatar/emoji/background/cardBack ([limits](media.md#images-and-chat)) |
| `GET /api/media/:id` | — | Public immutable image bytes |
| `GET /api/emojis` | — | Current owner's emoji entries |
| `POST /api/emojis` | `items: [{ name, mediaId }]` | 201, created entries; 1–50 unique [names](media.md#images-and-chat) |
| `PATCH /api/emojis/:id` | `name` | Rename owned entry |
| `DELETE /api/emojis/:id` | `{}` | Delete owned entry |
| `POST /api/emojis/delete` | `ids`: 1–300 unique ID strings | `deleted`: IDs removed in one atomic write; IDs that are unknown or not the caller's are ignored |
| `GET /health` | — | `{ status: 'ok' }` |

**Authentication and media:**

- Register/login and image/health reads need no prior session. Logout also accepts unauthenticated requests and revokes any presented valid sessions; other routes require authentication.
- Media endpoints return 503 when image storage is unavailable.
- Uploads check Origin, session, and rate limits before parsing. The 3 MiB body limit fits a base64-encoded 2 MiB emoji/background; oversized decoded images return 413.
- Per-account quota: `MEDIA_QUOTA_BYTES` (100 MiB of distinct uploaded images). Owned-image reuploads are free; replaced images still count. Exceeding quota returns 413; ownership markers live in `media/owners/`.
- See [media store](../server/src/media/media-store.ts) and [media limits](media.md).

**Profile updates:**

| Fields | Accepted values / behavior |
| --- | --- |
| Nickname, color, preset avatar, history visibility | Validated profile values |
| `avatarImage`, `seatBackground`, `tableBackground`, `cardBack` | Uploaded media ID or null |
| `tableBackgroundOpacity`, `cardBackOpacity` | Integer percent 20–100 |
| `avatarBorder` | Null (original avatar) or owned catalog ID; unowned returns 403 |
| `seatBackground` | Uses `background` upload purpose; shared in room `PlayerInfo`; null restores default |
| Omitted fields | Keep current values |
| Invalid values | 400 |
| `ownedAvatarBorders`, `coins`, `coinRevision` | Server-owned; cannot be changed through registration/profile updates |

**Shop and coins:**

- Purchases use the usual session, Origin, JSON, and rate checks. Unknown border: 400; insufficient coins: 409.
- Prices come from [`shop.ts`](../shared/src/constants/shop.ts), never client inputs. Repeat purchases do not charge twice; purchases do not equip automatically.
- A completed game grants each participating human `GAME_COIN_REWARD` (currently 10), regardless of winner, including bot games. Spectators/aborted games earn nothing.
- No retroactive history rewards; Hold'em/Blackjack reward the complete match, not individual hands.
- After durable settlement, private `account:coins` events update every rewarded account's tabs. `coinRevision` increases on every balance change, including debits; authenticated resume also returns balance/revision.
- Private `account:updated` events return the owner's account after purchases/saved profile changes.

**Privacy and history:**

| Contract / response | Contents / limits |
| --- | --- |
| `AccountProfile` | Private preferences/timestamps and owner's coins (zero for older accounts) |
| `PublicAccount` | ID, username, nickname, color, avatar, avatarImage, equipped avatarBorder; no inventory/balance |
| All responses | No credential/session digests |
| Player/history errors | Invalid ID: 400; unknown player: 404; private history: 403 |
| History endpoints | All eligible records, no pagination/count cap; participant maps include older-match accounts |

The frontend searches, filters, sorts, and calculates statistics over the full history
response. See [storage](storage.md).

## Socket actions

- Handshake/every action require a valid session and allowed Origin. Actor identity comes from the session, never client input.
- The final argument must be a callback; without it, actions do not execute. Empty-payload actions take the callback directly.
- Failures: `{ success: false, error }`. Acknowledge success after persistence, except ephemeral signaling/unchanged-state operations.
- Game types: `bridge`, `bigtwo`, `redpoints`, `ninetynine`, `sevens`, `chinesepoker`, `liarsdeck`, `blackjack`, `holdem`.
- Standard seats: `N`, `E`, `S`, `W`. Exact unions/results: [`socket-events.ts`](../shared/src/types/socket-events.ts).

| Action | Payload | Success |
| --- | --- | --- |
| `player:resume` | — | PlayerSnapshot; attach/restore account |
| `room:create` | `{ gameType }` | `{ success, roomCode }` |
| `room:join` | `{ roomCode }` | `{ success, room }`; joins as a spectator, also during a match |
| `room:joinFriend` | `{ accountId, roomCode }` | `{ success, room }`; joins an online accepted friend's currently hosted room as a spectator; atomically leaves the previous room |
| `room:invite` | `{ accountId }` | Invite an accepted friend while spectator room remains |
| `room:leave` | — | Leave; a seated player's leave aborts an unfinished game |
| `room:kick` | `{ accountId }` | Host removes another human member (spectators also during a match); they may rejoin by code |
| `room:changeSeat` | `{ seat }` | Change available seat |
| `room:movePlayer` | `{ accountId, target }` | Host moves a human member while waiting; `target` is the shared `RoomSeatTarget` union |
| `room:addSeat`, `room:removeSeat` | — | Host appends an additional seat (eight total maximum) or removes the last empty additional seat; waiting Ninety-Nine/Blackjack/Hold'em rooms only |
| `room:changeAdditionalSeat` | `{ index }` | Take an available additional seat; index is zero-based in `RoomInfo.additionalSeats` |
| `room:standUp` | — | Leave the seat to spectate while waiting |
| `room:setGameType` | `{ gameType }` | Host changes waiting room game |
| `room:setTimeControl` | `TimeControl` | Host changes waiting room timer; clears human readiness |
| `room:setSevensOptions` | `SevensOptions` | Host changes waiting Sevens room rules and the Dragon Slaying effect (`slayEffect`: `dragon` or `fire`, missing means `dragon`); changing `closeOnEnd` clears human readiness, changing only the effect keeps it |
| `room:setNinetyNineOptions` | `NinetyNineOptions` | Host changes waiting Ninety-Nine room rules; clears human readiness |
| `room:setBlackjackOptions` | `BlackjackOptions` | Host changes waiting Blackjack room rules (player dealer); clears human readiness |
| `room:addBot`, `room:removeBot` | `{ seat }` | Host adds/removes a bot while waiting |
| `room:fillBots` | — | Host fills every empty seat with ready bots |
| `room:ready`, `room:unready` | — | Update readiness; four ready seats start |
| `game:redealResponse` | `{ accept }` | Eligible Bridge player decides |
| `game:bid` | `{ bid }` | Bridge bid/pass |
| `game:playCard` | `{ card }` | Bridge card |
| `game:bigtwo:play` | `{ cards }` | Big Two legal group |
| `game:bigtwo:pass` | — | Big Two pass |
| `game:redpoints:play` | `{ card, capture? }` | Play and optional selected capture |
| `game:redpoints:chooseFlip` | `{ capture }` | Resolve flipped-card capture choice |
| `game:ninetynine:play` | `{ card, choice?, target? }` | +/- choice or target seat |
| `game:sevens:play` | `{ card }` | Sevens legal card |
| `game:sevens:cover` | `{ card }` | Sevens face-down cover when no card is playable |
| `game:chinesepoker:arrange` | `{ arrangement: { front, middle, back } }` | Final 3/5/5 Chinese Poker arrangement before the shared deadline |
| `game:liarsdeck:play` | `{ cardIds }` | Liar's Deck: one to three distinct deck card ids (0–19) from the hand, played face down |
| `game:liarsdeck:challenge` | — | Liar's Deck: call LIAR on the previous play |
| `game:blackjack:bet` | `{ amount }` | Blackjack: 10–200 chips in steps of 10, within the seat's chips, before the shared betting deadline |
| `game:blackjack:action` | `{ action }` | Blackjack: `hit`, `stand`, `double`, or `split` for the acting hand |
| `game:blackjack:dealerAction` | `{ action }` | Blackjack player dealer: `hit` or `stand` on its own turn; standing below 17 is rejected |
| `game:holdem:action` | `{ action }` | Hold'em: `{ type: 'fold' \| 'check' \| 'call' }` or `{ type: 'raise', to }`, where `to` is the street stake after a bet or raise |
| `game:continue` | — | Seated player or spectator leaves the result for the waiting room; others keep it |
| `game:abortVote:start` | — | Start seated-player abort vote |
| `game:abortVote:cast` | `{ agree }` | Record one vote |
| `chat:send` | `{ message }`, `{ stickerId }`, or `{ providedSticker }` | Send text, an owned sticker, or a site emoji sticker by name |

**Chat images — [`ChatMessage`](../shared/src/types/chat.ts):**

- Images are server-resolved. `:name:` tokens use `emojis` (personal media IDs) and `providedEmojis` (site files): at most 20 names combined, with no name in both.
- Sticker messages have empty content and one personal `sticker` or `providedSticker: { name, file }`.
- Site files: `<base>/provided-emoji/<file>`. Older messages remain valid; see [media](media.md#site-provided-emoji).

**Authority, bots, and host placement:**

- Play/pass/capture and continue wait for the presentation deadline; continue also requires scoring. Server validates turn/card/room authority; see [games](games.md).
- Optional `isBot`: absent/false means human. Reserved `bot:<UUID>` identities cannot authenticate or receive player snapshots.
- [`RoomSeatTarget`](../shared/src/types/room.ts): standard seat, zero-based additional seat index, or spectators.
- `room:movePlayer` targets a human in the host's waiting room. Occupied destinations exchange occupants; a spectator taking an occupied human seat exchanges spectator status, preserving membership.
- Moving to spectators respects capacity. Bots cannot be dragged/displaced into spectators or additional seats.
- Placement changes reset human readiness, keep bots ready, and persist before acknowledgement/broadcast.

**Clocks:**

- [`TimeControl`](../shared/src/types/room.ts) uses validated [shared limits](../shared/src/time-control.ts).
- [`GameClock`](../shared/src/types/game.ts) exposes active seat, committed deadlines, remaining reserves, and server time for client correction.
- Server enforces expiry; frontend countdowns do not authorize moves. See [timer rules](games.md#turn-timer).

**Server snapshots and notices:**

| Event / field | Behavior |
| --- | --- |
| `player:state` | Same `PlayerSnapshot` as resume: optional player, room, gameState, recent chat, success/error |
| Resume chat history | Always included; replaces the client's copy |
| Broadcast chat history | Included only when recipient's room changes |
| `chat:message { roomCode, message }` | New messages appended once by ID |
| Missing room/game | Clears old client state |
| Game state | Recipient-filtered hand/legal choices, public logs, results, presentation metadata; see [spectator visibility](games.md#spectators-and-god-view) |
| Snapshot recipients | Actor/affected room members and same-account tabs; no unrelated rooms |
| `room:invited` | Ephemeral room/game/sender/seat-availability notice |
| `room:kicked { roomCode }` | Follows removed member's room-less snapshot |

## Voice signaling

- Voice membership is ephemeral and authorized against committed room membership.
- Socket.IO carries negotiation; WebRTC carries audio without database writes.
- Join/leave/settings use the runtime queue. `voice:signal` relays synchronously outside it, checking connection, session expiry, and current voice peers.

| Client action | Payload | Success |
| --- | --- | --- |
| `voice:join` | `{ muted, deafened }` | `{ success, peerId, state }` |
| `voice:leave` | — | `{ success }` |
| `voice:settings` | `{ muted, deafened }` | `{ success }` |
| `voice:signal` | `{ targetPeerId, description?, candidate? }` | `{ success }` |

**Validation and limits:**

- Exactly one description/candidate. Offer/answer SDP: at most 12,000 characters; validated ICE candidate: at most 2,048 characters.
- Source identity is server-assigned; target must be a current same-room peer.
- One voice tab per account; each new join cycle receives a fresh peer ID.

| Action group | Per-account limit, shared across tabs |
| --- | --- |
| Voice | 1,200 actions/minute, separate from other actions |
| Other actions | 240 actions/minute |
| `chat:send` | Additional 5 messages per 5 seconds |

| Server event | Payload |
| --- | --- |
| `voice:state` | `{ roomCode, participants }`; participants: peerId/accountId/muted/deafened |
| `voice:signal` | `{ fromPeerId, description?, candidate? }` |
| `voice:left` | `{ reason }` |

See [voice operation/configuration](media.md#voice).
