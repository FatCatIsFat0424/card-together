# Architecture

Server-authoritative TypeScript monorepo.

| Channel | Carries |
| --- | --- |
| HTTP | Accounts, profiles, friends, private messages, history, media |
| Socket.IO | Authenticated room, game, chat actions; voice signaling |
| WebRTC | Voice audio between browsers |

Production runs one systemd backend behind local Nginx, with state outside the
application tree ([deployment](deployment.md)).

## Modules

| Location | Responsibility |
| --- | --- |
| `shared/src/` | Types, constants, pure game rules, presentation frames |
| `server/src/app.ts`, `index.ts` | Configuration, service composition, start and shutdown |
| `auth/`, `social/` | Password, session, profile, friendship, and private-message services |
| `http/`, `socket/` | Validate and authenticate requests; translate results |
| `runtime/` | Serialize changes, snapshot and restore, commit, schedule bots and timeouts |
| `bots/` | Per-game heuristics using only the bot's filtered view |
| `managers/`, `managers/games/` | Player, room, game, chat, voice state; game adapters |
| `engine/` | Pure Bridge deck, bidding, play, scoring |
| `database/`, `media/` | Async Repository, JSON adapter, migrations, indexes; content-addressed images |
| `client/src/pages/`, `components/` | Lazy routes and CSS Modules UI |
| `client/src/hooks/`, `stores/` | Account and Socket lifecycle; Zustand snapshots and preferences |
| `client/src/audio/`, `voice/` | Music, turn reminders, WebRTC |
| `deploy/` | Runtime preparation, install, backup, migration, publication |

- Dependencies flow **transport → runtime/managers → pure engine and shared rules**.
- The engine has no manager, storage, or network access.
- The Socket context and runtime coordinate managers; managers never call each other.
- HTTP services use the Repository contract ([storage](storage.md)).

## State commits

Every runtime mutation:

1. Validates session, room, and turn authority, then snapshots state.
2. Applies manager changes and atomically saves runtime plus any completed match.
3. Acknowledges, then broadcasts `player:state` to the actor's tabs and affected
   old and new room members.

- A failed save restores the snapshot. Unchanged resumes may skip the write but still
  authenticate and synchronize.
- `getRecipientVisibleState` filters hands and legal choices per recipient. Observers
  additionally receive `observedHands` (and Blackjack `observedHole`); see
  [spectators](games.md#spectators-and-god-view). Bots and automatic actions see only
  their own filtered view.
- Chat history is filtered per recipient.
- Each write still validates and serializes the full JSON document. In-memory indexes,
  scoped broadcasts, and unchanged-state checks reduce work but do **not** allow
  multiple server processes.
- Private messages and friend notifications use Repository transactions directly,
  independently of room snapshots. HTTP emits `social:changed` to affected accounts
  after persistence; clients reload through authenticated endpoints. Retention and
  permissions: [storage](storage.md#identity-and-sessions).

| Lifecycle | Behavior |
| --- | --- |
| Multiple tabs | Share one account identity and seat |
| Last tab disconnects | Starts a 60-second reconnect window |
| Server restart | Restores rooms, games, chat; disconnected players get a fresh window |
| Reconnect expiry or leaving | Aborts an unfinished match; completed history remains |
| Last human leaves | Removes the room, game, and chat; periodic cleanup also removes orphaned rooms |
| Socket IDs, voice membership | Never persisted |

## Frontend

- Public routes: `/login`, `/register`. Authenticated: `/`, `/account`, `/friends`,
  `/messages`, `/messages/:accountId`, `/shop`, `/players/:accountId`, `/room/:roomCode`,
  `/game/:roomCode`, all below the configured base path. Legacy `/friends?tab=messages`
  and `/friends/messages/:accountId` links redirect to the independent messages page.
- `api.ts` handles HTTP with cookies (15-second timeout, 120 seconds for uploads);
  `socket.ts` handles realtime.
- Account hooks replace store state from server snapshots, clear a missing room or
  game, and keep references for unchanged fields.
- Theme, motion, music, and voice preferences are browser-local; profile, images, and
  history visibility are server-side.

**Connection recovery**

- Socket.IO retries forever with 1–5 s backoff and a polling fallback. Network return or
  page visibility reconnects immediately; after more than 10 seconds hidden, the page
  re-sends `player:resume` and reconnects if it gets no answer.
- Before the first snapshot, protected routes show a full-page connecting state. Later
  disconnects keep pages mounted under a reconnect banner.
- Actions check `selectConnectionReady`; game, room, and host controls stay disabled
  until ready.

Page behavior: [interface](interface.md).

## Presentation timeline

[`game-presentation.ts`](../shared/src/game-presentation.ts) derives public frames
from committed logs. Metadata carries `id`, `startedAt`, `logStart`, and the
recipient's `serverNow`; frames never include opponents' hands or unrevealed stock.

- Frames run in sequence. Controls, turn highlights, reminders, bots, and auto-pass all
  wait for the shared deadline.
- The server rejects play, pass, capture, and continue before the deadline (continue also
  requires scoring). Clients disable controls and delay the score overlay.
- Refresh skips expired frames. Reduced motion keeps information and deadlines.
- Legacy Bridge snapshots without metadata keep the local completed-trick queue.

| Frame | Duration (ms) |
| --- | --- |
| Bridge play / completed trick | 1,300 / 2,000 |
| Big Two play / pass / round winner | 1,300 / 1,000 / 2,000 |
| Red Points play or flip/capture | 1,900 per log entry |
| Ninety-Nine play / elimination | 1,900 / 2,500 |
| Sevens play / cover / Dragon Slaying (dragon / fire only) | 1,300 / 1,000 / 2,200 / 1,700 |
| Sevens table collapse / broken table hold | 1,800 / 2,000 |
| Chinese Poker row reveal / sweep / home run | 2,500 / 1,500 / 2,500 |
| Liar's Deck new round / play / LIAR call / trigger suspense / pull result | 2,000 / 1,300 / 2,500 / 2,500 / 1,500 |
| Blackjack deal / hit / double / stand / split | 1,800 / 1,000 / 1,300 / 700 / 1,300 |
| Blackjack dealer reveal / dealer draw / settlement | 1,300 / 1,000 / 2,500 |
| Hold'em new hand / action / street / showdown / award | 1,500 / 900 / 1,300 / 2,500 / 2,500 |
| Final result before score overlay | 3,000 (2,000 after a Sevens table collapse) |

**Timing versions**

| Version | Behavior |
| --- | --- |
| 3 (current) | Bridge and Big Two plays: 300 ms arrival + 1,000 ms reading |
| 2 (restored) | Keeps the 2,400 ms Sevens Dragon Slaying close |
| Missing (restored) | Keeps shorter legacy play and pass frames |

Restored presentations keep their version and deadlines; the next action uses current
timing. **Any duration change that can delay a saved turn needs a new timing version.**

## Turn clocks

Rules and per-game timeouts: [games](games.md#turn-timer). Limits:
[`time-control.ts`](../shared/src/time-control.ts).

- Room timer settings and per-game reserves and deadlines are persisted.
- Actions settle elapsed time before advancing. Red Points carries unused allowance
  across its two decision stages. Presentation deadlines delay clock starts.
- Timeout work rechecks game and turn inside the runtime queue, applies one legal action
  from the player's filtered view, and publishes after saving. A failed write restores
  clock and game together; manual actions also check expiry.
- Startup keeps deadlines; overdue turns resolve without a browser. Later turns start
  from the new commit and never replay missed turns.
- Legacy rooms and games without timing data get defaults and fresh clocks.
- Clients project from server timestamps and never decrement stored reserves.

**Shared deadlines** (Chinese Poker arrangement, Blackjack betting):

- No single active seat; one deadline per window.
- At expiry, one commit fills every missing decision from each seat's filtered view.
- Bots submit individually. Submissions have no frames; the last one starts the showdown
  or deal. Blackjack betting opens after the previous settlement presentation.

**Big Two forced passes** use a separate scheduler with saved per-seat deadlines; see
[Big Two](games.md#big-two).

## Bots

- Bot timers are rebuilt from committed turns at startup and after each mutation. Each
  run rechecks game and turn in the runtime queue and waits for the presentation deadline.
- Results publish after saving. Failed saves roll back and retry; abort, replacement,
  and shutdown cancel stale work.
- After three consecutive failures on one turn, the bot or timeout tries the first legal
  action from the same view. If that fails three more commits, or none exists, the match
  aborts with a system chat line. Chat senders must be accounts, so a stuck bot turn is
  reported under the first human seat. Every failure is logged.
- Matches with any bot are excluded from match history but keep runtime results for resume.

Strategies: [games](games.md#bots).
