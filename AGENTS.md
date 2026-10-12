# Card Together project instructions

Authoritative project rule set; `CLAUDE.md` references it.

## Stack

- TypeScript npm workspaces: `client/` (React 19, Vite, Zustand, CSS Modules),
  `server/` (Express, Socket.IO), `shared/` (contracts and pure rules).
- Run checks with the Node.js version in `.node-version`; the app runs on 22.13+.
- Setup and configuration: [development](docs/development.md).

## Directory map

| Path | Contents |
| --- | --- |
| `shared/src/types/`, `constants/`, `rules/` | Browser/server contracts and pure game rules |
| `server/src/engine/` | Pure Bridge functions |
| `server/src/managers/`, `managers/games/` | Runtime state and game adapters |
| `server/src/runtime/` | Serialized persistence, rollback, bot and timeout scheduling |
| `server/src/bots/` | Bot strategies |
| `server/src/auth/`, `social/`, `http/`, `socket/` | Services and transport adapters |
| `server/src/database/`, `media/` | Repository and uploaded-image storage |
| `client/src/pages/`, `components/`, `hooks/`, `stores/` | UI and client state |
| `client/src/audio/`, `voice/` | Music playback, turn reminders, WebRTC |
| `server/tests/`, `deploy/tests/` | Vitest and Python standard-library tests |
| `scripts/` | Check runner and asset importers |
| `deploy/` | Production build, install, and operation scripts |
| `docs/` | Authoritative guides (index in [README](README.md#documentation)) |

## Implementation rules

- The server decides legality, turns, and results, and filters private hands per recipient.
- Engine and shared rule functions have no I/O, manager state, or transport access.
  Inject randomness and do not mutate caller inputs.
- Managers do not import Socket handlers or coordinate other managers directly;
  cross-manager changes go through the Socket context or runtime coordinator.
- Socket handlers validate payloads, authenticate every action, and require callbacks.
  Mutations acknowledge and broadcast only after persistence succeeds; failures restore state.
- Keep the asynchronous Repository contract and its atomic constraints. One process
  owns each JSON database. Voice and presence signaling stay ephemeral.
- TypeScript style: module functions rather than custom classes, named exports, typed
  parameters and returns, `unknown` with narrowing instead of `any`, readonly inputs
  where callers must not be mutated.
- Formatting: single quotes, semicolons, kebab-case module filenames, PascalCase React
  component files and types, camelCase functions and CSS classes.
- Styling uses CSS Modules and the variables in `client/src/styles/global.css`.
  User-visible strings live in the typed English and Traditional Chinese dictionaries.
- Background music is owner-provided audio only. Do not add sampled instruments, score
  rendering, or composition tooling; those live in `~/daw-tmp`.

## Checks

Required before completing behavior changes (CI runs the same gate):

```sh
npm run check -- full
```

- Use `npm run check -- focused` while editing; it does not replace the full gate.
- Deployment builds use `release` mode with explicit production paths.
- No formatter or secret scanner is configured: match adjacent formatting and review
  staged content manually.
- Modes, selection, and caches: [testing](docs/testing.md).

## Documentation and operations

- Update the affected guide in `docs/` when behavior, contracts, configuration, or
  operations change. Link to contracts in code instead of copying interfaces; do not
  keep component inventories, measurement logs, or task histories.
- Temporary task plans go in the Git-ignored `.plan/`.
- Data changes follow [deployment](docs/deployment.md) and [storage](docs/storage.md):
  stop writers, keep complete database and media backups, and confirm schema
  compatibility before restoring.
- Keep the card graphics' notices and license texts.
