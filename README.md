# Card Together

A browser-based multiplayer platform for Bridge, Taiwanese Big Two, Red Points,
Ninety-Nine, Sevens, and Chinese Poker. Built with React 19, TypeScript, Zustand, Express, Socket.IO,
and npm workspaces.

Players sign in, create or join four-seat rooms, chat, and play with
server-authoritative rules. Accounts, friendships, match history, rooms, and
unfinished games persist across server restarts. The interface supports
Traditional Chinese and English, themes, uploaded avatars, table backgrounds and card backs,
custom and site-provided emoji/stickers, optional WebRTC voice, and owner-provided
background music.

## Development

Use the Node.js version pinned in `.node-version` (24.x; 22.13+ also runs the app) and npm.
From the repository root:

```sh
npm ci
npm run dev:server
```

In another terminal:

```sh
npm run dev:client
```

Open <http://localhost:5173>. Vite proxies API and Socket.IO requests to port 3001.
The server creates `server/data/database.json`; this private directory is ignored
by Git. Only one server process may own a database file.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run build:client
python3 -B -m unittest discover -s deploy/tests
```

See [development](docs/development.md) for configuration, deployment script checks,
and benchmarks. Music sources belong in ignored `local-music/` and site chat emoji in
ignored `local-emoji/`; a fresh checkout has an empty playlist and no site emoji. See
[media](docs/media.md).

## Production

The deployment wrapper installs the application, updates the existing Nginx
site, starts systemd, and verifies local/public health. Run as the deployment user:

```sh
npm exec --yes --package="node@$(cat .node-version)" -- bash deploy/build.sh &&
bash deploy/deploy.sh
```

The target is <https://acserver.csie.org/card-together/>. Deployment requests sudo
and briefly stops the backend. Prerequisites, data migration, configuration, and
rollback are documented in the [deployment guide](docs/deployment.md).

## Documentation

| Document | Purpose |
| --- | --- |
| [Architecture](docs/architecture.md) | Module boundaries and runtime behavior |
| [Development](docs/development.md) | Environment, checks, and benchmarks |
| [Deployment](docs/deployment.md) | Build, Nginx, systemd, migration, and rollback |
| [Storage](docs/storage.md) | Accounts, JSON persistence, backup, and SQL boundaries |
| [API](docs/api.md) | HTTP and Socket contracts |
| [Games](docs/games.md) | The four games' house rules |
| [Media](docs/media.md) | Music files, images, stickers, and voice |
| [Agent instructions](AGENTS.md) | Project-specific contribution rules |

The application is [MIT-licensed](LICENSE). Playing-card graphics by Chris Aguilar
are LGPL-3.0-or-later; retain their [notices](client/src/assets/cards/README.txt)
and bundled license texts. Sample libraries and composition tooling are maintained
separately in `~/daw-tmp` and are not part of the game runtime.
