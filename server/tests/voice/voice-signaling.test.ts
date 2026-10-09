import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoiceIncomingSignal, VoiceJoinResult, VoiceRoomState, VoiceSettings, VoiceSignal } from '@shared/types';
import { createSocketHarness, TEST_ORIGIN } from '../performance/socket-harness';
import type { SocketHarness, TestClient } from '../performance/socket-harness';

const settings: VoiceSettings = { muted: false, deafened: false };
const description = { type: 'offer' as const, sdp: 'v=0\r\na=sendrecv\r\n' };
let harness: SocketHarness | undefined;

async function fixture(rooms = 1): Promise<SocketHarness> {
  harness = await createSocketHarness(rooms);
  return harness;
}

async function join(client: TestClient, value = settings): Promise<VoiceJoinResult & { peerId: string }> {
  const result = await client.timeout(5_000).emitWithAck('voice:join', value);
  expect(result.success).toBe(true);
  expect(result.peerId).toEqual(expect.any(String));
  return result as VoiceJoinResult & { peerId: string };
}

function nextState(client: TestClient, predicate: (state: VoiceRoomState) => boolean): Promise<VoiceRoomState> {
  return new Promise((resolve, reject): void => {
    const timer = setTimeout(() => { client.off('voice:state', listener); reject(new Error('Missing voice state')); }, 5_000);
    function listener(state: VoiceRoomState): void {
      if (!predicate(state)) return;
      clearTimeout(timer);
      client.off('voice:state', listener);
      resolve(state);
    }
    client.on('voice:state', listener);
  });
}

function nextSignal(client: TestClient): Promise<VoiceIncomingSignal> {
  return new Promise((resolve): void => { client.once('voice:signal', resolve); });
}

afterEach(async (): Promise<void> => {
  vi.restoreAllMocks();
  await harness?.close();
  harness = undefined;
});

describe('table voice signaling', (): void => {
  it('keeps four participants ephemeral with independent microphone/deafen settings', async (): Promise<void> => {
    const app = await fixture();
    const before = await app.repository.loadRuntime();
    for (const client of app.clients[0]) await join(client);
    const duplicate = await join(app.clients[0][0]);
    expect(duplicate.state?.participants).toHaveLength(4);
    const changed = nextState(app.clients[0][1], (state) => state.participants[0].deafened);
    expect(await app.clients[0][0].timeout(5_000).emitWithAck('voice:settings', {
      muted: false, deafened: true,
    })).toEqual({ success: true });
    const state = await changed;
    expect(state.roomCode).toBe(app.roomCodes[0]);
    expect(state.participants[0]).toEqual({
      peerId: duplicate.peerId, accountId: app.accountIds[0][0], muted: false, deafened: true,
    });
    expect(Object.keys(state.participants[0]).sort()).toEqual(['accountId', 'deafened', 'muted', 'peerId']);
    const muted = await join(app.clients[0][0], { muted: true, deafened: false });
    expect(muted.peerId).toBe(duplicate.peerId);
    expect(muted.state?.participants[0]).toMatchObject({ muted: true, deafened: false });
    expect(app.metrics.runtimeWrites).toBe(0);
    expect(await app.repository.loadRuntime()).toEqual(before);
    expect(app.metrics.snapshots).toBe(0);
  });

  it('relays bounded SDP and ICE to only the joined peer and replaces forged sender fields', async (): Promise<void> => {
    const app = await fixture();
    const [a, b, outsider] = app.clients[0];
    const first = await join(a);
    const second = await join(b);
    const broadcasts = vi.spyOn(app.application.io.sockets.adapter, 'broadcast');
    const received = nextSignal(b);
    const forged = { targetPeerId: second.peerId, description, fromPeerId: 'forged', accountId: 'forged' };
    expect(await a.timeout(5_000).emitWithAck('voice:signal', forged)).toEqual({ success: true });
    expect(await received).toEqual({ fromPeerId: first.peerId, description });
    const candidate = { candidate: 'candidate:1 1 UDP 1 127.0.0.1 12345 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    const ice = nextSignal(a);
    expect(await b.timeout(5_000).emitWithAck('voice:signal', { targetPeerId: first.peerId, candidate }))
      .toEqual({ success: true });
    expect(await ice).toEqual({ fromPeerId: second.peerId, candidate });
    expect(await outsider.timeout(5_000).emitWithAck('voice:signal', { targetPeerId: second.peerId, description }))
      .toMatchObject({ success: false });
    const signals = broadcasts.mock.calls.filter(([packet]) => packet.data?.[0] === 'voice:signal');
    expect(signals).toHaveLength(2);
    expect([...signals[0][1].rooms]).toEqual([b.id]);
    expect([...signals[1][1].rooms]).toEqual([a.id]);
    expect(app.metrics.runtimeWrites).toBe(0);
  });

  it('rejects cross-room, self, stale and non-member signaling without leaking state', async (): Promise<void> => {
    const app = await fixture(2);
    const a = app.clients[0][0];
    const b = app.clients[0][1];
    const c = app.clients[1][0];
    const first = await join(a);
    const second = await join(b);
    const otherRoom = await join(c);
    const broadcasts = vi.spyOn(app.application.io.sockets.adapter, 'broadcast');
    for (const targetPeerId of [first.peerId, otherRoom.peerId, '00000000-0000-4000-a000-000000000000']) {
      expect(await a.timeout(5_000).emitWithAck('voice:signal', { targetPeerId, description }))
        .toMatchObject({ success: false });
    }
    expect(broadcasts.mock.calls).toHaveLength(0);
    expect(await b.timeout(5_000).emitWithAck('voice:leave')).toEqual({ success: true });
    const rejoined = await join(b);
    expect(rejoined.peerId).not.toBe(second.peerId);
    expect(await a.timeout(5_000).emitWithAck('voice:signal', { targetPeerId: second.peerId, description }))
      .toMatchObject({ success: false });
    expect(await c.timeout(5_000).emitWithAck('room:leave')).toMatchObject({ success: true });
    expect(await c.timeout(5_000).emitWithAck('voice:join', settings)).toMatchObject({ success: false });
  });

  it('allows one voice tab per account and cleans its voice when another tab leaves the table', async (): Promise<void> => {
    const app = await fixture();
    const [a, b] = app.clients[0];
    const first = await join(a);
    await join(b);
    const secondTab = await app.connect(app.cookies[0][0]);
    await secondTab.timeout(5_000).emitWithAck('player:resume');
    expect(await secondTab.timeout(5_000).emitWithAck('voice:join', settings))
      .toMatchObject({ success: false, error: expect.stringContaining('another tab') });
    expect(await secondTab.timeout(5_000).emitWithAck('voice:leave')).toEqual({ success: true });
    expect((await join(a)).peerId).toBe(first.peerId);
    const left = new Promise<{ reason: string }>((resolve): void => { a.once('voice:left', resolve); });
    const remaining = nextState(b, (state) => state.participants.length === 1);
    expect(await secondTab.timeout(5_000).emitWithAck('room:leave')).toMatchObject({ success: true });
    expect((await left).reason).toContain('table');
    expect((await remaining).participants[0].accountId).toBe(app.accountIds[0][1]);
    expect(await a.timeout(5_000).emitWithAck('voice:settings', settings)).toMatchObject({ success: false });
  });

  it('removes disconnects immediately, allowing the account to join on another tab', async (): Promise<void> => {
    const app = await fixture();
    const [a, b] = app.clients[0];
    const original = await join(a);
    await join(b);
    const tab = await app.connect(app.cookies[0][0]);
    await tab.timeout(5_000).emitWithAck('player:resume');
    const remaining = nextState(b, (state) => state.participants.length === 1);
    a.disconnect();
    await remaining;
    const replacement = await join(tab);
    expect(replacement.peerId).not.toBe(original.peerId);
    expect(replacement.state?.participants).toHaveLength(2);
  });

  it('should restore signaling after a refreshed page resumes its table with a new peer', async (): Promise<void> => {
    const app = await fixture();
    const [originalPage, otherPlayer] = app.clients[0];
    const original = await join(originalPage);
    const other = await join(otherPlayer);
    const departed = nextState(otherPlayer, (state) => state.participants.length === 1);
    originalPage.disconnect();
    await departed;

    const refreshedPage = await app.connect(app.cookies[0][0]);
    expect(await refreshedPage.timeout(5_000).emitWithAck('player:resume'))
      .toMatchObject({ success: true, room: { code: app.roomCodes[0] } });
    const replacement = await join(refreshedPage);
    expect(replacement.peerId).not.toBe(original.peerId);
    expect(replacement.state?.participants).toHaveLength(2);
    expect(await otherPlayer.timeout(5_000).emitWithAck('voice:signal', {
      targetPeerId: original.peerId, description,
    })).toMatchObject({ success: false });

    const offer = nextSignal(refreshedPage);
    expect(await otherPlayer.timeout(5_000).emitWithAck('voice:signal', {
      targetPeerId: replacement.peerId, description,
    })).toEqual({ success: true });
    expect(await offer).toEqual({ fromPeerId: other.peerId, description });
    const answerDescription = { type: 'answer' as const, sdp: description.sdp };
    const answer = nextSignal(otherPlayer);
    expect(await refreshedPage.timeout(5_000).emitWithAck('voice:signal', {
      targetPeerId: other.peerId, description: answerDescription,
    })).toEqual({ success: true });
    expect(await answer).toEqual({ fromPeerId: replacement.peerId, description: answerDescription });
  });

  it('removes voice on HTTP logout and rejects expired sessions at both signal endpoints', async (): Promise<void> => {
    const app = await fixture();
    const [a, b, c] = app.clients[0];
    const first = await join(a);
    const second = await join(b);
    await join(c);
    const sessionReads = vi.spyOn(app.repository, 'getSession');
    const relayed = nextSignal(b);
    expect(await a.timeout(5_000).emitWithAck('voice:signal', { targetPeerId: second.peerId, description }))
      .toEqual({ success: true });
    await relayed;
    expect(sessionReads).not.toHaveBeenCalled();
    const expiredSocket = app.application.io.sockets.sockets.get(b.id!);
    if (!expiredSocket) throw new Error('Missing fixture socket');
    expiredSocket.data.expiresAt = Date.now() - 1;
    expect(await a.timeout(5_000).emitWithAck('voice:signal', { targetPeerId: second.peerId, description }))
      .toMatchObject({ success: false });
    expect(await b.timeout(5_000).emitWithAck('voice:signal', { targetPeerId: first.peerId, description }))
      .toMatchObject({ success: false, error: expect.stringContaining('session') });
    const remaining = nextState(c, (state) => state.participants.length === 1);
    const disconnected = new Promise<void>((resolve): void => { a.once('disconnect', (): void => resolve()); });
    const response = await fetch(`${app.baseUrl}/api/auth/logout`, {
      method: 'POST', headers: { Origin: TEST_ORIGIN, Cookie: app.cookies[0][0], 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(200);
    await disconnected;
    expect((await remaining).participants[0].accountId).toBe(app.accountIds[0][2]);
  });

  it('relays signaling during a pending durable write and retains voice after rollback', async (): Promise<void> => {
    const app = await fixture();
    const [a, b] = app.clients[0];
    const first = await join(a);
    const second = await join(b);
    const left = vi.fn();
    a.on('voice:left', left);
    let releaseWrite: () => void = (): void => undefined;
    let writeEntered: () => void = (): void => undefined;
    const blocked = new Promise<void>((resolve): void => { releaseWrite = resolve; });
    const entered = new Promise<void>((resolve): void => { writeEntered = resolve; });
    vi.spyOn(console, 'error').mockImplementation((): void => undefined);
    vi.spyOn(app.repository, 'saveRuntime').mockImplementationOnce(async (): Promise<void> => {
      writeEntered();
      await blocked;
      throw new Error('Disk full');
    });
    const failedLeave = a.timeout(5_000).emitWithAck('room:leave');
    await entered;
    const sessionReads = vi.spyOn(app.repository, 'getSession');
    const serverSocket = app.application.io.sockets.sockets.get(a.id!);
    if (!serverSocket) throw new Error('Missing fixture socket');
    let signalEntered: () => void = (): void => undefined;
    const signalArrived = new Promise<void>((resolve): void => { signalEntered = resolve; });
    serverSocket.use((packet, next): void => { if (packet[0] === 'voice:signal') signalEntered(); next(); });
    const received = nextSignal(b);
    const pendingSignal = a.timeout(5_000).emitWithAck('voice:signal', { targetPeerId: second.peerId, description });
    await signalArrived;
    expect(await pendingSignal).toEqual({ success: true });
    expect(await received).toEqual({ fromPeerId: first.peerId, description });
    expect(sessionReads).not.toHaveBeenCalled();
    releaseWrite();
    expect(await failedLeave).toMatchObject({ success: false });
    expect(left).not.toHaveBeenCalled();
    expect((await join(a)).peerId).toBe(first.peerId);
  });

  it('rejects malformed settings and oversized or ambiguous signaling, then remains usable', async (): Promise<void> => {
    const app = await fixture();
    const [a, b] = app.clients[0];
    await join(a);
    const second = await join(b);
    const invalid: unknown[] = [null, {}, { targetPeerId: second.peerId },
      { targetPeerId: second.peerId, description: { type: 'rollback', sdp: 'v=0' } },
      { targetPeerId: second.peerId, description: { type: ['offer'], sdp: 'v=0' } },
      { targetPeerId: second.peerId, description: { type: 'offer', sdp: 'a'.repeat(12_001) } },
      { targetPeerId: second.peerId, description, candidate: { candidate: '', sdpMid: null, sdpMLineIndex: null } },
      { targetPeerId: second.peerId, candidate: { candidate: 'a'.repeat(2_049), sdpMid: null, sdpMLineIndex: null } },
      { targetPeerId: second.peerId, candidate: { candidate: '', sdpMid: null, sdpMLineIndex: -1 } }];
    for (const value of invalid) {
      expect(await a.timeout(5_000).emitWithAck('voice:signal', value as VoiceSignal)).toMatchObject({ success: false });
    }
    expect(await a.timeout(5_000).emitWithAck('voice:settings', { muted: 'yes' } as unknown as VoiceSettings))
      .toMatchObject({ success: false });
    a.emit('voice:join', null as unknown as VoiceSettings, undefined as unknown as (result: VoiceJoinResult) => void);
    expect((await join(a)).state?.participants).toHaveLength(2);
    expect(app.metrics.runtimeWrites).toBe(0);
  });

  it('bounds voice traffic independently without exhausting game actions', async (): Promise<void> => {
    const app = await fixture();
    const a = app.clients[0][0];
    for (let index = 0; index < 1200; index += 1) {
      expect(await a.timeout(5_000).emitWithAck('voice:settings', settings))
        .toMatchObject({ success: false, error: 'Join your table voice chat first.' });
    }
    expect(await a.timeout(5_000).emitWithAck('voice:join', settings))
      .toMatchObject({ success: false, error: expect.stringContaining('Too many') });
    expect(await a.timeout(5_000).emitWithAck('player:resume')).toMatchObject({ success: true });
    expect(app.metrics.runtimeWrites).toBe(0);
  }, 15_000);
});
