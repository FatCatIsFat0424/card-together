# Development

Use the [README](../README.md) startup commands and [AGENTS.md](../AGENTS.md)
implementation rules. Install dependencies from the root with `npm ci`.

## Configuration

The server reads process environment variables; `server/.env.example` is a
reference and is not auto-loaded. Vite loads `client/.env.local` on startup/build.

| Server variable | Behavior |
| --- | --- |
| `PORT` | Defaults to `3001` |
| `HOST` | Optional bind address; use `127.0.0.1` behind local Nginx |
| `DATABASE_PATH` | Defaults to `server/data/database.json`, independent of cwd; relative overrides resolve from cwd |
| `CLIENT_ORIGIN` | Comma-separated exact origins; development defaults to localhost/127.0.0.1 port 5173; required in production |
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

Typecheck covers all workspaces, including both client TypeScript configurations.
Root lint covers shared/server/client source. Vitest runs from `server/` and discovers
`tests/**/*.test.ts`, including browser-controller tests executed in Node. Deployment
helpers use Python standard-library unittest; they do not need a new test framework.
No separate formatter or secret-check command is configured.

Use `npm run test:watch` during development. Test directories group engine, auth,
database, runtime/socket, social, client, and voice behavior. Cover malformed inputs,
authorization, private data boundaries, persistence failures, and cleanup where relevant.
Run a production build because Vite's base paths and generated music catalog matter.

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

After user-facing or deployment changes, check login/logout, room create/join/chat,
refresh/reconnect, the affected game, and private-hand visibility using separate accounts.
For layout changes, check 2560×1440, 1920×1080, 1366×768, 390×844, 375×667,
360×640, and 844×390 CSS viewports. Waiting rooms and games must not scroll the
document or route viewport; verify visible controls, seat/card intersections, timer
settings, and chat/info open/close behavior. Exercise crowded Red Points tables and
multiple capture targets, including the initial deal before presentation metadata exists.
Check music pause/resume and route changes when touching playback. Voice verification
needs separate browser participants; synthetic local streams do not prove real microphones
or cross-NAT connectivity. Production migration checks are listed in [deployment](deployment.md).
