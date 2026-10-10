# Development

Use the [README](../README.md) startup commands and [AGENTS.md](../AGENTS.md)
implementation rules. Use the exact Node.js version in `.node-version` (the default
`node` of an older shell fails; deployment enforces the pinned version) and install
dependencies from the root with `npm ci`. All workspaces share the root TypeScript version.

Checkbox controls use [AppCheckbox](../client/src/components/AppCheckbox.tsx), which
wraps MUI Checkbox with the existing theme variables and a 44px hit area. Keep labels
associated with the native input and put input-specific accessibility attributes in
`slotProps.input`. Emoji selection keeps whole-tile toggling and Shift-click ranges.

Interface icons use [AppIcon](../client/src/components/AppIcon.tsx) and individual
`@mui/icons-material` SVG imports, inheriting text size and theme color. Icons are
decorative; keep accessible names on controls and translated text beside status icons.
Keep existing artwork or symbols when Material Icons has no suitable equivalent,
including card suits, avatars, crowns, skulls, dragons, and revolvers.

The top bar shows a translated sign-out label beside its icon at widths of 768px
and above; narrower screens place a red sign-out icon and label last in the menu.

The lobby uses the profile page width, with a game picker and separate room actions.
On desktop, the sidebar groups the selected game, room-creation button, and code
joining below a divider; game descriptions appear only in the picker. At widths
up to 52rem, room-code joining and a divider labeled "Or" precede a full-width
creation button that always creates a Bridge room. The joined single-column list titled
"Rules" uses right chevrons and opens each game's detailed rules without selecting
a room mode or changing the background; the separate selected-game panel is hidden.
The online-friend panel sits below the room actions in the desktop sidebar and
below the rules list on smaller screens. Desktop friends stay in one horizontal
scrolling row, regardless of count; at widths up to 52rem, all friends are displayed
in a vertical list with no height cap. Host room codes and presence captions are omitted, while join buttons remain
available for hosts. The friend panel uses the existing
[friends API](api.md#http), refreshes on focus and every 30 seconds while visible,
and lists online friends with hosts first. Friend room admission uses `room:joinFriend`
and requires confirmation before switching away from an existing room. The lobby
remains accessible during a room or match and provides a return link; creating or
joining by code requires leaving the current room first. Rules, timers, invitations,
and bots are managed in the waiting room. See [Socket actions](api.md#socket-actions)
for authoritative room action contracts.

The selected game's Rules link opens a themed MUI dialog with detailed English and
Traditional Chinese instructions, scoring tables, examples, and shared room rules.
Keep this content in `client/src/game-rules-i18n.ts` aligned with the implemented
rules in [Game rules](games.md) and the linked shared rule functions. The dialog
supports scrolling, Escape/backdrop dismissal, focus trapping, and focus return.

Above 52rem, the friends page separates friends, sent requests, and incoming
requests into horizontal MUI tabs with live counts and keyboard navigation. Only
the selected panel is visible. Smaller screens retain the existing three-section layout.
Friend search, requests, and room admission continue to use the existing friends API.

Public player profiles omit the self-profile caption and show statistics and the
match table without an additional history heading or bot-recording caption.
Lobby navigation remains in the top bar;
the profile footer appears only when there is an active room to return to.

Selecting a game crossfades the lobby's decorative background over 600ms; the
artwork is loaded before the previous background fades out. Background changes
preserve the existing component styling and honor reduced motion preferences.

## Configuration

The server reads process environment variables; `server/.env.example` is a
reference and is not auto-loaded. Vite loads `client/.env.local` on startup/build.

| Server variable | Behavior |
| --- | --- |
| `PORT` | Defaults to `3001` |
| `HOST` | Optional bind address; use `127.0.0.1` behind local Nginx |
| `DATABASE_PATH` | Defaults to `server/data/database.json`, independent of cwd; relative overrides resolve from cwd |
| `CLIENT_ORIGIN` | Comma-separated exact `http(s)://host[:port]` origins without path, trailing slash, or default port; invalid entries stop startup; development defaults to localhost/127.0.0.1 port 5173; required in production |
| `NODE_ENV` | `production` enables Secure cookies and requires HTTPS |
| `TRUST_PROXY_LOOPBACK` | Defaults to `false`; enable only for a trusted local proxy overwriting forwarded client addresses |

| Vite variable | Behavior |
| --- | --- |
| `VITE_BASE_PATH` | Application base; defaults to `/`, must start/end with `/` |
| `VITE_SERVER_URL` | Optional external API/Socket origin; empty uses the app origin/base |
| `VITE_SOCKET_PATH` | Optional Socket.IO path; deployment uses `/card-together/socket.io` |
| `VITE_WEBRTC_ICE_SERVERS` | Browser-visible JSON ICE configuration; see [voice](media.md#voice) |

Do not put private secrets in `VITE_` variables: they enter public JavaScript.
Frontend environment changes require a restart in development or a production rebuild.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build:client
for script in deploy/*.sh; do bash -n "$script"; done
python3 -B -m unittest discover -s deploy/tests
```

`build:client` runs the music/emoji imports and the client build directly from the root:
npm 9 returns success from `npm run` inside a workspace even when the script fails.

Typecheck covers all workspaces, including both client TypeScript configurations and
`server/tests`/`server/benchmarks` (`server/tsconfig.test.json`). Root lint covers
shared/server/client source plus server tests and benchmarks, applies the React hooks
rules to the client, and reports floating promises as warnings. CI
(`.github/workflows/ci.yml`) runs these checks and the deployment checks on every push and pull request. Vitest runs from `server/` and discovers
`tests/**/*.test.ts`, including browser-controller tests executed in Node. Deployment
helpers use Python standard-library unittest; they do not need a new test framework.
No separate formatter or secret-check command is configured.

Use `npm run test:watch` during development. Test directories group engine, auth,
database, runtime/socket, social, client, and voice behavior. Cover malformed inputs,
authorization, private data boundaries, persistence failures, and cleanup where relevant.
Run a production build because Vite's base paths and generated music/emoji catalogs matter.
The server reads the generated [site emoji](media.md#site-provided-emoji) catalog at startup;
tests pass their own catalog and do not depend on local images.

Run focused tests while editing, then run all applicable checks on the final change.
Repeat a completed check only when later edits, failures, or unresolved concerns can
affect its result. Documentation-only changes need content, link, and whitespace review;
they do not require repeating application checks already completed for unchanged code.

## Benchmarks

```sh
npm run bench:database
npm run bench:socket
```

Benchmarks create and clean up independent temporary JSON databases; they do not use
production `DATABASE_PATH`. The database workload measures indexed queries and
persistent writes. The Socket workload reports snapshot counts, payload bytes, and
runtime writes across multiple rooms. Compare identical workloads and runtime versions;
time results depend on hardware/filesystem/load. Tests assert behavior rather than
performance deadlines. Assess startup frontend size using entry **and preloaded** chunks,
not the entry file alone.

## Browser verification

Choose browser checks from the changed behavior and its affected dependencies. For a
small, localized UI change, target 1–2 minutes of browser verification once the development
environment is ready. This is a planning target, not a time limit or a passing criterion:
finish the relevant checks and report failures or blockers. Diagnose slow setup or replace
unnecessary waiting before expanding the test scope.

| Change | Browser scope |
| --- | --- |
| Pure rules or server logic with no changed UI behavior | Use automated tests; no browser run is needed unless integration remains uncertain. |
| Localized UI or game option | Exercise one real client/server flow and the affected visual states. Check 1366×768 and 360×640 when layout changes; add 844×390 when short or landscape layouts are affected. |
| Shared layout, navigation, or responsive breakpoints | Exercise affected pages at 2560×1440, 1920×1080, 1366×768, 390×844, 375×667, 360×640, and 844×390. Add checks immediately around changed breakpoints where needed. |
| Authentication, membership, transport, private data, or deployment | Check the affected login/logout, room create/join/chat, refresh/reconnect, and game flows. Use separate accounts when verifying permissions or private-hand visibility. Follow [deployment](deployment.md) for production migration checks. |

Use automated tests for rule boundaries, complete matches, authorization, persistence
failures, and restart recovery. In the browser, use existing helpers or development-only
in-memory fixtures to reach visual states directly instead of playing a complete match
or waiting for bots and animations. Fixtures verify rendering; a real client/server action
must still verify changed wiring. Injected state does not prove authorization or durable
persistence. Keep test data isolated from real accounts and databases, and do not add
new test infrastructure for a one-off visual check without agreement.

For affected waiting-room and game layouts, verify no document or route-viewport
scrolling, visible controls, and no seat/card intersections. Check timer settings and
chat/info open/close behavior when their controls or available space change. Exercise
crowded Red Points tables, multiple capture targets, and the initial deal without
presentation metadata when changing that game's table or shared layout. Check music
pause/resume and route changes when touching playback. Voice verification needs separate
browser participants; synthetic local streams do not prove real microphones or cross-NAT
connectivity.

Batch independent inspections and inspect screenshots only for states that need visual
judgment. Reuse a working isolated development environment and synthetic accounts during
the task. Expand coverage when a check fails, shared behavior changes, or an uncertainty
remains; after a fix, repeat the affected checks. Once the selected checks pass, stop
adding unrelated flows or viewport checks. Report the scope actually verified and any
remaining limitations.
