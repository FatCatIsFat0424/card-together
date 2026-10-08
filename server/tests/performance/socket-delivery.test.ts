import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerSnapshot } from '@shared/types/socket-events';
import { SESSION_COOKIE_NAME, tokenHash } from '../../src/auth/auth-service';
import { createSocketHarness, SEATS, TEST_ORIGIN } from './socket-harness';
import type { SocketHarness, TestClient } from './socket-harness';

describe('socket delivery scope and read-only resume', () => {
  let harness: SocketHarness;

  beforeEach(async (): Promise<void> => {
    harness = await createSocketHarness(3);
  });

  afterEach(async (): Promise<void> => {
    vi.restoreAllMocks();
    await harness?.close();
  });

  async function resume(client: TestClient): Promise<PlayerSnapshot> {
    const state = await client.timeout(5_000).emitWithAck('player:resume');
    expect(state.success).toBe(true);
    return state;
  }

  async function disconnect(client: TestClient): Promise<void> {
    const serverSocket = client.id ? harness.application.io.sockets.sockets.get(client.id) : undefined;
    if (!serverSocket) throw new Error('Expected connected server socket');
    await new Promise<void>((resolve): void => {
      serverSocket.once('disconnect', (): void => resolve());
      client.disconnect();
    });
  }

  function expectRoomRecipients(roomIndex: number): void {
    expect(new Set(harness.metrics.recipients.keys())).toEqual(new Set(harness.accountIds[roomIndex]));
    expect(harness.metrics.snapshots).toBe(4);
  }

  async function expectDeliveredStateMatchesResume(roomIndex: number): Promise<void> {
    const delivered = new Map(harness.metrics.latestSnapshots);
    for (let index = 0; index < 4; index += 1) {
      const actual = await resume(harness.clients[roomIndex][index]);
      const expected = structuredClone(delivered.get(harness.accountIds[roomIndex][index]));
      if (expected?.gameState?.presentation && actual.gameState?.presentation) {
        expect(actual.gameState.presentation.serverNow)
          .toBeGreaterThanOrEqual(expected.gameState.presentation.serverNow!);
        expected.gameState.presentation = { ...expected.gameState.presentation,
          serverNow: actual.gameState.presentation.serverNow };
      }
      if (actual.gameState?.clock && expected.gameState?.clock) {
        expected.gameState.clock = { ...expected.gameState.clock, serverNow: actual.gameState.clock.serverNow };
      }
      expect(actual).toEqual(expected);
    }
  }

  it('should send a chat update to all room members and no unrelated accounts', async () => {
    expect(await harness.clients[0][0].timeout(5_000)
      .emitWithAck('chat:send', { message: 'Only this table receives the update' }))
      .toEqual({ success: true });
    expectRoomRecipients(0);
    expect(harness.metrics.runtimeWrites).toBe(1);
    for (const accountId of harness.accountIds[0]) {
      expect(harness.metrics.latestSnapshots.get(accountId)?.chatHistory?.at(-1)?.content)
        .toBe('Only this table receives the update');
    }
    await expectDeliveredStateMatchesResume(0);
  });

  it('should send a played card only to the four affected players', async () => {
    const players = harness.clients[0];
    for (const player of players) expect(await player.timeout(5_000).emitWithAck('room:ready'))
      .toEqual({ success: true });
    let state = await resume(players[0]);
    for (let attempt = 0; state.gameState?.phase === 'redeal_pending' && attempt < 30; attempt += 1) {
      const seat = state.gameState.redealPendingSeat;
      if (!seat) throw new Error('Expected redeal recipient');
      expect(await players[SEATS.indexOf(seat)].timeout(5_000)
        .emitWithAck('game:redealResponse', { accept: true })).toEqual({ success: true });
      state = await resume(players[0]);
    }
    expect(state.gameState?.phase).toBe('bidding');
    for (let bidIndex = 0; bidIndex < 4; bidIndex += 1) {
      const seat = state.gameState?.bidding?.currentBidderSeat;
      if (!seat) throw new Error('Expected bidder');
      const bid = bidIndex === 0 ? { type: 'bid' as const, level: 1 as const, suit: 'clubs' as const }
        : { type: 'pass' as const };
      expect(await players[SEATS.indexOf(seat)].timeout(5_000).emitWithAck('game:bid', { bid }))
        .toEqual({ success: true });
      state = await resume(players[0]);
    }
    const seat = state.gameState?.playing?.currentTurnSeat;
    if (!seat) throw new Error('Expected player turn');
    const actor = players[SEATS.indexOf(seat)];
    const card = (await resume(actor)).gameState?.validCards[0];
    if (!card) throw new Error('Expected valid card');
    harness.resetMetrics();
    expect(await actor.timeout(5_000).emitWithAck('game:playCard', { card })).toEqual({ success: true });
    expectRoomRecipients(0);
    for (const accountId of harness.accountIds[0]) {
      const snapshot = harness.metrics.latestSnapshots.get(accountId);
      expect(snapshot?.gameState?.playing?.currentTrick[seat]).toEqual(card);
      expect(snapshot?.gameState).not.toHaveProperty('hands');
    }
    await expectDeliveredStateMatchesResume(0);
  });

  it('should notify the departed player and their former room after leaving', async () => {
    const actorId = harness.accountIds[0][0];
    expect(await harness.clients[0][0].timeout(5_000).emitWithAck('room:leave'))
      .toEqual({ success: true });
    expectRoomRecipients(0);
    expect(harness.metrics.latestSnapshots.get(actorId)?.room).toBeUndefined();
    for (const accountId of harness.accountIds[0].slice(1)) {
      const state = harness.metrics.latestSnapshots.get(accountId);
      expect(state?.room?.code).toBe(harness.roomCodes[0]);
      expect(state?.room?.seats.N.player).toBeNull();
    }
    await expectDeliveredStateMatchesResume(0);
  });

  it('should notify the newly joined room without updating the former room', async () => {
    const actor = harness.clients[0][0];
    const actorId = harness.accountIds[0][0];
    expect(await actor.timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    expect(await harness.clients[1][3].timeout(5_000).emitWithAck('room:leave'))
      .toEqual({ success: true });
    harness.resetMetrics();
    expect(await actor.timeout(5_000).emitWithAck('room:join', { roomCode: harness.roomCodes[1] }))
      .toMatchObject({ success: true });
    expect(new Set(harness.metrics.recipients.keys()))
      .toEqual(new Set([actorId, ...harness.accountIds[1].slice(0, 3)]));
    expect(harness.metrics.snapshots).toBe(4);
    expect(harness.metrics.latestSnapshots.get(actorId)?.room?.code).toBe(harness.roomCodes[1]);
  });

  it('should notify the actor and current room after profile updates', async () => {
    const response = await fetch(`${harness.baseUrl}/api/auth/profile`, {
      method: 'PATCH',
      headers: {
        Origin: TEST_ORIGIN, Cookie: harness.cookies[0][0], 'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nickname: 'Updated nickname', avatar: 'fox' }),
    });
    expect(response.status).toBe(200);
    expectRoomRecipients(0);
    for (const accountId of harness.accountIds[0]) {
      const state = harness.metrics.latestSnapshots.get(accountId);
      expect(state?.room?.seats.N.player).toMatchObject({ nickname: 'Updated nickname', avatar: 'fox' });
    }
    await expectDeliveredStateMatchesResume(0);
  });

  it('should acknowledge repeated resume without durable writes or unrelated broadcasts', async () => {
    const client = harness.clients[0][0];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await resume(client);
      expect(state.player?.id).toBe(harness.accountIds[0][0]);
      expect(state.room?.code).toBe(harness.roomCodes[0]);
    }
    expect(harness.metrics.runtimeWrites).toBe(0);
    expect(new Set(harness.metrics.recipients.keys())).toEqual(new Set(harness.accountIds[0]));
    expect(harness.metrics.snapshots).toBe(12);
  });

  it('should restore another tab and deliver subsequent room updates to both tabs', async () => {
    const secondTab = await harness.connect(harness.cookies[0][0]);
    const secondState = await resume(secondTab);
    expect(secondState.player?.id).toBe(harness.accountIds[0][0]);
    expect(secondState.room?.code).toBe(harness.roomCodes[0]);
    harness.resetMetrics();
    const originalState = await resume(harness.clients[0][0]);
    expect(originalState).toEqual(secondState);
    expect(harness.metrics.runtimeWrites).toBe(0);
    expect(new Set(harness.metrics.recipients.keys())).toEqual(new Set(harness.accountIds[0]));
    expect(harness.metrics.recipients.get(harness.accountIds[0][0])).toBe(2);
    expect(harness.metrics.snapshots).toBe(5);
    harness.resetMetrics();
    expect(await secondTab.timeout(5_000).emitWithAck('chat:send', { message: 'Both tabs remain attached' }))
      .toEqual({ success: true });
    expect(new Set(harness.metrics.recipients.keys())).toEqual(new Set(harness.accountIds[0]));
    expect(harness.metrics.recipients.get(harness.accountIds[0][0])).toBe(2);
    expect(harness.metrics.snapshots).toBe(5);
  });

  it('should persist only the final tab disconnect and the following reconnection', async () => {
    const accountId = harness.accountIds[0][0];
    const secondTab = await harness.connect(harness.cookies[0][0]);
    await resume(secondTab);
    harness.resetMetrics();

    await disconnect(harness.clients[0][0]);
    // An ACK waits behind the server's disconnect mutation in the same runtime queue.
    await resume(secondTab);
    expect(harness.metrics.runtimeWrites).toBe(0);
    expect((await harness.repository.loadRuntime())?.players
      .find((player) => player.info.id === accountId)?.disconnectedAt).toBeNull();

    harness.resetMetrics();
    await disconnect(secondTab);
    await resume(harness.clients[0][1]);
    expect(harness.metrics.runtimeWrites).toBe(1);
    expect((await harness.repository.loadRuntime())?.players
      .find((player) => player.info.id === accountId)?.disconnectedAt).toEqual(expect.any(Number));
    expect(new Set(harness.metrics.recipients.keys()))
      .toEqual(new Set(harness.accountIds[0].slice(1)));

    harness.resetMetrics();
    const reconnected = await harness.connect(harness.cookies[0][0]);
    expect((await resume(reconnected)).room?.code).toBe(harness.roomCodes[0]);
    expect(harness.metrics.runtimeWrites).toBe(1);
    expect((await harness.repository.loadRuntime())?.players
      .find((player) => player.info.id === accountId)?.disconnectedAt).toBeNull();
    harness.resetMetrics();
    await resume(reconnected);
    expect(harness.metrics.runtimeWrites).toBe(0);
  });

  it('should persist a first account attachment and skip its later unchanged resumes', async () => {
    const template = await harness.repository.getAccountById(harness.accountIds[0][0]);
    if (!template) throw new Error('Expected fixture account');
    const accountId = 'newly-connected-account';
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    await harness.repository.createAccount({
      ...template, id: accountId, username: 'fresh_account', usernameNormalized: 'fresh_account',
    });
    await harness.repository.createSession({
      accountId, tokenHash: tokenHash(token), createdAt: now, expiresAt: now + 60_000,
    }, template.passwordHash);
    const client = await harness.connect(`${SESSION_COOKIE_NAME}=${token}`);
    harness.resetMetrics();
    const first = await resume(client);
    expect(first.player?.id).toBe(accountId);
    expect(first.room).toBeUndefined();
    expect(harness.metrics.runtimeWrites).toBe(1);
    expect(harness.metrics.snapshots).toBe(1);
    expect(new Set(harness.metrics.recipients.keys())).toEqual(new Set([accountId]));
    expect((await harness.repository.loadRuntime())?.players
      .some((player) => player.info.id === accountId)).toBe(true);
    harness.resetMetrics();
    expect(await resume(client)).toEqual(first);
    expect(harness.metrics.runtimeWrites).toBe(0);
    expect(harness.metrics.snapshots).toBe(1);
  });

  it('should avoid broadcasts when authorization, validation or durable commit fails', async () => {
    const client = harness.clients[0][0];
    expect(await client.timeout(5_000).emitWithAck('chat:send', { message: '' }))
      .toMatchObject({ success: false });
    expect(harness.metrics.snapshots).toBe(0);
    const logged = vi.spyOn(console, 'error').mockImplementation((): void => undefined);
    vi.spyOn(harness.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Storage failure'));
    expect(await client.timeout(5_000).emitWithAck('chat:send', { message: 'Must not broadcast' }))
      .toMatchObject({ success: false });
    expect(logged).toHaveBeenCalled();
    expect(harness.metrics.snapshots).toBe(0);
    await harness.repository.deleteAccountSessions(harness.accountIds[0][0]);
    expect(await client.timeout(5_000).emitWithAck('player:resume')).toMatchObject({ success: false });
    expect(await client.timeout(5_000).emitWithAck('chat:send', { message: 'Unauthorized' }))
      .toMatchObject({ success: false });
    expect(harness.metrics.snapshots).toBe(0);
  });
});
