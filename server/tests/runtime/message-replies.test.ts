import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ClientToServerEvents, MediaId, PlayerInfo, PlayerSnapshot } from '@shared/types';
import * as chat from '../../src/managers/chat-manager';
import * as games from '../../src/managers/game-manager';
import * as players from '../../src/managers/player-manager';
import * as rooms from '../../src/managers/room-manager';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import { replyPreview } from '../../src/media/message-reply';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import { createSocketHarness } from '../performance/socket-harness';
import { applyChatMessage, applyPlayerSnapshot } from '../../../client/src/stores/player-snapshot';
import { clearAccount, useAccountStore } from '../../../client/src/stores/account-store';
import { useChatStore } from '../../../client/src/stores/chat-store';
import { useChatMentionStore } from '../../../client/src/stores/chat-mention-store';
import type { SocketHarness, TestClient } from '../performance/socket-harness';

vi.mock('../../../client/src/socket', () => ({ disconnectSocket: vi.fn() }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn(), invalidateAccountRequests: vi.fn() }));

vi.mock('../../src/app', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/app')>();
  return { ...original, createApplication: (
    repository: Parameters<typeof original.createApplication>[0], options: Parameters<typeof original.createApplication>[1],
  ) => original.createApplication(repository, { ...options, providedEmojis: new Map([
    ['wave', { name: 'wave', file: `wave-${'b'.repeat(24)}.png` }],
  ]) }) };
});

it('bounds reply excerpts without splitting graphemes or embedding sticker assets', () => {
  expect(replyPreview('id', 'Name', { content: `${'a'.repeat(158)}👨‍👩‍👧‍👦long`, timestamp: 123 }).content)
    .toBe(`${'a'.repeat(158)}…`);
  expect(replyPreview('id', 'Name', { content: '', timestamp: 123, sticker: { mediaId: 'private' } }))
    .toEqual({ senderId: 'id', nickname: 'Name', timestamp: 123, content: '[Sticker]', kind: 'sticker' });
});

it('detaches provided-sticker replies and discards wire previews on restore/export', () => {
  const sender: PlayerInfo = { id: 'sender', username: 'sender', nickname: 'Sender', color: '#123456',
    avatar: 'cat', avatarImage: null };
  const reply = { messageId: 'original', notify: true };
  chat.initRoomChat('REPLY');
  try {
    const message = chat.addProvidedSticker('REPLY', sender, 'wave', new Map([
      ['wave', { name: 'wave', file: `wave-${'b'.repeat(24)}.png` }],
    ]), undefined, reply)!;
    reply.messageId = 'changed';
    expect(message.reply?.messageId).toBe('original');
    chat.restoreChat([{ roomCode: 'REPLY', messages: [{ ...message,
      replyPreview: { senderId: 'forged', nickname: 'Forged', timestamp: 123, content: 'Quote', kind: 'text' } }] }]);
    expect(chat.getChatHistory('REPLY')[0]).not.toHaveProperty('replyPreview');
    expect(chat.exportChat()[0].messages[0]).not.toHaveProperty('replyPreview');
  } finally { chat.clearRoomChat('REPLY'); }
});

describe.each(REPOSITORY_ADAPTERS)('room selected replies ($name)', (adapter) => {
  let app: SocketHarness;
  beforeEach(async () => { app = await createSocketHarness(2, adapter); });
  afterEach(async () => { vi.restoreAllMocks(); clearAccount(); await app?.close(); });

  function send(payload: unknown, client: TestClient = app.clients[0][0]): Promise<{ success: boolean; error?: string }> {
    return client.timeout(5000).emitWithAck('chat:send', payload as Parameters<ClientToServerEvents['chat:send']>[0]);
  }
  function last(room = 0): ReturnType<typeof chat.getChatHistory>[number] {
    return chat.getChatHistory(app.roomCodes[room]).at(-1)!;
  }
  async function reject(payload: unknown): Promise<void> {
    const before = await app.repository.loadRuntime();
    app.resetMetrics();
    expect(await send(payload)).toMatchObject({ success: false });
    expect(await app.repository.loadRuntime()).toEqual(before);
    expect(chat.exportChat()).toEqual(before!.chat);
    expect(app.metrics.runtimeWrites).toBe(0);
    expect(app.metrics.chatMessages).toBe(0);
    expect(app.metrics.snapshots).toBe(0);
  }

  it('resolves text replies for deltas/resume while retaining only references across persistence', async () => {
    expect(await send({ message: 'Canonical source' }, app.clients[0][1])).toEqual({ success: true });
    const source = last();
    expect(await send({ message: 'Answer', replyTo: source.id })).toEqual({ success: true });
    const response = last();
    const preview = { senderId: source.sender.id, nickname: source.sender.nickname, timestamp: source.timestamp, content: source.content, kind: 'text' };
    expect(response.reply).toEqual({ messageId: source.id, notify: true });
    expect(response).not.toHaveProperty('replyPreview');
    for (const id of app.accountIds[0]) {
      expect(app.metrics.chatViews.get(id)?.at(-1)).toMatchObject({ id: response.id, replyPreview: preview });
    }
    const saved = (await app.repository.loadRuntime())!;
    expect(isRuntimeSnapshot(saved)).toBe(true);
    expect(saved.chat[0].messages.at(-1)).toEqual(response);
    expect(isRuntimeSnapshot({ ...saved, chat: [{ ...saved.chat[0], messages: [{ ...response, replyPreview: preview }] }] }))
      .toBe(false);
    for (const reply of [null, {}, { messageId: source.id, notify: 'true' },
      { messageId: source.id, notify: true, content: 'Forged' }]) {
      expect(isRuntimeSnapshot({ ...saved, chat: [{ ...saved.chat[0], messages: [{ ...response, reply }] }] })).toBe(false);
    }
    chat.restoreChat(saved.chat);
    const renamed = await fetch(`${app.baseUrl}/api/auth/profile`, {
      method: 'PATCH', headers: { Cookie: app.cookies[0][1], Origin: 'http://localhost:5173',
        'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Current name' }),
    });
    expect(renamed.status).toBe(200);
    expect(players.getPlayerInfo(source.sender.id)?.nickname).toBe('Current name');
    const tab = await app.connect(app.cookies[0][1]);
    expect((await tab.timeout(5000).emitWithAck('player:resume')).chatHistory?.at(-1))
      .toMatchObject({ reply: response.reply, replyPreview: preview });
    expect(await send({ message: 'Nested', replyTo: response.id, replyNotify: false })).toEqual({ success: true });
    const nested = (await tab.timeout(5000).emitWithAck('player:resume')).chatHistory?.at(-1);
    expect(nested?.replyPreview).toEqual({ ...preview, senderId: response.sender.id, timestamp: response.timestamp,
      nickname: response.sender.nickname, content: 'Answer' });
    expect(nested?.mentions).toBeUndefined();
  });

  it('accepts all sticker replies and previews stickers without media', async () => {
    expect(await send({ message: 'Source' })).toEqual({ success: true });
    const source = last();
    const mediaId = `${'a'.repeat(64)}.webp` as MediaId;
    const [asset] = await app.repository.createEmojis(app.accountIds[0][0], [{ name: 'wave', mediaId }], Date.now());
    expect(await send({ stickerId: asset.id, replyTo: source.id, replyNotify: false })).toEqual({ success: true });
    const sticker = last();
    expect(sticker.reply).toEqual({ messageId: source.id, notify: false });
    expect(await send({ providedSticker: 'wave', replyTo: source.id })).toEqual({ success: true });
    expect(last().reply).toEqual({ messageId: source.id, notify: true });
    const original = app.repository.getAccountById.bind(app.repository);
    vi.spyOn(app.repository, 'getAccountById').mockImplementation(async (id) => {
      const account = await original(id);
      return account && { ...account, ownedShopItems: ['stickers-table-talk'] };
    });
    expect(await send({ shopSticker: 'table-hello', replyTo: sticker.id })).toEqual({ success: true });
    const resumed: PlayerSnapshot = await app.clients[0][1].timeout(5000).emitWithAck('player:resume');
    expect(resumed.chatHistory?.at(-1)?.replyPreview).toEqual({ senderId: sticker.sender.id, timestamp: sticker.timestamp,
      nickname: sticker.sender.nickname, content: '[Sticker]', kind: 'sticker' });
    expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
  });

  it('rejects forged, malformed, missing, cross-room and system references without writes or broadcasts', async () => {
    const system = last();
    await send({ message: 'Other room' }, app.clients[1][0]);
    const other = last(1);
    for (const replyTo of ['', 'a'.repeat(129), 1, null, ' missing ', 'missing', system.id, other.id]) {
      await reject({ message: 'Answer', replyTo });
    }
    await send({ message: 'Source' });
    const replyTo = last().id;
    for (const payload of [
      { message: 'Answer', replyNotify: true }, { message: 'Answer', replyTo, replyNotify: 'yes' },
      { message: 'Answer', replyTo, reply: { messageId: replyTo, notify: true } },
      { message: 'Answer', replyTo, replyPreview: { senderId: 'forged', content: 'Forged' } },
      { message: 'Answer', replyTo, senderId: 'forged' },
      { providedSticker: 'wave', replyTo, content: 'Forged' },
    ]) await reject(payload);
  });

  it('invalidates live reply previews after source eviction without replaying alerts', async () => {
    const recipient = app.clients[0][1];
    const snapshots: PlayerSnapshot[] = [];
    const deltas: ChatMessage[] = [];
    recipient.on('player:state', (snapshot) => { snapshots.push(snapshot); });
    recipient.on('chat:message', ({ message }) => { deltas.push(message); });
    await send({ message: 'Old source' }, recipient);
    const source = last();
    await send({ message: 'Retained reply', replyTo: source.id });
    const response = last();
    await expect.poll(() => deltas.find((entry) => entry.id === response.id)?.replyPreview?.content).toBe('Old source');
    for (let index = 0; index < 198; index += 1) chat.addMessage(app.roomCodes[0], source.sender, `Filler ${index}`);
    // Advance the live cursor past the reply while retaining its source at the history limit.
    expect(await recipient.timeout(5000).emitWithAck('room:ready')).toEqual({ success: true });
    expect(chat.getChatHistory(app.roomCodes[0])[0].id).toBe(source.id);
    expect(app.metrics.latestSnapshots.get(source.sender.id)).not.toHaveProperty('chatHistory');
    const before = await app.repository.loadRuntime();
    app.resetMetrics();
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await send({ message: 'Prune source' })).toMatchObject({ success: false });
    expect(await app.repository.loadRuntime()).toEqual(before);
    expect(chat.exportChat()).toEqual(before!.chat);
    expect(app.metrics.snapshots).toBe(0);
    expect(app.metrics.chatMessages).toBe(0);
    expect(app.metrics.chatViews.get(source.sender.id)?.find((entry) => entry.id === response.id)?.replyPreview?.content)
      .toBe('Old source');

    expect(await send({ message: 'Prune source' })).toEqual({ success: true });
    const pruner = last();
    await expect.poll(() => snapshots.at(-1)?.chatHistory?.at(-1)?.id).toBe(pruner.id);
    const liveHistory = snapshots.at(-1)!.chatHistory!;
    expect(liveHistory).toHaveLength(200);
    expect(liveHistory.some((entry) => entry.id === source.id)).toBe(false);
    const retained = liveHistory.find((entry) => entry.id === response.id);
    expect(retained?.reply).toEqual({ messageId: source.id, notify: true });
    expect(retained).not.toHaveProperty('replyPreview');
    for (const id of app.accountIds[0]) {
      expect(app.metrics.chatViews.get(id)).toEqual(liveHistory);
    }
    // Retained replies are never replayed; only the new message uses the live notification path.
    expect(app.metrics.chatMessages).toBe(4);
    expect(deltas.filter((entry) => entry.id === response.id)).toHaveLength(1);
    expect(deltas.filter((entry) => entry.id === pruner.id)).toHaveLength(1);
    const resumed: PlayerSnapshot = await recipient.timeout(5000).emitWithAck('player:resume');
    expect(resumed.chatHistory).toEqual(liveHistory);

    app.resetMetrics();
    expect(await send({ message: 'Ordinary delta' })).toEqual({ success: true });
    expect(app.metrics.chatMessages).toBe(4);
    for (const id of app.accountIds[0]) {
      expect(app.metrics.latestSnapshots.get(id)).not.toHaveProperty('chatHistory');
    }
  });

  it.each(['mention', 'reply', 'combined'] as const)(
    'preserves a new live %s alert when the same commit invalidates an older quote', async (kind) => {
      const recipient = app.clients[0][1];
      const accountId = app.accountIds[0][1];
      useAccountStore.getState().setAccount((await app.repository.getAccountById(accountId))!);
      applyPlayerSnapshot(await recipient.timeout(5000).emitWithAck('player:resume'));
      useChatMentionStore.getState().setMode('visual');
      const events: string[] = [];
      recipient.on('player:state', (snapshot) => { applyPlayerSnapshot(snapshot); events.push('state'); });
      recipient.on('chat:message', (event) => { applyChatMessage(event); events.push(event.message.id); });
      await send({ message: 'Old source' }, recipient);
      const source = last();
      await send({ message: 'Old reply', replyTo: source.id });
      const oldReply = last();
      await expect.poll(() => useChatMentionStore.getState().unreadIds).toEqual([oldReply.id]);
      useChatMentionStore.getState().markRead([oldReply.id]);
      useChatMentionStore.getState().setMode('sound');
      for (let index = 0; index < 198; index += 1) chat.addMessage(app.roomCodes[0], source.sender, `Filler ${index}`);
      const retainedSource = last();
      expect(await recipient.timeout(5000).emitWithAck('room:ready')).toEqual({ success: true });
      await expect.poll(() => useChatStore.getState().messages.at(-1)?.id).toBe(retainedSource.id);
      expect(chat.getChatHistory(app.roomCodes[0])[0].id).toBe(source.id);
      const soundCues: string[] = [];
      const unsubscribe = useChatMentionStore.subscribe((state, previous) => {
        if (state.soundCueId && state.soundCueId !== previous.soundCueId) soundCues.push(state.soundCueId);
      });
      try {
        events.length = 0;
        const message = kind === 'reply' ? 'New reply' : `@${source.sender.nickname} new message`;
        expect(await send({
          message,
          ...(kind !== 'reply' && { mentions: [{ playerId: accountId, nickname: source.sender.nickname,
            start: 0, end: source.sender.nickname.length + 1 }] }),
          ...(kind !== 'mention' && { replyTo: retainedSource.id }),
        })).toEqual({ success: true });
        const live = last();
        await expect.poll(() => events).toEqual([live.id, 'state']);
        expect(useChatMentionStore.getState()).toMatchObject({
          unreadIds: [live.id], notice: { id: live.id }, soundCueId: live.id,
        });
        expect(soundCues).toEqual([live.id]);
        const history = useChatStore.getState().messages;
        expect(history).toHaveLength(200);
        expect(history.some((entry) => entry.id === source.id)).toBe(false);
        expect(history.find((entry) => entry.id === oldReply.id)).not.toHaveProperty('replyPreview');
        expect(history.filter((entry) => entry.id === live.id)).toHaveLength(1);
        applyPlayerSnapshot(await recipient.timeout(5000).emitWithAck('player:resume'));
        expect(useChatMentionStore.getState().unreadIds).toEqual([live.id]);
        expect(soundCues).toEqual([live.id]);
      } finally { unsubscribe(); }
    },
  );

  it('rolls back references and emits nothing on persistence failure', async () => {
    await send({ message: 'Source' });
    const replyTo = last().id;
    const before = await app.repository.loadRuntime();
    app.resetMetrics();
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await send({ message: 'Answer', replyTo })).toMatchObject({ success: false });
    expect(await app.repository.loadRuntime()).toEqual(before);
    expect(chat.exportChat()).toEqual(before!.chat);
    expect(app.metrics.chatMessages).toBe(0);
    expect(app.metrics.snapshots).toBe(0);
    expect(await send({ message: 'Answer', replyTo })).toEqual({ success: true });
  });

  it('enforces observer visibility and notifications for active and eliminated players', async () => {
    const active = app.clients[0][0];
    await send({ message: 'Active source' });
    const activeSource = last();
    await send({ message: 'Public reply', replyTo: activeSource.id });
    const publicReply = last();
    expect(await active.timeout(5000).emitWithAck('room:setGameType', { gameType: 'ninetynine' })).toEqual({ success: true });
    for (const client of app.clients[0]) await client.timeout(5000).emitWithAck('room:ready');
    expect(await active.timeout(5000).emitWithAck('room:start')).toEqual({ success: true });
    const observer = app.clients[1][0];
    await observer.timeout(5000).emitWithAck('room:leave');
    await observer.timeout(5000).emitWithAck('room:join', { roomCode: app.roomCodes[0] });
    const game = games.getGameState(app.roomCodes[0]);
    if (game?.gameType !== 'ninetynine') throw new Error('Expected a 99 game');
    const eliminatedSeat = game.currentTurnSeat === 'W' ? 'S' : 'W';
    const eliminatedClient = app.clients[0][eliminatedSeat === 'W' ? 3 : 2];
    game.eliminated = [eliminatedSeat];
    game.stock.push(...game.hands[eliminatedSeat]);
    game.hands[eliminatedSeat] = [];
    game.log.push({ type: 'eliminated', seat: eliminatedSeat, timestamp: Date.now() });
    game.presentation = { id: 'shown-elimination', startedAt: 0, logStart: game.log.length - 1, timingVersion: 2 };
    await app.repository.saveRuntime({ players: players.exportPlayers(), rooms: rooms.exportRooms(),
      games: games.exportGames(), chat: chat.exportChat() });
    expect(await send({ message: 'Private source' }, observer)).toEqual({ success: true });
    const source = last();
    await reject({ message: 'Forbidden', replyTo: source.id });
    expect(await send({ message: 'Notify active', replyTo: activeSource.id }, observer)).toEqual({ success: false,
      error: 'Observers can only notify other observers during a match.' });
    expect(await send({ message: 'Silent reply', replyTo: activeSource.id, replyNotify: false }, observer))
      .toEqual({ success: true });
    expect(await send({ message: 'Private reply', replyTo: source.id }, eliminatedClient)).toEqual({ success: true });
    const privateReply = last();
    const activeView: PlayerSnapshot = await active.timeout(5000).emitWithAck('player:resume');
    expect(activeView.chatHistory?.some((entry) => entry.id === privateReply.id)).toBe(false);
    expect((await observer.timeout(5000).emitWithAck('player:resume')).chatHistory?.at(-1)?.replyPreview?.content)
      .toBe('Private source');
    // A previously public reply must not reveal an original that is now hidden from its recipient.
    chat.restoreChat(chat.exportChat().map((entry) => ({ ...entry, messages: entry.messages.map((message) =>
      message.id === activeSource.id ? { ...message, audience: 'observers' as const } : message) })));
    app.resetMetrics();
    expect(await send({ message: 'Public follow-up' })).toEqual({ success: true });
    const filtered = app.metrics.latestSnapshots.get(app.accountIds[0][0])?.chatHistory;
    expect(filtered).toBeDefined();
    expect(filtered?.some((entry) => entry.id === activeSource.id || entry.id === privateReply.id)).toBe(false);
    expect(filtered?.find((entry) => entry.id === publicReply.id)?.reply).toEqual(publicReply.reply);
    expect(filtered?.find((entry) => entry.id === publicReply.id)).not.toHaveProperty('replyPreview');
    // Observers retain the authorized preview and receive only the new public message.
    expect(app.metrics.latestSnapshots.get(app.accountIds[1][0])).not.toHaveProperty('chatHistory');
    expect(app.metrics.chatViews.get(app.accountIds[1][0])?.find((entry) => entry.id === publicReply.id)?.replyPreview?.content)
      .toBe('Active source');
    expect(app.metrics.chatMessages).toBe(5);
    expect((await active.timeout(5000).emitWithAck('player:resume')).chatHistory).toEqual(filtered);
  });
});
