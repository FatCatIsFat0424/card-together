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
| `runtime/` | Serialize changes, validate/restore snapshots, commit, roll back, schedule Big Two auto-pass |
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

Profile pages preserve room membership. Theme, motion, music, and voice preferences
are local browser settings; account profile/image/history visibility is durable server data.
Legacy `bridge.*` preferences migrate without replacing existing `card-together.*` values.
Music playback persists across routes/control-panel closure. Voice follows actual room
membership and requires explicit user join; see [media](media.md).

## Presentation timeline

`shared/src/game-presentation.ts` derives public frames from committed log entries.
Metadata supplies `id`, `startedAt`, `logStart`, and recipient `serverNow`; frames
never contain other players' private hands or unrevealed stock.

| Frame | Duration |
| --- | --- |
| Bridge play / completed trick | 400 / 2,000 ms |
| Big Two play / pass / round winner | 400 / 350 / 2,000 ms |
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
