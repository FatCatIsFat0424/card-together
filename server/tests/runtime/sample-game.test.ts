import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { BOARD_TIME_CONTROL } from '@shared/time-control';
import { ACTION_PARSERS, parseGameAction } from '@shared/games/actions';
import { GAME_DEFINITIONS } from '@shared/games/registry';
import type { ActionResult } from '@shared/types/socket-events';
import { tokenHash } from '../../src/auth/auth-service';
import { createApplication } from '../../src/app';
import { GAME_VALIDATORS } from '../../src/managers/games/validation-registry';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import * as games from '../../src/managers/game-manager';
import { parseSampleAction, sampleAdapter, sampleDefinition, sampleValidator } from '../fixtures/sample-game';
import { connectClient, createSocketHarness, TEST_ORIGIN } from '../performance/socket-harness';
import type { SocketHarness, TestClient } from '../performance/socket-harness';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import type { RepositoryAdapter } from '../helpers/repository-adapters';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

vi.mock('../../src/managers/games/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/managers/games/registry')>();
  const { sampleAdapter: sample } = await import('../fixtures/sample-game');
  const adapters = { ...actual.GAME_ADAPTERS, sample };
  return {
    ...actual,
    GAME_ADAPTERS: adapters,
    gameAdapter: (gameType: keyof typeof adapters) => adapters[gameType],
    allGameAdapters: () => Object.values(adapters),
  };
});

let harness: SocketHarness | undefined;
let directory: string | undefined;
let databasePath: string;
const originalGameCount = GAME_TYPES.length;

beforeAll(() => {
  // Runtime-only registry injection: no existing game's identity, action, or state is reused.
  Object.assign(GAME_TYPES, { [GAME_TYPES.length]: 'sample' });
  Object.assign(GAME_DEFINITIONS, { sample: sampleDefinition });
  Object.assign(ACTION_PARSERS, { sample: parseSampleAction });
  Object.assign(GAME_VALIDATORS, { sample: sampleValidator });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await harness?.close();
  harness = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

afterAll(() => {
  Reflect.set(GAME_TYPES, 'length', originalGameCount);
  Reflect.deleteProperty(GAME_DEFINITIONS, 'sample');
  Reflect.deleteProperty(ACTION_PARSERS, 'sample');
  Reflect.deleteProperty(GAME_VALIDATORS, 'sample');
});

async function startSample(adapter: RepositoryAdapter): Promise<SocketHarness> {
  directory = await mkdtemp(join(tmpdir(), 'sample-game-'));
  databasePath = join(directory, adapter.fileName);
  // Keep this database outside the harness directory so the same file can be reopened.
  const app = await (harness = await createSocketHarness(1, {
    fileName: adapter.fileName, open: () => adapter.open(databasePath),
  }));
  const players = app.clients[0];
  // Wire payloads deliberately exceed the production closed GameType union.
  expect(await players[0].emitWithAck('room:setGameType', { gameType: 'sample' } as never)).toEqual({ success: true });
  for (const client of players) expect(await client.emitWithAck('room:ready')).toEqual({ success: true });
  expect(await players[0].emitWithAck('room:start')).toEqual({ success: true });
  expect(sampleAdapter.getGameState(app.roomCodes[0])?.clock?.turn?.seat).toBe('N');
  // The room timer followed the game's own default when the host switched games.
  expect(sampleAdapter.getGameState(app.roomCodes[0])?.clock?.settings).toEqual(BOARD_TIME_CONTROL);
  return app;
}

function claim(client: TestClient, token = 'north-private'): Promise<ActionResult> {
  return client.timeout(5_000).emitWithAck('game:action', { gameType: 'sample', action: { type: 'claim', token } } as never);
}

describe.each(REPOSITORY_ADAPTERS)('$name test-only game action extension', (adapter) => {
  it('starts and dispatches an independent action through registries with recipient-private views', async () => {
    const app = await startSample(adapter);
    const [north, east] = app.clients[0];
    const code = app.roomCodes[0];
    expect(parseGameAction({ gameType: 'sample', action: { type: 'claim', token: 'north-private', injected: true } }))
      .toEqual({ gameType: 'sample', action: { type: 'claim', token: 'north-private' } });
    expect(parseGameAction({ gameType: 'sample', action: { type: 'claim', token: 42 } })).toBe('Invalid claim.');
    for (const [client, token] of [[north, 'north-private'], [east, 'east-private']] as const) {
      const snapshot = await client.emitWithAck('player:resume');
      expect(snapshot.gameState).toMatchObject({ gameType: 'sample', ownToken: token });
      expect(snapshot.gameState).not.toHaveProperty('tokens');
      expect(snapshot.gameState).not.toHaveProperty('replayRecording');
      expect(snapshot.gameState).not.toHaveProperty('observedTokens');
    }
    expect(games.getRecipientVisibleState(code, null)).toMatchObject({
      observer: 'spectator', observedTokens: { N: 'north-private', E: 'east-private' },
    });
    const before = structuredClone(sampleAdapter.getGameState(code));
    app.resetMetrics();
    expect(await claim(east, 'east-private')).toEqual({ success: false, error: 'Claim your own token on your turn.' });
    expect(await north.emitWithAck('game:action', { gameType: 'bridge', action: { type: 'bid', bid: { type: 'pass' } } }))
      .toEqual({ success: false, error: 'This action is not available in this game.' });
    expect(sampleAdapter.getGameState(code)).toEqual(before);
    expect(app.metrics.runtimeWrites).toBe(0);
    expect(await claim(north)).toEqual({ success: true });
    expect(sampleAdapter.getGameState(code)).toMatchObject({ log: [{ seat: 'N' }], currentTurnSeat: 'E' });
    expect(sampleAdapter.getGameState(code)?.clock?.turn).toMatchObject({ seat: 'E' });
    expect((await app.repository.loadRuntime())?.games[0]).toMatchObject({ gameType: 'sample', log: [{ seat: 'N' }] });
    const updated = await east.emitWithAck('player:resume');
    expect(updated.gameState).toMatchObject({ ownToken: 'east-private', log: [{ seat: 'N' }] });
    expect(updated.gameState).not.toHaveProperty('tokens');
    expect(updated.gameState).not.toHaveProperty('replayRecording');
    const after = structuredClone(sampleAdapter.getGameState(code));
    expect(await claim(east, 'east-private')).toEqual({ success: false, error: 'Please wait for the current action to finish.' });
    expect(sampleAdapter.getGameState(code)).toEqual(after);
  });

  it('rolls back failed persistence and waits for commit before acknowledgment or private broadcasts', async () => {
    const app = await startSample(adapter);
    const [north] = app.clients[0];
    const code = app.roomCodes[0];
    const before = structuredClone(sampleAdapter.getGameState(code));
    const saved = await app.repository.loadRuntime();
    const save = app.repository.saveRuntime.bind(app.repository);
    app.resetMetrics();
    adapter.failNextCommit(new Error('Sample commit failed'));
    expect(await claim(north)).toEqual({ success: false, error: 'Unable to save your changes. Please try again.' });
    expect(sampleAdapter.getGameState(code)).toEqual(before);
    expect(await app.repository.loadRuntime()).toEqual(saved);
    expect((await adapter.readDocument(databasePath)).runtime).toEqual(saved);
    expect(app.metrics.snapshots).toBe(0);

    let release: () => void = () => {};
    let entered: () => void = () => {};
    const committing = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(app.repository, 'saveRuntime').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      await save(...args);
    });
    let acknowledged = false;
    const response = claim(north).then((result) => { acknowledged = true; return result; });
    await committing;
    try {
      expect(acknowledged).toBe(false);
      expect(app.metrics.snapshots).toBe(0);
      expect(await app.repository.loadRuntime()).toEqual(saved);
      expect((await adapter.readDocument(databasePath)).runtime).toEqual(saved);
    } finally { release(); }
    expect(await response).toEqual({ success: true });
    expect((await app.repository.loadRuntime())?.games[0]).toMatchObject({ log: [{ seat: 'N' }] });
    expect(app.metrics.snapshots).toBeGreaterThan(0);
    for (const snapshot of app.metrics.latestSnapshots.values()) {
      expect(snapshot.gameState).not.toHaveProperty('tokens');
      expect(snapshot.gameState).not.toHaveProperty('replayRecording');
      expect(snapshot.gameState).not.toHaveProperty('observedTokens');
    }
  });

  it('reopens the durable game and restores its private state, replay, clock, and dispatcher', async () => {
    const app = await startSample(adapter);
    const [north] = app.clients[0];
    const code = app.roomCodes[0];
    const shape = vi.spyOn(sampleValidator, 'shape');
    const coherent = vi.spyOn(sampleValidator, 'coherent');
    expect(await claim(north)).toEqual({ success: true });
    const saved = await app.repository.loadRuntime();
    expect(isRuntimeSnapshot(saved)).toBe(true);
    expect(shape).toHaveBeenCalled();
    expect(coherent).toHaveBeenCalled();
    expect(saved?.games[0].replayRecording?.steps.length).toBeGreaterThan(0);
    expect((await adapter.readDocument(databasePath)).runtime).toEqual(saved);
    await app.close();
    harness = undefined;
    games.restoreGames([]);
    expect(sampleAdapter.getGameState(code)).toBeNull();

    const repository = await adapter.open(databasePath);
    let restarted: Awaited<ReturnType<typeof createApplication>> | undefined;
    let east: TestClient | undefined;
    try {
      expect((await repository.loadRuntime())?.games).toEqual(saved?.games);
      const application = await createApplication(repository, { allowedOrigins: [TEST_ORIGIN] });
      restarted = application;
      const restored = sampleAdapter.getGameState(code);
      expect(restored).toEqual(saved?.games[0]);
      expect(games.getPlayerVisibleState(code, 'E')).toMatchObject({ ownToken: 'east-private' });
      expect(games.getPlayerVisibleState(code, 'E')).not.toHaveProperty('tokens');
      expect(games.handleGameAction(code, 'E', {
        gameType: 'sample', action: { type: 'claim', token: 'east-private' },
      } as never)).toEqual({ success: false, reason: 'Please wait for the current action to finish.' });
      await new Promise<void>((resolve, reject) => {
        application.httpServer.once('error', reject);
        application.httpServer.listen(0, '127.0.0.1', resolve);
      });
      const address = application.httpServer.address();
      if (!address || typeof address === 'string') throw new Error('Expected restarted server address');
      east = await connectClient(`http://127.0.0.1:${address.port}`, app.cookies[0][1]);
      const now = vi.spyOn(Date, 'now').mockReturnValue(getPresentationEndsAt(games.getGameState(code)!));
      try { expect(await claim(east, 'east-private')).toEqual({ success: true }); }
      finally { now.mockRestore(); }
      expect((await repository.loadRuntime())?.games[0]).toMatchObject({ log: [{ seat: 'N' }, { seat: 'E' }] });
      const visible = (await east.emitWithAck('player:resume')).gameState;
      expect(visible).toMatchObject({ gameType: 'sample', ownToken: null, currentTurnSeat: 'S' });
      expect(visible).not.toHaveProperty('tokens');
      expect(visible).not.toHaveProperty('replayRecording');
    } finally {
      east?.disconnect();
      if (restarted) await restarted.close();
      else await repository.close();
    }
  });

  it('rejects malformed or incoherent sample state without changing the durable snapshot', async () => {
    const app = await startSample(adapter);
    const saved = await app.repository.loadRuntime();
    expect(saved).not.toBeNull();
    for (const invalid of [{ tokens: { N: 42 } }, { log: [{ seat: 'N' }] }]) {
      const candidate = structuredClone(saved!);
      Object.assign(candidate.games[0], invalid);
      expect(isRuntimeSnapshot(candidate)).toBe(false);
      await expect(app.repository.saveRuntime(candidate)).rejects.toThrow();
      expect(await app.repository.loadRuntime()).toEqual(saved);
      expect((await adapter.readDocument(databasePath)).runtime).toEqual(saved);
    }
  });

  it('authenticates a new game action before invoking its hook or writing state', async () => {
    const app = await startSample(adapter);
    const [north] = app.clients[0];
    const cookie = app.cookies[0][0];
    const before = structuredClone(sampleAdapter.getGameState(app.roomCodes[0]));
    const apply = vi.spyOn(sampleAdapter, 'applyAction');
    await app.repository.deleteSession(tokenHash(cookie.slice(cookie.indexOf('=') + 1)));
    app.resetMetrics();
    expect(await claim(north)).toEqual({ success: false, error: 'Your session has expired. Please sign in again.' });
    expect(apply).not.toHaveBeenCalled();
    expect(sampleAdapter.getGameState(app.roomCodes[0])).toEqual(before);
    expect(app.metrics.runtimeWrites).toBe(0);
    expect(app.metrics.snapshots).toBe(0);
  });
});
