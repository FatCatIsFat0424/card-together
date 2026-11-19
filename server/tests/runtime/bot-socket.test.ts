import { afterEach, describe, expect, it, vi } from 'vitest';
import * as rooms from '../../src/managers/room-manager';
import { createSocketHarness } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';

describe('bot seat transport', () => {
  let harness: SocketHarness | undefined;
  afterEach(async () => { await harness?.close(); harness = undefined; vi.restoreAllMocks(); });

  it('asks pages that still set a bot difficulty to refresh, without changing or saving the room', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    const code = app.roomCodes[0];
    await guest.emitWithAck('room:standUp');
    // An older page still sends a difficulty with the bot; it is ignored.
    expect(await host.emitWithAck('room:addBot', { seat: 'E', difficulty: 'easy' } as never)).toEqual({ success: true });
    const before = structuredClone(rooms.getRoomInfo(code));
    const saved = await app.repository.loadRuntime();
    expect(saved!.rooms[0].info.seats.E.player).toMatchObject({ isBot: true });
    expect(saved!.rooms[0].info.seats.E.player).not.toHaveProperty('botDifficulty');
    app.resetMetrics();
    for (const [client, payload] of [[host, { seat: 'E', difficulty: 'easy' }], [guest, { seat: 'E', difficulty: 'hard' }],
      [host, null]] as const) {
      expect(await client.emitWithAck('room:setBotDifficulty', payload)).toEqual({
        success: false, error: 'This version is outdated. Please refresh your page.',
      });
    }
    expect(rooms.getRoomInfo(code)).toEqual(before);
    expect(await app.repository.loadRuntime()).toEqual(saved);
    expect(app.metrics.runtimeWrites).toBe(0);
    expect(app.metrics.snapshots).toBe(0);
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
    expect(await host.emitWithAck('room:addBot', { seat: 'P5' })).toEqual({ success: true });
    expect((await app.repository.loadRuntime())!.rooms[0].info.additionalSeats?.[0].player).toMatchObject({ isBot: true });
    expect(await host.emitWithAck('room:removeBot', { seat: 'P5' })).toEqual({ success: true });
    expect((await app.repository.loadRuntime())!.rooms[0].info.additionalSeats?.[0].player).toBeNull();
  });
});
