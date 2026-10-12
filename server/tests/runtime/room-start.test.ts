import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import type { GameType } from '@shared/types';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import { createSocketHarness } from '../performance/socket-harness';
import type { SocketHarness, TestClient } from '../performance/socket-harness';

const FLEXIBLE = ['ninetynine', 'blackjack', 'holdem'] as const;

/** Additional players join the real room as spectators before taking their configured seats. */
async function prepare(app: SocketHarness, gameType: GameType, count: number): Promise<TestClient[]> {
  const [host, ...others] = app.clients[0];
  const code = app.roomCodes[0];
  expect(await host.emitWithAck('room:setGameType', { gameType })).toEqual({ success: true });
  expect(await host.emitWithAck('room:setTimeControl', { baseSeconds: 300, bankSeconds: 300 }))
    .toEqual({ success: true });
  if (count < 4) {
    for (const client of others.slice(count - 1)) expect(await client.emitWithAck('room:standUp')).toEqual({ success: true });
    return app.clients[0].slice(0, count);
  }
  if (count === 4) return app.clients[0];
  for (let index = 0; index < 4; index++) expect(await host.emitWithAck('room:addSeat')).toEqual({ success: true });
  const additional = app.clients[1].slice(0, count - 4);
  for (const [index, client] of additional.entries()) {
    expect(await client.emitWithAck('room:leave')).toEqual({ success: true });
    expect(await client.emitWithAck('room:join', { roomCode: code })).toMatchObject({ success: true });
    // A sparse five-player table also proves P8 works while P5/P6/P7 stay empty.
    expect(await client.emitWithAck('room:changeAdditionalSeat', { index: count === 5 ? 3 : index }))
      .toEqual({ success: true });
  }
  return [...app.clients[0], ...additional];
}

async function ready(clients: readonly TestClient[]): Promise<void> {
  for (const client of clients) expect(await client.emitWithAck('room:ready')).toEqual({ success: true });
}

describe('explicit host start after preparation', () => {
  let harness: SocketHarness | undefined;
  afterEach(async () => { await harness?.close(); harness = undefined; vi.restoreAllMocks(); });

  it('allows preparation below the minimum, preserves waiting, and requires every newly seated player to prepare', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    const code = app.roomCodes[0];
    await prepare(app, 'ninetynine', 1);
    expect(await host.emitWithAck('room:ready')).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.seats.N.isReady).toBe(true);
    expect(await host.emitWithAck('room:start')).toMatchObject({ success: false });
    expect(rooms.getRoomInfo(code)?.status).toBe('waiting');
    expect(games.getGameState(code)).toBeNull();
    expect(await guest.emitWithAck('room:changeSeat', { seat: 'E' })).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.seats.N.isReady).toBe(false);
    expect(await host.emitWithAck('room:ready')).toEqual({ success: true });
    expect(await host.emitWithAck('room:start')).toMatchObject({ success: false });
    expect(await guest.emitWithAck('room:ready')).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.status).toBe('waiting');
    expect(await host.emitWithAck('room:start')).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.status).toBe('playing');
  });

  for (const gameType of FLEXIBLE) {
    it.each([2, 5, 8])(`${gameType} starts %i prepared players only on the host's request`, async (count) => {
      const app = await (harness = await createSocketHarness(count > 4 ? 2 : 1));
      const clients = await prepare(app, gameType, count);
      const host = clients[0];
      const code = app.roomCodes[0];
      await ready(clients.slice(0, -1));
      expect(await host.emitWithAck('room:start')).toMatchObject({ success: false });
      expect(await clients.at(-1)!.emitWithAck('room:ready')).toEqual({ success: true });
      expect(rooms.isAllReady(code)).toBe(true);
      expect(rooms.getRoomInfo(code)?.status).toBe('waiting');
      expect(games.getGameState(code)).toBeNull();
      expect(await clients[1].emitWithAck('room:start')).toMatchObject({ success: false });
      const before = structuredClone(rooms.getSeatPlayers(code));
      expect(await host.emitWithAck('room:start')).toEqual({ success: true });
      expect(rooms.getRoomInfo(code)?.status).toBe('playing');
      const state = games.getGameState(code)!;
      expect(state.players).toEqual(before);
      expect(Object.values(state.players)).toHaveLength(count);
      if (count > 4) expect(state.players).toHaveProperty('P8');
      expect(state.clock?.settings).toEqual({ baseSeconds: 300, bankSeconds: 300 });
      if (state.clock?.turn) expect(state.clock.turn.deadline - state.clock.turn.startsAt).toBe(600_000);
      expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
      for (const client of clients) {
        const response = await client.emitWithAck('player:resume');
        expect(response.gameState?.gameType).toBe(gameType);
        expect(response.gameState?.mySeat).toBe(rooms.getGamePlayerSeat(code, response.player!.id));
      }
    });
  }

  it('requires all four seats for Bridge even when all three present players are prepared', async () => {
    const app = await (harness = await createSocketHarness(1));
    const clients = await prepare(app, 'bridge', 3);
    const host = clients[0];
    const code = app.roomCodes[0];
    await ready(clients);
    expect(await host.emitWithAck('room:start')).toMatchObject({ success: false });
    expect(await app.clients[0][3].emitWithAck('room:changeSeat', { seat: 'W' })).toEqual({ success: true });
    await ready(app.clients[0]);
    expect(rooms.getRoomInfo(code)?.status).toBe('waiting');
    expect(await host.emitWithAck('room:start')).toEqual({ success: true });
    expect(games.getGameState(code)?.gameType).toBe('bridge');
  });

  it('defaults shuffle off and permits only the host to set it in every game', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [host, guest] = app.clients[0];
    const code = app.roomCodes[0];
    expect(rooms.getRoomInfo(code)?.shuffleSeats ?? false).toBe(false);
    for (const gameType of GAME_TYPES) {
      expect(await host.emitWithAck('room:setGameType', { gameType })).toEqual({ success: true });
      expect(await guest.emitWithAck('room:setShuffleSeats', { enabled: true })).toMatchObject({ success: false });
      expect(await host.emitWithAck('room:ready')).toEqual({ success: true });
      expect(await host.emitWithAck('room:setShuffleSeats', { enabled: true })).toEqual({ success: true });
      expect(rooms.getRoomInfo(code)?.shuffleSeats).toBe(true);
      expect(rooms.getRoomInfo(code)?.seats.N.isReady).toBe(false);
      expect(await host.emitWithAck('room:setShuffleSeats', { enabled: false })).toEqual({ success: true });
    }
    expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
  });

  it('rolls back shuffled seats, preparation, and the new game without broadcasting when the start write fails', async () => {
    const app = await (harness = await createSocketHarness(1));
    const clients = await prepare(app, 'holdem', 4);
    const host = clients[0];
    const code = app.roomCodes[0];
    expect(await host.emitWithAck('room:setShuffleSeats', { enabled: true })).toEqual({ success: true });
    await ready(clients);
    const originalShuffle = rooms.shuffleReadySeats;
    vi.spyOn(rooms, 'shuffleReadySeats').mockImplementation((roomCode) => originalShuffle(roomCode, () => 0));
    const before = await app.repository.loadRuntime();
    const players = structuredClone(rooms.getSeatPlayers(code));
    app.resetMetrics();
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Start write failed'));
    expect(await host.emitWithAck('room:start')).toMatchObject({ success: false });
    expect(app.metrics.snapshots).toBe(0);
    expect(await app.repository.loadRuntime()).toEqual(before);
    expect(rooms.getSeatPlayers(code)).toEqual(players);
    expect(rooms.isAllReady(code)).toBe(true);
    expect(rooms.getRoomInfo(code)?.status).toBe('waiting');
    expect(games.getGameState(code)).toBeNull();
    expect(await host.emitWithAck('room:start')).toEqual({ success: true });
    expect(rooms.getSeatPlayers(code)).not.toEqual(players);
    expect(Object.values(rooms.getSeatPlayers(code)!).map((entry) => entry.id).sort())
      .toEqual(Object.values(players!).map((entry) => entry.id).sort());
    expect(games.getGameState(code)?.players).toEqual(rooms.getSeatPlayers(code));
    expect(isRuntimeSnapshot(await app.repository.loadRuntime())).toBe(true);
  });

  it('accepts 300+300 seconds and rejects either setting above 300 without changing preparation', async () => {
    const app = await (harness = await createSocketHarness(1));
    const host = app.clients[0][0];
    expect(await host.emitWithAck('room:setTimeControl', { baseSeconds: 300, bankSeconds: 300 }))
      .toEqual({ success: true });
    expect(await host.emitWithAck('room:ready')).toEqual({ success: true });
    const before = await app.repository.loadRuntime();
    for (const settings of [{ baseSeconds: 301, bankSeconds: 300 }, { baseSeconds: 300, bankSeconds: 301 }]) {
      expect(await host.emitWithAck('room:setTimeControl', settings)).toMatchObject({ success: false });
      expect(await app.repository.loadRuntime()).toEqual(before);
    }
    expect(rooms.getRoomInfo(app.roomCodes[0])?.seats.N.isReady).toBe(true);
  });

  it('protects a live P5 seat from kicks and persists its abort vote and another player vote', async () => {
    const app = await (harness = await createSocketHarness(2));
    const clients = await prepare(app, 'blackjack', 5);
    const host = clients[0];
    const additional = clients.at(-1)!;
    const id = app.accountIds[1][0];
    const code = app.roomCodes[0];
    expect(await additional.emitWithAck('room:changeAdditionalSeat', { index: 0 })).toEqual({ success: true });
    await ready(clients);
    expect(await host.emitWithAck('room:start')).toEqual({ success: true });
    expect(rooms.getGamePlayerSeat(code, id)).toBe('P5');
    expect(await host.emitWithAck('room:kick', { accountId: id })).toMatchObject({ success: false });
    expect(rooms.getRoomInfo(code)?.status).toBe('playing');
    expect(await additional.emitWithAck('game:abortVote:start')).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.abortVote?.startedBy).toBe(id);
    expect(await host.emitWithAck('game:abortVote:cast', { agree: true })).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.abortVote?.yes).toEqual([id, app.accountIds[0][0]]);
    const saved = await app.repository.loadRuntime();
    expect(isRuntimeSnapshot(saved)).toBe(true);
    expect(saved?.rooms.find((entry) => entry.info.code === code)?.info.abortVote?.yes)
      .toEqual([id, app.accountIds[0][0]]);
    expect(Object.values(games.getGameState(code)!.players)).toHaveLength(5);
  });
});
