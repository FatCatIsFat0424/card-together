import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_TIMEOUT_MS } from '@shared/constants';
import type { ChatMessage } from '@shared/types';
import type { PlayerSnapshot } from '@shared/types/socket-events';
import { getPlayerState } from '../../src/managers/player-manager';
import { getChatHistory } from '../../src/managers/chat-manager';
import { getRoomInfo, getRoomMemberIds } from '../../src/managers/room-manager';
import { createSocketHarness } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';
import { t } from '../../../client/src/i18n';

describe('room membership system chat', () => {
  let app: SocketHarness;

  beforeEach(async () => {
    app = await createSocketHarness(2);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  function history(roomIndex: number): ChatMessage[] {
    return structuredClone(getChatHistory(app.roomCodes[roomIndex]));
  }

  it('records creation and joins once, persisting and delivering the same messages', async () => {
    const messages = history(0);
    expect(messages).toHaveLength(4);
    expect(messages.map((message) => message.sender.id)).toEqual(app.accountIds[0]);
    for (const message of messages) {
      expect(message).toMatchObject({ system: true, content: 'chat.playerJoined' });
      expect(t('chat.playerJoined', 'zh-TW', { name: message.sender.nickname }))
        .toBe(`${message.sender.nickname} 加入了房間`);
      expect(t('chat.playerJoined', 'en', { name: message.sender.nickname }))
        .toBe(`${message.sender.nickname} joined the room`);
    }
    for (const id of app.accountIds[0]) expect(app.metrics.chatViews.get(id)).toEqual(messages);
    const stored = await app.repository.loadRuntime();
    expect(stored?.chat.find((room) => room.roomCode === app.roomCodes[0])?.messages).toEqual(messages);

    expect(await app.clients[0][1].timeout(5_000).emitWithAck('room:join', { roomCode: app.roomCodes[0] }))
      .toMatchObject({ success: true });
    expect(app.metrics.chatMessages).toBe(0);
    expect(history(0)).toEqual(messages);
  });

  it('announces departures and new arrivals only to the affected rooms', async () => {
    const actor = app.clients[0][1];
    const actorId = app.accountIds[0][1];
    expect(await actor.timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    const departure = history(0).at(-1)!;
    expect(departure).toMatchObject({ system: true, content: 'chat.playerLeft', sender: { id: actorId } });
    expect(t('chat.playerLeft', 'zh-TW', { name: departure.sender.nickname }))
      .toBe(`${departure.sender.nickname} 離開了房間`);
    expect(t('chat.playerLeft', 'en', { name: departure.sender.nickname }))
      .toBe(`${departure.sender.nickname} left the room`);
    expect(app.metrics.chatMessages).toBe(3);
    expect(new Set(app.metrics.recipients.keys())).toEqual(new Set(app.accountIds[0]));
    for (const id of app.accountIds[0].filter((id) => id !== actorId)) {
      expect(app.metrics.chatViews.get(id)?.at(-1)).toEqual(departure);
    }
    expect(app.metrics.chatViews.get(actorId)).toEqual([]);

    app.resetMetrics();
    expect(await actor.timeout(5_000).emitWithAck('room:join', { roomCode: app.roomCodes[1] }))
      .toMatchObject({ success: true });
    const arrival = history(1).at(-1)!;
    expect(arrival).toMatchObject({ system: true, content: 'chat.playerJoined', sender: { id: actorId } });
    expect(app.metrics.chatMessages).toBe(4);
    expect(new Set(app.metrics.recipients.keys())).toEqual(new Set([actorId, ...app.accountIds[1]]));
    const resumed: PlayerSnapshot = await actor.timeout(5_000).emitWithAck('player:resume');
    expect(resumed.chatHistory).toEqual(history(1));
    expect(resumed.chatHistory?.filter((message) => message.id === arrival.id)).toHaveLength(1);
    const stored = await app.repository.loadRuntime();
    for (const index of [0, 1]) {
      expect(stored?.chat.find((room) => room.roomCode === app.roomCodes[index])?.messages).toEqual(history(index));
    }
  });

  it('announces a kicked member leaving', async () => {
    const accountId = app.accountIds[0][1];
    expect(await app.clients[0][0].timeout(5_000).emitWithAck('room:kick', { accountId }))
      .toEqual({ success: true });
    expect(history(0).at(-1)).toMatchObject({ system: true, content: 'chat.playerLeft', sender: { id: accountId } });
    expect(app.metrics.chatMessages).toBe(3);
  });

  it.each(['join', 'leave', 'kick'] as const)('rolls back %s notifications without broadcasting on write failure', async (action) => {
    const actor = app.clients[0][1];
    if (action === 'join') expect(await actor.timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    const before = await app.repository.loadRuntime();
    const messages = history(0);
    app.resetMetrics();
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = action === 'join'
      ? await actor.timeout(5_000).emitWithAck('room:join', { roomCode: app.roomCodes[0] })
      : action === 'leave' ? await actor.timeout(5_000).emitWithAck('room:leave')
        : await app.clients[0][0].timeout(5_000).emitWithAck('room:kick', { accountId: app.accountIds[0][1] });
    expect(response).toMatchObject({ success: false, error: expect.stringContaining('save') });
    expect(await app.repository.loadRuntime()).toEqual(before);
    expect(history(0)).toEqual(messages);
    expect(getRoomMemberIds(app.roomCodes[0]).includes(app.accountIds[0][1])).toBe(action !== 'join');
    expect(app.metrics.snapshots).toBe(0);
    expect(app.metrics.chatMessages).toBe(0);
  });

  it('keeps chat unchanged across tabs, disconnects and reconnects', async () => {
    const messages = history(0);
    const secondTab = await app.connect(app.cookies[0][1]);
    expect((await secondTab.timeout(5_000).emitWithAck('player:resume')).chatHistory).toEqual(messages);
    app.clients[0][1].disconnect();
    expect((await secondTab.timeout(5_000).emitWithAck('player:resume')).chatHistory).toEqual(messages);
    secondTab.disconnect();
    await expect.poll(() => getPlayerState(app.accountIds[0][1])?.connectionStatus).toBe('disconnected');
    expect(history(0)).toEqual(messages);
    const reconnected = await app.connect(app.cookies[0][1]);
    expect((await reconnected.timeout(5_000).emitWithAck('player:resume')).chatHistory).toEqual(messages);
    expect(app.metrics.chatMessages).toBe(0);
  });

  it('announces a departure when the reconnect grace period expires', async () => {
    const accountId = app.accountIds[0][1];
    app.clients[0][1].disconnect();
    await expect.poll(() => getPlayerState(accountId)?.connectionStatus).toBe('disconnected');
    const expiredAt = Date.now() + RECONNECT_TIMEOUT_MS + 1;
    vi.spyOn(Date, 'now').mockReturnValue(expiredAt);
    await expect.poll(() => getPlayerState(accountId), { timeout: 7_000 }).toBeNull();
    expect(history(0).at(-1)).toMatchObject({ system: true, content: 'chat.playerLeft', sender: { id: accountId } });
    const stored = await app.repository.loadRuntime();
    expect(stored?.chat.find((room) => room.roomCode === app.roomCodes[0])?.messages).toEqual(history(0));
  }, 10_000);

  it('removes the history when the final human leaves', async () => {
    for (const actor of app.clients[0]) {
      expect(await actor.timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    }
    expect(getRoomInfo(app.roomCodes[0])).toBeNull();
    expect(history(0)).toEqual([]);
    expect((await app.repository.loadRuntime())?.chat.some((room) => room.roomCode === app.roomCodes[0])).toBe(false);
  });
});
