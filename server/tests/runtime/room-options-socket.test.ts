import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameOptionsPayload } from '@shared/types';
import * as rooms from '../../src/managers/room-manager';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import { createSocketHarness } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';

describe.each(REPOSITORY_ADAPTERS)('unified room options ($name)', (adapter) => {
  let app: SocketHarness | undefined;
  afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks(); });

  it('rejects stale games, invalid envelopes, and legacy events without changing or broadcasting rules', async () => {
    const harness = app = await createSocketHarness(1, adapter);
    const [host, guest] = harness.clients[0];
    const code = harness.roomCodes[0];
    await host.emitWithAck('room:setGameType', { gameType: 'sevens' });
    const before = structuredClone(rooms.getRoomInfo(code));
    const saved = await harness.repository.loadRuntime();
    harness.resetMetrics();
    for (const payload of [
      null, [], {}, { gameType: 'unknown', options: {} }, { gameType: 'sevens' },
      { gameType: 'sevens', options: { closeOnEnd: false }, extra: true },
      { gameType: 'blackjack', options: { playerDealer: true } },
      { gameType: 'sevens', options: { closeOnEnd: false, private: 'untrusted' } },
    ]) {
      expect(await host.emitWithAck('room:setGameOptions', payload as GameOptionsPayload))
        .toMatchObject({ success: false });
    }
    expect(await guest.emitWithAck('room:setGameOptions', { gameType: 'sevens', options: { closeOnEnd: false } }))
      .toMatchObject({ success: false });
    for (const event of ['room:setSevensOptions', 'room:setNinetyNineOptions', 'room:setBlackjackOptions', 'room:setNapoleonOptions'] as const) {
      expect(await host.emitWithAck(event, {} as never)).toEqual({
        success: false, error: 'This version is outdated. Please refresh your page.',
      });
    }
    host.emit('room:setGameOptions', { gameType: 'sevens', options: { closeOnEnd: false } }, undefined as never);
    expect(await host.emitWithAck('room:setGameOptions', { gameType: 'unknown', options: {} } as never))
      .toMatchObject({ success: false });
    expect(rooms.getRoomInfo(code)).toEqual(before);
    expect(await harness.repository.loadRuntime()).toEqual(saved);
    expect(harness.metrics.runtimeWrites).toBe(0);
    expect(harness.metrics.snapshots).toBe(0);
  });

  it('preserves all game choices when switching and acknowledges only after persistence succeeds', async () => {
    const harness = app = await createSocketHarness(1, adapter);
    const [host, guest] = harness.clients[0];
    const code = harness.roomCodes[0];
    await host.emitWithAck('room:setGameType', { gameType: 'sevens' });
    await guest.emitWithAck('room:ready');
    const before = structuredClone(rooms.getRoomInfo(code));
    const saved = await harness.repository.loadRuntime();
    harness.resetMetrics();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = vi.spyOn(harness.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk unavailable'));
    expect(await host.emitWithAck('room:setGameOptions', { gameType: 'sevens', options: { closeOnEnd: false } }))
      .toMatchObject({ success: false });
    expect(rooms.getRoomInfo(code)).toEqual(before);
    expect(await harness.repository.loadRuntime()).toEqual(saved);
    expect(harness.metrics.snapshots).toBe(0);
    save.mockRestore();
    for (const payload of [
      { gameType: 'sevens', options: { closeOnEnd: false } },
      { gameType: 'ninetynine', options: { twoDecks: true } },
      { gameType: 'blackjack', options: { playerDealer: true } },
      { gameType: 'napoleon', options: { jokerSummon: false } },
      { gameType: 'crazyeights', options: { actionCards: true } },
      { gameType: 'gomoku', options: { renju: true, swap: true } },
      { gameType: 'xiangqi', options: { handicap: 'horses', handicapSide: 'black' } },
      { gameType: 'banqi', options: { chain: true, rookDash: false } },
      { gameType: 'battleship', options: { noTouching: true, hitAgain: false } },
    ] satisfies readonly GameOptionsPayload[]) {
      await host.emitWithAck('room:setGameType', { gameType: payload.gameType });
      expect(await host.emitWithAck('room:setGameOptions', payload)).toEqual({ success: true });
      expect((await harness.repository.loadRuntime())?.rooms[0].info.gameOptions?.[payload.gameType]).toEqual(payload.options);
    }
    await host.emitWithAck('room:setGameType', { gameType: 'sevens' });
    expect(rooms.getRoomInfo(code)?.gameOptions).toEqual({
      sevens: { closeOnEnd: false }, ninetynine: { twoDecks: true },
      blackjack: { playerDealer: true }, napoleon: { jokerSummon: false }, crazyeights: { actionCards: true }, doudizhu: { variant: 'score' },
      gomoku: { renju: true, swap: true },
      xiangqi: { handicap: 'horses', handicapSide: 'black' },
      banqi: { chain: true, rookDash: false },
      battleship: { noTouching: true, hitAgain: false },
    });
  });
});
