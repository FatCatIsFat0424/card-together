# Card Together project instructions

This is the authoritative project rule set. `CLAUDE.md` references it.

## Stack and layout

TypeScript npm workspaces: React 19/Vite/Zustand/CSS Modules in `client/`,
Express/Socket.IO in `server/`, and shared contracts/rules in `shared/`.
Use Node.js 22.13+; deployment uses Node.js 24.

- `shared/src/types/`, `constants/`, `rules/`: browser/server contracts and pure rules.
- `server/src/engine/`: pure Bridge functions; `managers/games/`: game adapters.
- `server/src/managers/`: runtime state; `runtime/`: serialized persistence/rollback.
- `server/src/auth/`, `social/`, `http/`, `socket/`: services and transport adapters.
- `server/src/database/`, `media/`: repository and uploaded-image storage.
- `client/src/pages/`, `components/`, `hooks/`, `stores/`: UI and state.
- `client/src/audio/`, `voice/`: file playback/turn reminders and WebRTC.
- `server/tests/`, `deploy/tests/`: Vitest and Python standard-library tests.
- `deploy/`: production artifacts/scripts; `docs/`: current authoritative guides.

## Implementation boundaries

- The server decides game outcomes and filters private hands per recipient.
- Engine/shared rule functions have no I/O, manager state, or transport dependencies;
  inject randomness where needed and preserve caller inputs.
- Managers do not import Socket handlers or directly coordinate other managers.
  Cross-manager changes go through Socket context/runtime coordinator.
- Socket handlers validate payloads, authenticate every action, and require callbacks.
  Mutations acknowledge/broadcast only after persistence succeeds; failure restores state.
- Keep the asynchronous Repository contract and atomic constraints. One process owns
  each JSON database. Voice/presence signaling remains ephemeral.
- Use module functions rather than custom classes, named exports, typed parameters
  and return values, `unknown` with narrowing instead of `any`, and readonly inputs
  where callers must not be mutated.
- Follow existing formatting: single quotes, semicolons, kebab-case module filenames,
  PascalCase React component filenames/types, camelCase functions/CSS classes.
- Use CSS Modules and existing variables in `client/src/styles/global.css`.
  Keep user-visible strings in the typed English/Traditional Chinese dictionaries.
- Keep background music as owner-provided audio playback. Do not reintroduce sampled
  instrument libraries, score rendering, or composition tooling; those live in `~/daw-tmp`.

## Setup and checks

See [development](docs/development.md) for setup and test locations. Required checks
for behavior changes, from the repository root:

```sh
npm run typecheck
npm run lint
npm test
npm run build:client
```

For deployment changes also run:

```sh
for script in deploy/*.sh; do bash -n "$script"; done
python3 -B -m unittest discover -s deploy/tests
```

Use existing Vitest tests for behavior and boundary cases. No formatter or secret
scanner is configured; follow adjacent formatting and review changed content.
Root `typecheck` and `lint` also cover `server/tests` and benchmarks; Vitest discovers
`server/tests/**/*.test.ts`. Run checks with the Node.js version in `.node-version`; CI runs them.

## Documentation and operations

Update the affected guide in `docs/` when behavior, contracts, configuration, or
operational requirements change. Link to authoritative contracts instead of
copying interfaces or keeping generated component inventories/task histories.
Use ignored `.plan/` for temporary task plans.

Follow [deployment](docs/deployment.md) and [storage](docs/storage.md) for data
changes: stop writers, preserve complete data/media, and verify compatibility before
restore. Preserve card graphics' notices and license texts.
