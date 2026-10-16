import { afterEach, describe, expect, it, vi } from 'vitest';
import * as games from '../../src/managers/game-manager';
import { createSocketHarness } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';

describe('auto-play transport', () => {
  let harness: SocketHarness | undefined;
  afterEach(async () => { await harness?.close(); harness = undefined; vi.restoreAllMocks(); });

  it('commits early departure with auto-play, publishes it to every view, and clears it on manual return', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    expect(await host.emitWithAck('game:leaveEarly')).toMatchObject({ success: false });
    for (const client of app.clients[0]) expect(await client.emitWithAck('room:ready')).toEqual({ success: true });
    expect(await host.emitWithAck('room:start')).toEqual({ success: true });
    const code = app.roomCodes[0];
    const saved = await app.repository.loadRuntime();
    app.resetMetrics();
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('disk unavailable'));
    expect(await host.emitWithAck('game:leaveEarly')).toMatchObject({ success: false });
    expect(games.getPlayerVisibleState(code, 'N')).toMatchObject({ autoPlay: false, earlyLeaveSeats: [] });
    expect(await app.repository.loadRuntime()).toEqual(saved);
    expect(app.metrics.snapshots).toBe(0);

    expect(await host.emitWithAck('game:leaveEarly')).toEqual({ success: true });
    expect(app.metrics.snapshots).toBeGreaterThan(0);
    expect((await app.repository.loadRuntime())!.games[0]).toMatchObject({ autoPlaySeats: ['N'], earlyLeaveSeats: ['N'] });
    expect((await host.emitWithAck('player:resume')).gameState).toMatchObject({ autoPlay: true, earlyLeaveSeats: ['N'] });
    expect((await guest.emitWithAck('player:resume')).gameState).toMatchObject({ autoPlay: false, earlyLeaveSeats: ['N'] });
    expect(games.getRecipientVisibleState(code, null)?.earlyLeaveSeats).toEqual(['N']);
    expect(await host.emitWithAck('game:leaveEarly')).toEqual({ success: true });
    expect(games.getGameState(code)?.earlyLeaveSeats).toEqual(['N']);
    expect(await host.emitWithAck('game:autoPlay', { enabled: false })).toEqual({ success: true });
    expect((await guest.emitWithAck('player:resume')).gameState?.earlyLeaveSeats).toEqual([]);
    expect(await host.emitWithAck('game:autoPlay', { enabled: true })).toEqual({ success: true });
    expect(games.getRecipientVisibleState(code, null)?.earlyLeaveSeats).toEqual([]);
  });

  it('validates input, owns only the caller’s seat, persists before broadcasting, and rolls back failures', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    expect(await host.emitWithAck('game:autoPlay', { enabled: true })).toMatchObject({ success: false });
    for (const client of app.clients[0]) expect(await client.emitWithAck('room:ready')).toEqual({ success: true });
    expect(await host.emitWithAck('room:start')).toEqual({ success: true });
    for (const enabled of ['yes', null, 1, undefined]) {
      expect(await host.emitWithAck('game:autoPlay', { enabled: enabled as unknown as boolean })).toMatchObject({ success: false });
    }
    const code = app.roomCodes[0];
    const saved = await app.repository.loadRuntime();
    app.resetMetrics();
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('disk unavailable'));
    expect(await host.emitWithAck('game:autoPlay', { enabled: true })).toMatchObject({ success: false });
    expect(games.getPlayerVisibleState(code, 'N')?.autoPlay).toBe(false);
    expect(await app.repository.loadRuntime()).toEqual(saved);
    expect(app.metrics.snapshots).toBe(0);
    expect(await host.emitWithAck('game:autoPlay', { enabled: true })).toEqual({ success: true });
    expect((await app.repository.loadRuntime())!.games[0].autoPlaySeats).toEqual(['N']);
    expect((await host.emitWithAck('player:resume')).gameState?.autoPlay).toBe(true);
    expect((await guest.emitWithAck('player:resume')).gameState?.autoPlay).toBe(false);
    expect(await host.emitWithAck('game:autoPlay', { enabled: false })).toEqual({ success: true });
    expect(games.getGameState(code)?.autoPlaySeats).toEqual([]);
  });
});
