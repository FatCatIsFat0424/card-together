# Development

## Setup

- Start with [README](../README.md); follow [AGENTS.md](../AGENTS.md) for implementation rules.
- Use the exact Node.js version in [.node-version](../.node-version). Older shell defaults fail; deployment enforces the pinned version.
- Run `npm ci` from the root. All workspaces share the root TypeScript version.

## UI conventions

| Component | Rules |
| --- | --- |
| [AppCheckbox](../client/src/components/AppCheckbox.tsx) | MUI Checkbox with theme variables and a 44px hit area, extending beyond the compact frame. Associate labels with the native input; use `slotProps.input` for input accessibility attributes. |
| Checkbox placement | Emoji selection supports whole-tile toggling and Shift-click ranges. The waiting-room Dragon Slaying option matches one game-picker row's height. |
| [AppIcon](../client/src/components/AppIcon.tsx) | Use individual `@mui/icons-material` SVG imports; inherit text size/color. Decorative icons need accessible control names and translated status text. |
| Artwork | Keep suits, avatars, crowns, skulls, dragons, and revolvers where Material Icons has no suitable equivalent. |
| Lobby backgrounds | Preload artwork, then crossfade over 600ms. Preserve component styling and respect reduced motion. |

### Navigation and account state

- Sign-out: icon and translated label at widths ≥768px; red icon and label last in the menu on narrower screens.
- Coin balance: owner-only Material coin icon on desktop/compact screens, with a hint explaining the 10-coin completed-game reward.
- Authenticated resume and private `account:coins` events update balances. Server-owned revisions prevent stale HTTP responses from undoing rewards or purchase debits.
- Private `account:updated` events synchronize saved profiles/inventory across the owner's tabs. Public profiles and room identities omit balances. See [game coins](storage.md#game-coins).

### Lobby and friends

The lobby uses the profile page width and separates the game picker from room actions.

| Layout | Behavior |
| --- | --- |
| Desktop | Sidebar: selected game, creation button, then code joining below a divider. Descriptions appear only in the picker; friends appear below room actions. |
| Width ≤52rem | Code joining, “Or” divider, then full-width creation button that always creates Bridge. Hide the selected-game panel; show friends below the rules list. |
| Rules list | Single column titled “Rules” with right chevrons. Opening details does not select a mode or change the background. |
| Online friends | Vertical scrolling, at most three rows on every screen; desktop sidebar may extend below the picker. Truncate long names; omit host codes/presence captions, retain host join buttons. |

- Online friends use the [friends API](api.md#http), refresh on focus/every 30 seconds while visible, and list hosts first.
- `room:joinFriend` requires confirmation before switching rooms.
- The lobby remains accessible during rooms/matches with a return link. Creating/joining by code requires leaving the current room first.
- Waiting-room controls own rules, timers, invitations, and bots; see [Socket actions](api.md#socket-actions).
- Friends page: above 52rem, horizontal MUI tabs for friends/sent/incoming requests with live counts, keyboard navigation, and one visible panel. Smaller screens retain three sections. Search, requests, and room admission use the existing API.
- Public profiles: show statistics/match table; omit self-profile caption, extra history heading, and bot-recording caption. Keep lobby navigation in the top bar; show the footer only for an active room return link.

### Waiting-room seats

| Layout | Seats |
| --- | --- |
| Desktop | Equal-width outlined portrait cards for North/East/South/West; no horizontal scrollbar. Ninety-Nine, Blackjack, and Hold'em always have two rows of four columns; other modes have one row. |
| Compact | Two equal-width columns, smaller avatars/controls, up to four rows. Scroll seats vertically when they exceed table height. |

- Empty cards are full-card seat buttons; bot controls remain separate.
- Ninety-Nine/Blackjack/Hold'em: host-only plus icon occupies the next cell starting at seat five, adds human seats up to eight, then disappears. Remove only the last empty additional seat.
- Additional seats persist/synchronize through the room API. Every mode currently requires exactly four configured seats and four seated players to start; empty/remove additional seats first.
- Ready stays clickable while connected/idle. Invalid counts trigger a dismissible MUI Snackbar; spectators are prompted to sit before preparing.
- Account appearance settings upload/clear Seat backgrounds with live preview. Profile updates synchronize occupied-seat artwork; bots use [mechanical dealer artwork](../client/src/assets/room-backgrounds/README.md). Empty/human seats without artwork retain the theme surface.

Host placement while waiting:

- Drag humans between any seats or into spectators. Occupied seats swap; placing a spectator in an occupied human seat moves its occupant to spectators.
- Material drag handle supports mouse/touch and click/keyboard selection followed by a destination; Escape cancels. Profile links work normally outside placement.
- Bots can swap standard seats with humans, but remain in standard seats.
- Changes clear human readiness. Persist before broadcasting; save failure restores the arrangement.

### Rules dialog

- Keep bilingual content in `client/src/game-rules-i18n.ts`, aligned with [game rules](games.md) and linked shared functions: instructions, scoring tables, examples, and shared room rules.
- Use a themed MUI dialog with scrolling, Escape/backdrop dismissal, focus trapping, and focus return.
- Entry points: lobby Rules link, waiting-room Game rules button beside mode selector, desktop match information rail, compact table tools. Available to players/spectators.
- Show applicable option states above full rules: Sevens Dragon Slaying, Ninety-Nine two decks without reshuffling, Blackjack player dealer.
- Waiting-room options track host changes; match options use current game state. Reading does not pause play/timers; settlement closes the dialog.

### Shop and avatar borders

- Authenticated `/shop` appears in desktop/mobile navigation. [Shared catalog](../shared/src/constants/shop.ts) is authoritative; permanent borders cost 50–300 coins (5–30 completed games).
- Try-on uses preset/uploaded avatars with CSS borders. CSS/SVG decorations scale with avatars: cat, rabbit, frog, bear, dog, branching antlers, and Cthulhu tentacles.
- Selection/reset are local previews; they do not change balance/profile. Buying atomically debits coins/adds private inventory; repeat purchases charge nothing.
- Account Material select offers owned borders/original avatar, previews immediately, and saves with identity.
- Equipped borders appear in lobby, public profiles, friends, chat, and rooms. Preserve full-size responsive avatar dimensions, accessible labels, and unobscured artwork.
- Original single-color ring shares shop borders' outer extent.

## Configuration

- Server reads process environment variables. `server/.env.example` is reference-only, not auto-loaded.
- Vite loads `client/.env.local` at startup/build. Restart development or rebuild production after frontend environment changes.
- `VITE_` values enter public JavaScript; never use them for secrets.

| Server variable | Behavior |
| --- | --- |
| `PORT` | Default `3001` |
| `HOST` | Optional bind address; use `127.0.0.1` behind local Nginx |
| `DATABASE_PATH` | Default `server/data/database.json`, independent of cwd; relative overrides resolve from cwd |
| `CLIENT_ORIGIN` | Comma-separated exact `http(s)://host[:port]` origins, without path/trailing slash/default port. Invalid entries stop startup. Development defaults to `localhost:5173`/`127.0.0.1:5173`; required in production. |
| `NODE_ENV` | `production` enables Secure cookies and requires HTTPS |
| `TRUST_PROXY_LOOPBACK` | Default `false`; enable only for a trusted local proxy overwriting forwarded client addresses |
| `SEVENS_DEV_PRESET` | Development-only `near-slay`: 44 ordinary logged plays lay each suit from 2 to Q, leaving two aces/kings per seat. Any other value, or any production value, stops startup. |

| Vite variable | Behavior |
| --- | --- |
| `VITE_BASE_PATH` | Default `/`; must start/end with `/` |
| `VITE_SERVER_URL` | Optional external API/Socket origin; empty uses app origin/base |
| `VITE_SOCKET_PATH` | Optional Socket.IO path; deployment uses `/card-together/socket.io` |
| `VITE_WEBRTC_ICE_SERVERS` | Browser-visible JSON ICE configuration; see [voice](media.md#voice) |

## Checks

[Testing](testing.md) owns commands, selection/cache behavior, coverage, and failure reporting.

- During edits: focused gate or `npm run test:watch` for repeated behavior work.
- Before completing behavior changes: `npm run check -- full`, also used by CI.
- Deployment builds: release gate with explicit application base/Socket path.
- Documentation-only changes: content, local links, and whitespace review.
- Repeat checks only when later changes, failures, or unresolved concerns affect results.
- `build:client` independently checks the build; root lint covers validation/import scripts and Vite/Vitest configs.
- No separate formatter/secret scanner is configured; floating promises remain lint errors and existing React hooks warnings remain enabled.
- Server startup reads the generated [emoji catalog](media.md#site-provided-emoji); tests inject catalogs instead of requiring owner originals.

## Benchmarks

```sh
npm run bench:database
npm run bench:socket
npm run bench:arrange
```

| Workload | Metrics and acceptance |
| --- | --- |
| Database | Indexed queries/persistent writes |
| Socket | Snapshot/chat bytes and runtime writes across rooms. `payloadBytes` and `snapshotPayloadBytes` mean snapshots; `chatPayloadBytes` means chat. Validate acknowledgments, recipients, and workload sanity before accepting results. |
| Arrange | Seed 23, one warmup, 20 measured samples. Timing budget is opt-in; full correctness corpus remains in Vitest. |

- All benchmarks create/clean independent temporary JSON databases; never use production `DATABASE_PATH`.
- Compare identical workloads/runtime versions; hardware, filesystem, and load affect timings. Correctness tests avoid performance deadlines.
- Frontend startup size includes entry **and preloaded** chunks.

## Browser verification

Choose scope from affected behavior/dependencies. For localized UI, plan 1–2 minutes after setup; finish relevant checks regardless of that target. Diagnose slow setup/unnecessary waits before expanding scope.

| Change | Browser scope |
| --- | --- |
| Pure rules/server logic without UI changes | Automated tests; browser only for unresolved integration. |
| Localized UI/game option | One real client/server flow and affected visuals. Layout checks: 1366×768 and 360×640; add 844×390 for short/landscape impact. |
| Shared layout/navigation/breakpoints | Affected pages at 2560×1440, 1920×1080, 1366×768, 390×844, 375×667, 360×640, 844×390; add checks around changed breakpoints. |
| Authentication/membership/transport/private data/deployment | Affected login/logout, room create/join/chat, refresh/reconnect, and game flows. Separate accounts for permissions/private hands; follow [deployment](deployment.md) for migration. |

Verification rules:

- Automated tests cover rule boundaries, full matches, authorization, persistence failure, and restart recovery.
- Reach visuals with existing helpers/development-only in-memory fixtures; avoid full matches or bot/animation waits. Verify changed wiring with a real action: injected state cannot prove authorization/durability.
- Isolate synthetic accounts/databases; do not introduce one-off test infrastructure without agreement.
- Batch independent inspections; use screenshots for visual judgment. Reuse isolated environments/accounts.
- Expand after failures/shared changes/remaining uncertainty; repeat affected checks after fixes. Stop adding unrelated flows/viewports once selected checks pass; report actual scope and limitations.

| Affected area | Additional checks |
| --- | --- |
| Waiting-room/game layout | No document/route-viewport scrolling; visible controls; no seat/card intersections. Check timers and chat/info toggles when controls/space change. |
| Red Points/shared table | Crowded tables, multiple capture targets, initial deal without presentation metadata |
| Music | Pause/resume and route changes |
| Voice | Separate browser participants; synthetic streams do not prove microphones or cross-NAT connectivity |
