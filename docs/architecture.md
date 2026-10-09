# Architecture

Card Together is a server-authoritative TypeScript monorepo. HTTP handles accounts,
friends, profiles, and media; authenticated Socket.IO actions drive rooms and games.
Browsers exchange voice audio over WebRTC. Production has one systemd backend behind
local Nginx with durable state outside the application tree.

## Module boundaries

| Location | Responsibility |
| --- | --- |
| `shared/src/` | Types, constants, pure multi-game rules, public presentation frames |
| `server/src/app.ts`, `index.ts` | Compose services, read/validate configuration, start/close the app |
| `auth/`, `social/` | Password/session/profile and friendship services |
| `http/`, `socket/` | Validate/authenticate requests and translate service/runtime results |
| `runtime/` | Serialize changes, validate/restore snapshots, commit, roll back, schedule bot turns and Big Two auto-pass |
| `bots/` | Per-game heuristics and weighted near-best choices with injectable randomness, using only filtered player state |
| `managers/`, `managers/games/` | Player/room/game/chat/voice state and game-specific adapters |
| `engine/` | Pure Bridge deck/dealing/bidding/playing/scoring |
| `database/`, `media/` | Async Repository, JSON adapter/migrations/indexes, content-addressed images |
| `client/src/pages/`, `components/` | Lazy routes and CSS Modules UI |
| `client/src/hooks/`, `stores/` | Account/Socket lifecycle and Zustand snapshots/preferences |
| `client/src/audio/`, `voice/` | Native file playback/turn reminder and WebRTC controllers |
| `deploy/` | Prepared runtime, systemd/Nginx install, backup/migration, publication |

Dependency direction is transport → runtime/managers → pure engine/shared rules.
Engine code cannot access managers, storage, or network. Managers do not directly
coordinate each other; Socket context/runtime owns those operations. HTTP services
use the Repository contract. The detailed [API](api.md) and [storage](storage.md)
documents define transport/data boundaries.

## Committed game state

Each mutation validates session/room/turn authority, snapshots state for rollback,
applies manager changes, and writes the runtime and any completed match atomically.
Only then does it acknowledge and broadcast `player:state` to the actor and affected
old/new room members, including their connected tabs. Persistence failure restores
manager state. Unchanged resumes may skip writes while retaining authentication and
synchronization. Each snapshot includes only the recipient's private hand/legal cards.

Tabs share one account identity and seat. A final-tab disconnect starts a 60-second
reconnect window. Restart restores room/game/chat state and gives disconnected players
a fresh window. Expiry or voluntary departure aborts an unfinished match; completed
history remains. Socket IDs and voice membership are never durable.

JSON writes still validate/serialize the complete document and atomically replace the
file. In-memory indexes accelerate account/session/friendship/history reads; scoped
broadcasts and unchanged-state checks reduce redundant work. These optimizations do
not enable multiple server processes.

## Frontend

Public routes are `/login` and `/register`; authenticated routes include `/`, `/account`,
`/friends`, `/players/:accountId`, `/room/:roomCode`, and `/game/:roomCode` under the
configured base path. `api.ts` handles cookies/HTTP and `socket.ts` handles realtime
transport. Account connection hooks replace store state from server snapshots and clear
missing room/game state. Equal snapshot fields retain references to avoid redundant updates.

The socket retries indefinitely (1–5 s backoff) and may fall back to polling. Returning
network or page visibility triggers an immediate reconnect; a page hidden for more than
10 seconds re-sends `player:resume` and reconnects if it goes unanswered. Until the first
ready snapshot, protected routes show a full-page connecting state; afterwards pages stay
mounted under a non-blocking reconnect banner, and actions should check
`selectConnectionReady` from the account store. Routes sit in an error boundary with a
reload action, and a missing lazy chunk after a deployment reloads the page once per
30 seconds. Media uploads use a 120-second request timeout instead of 15 seconds.

Profile pages preserve room membership. Theme, motion, music, and voice preferences
are local browser settings; account profile/image/history visibility is durable server data.
The application owns one dynamic viewport below the fixed-height top bar. Waiting rooms
and games fill that space without document scrolling; long account pages, chat, and
history retain internal scrolling. The waiting room uses a separate readiness row,
with a two-by-two seat layout and a chat toggle (with an unread count) on phones or
short landscape windows. Seated/ready counts appear in the table centre, or beside the
Ready button where the centre is hidden; the room code has a copy button.
Timer settings expand in a bounded panel rather than pushing the seats down.

Game seats and the central play area occupy separate grid cells. At every viewport
size, the local seat stays below the centre, the opposite seat above it, and the
other seats to its left and right. The local identity, score, and captured-card preview share the hand header,
with a compact base + reserve clock at its right edge. Other seats show only their active turn allowance, never their reserve. Short landscape windows keep the local hand header
below the table as well. Status/error text stays with the hand.
Red Points measures the actual card viewport and paginates table cards to fit,
preserving card order and the current page during capture highlights, and enlarging
sparse tables without reserving empty rows. Other central presentations fit their
grid cell without changing the space reserved for seats and controls.
All four tables share one result dialog (`games/ResultDialog.tsx`) that stays below the
top bar so music, voice, sign-out, and invite notices remain usable; it is a labelled
modal dialog that focuses "Back to room" and reports the pending return.
Overlay sheets (info, chat) and top-bar popovers move focus inside when opened and
return it to their trigger when closed. Escape closes only the topmost layer: popovers
mark the key handled so the game sheets underneath stay open. On phones and short
landscape windows the abort-vote region sits at the bottom of the table so the tool
buttons and the top seat stay visible.
Game and room action controls (cards, bids, Play/Pass, votes, seat/ready/bot/host
controls, Back to room) are disabled while the account connection is not `ready`;
local-only controls such as sorting stay usable.
Legacy `bridge.*` preferences migrate without replacing existing `card-together.*` values.
Music playback persists across routes/control-panel closure. Voice follows actual room
membership and requires explicit user join; see [media](media.md).

## Presentation timeline

`shared/src/game-presentation.ts` derives public frames from committed log entries.
Metadata supplies `id`, `startedAt`, `logStart`, and recipient `serverNow`; frames
never contain other players' private hands or unrevealed stock.
New actions use `timingVersion: 2`: ordinary Bridge/Big Two plays allow 300 ms for
arrival followed by one second to read the result. Missing timing versions retain
legacy deadlines so saved automatic passes remain valid across upgrades; the next
action uses the new timing. Controls, turn highlights, reminders, bots, and automatic
passes wait for the shared presentation deadline.

| Frame | Duration |
| --- | --- |
| Bridge play / completed trick | 1,300 / 2,000 ms |
| Big Two play / pass / round winner | 1,300 / 1,000 / 2,000 ms |
| Red Points play or flip/capture | 1,900 ms per log entry |
| Ninety-Nine play / elimination | 1,900 / 2,500 ms |
| Final result before score overlay | 3,000 ms |

Frames for one action run sequentially. The server rejects further play/pass/capture
and continue actions until the deadline; continue also requires scoring. Clients disable
corresponding controls and delay score overlays. Refresh/resume skips expired frames
and displays remaining time rather than restarting animations. Reduced motion preserves
information and deadlines. Turn reminders wait for the full timeline to finish.
Legacy Bridge snapshots without metadata retain the local completed-trick queue.

Each game shows current-match history reconstructed from its public records. Cross-match
history is separately persisted in Repository matches. Big Two automatic passes use their
own server scheduler and saved deadlines; see [rules](games.md#big-two).

Bot timers are reconstructed from committed game turns at startup and after mutations.
They recheck game/turn identity inside the runtime queue, wait for presentation completion,
and publish only after persistence succeeds. Failed saves roll back and retry; abort,
replacement, and shutdown cancel stale work. Bot decisions never receive opponents'
private hands. Big Two's existing forced-pass scheduler owns forced passes for all seats.
Bot and timeout attempts that fail three times in a row for the same turn fall back to the
first legal action from the same filtered view; if none applies, the game is aborted with a
system chat line instead of retrying forever. Every failed attempt is logged.

## Turn clocks

Room timer settings and per-game reserves/deadlines are durable state. Game actions
settle elapsed decision time before advancing the clock; Red Points preserves the unused
allowance across its two decision stages. Presentation deadlines postpone clock starts.
The timeout scheduler rechecks the game and turn inside the runtime queue, applies one
legal action from the player's filtered view, and publishes only after persistence.
Failed writes restore the clock and game together. Manual actions also check expiry.

Startup preserves existing deadlines, so an overdue turn resumes without a browser;
subsequent turns start from the newly committed action rather than replaying missed turns.
Legacy rooms/games without timing metadata receive default settings and fresh clocks.
The client projects server timestamps locally and never decrements stored reserves itself.
See [game timer rules](games.md#turn-timer) for settings and per-game behavior.
