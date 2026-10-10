import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BidAction, BridgeGameState, Card } from '@shared/types';
import type { PlayerSnapshot } from '@shared/types/socket-events';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import { getTurnSeat } from '../../src/managers/game-clock';
import { applyAutomatedAction, firstLegalAction } from '../../src/runtime/automated-action';
import { createSocketHarness, SEATS } from '../performance/socket-harness';
import type { SocketHarness, TestClient } from '../performance/socket-harness';

let harness: SocketHarness | undefined;

afterEach(async (): Promise<void> => {
  vi.restoreAllMocks();
  await harness?.close();
  harness = undefined;
});

async function resume(client: TestClient): Promise<PlayerSnapshot> {
  const state = await client.timeout(5_000).emitWithAck('player:resume');
  expect(state.success).toBe(true);
  return state;
}

/** Starts the fixture Bridge room and answers any redeal offers. */
async function startBridge(app: SocketHarness): Promise<TestClient[]> {
  const players = app.clients[0];
  for (const client of players) {
    expect(await client.timeout(5_000).emitWithAck('room:ready')).toEqual({ success: true });
  }
  let snapshot = await resume(players[0]);
  for (let attempt = 0; snapshot.gameState?.phase === 'redeal_pending' && attempt < 30; attempt += 1) {
    const seat = snapshot.gameState.redealPendingSeat;
    if (!seat) throw new Error('Expected a redeal decision');
    expect(await players[SEATS.indexOf(seat)].timeout(5_000)
      .emitWithAck('game:redealResponse', { accept: false })).toEqual({ success: true });
    snapshot = await resume(players[0]);
  }
  expect(snapshot.gameState?.phase).toBe('bidding');
  return players;
}

async function savedGame(app: SocketHarness): Promise<BridgeGameState> {
  const runtime = await app.repository.loadRuntime();
  const game = runtime?.games[0];
  if (game?.gameType !== 'bridge') throw new Error('Expected a saved Bridge game');
  return game;
}

describe('Bridge action payloads', () => {
  it('should store only the known bid and card fields', async () => {
    const app = await (harness = await createSocketHarness(1));
    const players = await startBridge(app);
    for (let index = 0; index < 4; index += 1) {
      const visible = (await resume(players[0])).gameState;
      const bidder = visible?.gameType === 'bridge' ? visible.bidding?.currentBidderSeat : undefined;
      if (!bidder) throw new Error('Expected a current bidder');
      const bid = (index === 0
        ? { type: 'bid', level: 1, suit: 'clubs', injected: 'x'.repeat(64) }
        : { type: 'pass', level: 7, injected: true }) as unknown as BidAction;
      expect(await players[SEATS.indexOf(bidder)].timeout(5_000).emitWithAck('game:bid', { bid }))
        .toEqual({ success: true });
    }
    const bidding = await savedGame(app);
    expect(bidding.phase).toBe('playing');
    for (const entry of bidding.log.filter((item) => item.type === 'bid')) {
      expect(Object.keys(entry.action).sort()).toEqual(entry.action.type === 'pass'
        ? ['type'] : ['level', 'suit', 'type']);
    }

    const seat = bidding.playing?.currentTurnSeat;
    if (!seat) throw new Error('Expected the opening lead');
    const client = players[SEATS.indexOf(seat)];
    const visible = (await resume(client)).gameState;
    const card = visible?.gameType === 'bridge' ? visible.validCards[0] : undefined;
    if (!card) throw new Error('Expected a legal card');
    const extended = { ...card, injected: 'x' } as Card;
    expect(await client.timeout(5_000).emitWithAck('game:playCard', { card: extended })).toEqual({ success: true });
    const played = await savedGame(app);
    expect(played.playing?.currentTrick[seat]).toEqual(card);
    expect(Object.keys(played.playing?.currentTrick[seat] ?? {}).sort()).toEqual(['rank', 'suit']);
    expect(played.log.at(-1)).toEqual(expect.objectContaining({ type: 'play', card }));
    const logged = played.log.at(-1);
    if (logged?.type !== 'play') throw new Error('Expected a play log entry');
    expect(Object.keys(logged.card).sort()).toEqual(['rank', 'suit']);
  });
});

describe('finished board dismissal', () => {
  it('should let each seated player return while the others keep the result', async () => {
    const app = await (harness = await createSocketHarness(2));
    const players = await startBridge(app);
    const code = app.roomCodes[0];
    // Finish the deal in-process; the next committed action records it and reopens the room.
    for (let step = 0; step < 200; step += 1) {
      const game = games.getGameState(code)!;
      const seat = getTurnSeat(game);
      if (!seat || game.phase === 'scoring') break;
      delete game.presentation;
      const opening = game.gameType === 'bridge' && game.phase === 'bidding' && !game.bidding?.highestBid;
      const action = opening ? { type: 'bridge-bid' as const, action: { type: 'bid' as const, level: 1 as const,
        suit: 'clubs' as const } } : firstLegalAction(games.getPlayerVisibleState(code, seat)!);
      expect(applyAutomatedAction(code, seat, action!).success).toBe(true);
    }
    delete games.getGameState(code)!.presentation;
    await resume(players[1]);
    expect(games.getGameState(code)?.phase).toBe('scoring');
    expect(rooms.getRoomInfo(code)?.status).toBe('waiting');
    expect(await players[0].timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    const visitor = app.clients[1][0];
    expect(await visitor.timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    expect(await visitor.timeout(5_000).emitWithAck('room:join', { roomCode: code }))
      .toMatchObject({ success: true });
    // A spectator watches the finished board until returning, without removing it.
    const watching = (await resume(visitor)).gameState;
    expect(watching?.phase).toBe('scoring');
    expect(watching?.gameType === 'bridge' && watching.observer).toBe('spectator');
    expect(await visitor.timeout(5_000).emitWithAck('game:continue')).toEqual({ success: true });
    expect((await resume(visitor)).gameState).toBeUndefined();
    expect(games.getGameState(code)?.phase).toBe('scoring');
    expect(await players[1].timeout(5_000).emitWithAck('game:continue')).toEqual({ success: true });
    expect(games.getGameState(code)?.returnedSeats).toEqual(['N', 'E']);
    expect((await resume(players[1])).gameState).toBeUndefined();
    expect((await resume(players[2])).gameState?.phase).toBe('scoring');
    expect(await players[2].timeout(5_000).emitWithAck('game:continue')).toEqual({ success: true });
    expect(games.getGameState(code)).not.toBeNull();
    expect(await players[3].timeout(5_000).emitWithAck('game:continue')).toEqual({ success: true });
    expect(games.getGameState(code)).toBeNull();
  });

  it('should hide a finished board from a different player in the same seat', async () => {
    const app = await (harness = await createSocketHarness(2));
    await startBridge(app);
    const code = app.roomCodes[0];
    const game = games.getGameState(code)!;
    expect(games.isViewingGame(code, 'N', game.players.N.id)).toBe(true);
    expect(games.isViewingGame(code, 'N', game.players.E.id)).toBe(false);
  });
});
