import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameActionEnvelope } from '@shared/games/actions';
import { getPresentationEndsAt } from '@shared/game-presentation';
import type { Seat } from '@shared/types';
import * as games from '../../src/managers/game-manager';
import { firstLegalAction } from '../../src/runtime/automated-action';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import { createSocketHarness, SEATS } from '../performance/socket-harness';
import type { SocketHarness, TestClient } from '../performance/socket-harness';

const TRICK_GAMES = ['hearts', 'gongzhu', 'spades'] as const;

/** Selects an action using only the same private snapshot the authenticated player receives. */
async function pendingAction(clients: readonly TestClient[]): Promise<{
  client: TestClient; seat: Seat; request: GameActionEnvelope;
}> {
  for (const [index, client] of clients.entries()) {
    const response = await client.timeout(5_000).emitWithAck('player:resume');
    if (!response.gameState) throw new Error('Expected an active game');
    expect(response.gameState).not.toHaveProperty('hands');
    expect(response.gameState).not.toHaveProperty('observedHands');
    expect(response.gameState).not.toHaveProperty('replayRecording');
    const action = firstLegalAction(response.gameState);
    if (action?.type === 'game-action') return { client, seat: SEATS[index], request: action.request };
  }
  throw new Error('Expected a player to owe an action');
}

describe.each(REPOSITORY_ADAPTERS)('trick-game Socket transactions ($name)', (storage) => {
  let harness: SocketHarness | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    await harness?.close();
    harness = undefined;
  });

  it.each(TRICK_GAMES)('commits %s before acknowledgement and broadcast, and rolls back failed writes', async (gameType) => {
    const app = await (harness = await createSocketHarness(1, storage));
    const clients = app.clients[0];
    const host = clients[0];
    const code = app.roomCodes[0];
    expect(await host.emitWithAck('room:setGameType', { gameType })).toEqual({ success: true });
    for (const client of clients) expect(await client.emitWithAck('room:ready')).toEqual({ success: true });
    expect(await host.emitWithAck('room:start')).toEqual({ success: true });
    let now = Math.max(Date.now(), getPresentationEndsAt(games.getGameState(code)!)) + 1;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const pending = await pendingAction(clients);
    const originalState = structuredClone(games.getGameState(code));
    for (const action of [null, { type: 'unknown' }, { type: 'play', card: { suit: 'clubs', rank: 1 } }]) {
      expect(await pending.client.emitWithAck('game:action', { gameType, action } as never)).toMatchObject({ success: false });
    }
    expect(await pending.client.emitWithAck('game:action', {
      gameType: 'bigtwo', action: { type: 'pass' },
    })).toMatchObject({ success: false });
    expect(games.getGameState(code)).toEqual(originalState);

    const durableBefore = await app.repository.loadRuntime();
    const save = app.repository.saveRuntime.bind(app.repository);
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const saveSpy = vi.spyOn(app.repository, 'saveRuntime').mockImplementationOnce(async (...args) => {
      entered();
      await barrier;
      await save(...args);
    });
    app.resetMetrics();
    let acknowledged = false;
    const response = pending.client.timeout(5_000).emitWithAck('game:action', pending.request)
      .then((result) => { acknowledged = true; return result; });
    try {
      await Promise.race([writing, response.then(() => { throw new Error('Action did not reach the persistence barrier'); })]);
      expect(acknowledged).toBe(false);
      expect(app.metrics.snapshots).toBe(0);
      expect(await app.repository.loadRuntime()).toEqual(durableBefore);
    } finally {
      release();
    }
    expect(await response).toEqual({ success: true });
    const durableAfter = await app.repository.loadRuntime();
    expect(durableAfter).not.toEqual(durableBefore);
    expect(isRuntimeSnapshot(durableAfter)).toBe(true);
    expect(durableAfter?.games[0]).toEqual(games.getGameState(code));

    now = Math.max(now, getPresentationEndsAt(games.getGameState(code)!)) + 1;
    expect(await pending.client.emitWithAck('game:action', pending.request)).toMatchObject({ success: false });
    const next = await pendingAction(clients);
    const committed = structuredClone(games.getGameState(code));
    saveSpy.mockRejectedValueOnce(new Error('Synthetic storage failure'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app.resetMetrics();
    expect(await next.client.emitWithAck('game:action', next.request)).toMatchObject({ success: false });
    expect(app.metrics.snapshots).toBe(0);
    expect(games.getGameState(code)).toEqual(committed);
    expect(await app.repository.loadRuntime()).toEqual(durableAfter);
    expect(await next.client.emitWithAck('game:action', next.request)).toEqual({ success: true });
    expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
  });
});
