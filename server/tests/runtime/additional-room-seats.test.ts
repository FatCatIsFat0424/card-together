import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_ROOM_SEATS } from '@shared/constants';
import * as rooms from '../../src/managers/room-manager';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import { createSocketHarness } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';

describe('additional waiting-room seats', () => {
  let harness: SocketHarness | undefined;
  afterEach(async () => { await harness?.close(); harness = undefined; vi.restoreAllMocks(); });

  it('should persist and synchronize additional seats and allow preparation before all seats fill', async () => {
    const app = await (harness = await createSocketHarness(2));
    const host = app.clients[0][0];
    const guest = app.clients[0][1];
    const visitor = app.clients[1][0];
    const code = app.roomCodes[0];
    expect(await host.emitWithAck('room:setGameType', { gameType: 'holdem' })).toEqual({ success: true });
    expect(await guest.emitWithAck('room:addSeat')).toMatchObject({ success: false });
    expect(await host.emitWithAck('room:addSeat')).toEqual({ success: true });
    expect((await guest.emitWithAck('player:resume')).room?.additionalSeats).toHaveLength(1);
    expect(await host.emitWithAck('room:ready')).toEqual({ success: true });
    expect(rooms.isAllReady(code)).toBe(false);
    expect(await visitor.emitWithAck('room:leave')).toEqual({ success: true });
    expect(await visitor.emitWithAck('room:join', { roomCode: code })).toMatchObject({ success: true });
    expect(await visitor.emitWithAck('room:changeAdditionalSeat', { index: -1 })).toMatchObject({ success: false });
    expect(await visitor.emitWithAck('room:changeAdditionalSeat', { index: 0 })).toEqual({ success: true });
    expect(rooms.getSpectatorIds(code)).not.toContain(app.accountIds[1][0]);
    expect(rooms.getRoomInfo(code)?.additionalSeats?.[0].player?.id).toBe(app.accountIds[1][0]);
    expect(await guest.emitWithAck('room:changeAdditionalSeat', { index: 0 })).toMatchObject({ success: false });
    expect(await host.emitWithAck('room:removeSeat')).toMatchObject({ success: false });
    expect(await host.emitWithAck('room:setGameType', { gameType: 'bridge' })).toMatchObject({ success: false });
    const persisted = await app.repository.loadRuntime();
    expect(isRuntimeSnapshot(persisted)).toBe(true);
    rooms.restoreRooms(structuredClone(persisted!.rooms));
    expect(rooms.getRoomInfo(code)?.additionalSeats?.[0].player?.id).toBe(app.accountIds[1][0]);
    const duplicate = structuredClone(persisted!);
    duplicate.rooms[0].info = { ...duplicate.rooms[0].info, additionalSeats: [duplicate.rooms[0].info.seats.N] };
    expect(isRuntimeSnapshot(duplicate)).toBe(false);
    const unsupported = structuredClone(persisted!);
    unsupported.rooms[0].info = { ...unsupported.rooms[0].info, gameType: 'bridge' };
    expect(isRuntimeSnapshot(unsupported)).toBe(false);
    const playing = structuredClone(persisted!);
    playing.rooms[0].info = { ...playing.rooms[0].info, status: 'playing' };
    expect(isRuntimeSnapshot(playing)).toBe(false);
    expect(await visitor.emitWithAck('room:standUp')).toEqual({ success: true });
    expect(rooms.getSpectatorIds(code)).toContain(app.accountIds[1][0]);
    expect(await host.emitWithAck('room:removeSeat')).toEqual({ success: true });
    expect(await host.emitWithAck('room:setGameType', { gameType: 'bridge' })).toEqual({ success: true });
    expect(await host.emitWithAck('room:addSeat')).toMatchObject({ success: false });
  });

  it('should move an additional-seat player back to a standard seat without duplicate membership', async () => {
    const app = await (harness = await createSocketHarness(1));
    const host = app.clients[0][0];
    const code = app.roomCodes[0];
    expect(await host.emitWithAck('room:setGameType', { gameType: 'ninetynine' })).toEqual({ success: true });
    expect(await host.emitWithAck('room:addSeat')).toEqual({ success: true });
    expect(await host.emitWithAck('room:changeAdditionalSeat', { index: 0 })).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.seats.N.player).toBeNull();
    expect(await host.emitWithAck('room:changeSeat', { seat: 'N' })).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.additionalSeats?.[0].player).toBeNull();
    expect(rooms.getSpectatorIds(code)).not.toContain(app.accountIds[0][0]);
    expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
    expect(await host.emitWithAck('room:changeAdditionalSeat', { index: 0 })).toEqual({ success: true });
    expect(await host.emitWithAck('room:leave')).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.additionalSeats?.[0].player).toBeNull();
    expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
  });

  it.each(['ninetynine', 'blackjack', 'holdem'] as const)('%s should preserve legacy rooms, roll back failed writes, and cap seats at eight', async (gameType) => {
    const app = await (harness = await createSocketHarness(1));
    const host = app.clients[0][0];
    expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
    expect(await host.emitWithAck('room:setGameType', { gameType })).toEqual({ success: true });
    const before = await app.repository.loadRuntime();
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Seat write failed'));
    expect(await host.emitWithAck('room:addSeat')).toMatchObject({ success: false });
    expect(await app.repository.loadRuntime()).toEqual(before);
    expect((await host.emitWithAck('player:resume')).room?.additionalSeats ?? []).toHaveLength(0);
    expect(await host.emitWithAck('room:addSeat')).toEqual({ success: true });
    for (let index = 1; index < MAX_ROOM_SEATS - 4; index++) {
      expect(await host.emitWithAck('room:addSeat')).toEqual({ success: true });
    }
    expect(await host.emitWithAck('room:addSeat')).toMatchObject({ success: false });
    expect(rooms.getRoomInfo(app.roomCodes[0])?.additionalSeats).toHaveLength(4);
    const saved = await app.repository.loadRuntime();
    expect(isRuntimeSnapshot(saved)).toBe(true);
    const oversized = structuredClone(saved!);
    oversized.rooms[0].info = {
      ...oversized.rooms[0].info,
      additionalSeats: [...oversized.rooms[0].info.additionalSeats!, { player: null, isReady: false }],
    };
    expect(isRuntimeSnapshot(oversized)).toBe(false);
  });

  it('should wait for the host to start a prepared two-player room', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, east, south, west] = app.clients[0];
    const code = app.roomCodes[0];
    expect(await host.emitWithAck('room:setGameType', { gameType: 'holdem' })).toEqual({ success: true });
    expect(await east.emitWithAck('room:standUp')).toEqual({ success: true });
    expect(await west.emitWithAck('room:standUp')).toEqual({ success: true });
    expect(await host.emitWithAck('room:ready')).toEqual({ success: true });
    expect(await south.emitWithAck('room:ready')).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.status).toBe('waiting');
    expect(await south.emitWithAck('room:start')).toMatchObject({ success: false });
    expect(await host.emitWithAck('room:start')).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.status).toBe('playing');
  });
});
