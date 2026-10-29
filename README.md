# Card Together

Browser-based multiplayer games with server-authoritative rules, 24 in three categories:

- **Card games:** Bridge, Taiwanese Big Two, Red Points, Ninety-Nine, Sevens, Chinese Poker,
  Liar's Deck, Blackjack, Ten and a Half, Texas Hold'em, Five-Card Stud, Napoleon, Crazy Eights,
  Old Maid, Go Fish, and Dou Dizhu.
- **Dice games:** Liar's Dice.
- **Board games:** Reversi, Gomoku, Jungle, Xiangqi (with handicaps), Banqi, Chinese Checkers,
  and Land Battle Chess.

- Rooms with up to eight spectators, chat, bots (Easy and Hard), and turn timers. Ninety-Nine,
  Blackjack, Ten and a Half, Hold'em, Five-Card Stud, Crazy Eights, Liar's Dice, and Old Maid support
  2–8 occupied seats, Go Fish 2–6, Napoleon 4–6, Chinese Checkers 2, 3, 4, or 6, Dou Dizhu exactly
  three, the other board games exactly two, and the remaining card games four.
- Accounts, friends, match history with replays and statistics, daily rewards, a coin-based cosmetics shop,
  rooms, and unfinished games survive restarts.
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

Guides in `docs/` are written in Traditional Chinese.

| Document | Contents |
| --- | --- |
| [Agent instructions](AGENTS.md) | Project rules, directory map, required checks |
| [Architecture](docs/architecture.md) | Module boundaries, adding a game, state commits, timelines, clocks, bots |
| [Interface](docs/interface.md) | Frontend layout and page behavior |
| [Games](docs/games/README.md) | House rules for every game (card, dice, board), spectators, timers, bots |
| [API](docs/api.md) | HTTP, Socket, and voice signaling contracts |
| [Storage](docs/storage.md) | Accounts, coins, JSON persistence, maintenance tools |
| [Media](docs/media.md) | Music, uploads, emoji, chat, and voice |
| [Development](docs/development.md) | Environment, configuration, benchmarks, browser checks |
| [Testing](docs/testing.md) | Check runner, gates, caches, coverage |
| [Deployment](docs/deployment.md) | Build, install, Nginx, backups, rollback |
| [Android app](docs/android.md) | APK wrapper, signing key, release steps |
| [Roadmap](docs/roadmap.md) | Public launch gates, monetization, operations, and development priorities |

## License

The application is [MIT-licensed](LICENSE). Playing-card graphics by Chris Aguilar
are LGPL-3.0-or-later; keep their [notices](client/src/assets/cards/README.txt) and
bundled license texts.
