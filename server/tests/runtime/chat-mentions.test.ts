import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMention, ClientToServerEvents, PlayerInfo, PlayerSnapshot } from '@shared/types';
import * as chat from '../../src/managers/chat-manager';
import * as games from '../../src/managers/game-manager';
import * as players from '../../src/managers/player-manager';
import * as rooms from '../../src/managers/room-manager';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import { parseChatMentions } from '../../src/socket/chat-mentions';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import { createSocketHarness } from '../performance/socket-harness';
import type { SocketHarness, TestClient } from '../performance/socket-harness';

function mention(player: Pick<PlayerInfo, 'id' | 'nickname'>, start = 0): ChatMention {
  return { playerId: player.id, nickname: player.nickname, start, end: start + player.nickname.length + 1 };
}

const SELECTED = { playerId: 'target', nickname: 'Alice', start: 0, end: 6 };

describe('explicit chat mention metadata', () => {
  it.each([
    null, {}, 'target', [null], [[]], ['target'],
    [{ ...SELECTED, extra: true }], [{ nickname: 'Alice', start: 0, end: 6 }],
    [{ ...SELECTED, playerId: '' }], [{ ...SELECTED, playerId: 1 }],
    [{ ...SELECTED, nickname: '' }], [{ ...SELECTED, nickname: 'Bob' }],
    [{ ...SELECTED, start: -1 }], [{ ...SELECTED, start: 0.5 }],
    [{ ...SELECTED, start: '0' }], [{ ...SELECTED, start: NaN }], [{ ...SELECTED, end: Infinity }],
    [{ ...SELECTED, end: Number.MAX_SAFE_INTEGER + 1 }], [{ ...SELECTED, end: 500 }],
    [{ ...SELECTED, end: 7 }], [{ ...SELECTED, end: 0 }], [{ ...SELECTED, end: 5 }],
    [SELECTED, SELECTED],
    [{ ...SELECTED, nickname: 'Alice @B', end: 9 }, { ...SELECTED, nickname: 'B', start: 7, end: 9 }],
    Array.from({ length: 21 }, () => SELECTED),
  ].map((value) => ({ value })))('rejects malformed, spoofed, excessive, or overlapping metadata: %j', ({ value }) => {
    expect(parseChatMentions(value, '@Alice @B')).toBeNull();
  });

  it('accepts twenty selections without changing caller order or retaining caller references', () => {
    const input = Array.from({ length: 20 }, (_, index) => ({ ...SELECTED, start: index * 7, end: index * 7 + 6 })).reverse();
    const before = structuredClone(input);
    const result = parseChatMentions(input, Array.from({ length: 20 }, () => '@Alice').join(' '));
    expect(result).toEqual([...before].reverse());
    expect(input).toEqual(before);
    expect(result?.[0]).not.toBe(input.at(-1));
    expect(parseChatMentions(undefined, '@Alice')).toEqual([]);
    expect(parseChatMentions([], '@Alice')).toEqual([]);
  });

  it('stores sorted, detached metadata and retains old plain history', () => {
    const code = 'MENTION';
    const sender: PlayerInfo = { id: 'sender', username: 'sender', nickname: 'Sender', color: '#123456',
      avatar: 'cat', avatarImage: null };
    const input = [{ ...SELECTED, start: 7, end: 13 }, { ...SELECTED }];
    chat.initRoomChat(code);
    try {
      const message = chat.addMessage(code, sender, '@Alice @Alice', [], new Map(), undefined, input);
      input[0].nickname = 'Changed';
      input.splice(1, 1);
      expect(message.mentions).toEqual([SELECTED, { ...SELECTED, start: 7, end: 13 }]);
      const plain = chat.addMessage(code, sender, '@Alice');
      expect(plain).not.toHaveProperty('mentions');
      const saved = structuredClone(chat.exportChat());
      chat.restoreChat(saved);
      expect(chat.getChatHistory(code)).toEqual([message, plain]);
    } finally {
      chat.clearRoomChat(code);
    }
  });
});

describe.each(REPOSITORY_ADAPTERS)('room chat mentions ($name)', (adapter) => {
  let app: SocketHarness;

  beforeEach(async () => {
    app = await createSocketHarness(2, adapter);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  function target(index: number, roomIndex = 0): PlayerInfo {
    return players.getPlayerInfo(app.accountIds[roomIndex][index])!;
  }

  function send(payload: unknown, client: TestClient = app.clients[0][0]): Promise<{ success: boolean; error?: string }> {
    return client.timeout(5_000).emitWithAck('chat:send', payload as Parameters<ClientToServerEvents['chat:send']>[0]);
  }

  async function rename(index: number, nickname: string): Promise<void> {
    const response = await fetch(`${app.baseUrl}/api/auth/profile`, {
      method: 'PATCH', headers: { Cookie: app.cookies[0][index], Origin: 'http://localhost:5173',
        'Content-Type': 'application/json' }, body: JSON.stringify({ nickname }),
    });
    expect(response.status).toBe(200);
    expect(target(index).nickname).toBe(nickname);
  }

  async function assertRejected(payload: unknown, error?: string): Promise<void> {
    const before = await app.repository.loadRuntime();
    app.resetMetrics();
    expect(await send(payload)).toMatchObject({ success: false, ...(error ? { error } : {}) });
    expect(await app.repository.loadRuntime()).toEqual(before);
    expect(chat.getChatHistory(app.roomCodes[0])).toEqual(before?.chat.find((room) => room.roomCode === app.roomCodes[0])?.messages);
    expect(app.metrics.runtimeWrites).toBe(0);
    expect(app.metrics.chatMessages).toBe(0);
    expect(app.metrics.snapshots).toBe(0);
  }

  it('persists and resumes multiple targets, repeated selections, and self selections using trimmed UTF-16 offsets', async () => {
    const selected = [target(1), target(2), target(1), target(0)];
    const content = `😀 ${selected.map((player) => `@${player.nickname}`).join(' ')}`;
    let start = 3;
    const mentions = selected.map((player) => {
      const selection = mention(player, start);
      start = selection.end + 1;
      return selection;
    });
    expect(await send({ message: `  ${content}  `, mentions: [...mentions].reverse() })).toEqual({ success: true });
    const message = chat.getChatHistory(app.roomCodes[0]).at(-1)!;
    expect(message).toMatchObject({ content, mentions });
    expect(app.metrics.chatMessages).toBe(4);
    for (const id of app.accountIds[0]) {
      expect(app.metrics.chatViews.get(id)?.filter((entry) => entry.id === message.id)).toEqual([message]);
    }
    const snapshot = await app.repository.loadRuntime();
    expect(isRuntimeSnapshot(snapshot)).toBe(true);
    expect(snapshot?.chat.find((room) => room.roomCode === app.roomCodes[0])?.messages.at(-1)).toEqual(message);
    const tab = await app.connect(app.cookies[0][1]);
    const resumed: PlayerSnapshot = await tab.timeout(5_000).emitWithAck('player:resume');
    expect(resumed.chatHistory?.filter((entry) => entry.id === message.id)).toEqual([message]);
    // Runtime hydration preserves the selected nickname snapshot without looking up current profiles.
    await rename(1, 'New name');
    chat.restoreChat(snapshot!.chat);
    expect((await tab.timeout(5_000).emitWithAck('player:resume')).chatHistory?.at(-1)).toEqual(message);
  });

  it('keeps identical nicknames tied to selected player IDs and rejects stale renamed selections', async () => {
    await rename(1, 'Twin');
    await rename(2, 'Twin');
    const mentions = [mention(target(1)), mention(target(2), 6)];
    expect(await send({ message: '@Twin @Twin', mentions })).toEqual({ success: true });
    expect(chat.getChatHistory(app.roomCodes[0]).at(-1)?.mentions).toEqual(mentions);
    await rename(1, 'Renamed');
    await assertRejected({ message: '@Twin @Twin', mentions },
      'A mentioned player changed their nickname. Please select them again.');
    expect(await send({ message: '@Twin', mentions: [mention(target(2))] })).toEqual({ success: true });
  });

  it('rejects unknown, off-room, and bot IDs without persisting or broadcasting', async () => {
    expect(await app.clients[0][3].timeout(5_000).emitWithAck('room:standUp')).toEqual({ success: true });
    expect(await app.clients[0][0].timeout(5_000).emitWithAck('room:addBot', { seat: 'W' })).toEqual({ success: true });
    const bot = rooms.getRoomInfo(app.roomCodes[0])!.seats.W.player!;
    for (const player of [{ id: 'unknown', nickname: 'Unknown' }, target(0, 1), bot]) {
      await assertRejected({ message: `@${player.nickname}`, mentions: [mention(player)] },
        'Mentioned players must be human members of this room. Please select players again.');
    }
  });

  it('rejects malformed and overlapping selections and extra text payload keys', async () => {
    const selected = mention(target(1));
    const message = `@${selected.nickname}`;
    for (const payload of [
      { message, mentions: null }, { message, mentions: [selected, selected] },
      { message, mentions: [{ ...selected, nickname: 'Spoofed' }] },
      { message, mentions: [{ ...selected, start: 1 }] }, { message, mentions: [selected], extra: true },
    ]) await assertRejected(payload);
  });

  it.each([{ stickerId: 'custom' }, { providedSticker: 'wave' }, { shopSticker: 'table-hello' }])(
    'rejects mentions and extra keys on sticker variants: %j', async (payload) => {
      await assertRejected({ ...payload, mentions: [] }, 'Invalid sticker payload.');
      await assertRejected({ ...payload, extra: true }, 'Invalid sticker payload.');
    },
  );

  it('keeps unselected literal @text and old plain messages valid', async () => {
    for (const payload of [{ message: 'plain text' }, { message: `@${target(1).nickname}` },
      { message: '@unknown', mentions: [] }]) {
      expect(await send(payload)).toEqual({ success: true });
      expect(chat.getChatHistory(app.roomCodes[0]).at(-1)).not.toHaveProperty('mentions');
    }
    expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
  });

  it('rolls back selected mentions and emits nothing on write failure, then permits retry', async () => {
    const before = await app.repository.loadRuntime();
    const payload = { message: `@${target(1).nickname}`, mentions: [mention(target(1))] };
    app.resetMetrics();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    expect(await send(payload)).toMatchObject({ success: false, error: expect.stringContaining('save') });
    expect(await app.repository.loadRuntime()).toEqual(before);
    expect(chat.exportChat()).toEqual(before?.chat);
    expect(app.metrics.chatMessages).toBe(0);
    expect(app.metrics.snapshots).toBe(0);
    expect(await send(payload)).toEqual({ success: true });
    expect(chat.getChatHistory(app.roomCodes[0]).filter((message) => message.mentions)).toHaveLength(1);
  });

  it('allows spectator and eliminated mentions only to recipients who can read observer chat', async () => {
    const active = app.clients[0][0];
    expect(await active.timeout(5_000).emitWithAck('room:setGameType', { gameType: 'ninetynine' })).toEqual({ success: true });
    for (const client of app.clients[0]) expect(await client.timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });
    expect(await active.timeout(5_000).emitWithAck('room:start')).toEqual({ success: true });
    const observer = app.clients[1][0];
    expect(await observer.timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    expect(await observer.timeout(5_000).emitWithAck('room:join', { roomCode: app.roomCodes[0] })).toMatchObject({ success: true });
    const spectator = target(0, 1);
    const game = games.getGameState(app.roomCodes[0]);
    if (game?.gameType !== 'ninetynine') throw new Error('Expected a 99 game');
    const eliminatedSeat = game.currentTurnSeat === 'W' ? 'S' : 'W';
    const eliminatedIndex = eliminatedSeat === 'W' ? 3 : 2;
    const eliminated = target(eliminatedIndex);
    const eliminatedClient = app.clients[0][eliminatedIndex];
    game.eliminated = [eliminatedSeat];
    game.stock.push(...game.hands[eliminatedSeat]);
    game.hands[eliminatedSeat] = [];
    game.log.push({ type: 'eliminated', seat: eliminatedSeat, timestamp: Date.now() });
    game.presentation = { id: 'shown-elimination', startedAt: 0, logStart: game.log.length - 1, timingVersion: 2 };
    // Commit the fixture transition before comparing rejected mutations with durable state.
    await app.repository.saveRuntime({ players: players.exportPlayers(), rooms: rooms.exportRooms(),
      games: games.exportGames(), chat: chat.exportChat() });
    const activePayload = { message: `@${target(0).nickname}`, mentions: [mention(target(0))] };
    app.resetMetrics();
    for (const client of [observer, eliminatedClient]) {
      expect(await send(activePayload, client)).toEqual({ success: false,
        error: 'Observers can only mention other observers during a match.' });
    }
    expect(app.metrics.runtimeWrites).toBe(0);
    expect(app.metrics.chatMessages).toBe(0);
    expect(await send({ message: `@${eliminated.nickname}`, mentions: [mention(eliminated)] }, observer))
      .toEqual({ success: true });
    const observerMessage = chat.getChatHistory(app.roomCodes[0]).at(-1)!;
    expect(observerMessage).toMatchObject({ audience: 'observers', mentions: [mention(eliminated)] });
    expect((await active.timeout(5_000).emitWithAck('player:resume')).chatHistory).not.toContainEqual(observerMessage);
    expect((await eliminatedClient.timeout(5_000).emitWithAck('player:resume')).chatHistory).toContainEqual(observerMessage);
    expect(await send({ message: `@${spectator.nickname}`, mentions: [mention(spectator)] }, eliminatedClient))
      .toEqual({ success: true });
    expect(await send({ message: `@${spectator.nickname}`, mentions: [mention(spectator)] }, active)).toEqual({ success: true });
  });
});
