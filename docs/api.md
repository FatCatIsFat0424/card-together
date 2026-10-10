# HTTP and Socket API

HTTP paths below are backend-relative. Production Nginx mounts them below
`/card-together/`. Requests/responses are JSON; successful operations use
`{ success: true, ... }`, failures `{ success: false, error: string }` with an appropriate
HTTP status. Mutations require an allowed Origin and JSON Content-Type (`{}` for an empty
body). Session cookies authenticate protected routes. API responses are not cached,
except immutable uploaded-image reads. Contracts live in `shared/src/types/`.

## HTTP

| Method/path | Input | Result |
| --- | --- | --- |
| `POST /api/auth/register` | `username, password, nickname?, color?, avatar?` | 201, account and session cookie |
| `POST /api/auth/login` | `username, password` | Account and session cookie |
| `GET /api/auth/me` | — | Current account |
| `POST /api/auth/migrate-session` | `{}` | Same-origin legacy session migration; unchanged expiry |
| `PATCH /api/auth/profile` | Profile fields | Updated account and connected-player synchronization |
| `POST /api/auth/password` | `currentPassword, newPassword` | Revoke all sessions; sign in again |
| `POST /api/auth/logout` | `{}` | Revoke presented sessions and clear cookies |
| `POST /api/auth/logout-all` | `{}` | Revoke every account session |
| `GET /api/account/history` | — | Current account's latest 50 completed matches |
| `GET /api/players/:accountId` | — | Public profile |
| `GET /api/players/:accountId/history` | — | Latest 50 matches and participant map; owner/public only |
| `GET /api/friends` | — | `friends, incoming, outgoing`; friends include online/in-room presence |
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

Register/login and image/health reads do not require a prior session. Migration
requires a valid existing legacy session, authenticated by the endpoint itself.
Logout accepts unauthenticated requests but revokes any presented valid sessions;
other routes require session authentication. Media endpoints return 503 if image storage is unavailable.
Uploads check origin, session, and rate limits before parsing the up-to-3 MiB body, which
fits a base64-encoded 2 MiB emoji or background. Larger decoded images return 413. Each
account may store `MEDIA_QUOTA_BYTES` (100 MiB, [media store](../server/src/media/media-store.ts))
of distinct images it uploaded; re-uploading an owned image is free, and replaced images still
count. Exceeding the quota returns 413. Ownership markers live in `media/owners/`.
Profile updates support nickname, color, preset avatar, uploaded avatar/table
background/card back (`avatarImage`, `tableBackground`, `cardBack`: an uploaded media ID or
null), image opacity (`tableBackgroundOpacity`, `cardBackOpacity`: integer percent 20–100),
and history visibility. Omitted fields keep their values; invalid values return 400.
`AccountProfile` includes private profile preferences/timestamps;
`PublicAccount` exposes only ID, username, nickname, color, avatar, and avatarImage.
No response exposes credential/session digests. Invalid player IDs return 400, unknown
players 404, and private histories 403. See [storage](storage.md) and [media limits](media.md).

## Socket actions

Handshake and every action require a valid session and allowed Origin. The final argument
is a callback; actions without one do not execute. Empty-payload actions take the callback
directly. Failures always use `{ success: false, error }`. Account identity comes from the
session, never a client-supplied actor ID. Success is acknowledged only after persistence,
except ephemeral signaling and unchanged-state operations.

Game types: `bridge`, `bigtwo`, `redpoints`, `ninetynine`, `sevens`, `chinesepoker`, `liarsdeck`, `blackjack`, `holdem`. Seats: `N`, `E`, `S`, `W`.
For exact unions and result fields, use
[`socket-events.ts`](../shared/src/types/socket-events.ts).

| Action | Payload | Success |
| --- | --- | --- |
| `player:resume` | — | PlayerSnapshot; attach/restore account |
| `room:create` | `{ gameType }` | `{ success, roomCode }` |
| `room:join` | `{ roomCode }` | `{ success, room }`; joins as a spectator, also during a match |
| `room:invite` | `{ accountId }` | Invite an accepted friend while spectator room remains |
| `room:leave` | — | Leave; a seated player's leave aborts an unfinished game |
| `room:kick` | `{ accountId }` | Host removes another human member (spectators also during a match); they may rejoin by code |
| `room:changeSeat` | `{ seat }` | Change available seat |
| `room:standUp` | — | Leave the seat to spectate while waiting |
| `room:setGameType` | `{ gameType }` | Host changes waiting room game |
| `room:setTimeControl` | `TimeControl` | Host changes waiting room timer; clears human readiness |
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
| `game:holdem:action` | `{ action }` | Hold'em: `{ type: 'fold' \| 'check' \| 'call' }` or `{ type: 'raise', to }`, where `to` is the street stake after a bet or raise |
| `game:continue` | — | Seated player or spectator leaves the result for the waiting room; others keep it |
| `game:abortVote:start` | — | Start seated-player abort vote |
| `game:abortVote:cast` | `{ agree }` | Record one vote |
| `chat:send` | `{ message }`, `{ stickerId }`, or `{ providedSticker }` | Send text, an owned sticker, or a site emoji sticker by name |

[`ChatMessage`](../shared/src/types/chat.ts) carries server-resolved images only: `emojis`
(name → personal media ID) and `providedEmojis` (name → site emoji file) for `:name:`
tokens, at most 20 names combined and never the same name in both; or one `sticker`
(personal) or `providedSticker` (`{ name, file }`) with empty content. Site emoji files are
served from `<base>/provided-emoji/<file>`; see [media](media.md#site-provided-emoji).
Messages stored before site emoji existed remain valid.

Play/pass/capture and continue wait for the server's presentation deadline; continue also
requires scoring. The server validates turn/card/room authority; see [games](games.md).
Room/game players expose optional `isBot`; absent or false means a human. Bot identities
use reserved `bot:<UUID>` IDs and cannot authenticate or receive player snapshots.

Timer settings use [`TimeControl`](../shared/src/types/room.ts) and the validated
[shared limits](../shared/src/time-control.ts). Visible game clocks use
[`GameClock`](../shared/src/types/game.ts), with the active seat, committed deadlines,
remaining reserves, and server time for client clock correction. The server enforces
expiry; frontend countdowns do not authorize moves. See [timer rules](games.md#turn-timer).

`player:state` sends the same `PlayerSnapshot` as resume: optional player, room,
gameState, and recent chat history plus success/error. Resume always includes chat history,
which replaces the client's copy. Broadcasts include history only when the recipient's room
changed; otherwise they omit it and each new message follows as
`chat:message { roomCode, message }`, which clients append once by message ID. Missing
room/game clears old client state. Game state includes only the recipient's hand and legal choices plus public logs,
results, and presentation metadata. Actor/affected room members receive snapshots, including
same-account tabs; unrelated rooms do not. `room:invited` delivers an ephemeral invite
with room/game/sender/seat availability. `room:kicked { roomCode }` follows the removed
member's room-less snapshot.

## Voice signaling

Voice membership is ephemeral and authorized against committed room membership. Socket.IO
carries negotiation; audio travels over WebRTC and does not write the database. Join, leave,
and settings run in the runtime queue; `voice:signal` is relayed synchronously outside it,
checking only the connection, its session expiry, and current voice peers.

| Client action | Payload | Success |
| --- | --- | --- |
| `voice:join` | `{ muted, deafened }` | `{ success, peerId, state }` |
| `voice:leave` | — | `{ success }` |
| `voice:settings` | `{ muted, deafened }` | `{ success }` |
| `voice:signal` | `{ targetPeerId, description?, candidate? }` | `{ success }` |

Exactly one description/candidate is required. Descriptions accept offer/answer with
SDP at most 12,000 characters; ICE candidates at most 2,048 characters with validated
fields. Source identity is server-assigned; target must be a current same-room peer.
One account may join from only one tab. Voice has a separate 1,200-actions/minute/account
limit; other actions use 240, and `chat:send` additionally allows 5 per 5 seconds. Limits
are shared by all of an account's tabs.

Server events: `voice:state { roomCode, participants }`,
`voice:signal { fromPeerId, description?, candidate? }`, and `voice:left { reason }`.
Participants include peerId/accountId/muted/deafened. Fresh join cycles receive fresh
peer IDs. See [voice operation/configuration](media.md#voice).
