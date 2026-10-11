import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientToServerEvents } from '@shared/types';
import * as rooms from '../../src/managers/room-manager';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import { createSocketHarness } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';

describe('host seat management', () => {
  let harness: SocketHarness | undefined;
  afterEach(async () => { await harness?.close(); harness = undefined; vi.restoreAllMocks(); });

  it('swaps players, resets readiness, synchronizes every recipient, and persists the new seats', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    const [hostId, guestId] = app.accountIds[0];
    const code = app.roomCodes[0];
    expect(await host.emitWithAck('room:ready')).toEqual({ success: true });
    expect(await guest.emitWithAck('room:ready')).toEqual({ success: true });
    app.resetMetrics();
    expect(await host.emitWithAck('room:movePlayer', { accountId: guestId, target: { type: 'seat', seat: 'N' } }))
      .toEqual({ success: true });
    expect(rooms.getPlayerSeat(code, guestId)).toBe('N');
    expect(rooms.getPlayerSeat(code, hostId)).toBe('E');
    expect(Object.values(rooms.getRoomInfo(code)!.seats).every((seat) => !seat.isReady)).toBe(true);
    expect(app.metrics.snapshots).toBe(4);
    for (const snapshot of app.metrics.latestSnapshots.values()) {
      expect(snapshot.room?.seats.N.player?.id).toBe(guestId);
      expect(snapshot.room?.seats.E.player?.id).toBe(hostId);
    }
    const saved = await app.repository.loadRuntime();
    expect(isRuntimeSnapshot(saved)).toBe(true);
    rooms.restoreRooms(structuredClone(saved!.rooms));
    expect((await guest.emitWithAck('player:resume')).room?.seats.N.player?.id).toBe(guestId);
  });

  it('moves to spectators without removing membership, and moves spectators into empty or occupied seats', async () => {
    const app = await (harness = await createSocketHarness(1));
    const host = app.clients[0][0];
    const guestId = app.accountIds[0][1];
    const southId = app.accountIds[0][2];
    const code = app.roomCodes[0];
    expect(await host.emitWithAck('room:movePlayer', { accountId: guestId, target: { type: 'spectator' } }))
      .toEqual({ success: true });
    expect(rooms.getSpectatorIds(code)).toEqual([guestId]);
    expect(rooms.getRoomMemberIds(code)).toHaveLength(4);
    expect(rooms.getRoomInfo(code)?.seats.E.player).toBeNull();
    expect(await host.emitWithAck('room:movePlayer', { accountId: guestId, target: { type: 'seat', seat: 'S' } }))
      .toEqual({ success: true });
    expect(rooms.getSpectatorIds(code)).toEqual([southId]);
    expect(await host.emitWithAck('room:movePlayer', { accountId: southId, target: { type: 'seat', seat: 'E' } }))
      .toEqual({ success: true });
    expect(rooms.getSpectatorIds(code)).toEqual([]);
    expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
  });

  it('rejects guests, outsiders, malformed destinations, and movement during a match', async () => {
    const app = await (harness = await createSocketHarness(2));
    const [host, guest] = app.clients[0];
    const guestId = app.accountIds[0][1];
    const payload = { accountId: guestId, target: { type: 'spectator' as const } };
    expect(await guest.emitWithAck('room:movePlayer', payload)).toMatchObject({ success: false });
    expect(await host.emitWithAck('room:movePlayer', { ...payload, accountId: app.accountIds[1][0] }))
      .toMatchObject({ success: false });
    const invalid: readonly unknown[] = [null, {}, { ...payload, accountId: 42 }, { ...payload, target: null },
      { ...payload, target: { type: 'seat', seat: 'X' } }, { ...payload, target: { type: 'additional', index: -1 } },
      { ...payload, target: { type: 'additional', index: 0.5 } }, { ...payload, target: { type: 'additional', index: 0 } }];
    for (const value of invalid) {
      expect(await host.emitWithAck('room:movePlayer', value as Parameters<ClientToServerEvents['room:movePlayer']>[0]))
        .toMatchObject({ success: false });
    }
    expect(rooms.getPlayerSeat(app.roomCodes[0], guestId)).toBe('E');
    for (const client of app.clients[0]) expect(await client.emitWithAck('room:ready')).toEqual({ success: true });
    expect(rooms.getRoomInfo(app.roomCodes[0])?.status).toBe('playing');
    expect(await host.emitWithAck('room:movePlayer', payload)).toMatchObject({ success: false });
    expect(rooms.getPlayerSeat(app.roomCodes[0], guestId)).toBe('E');
  });

  it('swaps additional human seats and standard bots without allowing bots outside standard seats', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    const [hostId, guestId] = app.accountIds[0];
    const code = app.roomCodes[0];
    expect(await host.emitWithAck('room:setGameType', { gameType: 'holdem' })).toEqual({ success: true });
    expect(await host.emitWithAck('room:addSeat')).toEqual({ success: true });
    expect(await host.emitWithAck('room:movePlayer', { accountId: guestId, target: { type: 'additional', index: 0 } }))
      .toEqual({ success: true });
    expect(await host.emitWithAck('room:addBot', { seat: 'E' })).toEqual({ success: true });
    const botId = rooms.getRoomInfo(code)!.seats.E.player!.id;
    expect(await host.emitWithAck('room:movePlayer', { accountId: guestId, target: { type: 'seat', seat: 'E' } }))
      .toMatchObject({ success: false });
    expect(await host.emitWithAck('room:movePlayer', { accountId: botId, target: { type: 'spectator' } }))
      .toMatchObject({ success: false });
    expect(await host.emitWithAck('room:movePlayer', { accountId: hostId, target: { type: 'seat', seat: 'E' } }))
      .toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.seats.N.player?.id).toBe(botId);
    expect(rooms.getRoomInfo(code)?.seats.N.isReady).toBe(true);
    expect(await host.emitWithAck('room:movePlayer', { accountId: hostId, target: { type: 'additional', index: 0 } }))
      .toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.seats.E.player?.id).toBe(guestId);
    expect(rooms.getRoomInfo(code)?.additionalSeats?.[0].player?.id).toBe(hostId);
    expect(await guest.emitWithAck('room:standUp')).toEqual({ success: true });
    expect(await host.emitWithAck('room:movePlayer', { accountId: guestId, target: { type: 'seat', seat: 'N' } }))
      .toMatchObject({ success: false });
    expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
  });

  it('keeps spectator capacity while allowing a spectator to swap with a seated player', async () => {
    const app = await (harness = await createSocketHarness(3));
    const host = app.clients[0][0];
    const code = app.roomCodes[0];
    for (const client of [...app.clients[1], ...app.clients[2]]) {
      expect(await client.emitWithAck('room:leave')).toEqual({ success: true });
      expect(await client.emitWithAck('room:join', { roomCode: code })).toMatchObject({ success: true });
    }
    expect(rooms.getSpectatorIds(code)).toHaveLength(8);
    expect(await host.emitWithAck('room:movePlayer', { accountId: app.accountIds[0][1], target: { type: 'spectator' } }))
      .toMatchObject({ success: false });
    expect(await host.emitWithAck('room:movePlayer', { accountId: app.accountIds[1][0], target: { type: 'seat', seat: 'E' } }))
      .toEqual({ success: true });
    expect(rooms.getSpectatorIds(code)).toHaveLength(8);
    expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
  });

  it('restores seats and readiness without broadcasting when persistence fails, then allows retry', async () => {
    const app = await (harness = await createSocketHarness(1));
    const host = app.clients[0][0];
    expect(await host.emitWithAck('room:ready')).toEqual({ success: true });
    const before = await app.repository.loadRuntime();
    app.resetMetrics();
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Seat move write failed'));
    const payload = { accountId: app.accountIds[0][1], target: { type: 'seat' as const, seat: 'N' as const } };
    expect(await host.emitWithAck('room:movePlayer', payload)).toMatchObject({ success: false });
    expect(app.metrics.snapshots).toBe(0);
    expect(await app.repository.loadRuntime()).toEqual(before);
    expect(rooms.getRoomInfo(app.roomCodes[0])?.seats.N.isReady).toBe(true);
    expect(rooms.getPlayerSeat(app.roomCodes[0], app.accountIds[0][1])).toBe('E');
    expect(await host.emitWithAck('room:movePlayer', payload)).toEqual({ success: true });
    expect(rooms.getPlayerSeat(app.roomCodes[0], app.accountIds[0][1])).toBe('N');
  });
});
