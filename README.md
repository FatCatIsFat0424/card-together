# Card Together

Browser-based multiplayer card games with server-authoritative rules: Bridge,
Taiwanese Big Two, Red Points, Ninety-Nine, Sevens, Chinese Poker, Liar's Deck,
Blackjack, Texas Hold'em, and Napoleon.

- Rooms with up to eight spectators, chat, bots, and turn timers; Ninety-Nine,
  Blackjack, and Hold'em support 2–8 occupied seats, Napoleon 4–6, while other games use four.
- Accounts, friends, match history, rooms, and unfinished games survive restarts.
- Traditional Chinese and English, themes, uploaded avatars and table artwork,
  custom and site-provided emoji, optional WebRTC voice, and owner-provided music.

Stack: TypeScript npm workspaces with React 19, Vite, Zustand, Express, and Socket.IO.

## Quick start

Requires npm and the Node.js version in [`.node-version`](.node-version).

```sh
npm ci
npm run dev:server   # terminal 1, port 3001
npm run dev:client   # terminal 2
```

Open <http://localhost:5173>. Vite proxies API and Socket.IO requests to the server,
which creates the Git-ignored `server/data/database.json`.

- Setup, configuration, and checks: [development](docs/development.md), [testing](docs/testing.md).
- A fresh checkout has no music or site emoji: see [media](docs/media.md).
- Production: <https://acserver.csie.org/card-together/>, deployed with the
  [deployment guide](docs/deployment.md).

## Documentation

| Document | Contents |
| --- | --- |
| [Agent instructions](AGENTS.md) | Project rules, directory map, required checks |
| [Architecture](docs/architecture.md) | Module boundaries, state commits, timelines, clocks, bots |
| [Interface](docs/interface.md) | Frontend layout and page behavior |
| [Games](docs/games/README.md) | House rules for every game, spectators, timers, bots |
| [API](docs/api.md) | HTTP, Socket, and voice signaling contracts |
| [Storage](docs/storage.md) | Accounts, coins, JSON persistence, maintenance tools |
| [Media](docs/media.md) | Music, uploads, emoji, chat, and voice |
| [Development](docs/development.md) | Environment, configuration, benchmarks, browser checks |
| [Testing](docs/testing.md) | Check runner, gates, caches, coverage |
| [Deployment](docs/deployment.md) | Build, install, Nginx, backups, rollback |
| [Android app](docs/android.md) | APK wrapper, signing key, release steps |
| [Roadmap](docs/roadmap.md) | Public launch gates, monetization, operations, and development priorities (Traditional Chinese) |

## License

The application is [MIT-licensed](LICENSE). Playing-card graphics by Chris Aguilar
are LGPL-3.0-or-later; keep their [notices](client/src/assets/cards/README.txt) and
bundled license texts.
