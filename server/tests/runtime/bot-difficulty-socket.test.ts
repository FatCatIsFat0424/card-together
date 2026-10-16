import { afterEach, describe, expect, it, vi } from 'vitest';
import * as rooms from '../../src/managers/room-manager';
import { createSocketHarness } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';

describe('bot difficulty transport', () => {
  let harness: SocketHarness | undefined;
  afterEach(async () => { await harness?.close(); harness = undefined; vi.restoreAllMocks(); });

  it('validates difficulty and permissions, commits changes, and preserves them on resume and start', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    for (const client of app.clients[0].slice(1)) {
      expect(await client.emitWithAck('room:standUp')).toEqual({ success: true });
    }
    expect(await host.emitWithAck('room:addBot', { seat: 'E', difficulty: 'easy' })).toEqual({ success: true });
    expect(await host.emitWithAck('room:fillBots')).toEqual({ success: true });
    expect(await guest.emitWithAck('room:setBotDifficulty', { seat: 'E', difficulty: 'hard' }))
      .toMatchObject({ success: false });
    for (const difficulty of ['medium', null, 1, undefined]) {
      expect(await host.emitWithAck('room:setBotDifficulty', {
        seat: 'E', difficulty: difficulty as 'easy',
      })).toMatchObject({ success: false, error: 'Invalid bot difficulty.' });
    }
    expect(await host.emitWithAck('room:setBotDifficulty', { seat: 'N', difficulty: 'easy' }))
      .toMatchObject({ success: false });
    expect(await host.emitWithAck('room:setBotDifficulty', { seat: 'S', difficulty: 'easy' })).toEqual({ success: true });
    const saved = await app.repository.loadRuntime();
    expect(saved!.rooms[0].info.seats.S.player?.botDifficulty).toBe('easy');
    const resumed = await guest.emitWithAck('player:resume');
    expect(resumed.room!.seats.E.player?.botDifficulty).toBe('easy');
    expect(resumed.room!.seats.S.player?.botDifficulty).toBe('easy');
    expect(resumed.room!.seats.W.player?.botDifficulty).toBe('hard');
    expect(await host.emitWithAck('room:ready')).toEqual({ success: true });
    expect(await host.emitWithAck('room:start')).toEqual({ success: true });
    expect(await host.emitWithAck('room:setBotDifficulty', { seat: 'E', difficulty: 'hard' }))
      .toMatchObject({ success: false });
    expect((await app.repository.loadRuntime())!.games[0].players.E?.botDifficulty).toBe('easy');
  });

  it('accepts bot actions for additional seats and rejects unknown seats', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host] = app.clients[0];
    expect(await host.emitWithAck('room:setGameType', { gameType: 'holdem' })).toEqual({ success: true });
    expect(await host.emitWithAck('room:addBot', { seat: 'P5' })).toMatchObject({ success: false });
    expect(await host.emitWithAck('room:addSeat')).toEqual({ success: true });
    for (const seat of ['P9', 'X', null]) {
      expect(await host.emitWithAck('room:addBot', { seat: seat as 'P5' })).toMatchObject({ success: false, error: 'Invalid seat.' });
    }
    expect(await host.emitWithAck('room:addBot', { seat: 'P5', difficulty: 'easy' })).toEqual({ success: true });
    expect(await host.emitWithAck('room:setBotDifficulty', { seat: 'P5', difficulty: 'hard' })).toEqual({ success: true });
    expect((await app.repository.loadRuntime())!.rooms[0].info.additionalSeats?.[0].player)
      .toMatchObject({ isBot: true, botDifficulty: 'hard' });
    expect(await host.emitWithAck('room:removeBot', { seat: 'P5' })).toEqual({ success: true });
    expect((await app.repository.loadRuntime())!.rooms[0].info.additionalSeats?.[0].player).toBeNull();
  });

  it('rolls back difficulty and readiness when persistence fails without broadcasting', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    const code = app.roomCodes[0];
    await guest.emitWithAck('room:standUp');
    await host.emitWithAck('room:addBot', { seat: 'E' });
    await host.emitWithAck('room:ready');
    const before = structuredClone(rooms.getRoomInfo(code));
    const saved = await app.repository.loadRuntime();
    app.resetMetrics();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('disk unavailable'));
    expect(await host.emitWithAck('room:setBotDifficulty', { seat: 'E', difficulty: 'easy' }))
      .toMatchObject({ success: false });
    expect(rooms.getRoomInfo(code)).toEqual(before);
    expect(await app.repository.loadRuntime()).toEqual(saved);
    expect(app.metrics.snapshots).toBe(0);
    expect(await host.emitWithAck('room:setBotDifficulty', { seat: 'E', difficulty: 'easy' }))
      .toEqual({ success: true });
    expect(rooms.getRoomInfo(code)!.seats.E.player?.botDifficulty).toBe('easy');
    expect(rooms.getRoomInfo(code)!.seats.N.isReady).toBe(false);
  });
});
