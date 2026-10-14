# Development

Project rules: [AGENTS.md](../AGENTS.md). Check commands: [testing](testing.md).

## Setup

1. Use the exact Node.js version in [`.node-version`](../.node-version). The app runs
   on 22.13+, but the check runner and deployment reject other versions.
2. Run `npm ci` from the repository root. All workspaces share the root TypeScript.
3. Start `npm run dev:server` and `npm run dev:client`, then open <http://localhost:5173>.

Client `predev` and `prebuild` import owner music and site emoji from the ignored
`local-music/` and `local-emoji/` folders; see [media](media.md).

## Configuration

- The server reads process environment variables only. `server/.env.example` is a
  reference and is not loaded automatically.
- Vite reads `client/.env.local` at startup and build; restart or rebuild after changes.
- `VITE_` values are public JavaScript. Never put secrets in them.

| Server variable | Behavior |
| --- | --- |
| `PORT` | Default `3001` |
| `HOST` | Optional bind address; use `127.0.0.1` behind a local proxy |
| `DATABASE_PATH` | Default `server/data/database.json` regardless of cwd; relative overrides resolve from cwd |
| `CLIENT_ORIGIN` | Comma-separated exact `http(s)://host[:port]` origins: no path, trailing slash, or default port. Required in production; development defaults to `localhost:5173` and `127.0.0.1:5173`. Invalid entries stop startup |
| `NODE_ENV` | `production` enables Secure cookies and requires HTTPS |
| `TRUST_PROXY_LOOPBACK` | Default `false`. Enable only behind a trusted local proxy that overwrites forwarded addresses |
| `SEVENS_DEV_PRESET` | Development only. `near-slay` deals Sevens after 44 logged plays that lay each suit from 2 to Q, leaving two aces or kings per seat. Any other value, or any value in production, stops startup |

| Vite variable | Behavior |
| --- | --- |
| `VITE_BASE_PATH` | Default `/`; must start and end with `/` |
| `VITE_SERVER_URL` | Optional external API/Socket origin; empty uses the app origin and base |
| `VITE_SOCKET_PATH` | Optional Socket.IO path |
| `VITE_DEV_PROXY_TARGET` | Development proxy HTTP(S) origin; default `http://localhost:3001`. No credentials, path, query, or fragment |
| `VITE_WEBRTC_ICE_SERVERS` | Public JSON ICE configuration; see [voice](media.md#voice) |

Production values: [deployment](deployment.md#runtime-settings).

When the workstation also hosts production on port `3001`, keep development on a
separate backend port and database:

```sh
PORT=3002 HOST=127.0.0.1 npm run dev:server
```

Set `VITE_DEV_PROXY_TARGET=http://127.0.0.1:3002` in `client/.env.local`, then start
`npm run dev:client`. The default development database remains `server/data/database.json`;
never override it with `/var/lib/card-together/database.json`. API and Socket.IO proxy
requests both use the configured development target. The variable is for Vite's dev
server only and does not change the production Nginx upstream.

The optional [automatic deployment service](deployment.md#automatic-deployment-after-ci)
uses a separate detached worktree and owner-input snapshots. Your current branch,
uncommitted changes, and local-only commits do not enter its production builds.

## UI conventions

- **Checkboxes:** use [AppCheckbox](../client/src/components/AppCheckbox.tsx) (MUI, theme
  variables, 44px hit area). Associate labels with the native input and pass input
  accessibility attributes through `slotProps.input`.
- **Icons:** use [AppIcon](../client/src/components/AppIcon.tsx) with individual
  `@mui/icons-material` SVG imports; icons inherit text size and color. Decorative icons
  need accessible control names and translated status text.
- **Custom artwork:** keep the existing suits, avatars, crowns, skulls, dragons, and
  revolvers where Material Icons has no suitable equivalent.
- **Motion:** respect reduced-motion preferences; presentation must keep its information
  and deadlines without animation.
- **Rules text:** bilingual rules live in `client/src/game-rules-i18n.ts` and must match
  [games](games.md) and the linked shared functions.
- **Preferences:** browser preferences use `card-together.*` keys. Legacy `bridge.*`
  values migrate without replacing existing keys.

Page behavior and layout: [interface](interface.md).

## Benchmarks

Opt-in; not part of any check gate.

```sh
npm run bench:database   # indexed queries and persistent writes
npm run bench:socket     # snapshot/chat payload bytes and runtime writes across rooms
npm run bench:arrange    # Chinese Poker arrangement search: seed 23, 1 warmup, 20 samples
```

- Each benchmark creates and removes its own temporary JSON database. Never point one
  at a production `DATABASE_PATH`.
- Socket results: `payloadBytes` and `snapshotPayloadBytes` count snapshots,
  `chatPayloadBytes` counts chat. Validate acknowledgments, recipients, and workload
  before accepting results.
- The arrange timing budget is opt-in; its correctness corpus stays in Vitest.
- Compare only identical workloads and runtime versions. Frontend startup size includes
  the entry chunk **and** preloaded chunks.

## Browser verification

Choose scope from the affected behavior. Automated tests already cover rule boundaries,
full matches, authorization, persistence failure, and restart recovery.

| Change | Browser scope |
| --- | --- |
| Rules or server logic without UI changes | None, unless integration remains uncertain |
| Localized UI or game option | One real client/server flow plus affected visuals at 1366×768 and 360×640; add 844×390 for short landscape |
| Shared layout, navigation, breakpoints | Affected pages at 2560×1440, 1920×1080, 1366×768, 390×844, 375×667, 360×640, 844×390, and around changed breakpoints |
| Authentication, membership, transport, private data, deployment | Login/logout, room create/join/chat, refresh/reconnect, and affected game flows with separate accounts; follow [deployment](deployment.md) for migrations |

| Affected area | Also check |
| --- | --- |
| Waiting room or game layout | No document scrolling, visible controls, no seat/card overlap; timers and chat/info toggles when space changes |
| Red Points or shared table | Crowded tables, multiple capture targets, initial deal without presentation metadata |
| Music | Pause/resume across route changes; a paused tab stays paused after reload |
| Voice | Separate browser participants; synthetic streams prove neither microphones nor cross-NAT routing |

Rules:

- Use isolated synthetic accounts and databases, and reuse them across checks.
- Reach visuals through existing helpers or development-only fixtures instead of playing
  full matches. Confirm changed wiring with one real action; injected state cannot prove
  authorization or durability.
- Use screenshots for visual judgment and batch independent inspections.
- Widen scope after failures or shared changes; stop once the selected checks pass, and
  report the actual scope and limits.
- Ask before adding new test infrastructure.
