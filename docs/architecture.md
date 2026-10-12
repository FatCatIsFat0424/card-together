# Architecture

Card Together is a server-authoritative TypeScript monorepo:

- **HTTP:** accounts, friends, profiles, and media.
- **Socket.IO:** authenticated room and game actions.
- **WebRTC:** voice audio between browsers.
- **Production:** one systemd backend behind local Nginx; durable state outside the application tree.

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

- Dependencies flow **transport → runtime/managers → pure engine/shared rules**.
- Engine code has no manager, storage, or network access.
- Socket context/runtime coordinates managers; managers do not coordinate each other directly.
- HTTP services use the Repository contract.
- See [API](api.md) and [storage](storage.md) for transport/data boundaries.

## Committed game state

**Mutation sequence:**

1. Validate session, room, and turn authority; snapshot state for rollback.
2. Apply manager changes; atomically save runtime and any completed match.
3. Acknowledge and broadcast `player:state` to the actor and affected old/new room members, including their tabs.

- Failed persistence restores manager state.
- Unchanged resumes may skip writes but still authenticate and synchronize.
- `getRecipientVisibleState` filters private hands/legal cards per recipient. Spectators and eliminated seats also receive all hands (`observedHands`, Blackjack `observedHole`); bots and automatic actions use only their filtered view.
- Room snapshots include spectators and current observer accounts; chat history is recipient-filtered. See [spectators](games.md#spectators-and-god-view).

| Lifecycle | Behavior |
| --- | --- |
| Multiple tabs | Share one account identity and seat |
| Final-tab disconnect | Starts a 60-second reconnect window |
| Restart | Restores room/game/chat; disconnected players receive a fresh window |
| Reconnect expiry or voluntary departure | Aborts an unfinished match; completed history remains |
| Socket IDs and voice membership | Never durable |

JSON writes still validate/serialize the complete document and atomically replace the
file. In-memory indexes accelerate account/session/friendship/history reads; scoped
broadcasts and unchanged-state checks reduce redundant work. These optimizations do
not enable multiple server processes.

## Frontend

| Area | Behavior |
| --- | --- |
| Public routes | `/login`, `/register` |
| Authenticated routes | `/`, `/account`, `/friends`, `/players/:accountId`, `/room/:roomCode`, `/game/:roomCode` |
| Route prefix | Configured base path |
| Transport | `api.ts`: cookies/HTTP; `socket.ts`: realtime |
| Account hooks | Replace store state from server snapshots; clear missing room/game; retain equal field references |
| Browser preferences | Theme, motion, music, and voice |
| Durable profile data | Profile/image/history visibility |

**Connection and recovery:**

- Socket retries indefinitely with 1–5 s backoff and polling fallback.
- Returning network/page visibility triggers immediate reconnect. After more than 10 seconds hidden, the page re-sends `player:resume` and reconnects if unanswered.
- Before the first ready snapshot, protected routes show a full-page connecting state. Later disconnects leave pages mounted under a reconnect banner.
- Actions check account-store `selectConnectionReady`. Cards, bids, Play/Pass, votes, seat/ready/bot/host controls, and Back to room are disabled unless `ready`; local sorting remains usable.
- Route errors offer reload. Missing lazy chunks reload once per 30 seconds after deployment.
- HTTP timeout: 15 seconds normally; 120 seconds for media uploads.

**Navigation and layout:**

- Navigation stays available during matches: top-bar links on desktop, menu below 1024px.
- Account, friend, and profile navigation preserves room membership. Joining another friend's hosted room confirms the switch and commits both membership changes together.
- The app fills one dynamic viewport below the fixed top bar. Rooms/games avoid document scrolling; long account pages, chat, and history scroll internally.
- Waiting rooms use a separate readiness row. Phones/short landscape windows use two-by-two seats and a chat toggle with unread count.
- Seated/ready counts appear in the table centre, or beside Ready when the centre is hidden. Room codes have a copy button; timer settings expand inside a bounded panel.
- Seats and play area occupy separate grid cells: local below, opposite above, others left/right at every viewport size.
- Local identity, score, and captured-card preview share the hand header below the table, including short landscape windows; the base + reserve clock sits at its right edge. Other seats show active allowance only. Status/errors stay with the hand.

**Game presentation and accessibility:**

- Red Points measures the card viewport, paginates in card order, keeps the page during capture highlights, and enlarges sparse tables without empty rows.
- Below 768px, Sevens shows suit end cards and next open positions instead of all thirteen positions. Other presentations fit their grid cell without shrinking reserved seat/control space.
- Shared `games/ResultDialog.tsx` stays below the top bar, leaving music, voice, sign-out, and invite notices available. The labelled modal focuses Back to room and reports a pending return.
- Info/chat sheets and top-bar popovers move focus inside on open and return it to the trigger on close. Escape closes only the topmost layer; popovers mark it handled to preserve underlying sheets.
- On phones/short landscape windows, abort voting sits at the table bottom so tools and the top seat remain visible.

Legacy `bridge.*` preferences migrate without replacing existing `card-together.*` values.
Music persists across routes/panel closure; voice requires explicit join and follows actual
room membership. See [media](media.md).

## Presentation timeline

[`game-presentation.ts`](../shared/src/game-presentation.ts) derives public frames from
committed logs. Metadata includes `id`, `startedAt`, `logStart`, and recipient `serverNow`;
frames exclude opponents' private hands and unrevealed stock.

| Timing version | Behavior |
| --- | --- |
| New actions: `timingVersion: 3` | Ordinary Bridge/Big Two plays: 300 ms arrival + 1,000 ms reading time |
| Restored version 2 | Retains the 2,400 ms Sevens Dragon Slaying close |
| Missing version | Retains shorter legacy play/pass frames |

Restored presentations keep their version/deadlines; the next action uses current timing.
Any duration change that can delay a saved turn requires a new timing version.

| Frame | Duration |
| --- | --- |
| Bridge play / completed trick | 1,300 / 2,000 ms |
| Big Two play / pass / round winner | 1,300 / 1,000 / 2,000 ms |
| Red Points play or flip/capture | 1,900 ms per log entry |
| Ninety-Nine play / elimination | 1,900 / 2,500 ms |
| Sevens play / cover / Dragon Slaying close (dragon / fire only) | 1,300 / 1,000 / 2,900 / 1,700 ms |
| Chinese Poker row reveal / sweep / home run | 2,500 / 1,500 / 2,500 ms |
| Liar's Deck new round / play / LIAR call / trigger suspense / pull result | 2,000 / 1,300 / 2,500 / 2,500 / 1,500 ms |
| Blackjack deal / hit / double / stand / split / dealer reveal / dealer draw / settlement | 1,800 / 1,000 / 1,300 / 700 / 1,300 / 1,300 / 1,000 / 2,500 ms |
| Hold'em new hand / action / street / showdown / award | 1,500 / 900 / 1,300 / 2,500 / 2,500 ms |
| Sevens table collapse after every suit is slain / broken table before the result | 1,800 / 2,000 ms |
| Final result before score overlay | 3,000 ms (2,000 ms after a Sevens table collapse) |

**Timeline rules:**

- Frames run sequentially. Controls, turn highlights, reminders, bots, and auto-pass wait for the shared deadline.
- Server rejects play/pass/capture and continue before the deadline; continue also requires scoring. Clients disable controls and delay score overlays.
- Refresh/resume skips expired frames and shows remaining time. Reduced motion preserves information/deadlines.
- Legacy Bridge snapshots without metadata retain the local completed-trick queue.
- Current-match history comes from public records. Repository match history contains human-only games; bot games retain runtime results for resume. See [storage](storage.md) for legacy cleanup.
- Big Two forced passes have their own scheduler and saved deadlines for all seats. See [rules](games.md#big-two).

**Bots and cleanup:**

- Rebuild bot timers from committed turns at startup/after mutations; recheck game/turn inside the runtime queue and wait for presentation completion.
- Publish after persistence. Failed saves roll back and retry; abort, replacement, and shutdown cancel stale work. Bots never receive opponents' private hands.
- After three consecutive bot/timeout failures on the same turn, try the first legal action from the same filtered view. If none applies, or it fails three more commits, abort with a system chat line about a human seat (chat senders must be accounts). Log every failure.
- Remove rooms, games, and chat when the last human leaves, including reconnect expiry. The cleanup interval also removes orphaned rooms with no human still pointing at them.
- Results containing any bot are excluded from match history.

## Turn clocks

- Room timer settings and per-game reserves/deadlines are durable.
- Actions settle elapsed decision time before advancing; Red Points carries unused allowance across both decision stages.
- Presentation deadlines postpone clock starts.
- Timeout work rechecks game/turn in the runtime queue, uses one legal action from the player's filtered view, and publishes after persistence. Failed writes restore clocks and game together; manual actions also check expiry.

**Simultaneous phases — Chinese Poker arrangements and Blackjack bets:**

- Publish no single-seat turn; store one shared deadline per window.
- At expiry, the shared-deadline scheduler resolves all missing decisions from each seat's filtered view in one commit. Blackjack humans receive the minimum bet.
- Bots submit individually through the ordinary scheduler. Submissions have no presentation frames; only the final submission starts showdown/deal.
- Blackjack betting opens after the previous settlement presentation; each deal refills all reserves.

**Restart and client behavior:**

- Startup preserves deadlines; overdue turns resume without a browser. Later turns start from the newly committed action, without replaying missed turns.
- Legacy rooms/games without timing metadata receive defaults and fresh clocks.
- Clients project server timestamps; they never decrement stored reserves.
- See [game timer rules](games.md#turn-timer) for settings/per-game behavior.
