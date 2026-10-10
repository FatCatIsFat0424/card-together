import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FriendsData } from '@shared/types';
import { MAX_SPECTATORS } from '@shared/constants';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import { createSocketHarness, TEST_ORIGIN } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';

describe('joining a room hosted by a friend', () => {
  let app: SocketHarness;
  let friendshipId: string;

  beforeEach(async () => {
    app = await createSocketHarness(2);
    friendshipId = randomUUID();
    await app.repository.createFriendship({
      id: friendshipId, requesterId: app.accountIds[0][0], recipientId: app.accountIds[1][0],
      status: 'accepted', createdAt: 1, updatedAt: 1,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  async function listFriends(index: number): Promise<FriendsData> {
    const result = await fetch(`${app.baseUrl}/api/friends`, {
      headers: { Cookie: app.cookies[index][0], Origin: TEST_ORIGIN },
    });
    expect(result.status).toBe(200);
    return await result.json() as FriendsData;
  }

  function join() {
    return app.clients[1][0].timeout(5_000).emitWithAck('room:joinFriend', {
      accountId: app.accountIds[0][0], roomCode: app.roomCodes[0],
    });
  }

  it('lists the hosted room and switches rooms without an invitation, joining as a spectator', async () => {
    expect((await listFriends(1)).friends).toMatchObject([{
      id: app.accountIds[0][0], online: true, inRoom: true, hostedRoomCode: app.roomCodes[0],
    }]);
    const result = await join();
    expect(result).toMatchObject({ success: true, room: { code: app.roomCodes[0] } });
    expect(rooms.getPlayerSeat(app.roomCodes[0], app.accountIds[1][0])).toBeNull();
    expect(rooms.getRoomMemberIds(app.roomCodes[1])).not.toContain(app.accountIds[1][0]);
    expect(rooms.getRoomInfo(app.roomCodes[1])?.hostId).toBe(app.accountIds[1][1]);
    const stored = await app.repository.loadRuntime();
    expect(stored?.players.find((entry) => entry.info.id === app.accountIds[1][0])?.currentRoomCode)
      .toBe(app.roomCodes[0]);
    expect(await join()).toMatchObject({ success: true });
    expect(rooms.getRoomMemberIds(app.roomCodes[0]).filter((id) => id === app.accountIds[1][0])).toHaveLength(1);
  });

  it('allows spectating a playing room without revealing private hands to seated players', async () => {
    for (const client of app.clients[0]) expect(await client.timeout(5_000).emitWithAck('room:ready'))
      .toEqual({ success: true });
    expect(await join()).toMatchObject({ success: true, room: { status: 'playing' } });
    const spectator = await app.clients[1][0].timeout(5_000).emitWithAck('player:resume');
    expect(spectator.gameState).toMatchObject({ observer: 'spectator' });
    expect(spectator.gameState).toHaveProperty('observedHands');
    const seated = await app.clients[0][0].timeout(5_000).emitWithAck('player:resume');
    expect(seated.gameState).not.toHaveProperty('observedHands');
  });

  it('rejects non-friends, pending requests and removed friendships without leaving the original room', async () => {
    await app.repository.deleteFriendship(friendshipId, app.accountIds[1][0]);
    expect(await join()).toMatchObject({ success: false, error: 'You can only join rooms hosted by friends.' });
    await app.repository.createFriendship({
      id: randomUUID(), requesterId: app.accountIds[0][0], recipientId: app.accountIds[1][0],
      status: 'pending', createdAt: 1, updatedAt: 1,
    });
    expect(await join()).toMatchObject({ success: false });
    expect((await listFriends(1)).friends).toEqual([]);
    expect(players.getPlayerState(app.accountIds[1][0])?.currentRoomCode).toBe(app.roomCodes[1]);
  });

  it('hides the room and rejects stale joins when the friend is no longer its host', async () => {
    expect(await app.clients[0][0].timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    expect(await app.clients[0][0].timeout(5_000).emitWithAck('room:join', { roomCode: app.roomCodes[0] }))
      .toMatchObject({ success: true });
    expect((await listFriends(1)).friends[0]).toMatchObject({ inRoom: true, hostedRoomCode: null });
    expect(await join()).toMatchObject({ success: false, error: expect.stringContaining('no longer hosting') });
    expect(players.getPlayerState(app.accountIds[1][0])?.currentRoomCode).toBe(app.roomCodes[1]);
  });

  it('rejects a mismatched room or offline host even if the list was previously joinable', async () => {
    expect(await app.clients[1][0].timeout(5_000).emitWithAck('room:joinFriend', {
      accountId: app.accountIds[0][0], roomCode: app.roomCodes[1],
    })).toMatchObject({ success: false });
    app.clients[0][0].disconnect();
    await expect.poll(() => players.getPlayerState(app.accountIds[0][0])?.connectionStatus).toBe('disconnected');
    expect((await listFriends(1)).friends[0]).toMatchObject({ online: false, hostedRoomCode: null });
    expect(await join()).toMatchObject({ success: false });
    expect(players.getPlayerState(app.accountIds[1][0])?.currentRoomCode).toBe(app.roomCodes[1]);
  });

  it('keeps original membership when admission fails or the durable write fails', async () => {
    const before = await app.repository.loadRuntime();
    const persisted = vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await join()).toMatchObject({ success: false, error: expect.stringContaining('save') });
    expect(logged).toHaveBeenCalled();
    expect(await app.repository.loadRuntime()).toEqual(before);
    expect(players.getPlayerState(app.accountIds[1][0])?.currentRoomCode).toBe(app.roomCodes[1]);
    expect(rooms.getRoomMemberIds(app.roomCodes[0])).not.toContain(app.accountIds[1][0]);
    expect(rooms.getRoomInfo(app.roomCodes[1])?.hostId).toBe(app.accountIds[1][0]);
    persisted.mockRestore();
    // Admission fails before any write, so temporary in-process spectators need no accounts.
    for (let index = 0; index < MAX_SPECTATORS; index++) rooms.joinRoom(app.roomCodes[0], `watcher-${index}`);
    expect(await join()).toMatchObject({ success: false, error: 'Room is full' });
    expect(players.getPlayerState(app.accountIds[1][0])?.currentRoomCode).toBe(app.roomCodes[1]);
    for (let index = 0; index < MAX_SPECTATORS; index++) rooms.leaveRoom(app.roomCodes[0], `watcher-${index}`);
    expect(await join()).toMatchObject({ success: true });
  });

  it('validates payloads, requires callbacks and rechecks the session', async () => {
    for (const payload of [null, {}, { accountId: 42 }, { accountId: '', roomCode: app.roomCodes[0] }]) {
      expect(await app.clients[1][0].timeout(5_000).emitWithAck('room:joinFriend',
        payload as unknown as { accountId: string; roomCode: string })).toMatchObject({ success: false });
    }
    app.clients[1][0].emit('room:joinFriend', { accountId: app.accountIds[0][0], roomCode: app.roomCodes[0] },
      null as unknown as (response: { success: boolean }) => void);
    expect((await app.clients[1][0].timeout(5_000).emitWithAck('player:resume')).room?.code).toBe(app.roomCodes[1]);
    await app.repository.deleteAccountSessions(app.accountIds[1][0]);
    expect(await join()).toMatchObject({ success: false, error: expect.stringContaining('session') });
  });
});
