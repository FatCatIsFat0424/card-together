import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BidAction, BridgeGameState, Card } from '@shared/types';
import type { ActionResult, PlayerSnapshot } from '@shared/types/socket-events';
import { tokenHash } from '../../src/auth/auth-service';
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
  expect(await players[0].timeout(5_000).emitWithAck('room:start')).toEqual({ success: true });
  let snapshot = await resume(players[0]);
  for (let attempt = 0; snapshot.gameState?.phase === 'redeal_pending' && attempt < 30; attempt += 1) {
    const seat = snapshot.gameState.redealPendingSeat;
    if (!seat) throw new Error('Expected a redeal decision');
    expect(await players[SEATS.indexOf(seat)].timeout(5_000)
      .emitWithAck('game:action', {
        gameType: 'bridge',
        action: { type: 'redeal', accept: false },
      })).toEqual({ success: true });
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
      expect(await players[SEATS.indexOf(bidder)].timeout(5_000).emitWithAck('game:action', {
        gameType: 'bridge',
        action: { type: 'bid', bid },
      }))
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
    expect(await client.timeout(5_000).emitWithAck('game:action', {
      gameType: 'bridge',
      action: { type: 'play', card: extended },
    })).toEqual({ success: true });
    const played = await savedGame(app);
    expect(played.playing?.currentTrick[seat]).toEqual(card);
    expect(Object.keys(played.playing?.currentTrick[seat] ?? {}).sort()).toEqual(['rank', 'suit']);
    expect(played.log.at(-1)).toEqual(expect.objectContaining({ type: 'play', card }));
    const logged = played.log.at(-1);
    if (logged?.type !== 'play') throw new Error('Expected a play log entry');
    expect(Object.keys(logged.card).sort()).toEqual(['rank', 'suit']);
  });
});

describe('unified game actions', () => {
  it('rejects malformed envelopes and actions without changing the game', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [client] = await startBridge(app);
    const before = structuredClone(games.getGameState(app.roomCodes[0]));
    const saved = await app.repository.loadRuntime();
    app.resetMetrics();
    for (const payload of [null, [], {}, { gameType: 'unknown', action: { type: 'pass' } },
      { gameType: 'bridge' }, { gameType: 'bridge', action: null },
      { gameType: 'bridge', action: { type: 'bid', bid: { type: 'bid', level: 8, suit: 'clubs' } } },
      { gameType: 'bridge', action: { type: 'play', card: { suit: 'clubs', rank: 1 } } },
      { gameType: 'bridge', action: { type: 'redeal', accept: 'yes' } },
    ]) {
      expect(await client.timeout(5_000).emitWithAck('game:action', payload as never))
        .toMatchObject({ success: false, error: expect.stringMatching(/^Invalid /) });
    }
    expect(games.getGameState(app.roomCodes[0])).toEqual(before);
    expect(await app.repository.loadRuntime()).toEqual(saved);
    expect(app.metrics.snapshots).toBe(0);
    expect(app.metrics.runtimeWrites).toBe(0);
  });

  it('rejects a different game type before dispatch or clock mutation', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [client] = await startBridge(app);
    const code = app.roomCodes[0];
    const before = structuredClone(games.getGameState(code));
    app.resetMetrics();
    expect(await client.timeout(5_000).emitWithAck('game:action', { gameType: 'bigtwo', action: { type: 'pass' } }))
      .toEqual({ success: false, error: 'This action is not available in this game.' });
    expect(games.getGameState(code)).toEqual(before);
    expect(games.handleGameAction(code, 'N', { gameType: 'bigtwo', action: { type: 'pass' } })).toMatchObject({ success: false });
    expect(games.getGameState(code)).toEqual(before);
    expect(app.metrics.runtimeWrites).toBe(0);
    expect(app.metrics.snapshots).toBe(0);
  });

  it('ignores valid actions with missing or non-function callbacks', async () => {
    const app = await (harness = await createSocketHarness(1));
    const players = await startBridge(app);
    const code = app.roomCodes[0];
    const before = structuredClone(games.getGameState(code));
    const bidder = before?.gameType === 'bridge' ? before.bidding?.currentBidderSeat : undefined;
    if (!bidder) throw new Error('Expected a bidder');
    const client = players[SEATS.indexOf(bidder)];
    const payload = { gameType: 'bridge' as const, action: { type: 'bid' as const, bid: { type: 'pass' as const } } };
    const emit = client.emit.bind(client) as (event: string, ...args: unknown[]) => void;
    app.resetMetrics();
    emit('game:action', payload);
    emit('game:action', payload, null);
    emit('game:action', payload, {});
    await resume(client);
    expect(games.getGameState(code)).toEqual(before);
    expect(app.metrics.runtimeWrites).toBe(0);
    expect(await client.timeout(5_000).emitWithAck('game:action', payload)).toEqual({ success: true });
  });

  it('keeps every legacy gameplay event as a refresh-only acknowledgment', async () => {
    const app = await (harness = await createSocketHarness(1));
    const players = await startBridge(app);
    const code = app.roomCodes[0];
    const before = structuredClone(games.getGameState(code));
    const saved = await app.repository.loadRuntime();
    const emit = players[0].timeout(5_000).emitWithAck.bind(players[0]) as
      (event: string, ...args: unknown[]) => Promise<ActionResult>;
    const payloadEvents = ['game:redealResponse', 'game:bid', 'game:playCard', 'game:bigtwo:play',
      'game:redpoints:play', 'game:redpoints:chooseFlip', 'game:ninetynine:play', 'game:sevens:play',
      'game:sevens:cover', 'game:chinesepoker:arrange', 'game:liarsdeck:play', 'game:blackjack:bet',
      'game:blackjack:action', 'game:blackjack:dealerAction', 'game:holdem:action', 'game:napoleon:action'];
    app.resetMetrics();
    for (const event of payloadEvents) expect(await emit(event, null))
      .toEqual({ success: false, error: 'Please refresh the page to continue playing.' });
    for (const event of ['game:bigtwo:pass', 'game:liarsdeck:challenge']) expect(await emit(event))
      .toEqual({ success: false, error: 'Please refresh the page to continue playing.' });
    const send = players[0].emit.bind(players[0]) as (event: string, ...args: unknown[]) => void;
    for (const event of payloadEvents) { send(event, {}); send(event, {}, null); }
    send('game:bigtwo:pass');
    send('game:liarsdeck:challenge', null);
    await resume(players[0]);
    expect(games.getGameState(code)).toEqual(before);
    expect(await app.repository.loadRuntime()).toEqual(saved);
    expect(app.metrics.runtimeWrites).toBe(0);
  });

  it('authenticates both unified and legacy actions before dispatch', async () => {
    const app = await (harness = await createSocketHarness(1));
    const [client] = await startBridge(app);
    const code = app.roomCodes[0];
    const before = structuredClone(games.getGameState(code));
    const cookie = app.cookies[0][0];
    await app.repository.deleteSession(tokenHash(cookie.slice(cookie.indexOf('=') + 1)));
    app.resetMetrics();
    expect(await client.timeout(5_000).emitWithAck('game:action', {
      gameType: 'bridge', action: { type: 'bid', bid: { type: 'pass' } },
    })).toEqual({ success: false, error: 'Your session has expired. Please sign in again.' });
    expect(await client.timeout(5_000).emitWithAck('game:bid', { bid: { type: 'pass' } }))
      .toEqual({ success: false, error: 'Your session has expired. Please sign in again.' });
    expect(games.getGameState(code)).toEqual(before);
    expect(app.metrics.runtimeWrites).toBe(0);
    expect(app.metrics.snapshots).toBe(0);
  });

  it('rolls back a failed game action without publishing and permits a retry', async () => {
    const app = await (harness = await createSocketHarness(1));
    const players = await startBridge(app);
    const code = app.roomCodes[0];
    const before = structuredClone(games.getGameState(code));
    const saved = await app.repository.loadRuntime();
    const bidder = before?.gameType === 'bridge' ? before.bidding?.currentBidderSeat : undefined;
    if (!bidder) throw new Error('Expected a bidder');
    const client = players[SEATS.indexOf(bidder)];
    const payload = { gameType: 'bridge' as const, action: { type: 'bid' as const, bid: { type: 'pass' as const } } };
    app.resetMetrics();
    vi.spyOn(app.repository, 'saveRuntime').mockRejectedValueOnce(new Error('Disk full'));
    expect(await client.timeout(5_000).emitWithAck('game:action', payload))
      .toEqual({ success: false, error: 'Unable to save your changes. Please try again.' });
    expect(games.getGameState(code)).toEqual(before);
    expect(await app.repository.loadRuntime()).toEqual(saved);
    expect(app.metrics.snapshots).toBe(0);
    expect(await client.timeout(5_000).emitWithAck('game:action', payload)).toEqual({ success: true });
    const after = await savedGame(app);
    expect(after.log).toHaveLength(before!.log.length + 1);
    expect(after.log.at(-1)).toMatchObject({ type: 'bid', seat: bidder, action: { type: 'pass' } });
    expect(app.metrics.snapshots).toBeGreaterThan(0);
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
    const visitor = app.clients[1][0];
    expect(await visitor.timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
    expect(await visitor.timeout(5_000).emitWithAck('room:join', { roomCode: code }))
      .toMatchObject({ success: true });
    expect(await players[0].timeout(5_000).emitWithAck('room:standUp')).toEqual({ success: true });
    expect(games.getGameState(code)?.returnedSeats ?? []).toEqual([]);
    expect(games.getGameState(code)?.returnedViewers ?? []).toEqual([]);
    expect(await visitor.timeout(5_000).emitWithAck('room:changeSeat', { seat: 'N' })).toEqual({ success: true });
    expect((await resume(visitor)).gameState).toBeUndefined();
    expect((await resume(players[2])).gameState?.phase).toBe('scoring');
    expect(await visitor.timeout(5_000).emitWithAck('room:standUp')).toEqual({ success: true });
    expect(await players[0].timeout(5_000).emitWithAck('room:changeSeat', { seat: 'N' })).toEqual({ success: true });
    expect(await players[0].timeout(5_000).emitWithAck('room:leave')).toEqual({ success: true });
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

  it('checks the original account when deciding whether a seat views its board', () => {
    games.startGame('VIEW01', 'bridge', Object.fromEntries(SEATS.map((seat) => [seat, {
      id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
    }])));
    expect(games.isViewingGame('VIEW01', 'N', 'N')).toBe(true);
    expect(games.isViewingGame('VIEW01', 'N', 'E')).toBe(false);
    games.restoreGames([]);
  });
});
