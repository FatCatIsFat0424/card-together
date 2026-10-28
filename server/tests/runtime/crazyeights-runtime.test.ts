import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { getPresentationEndsAt, getPresentationFrames } from '@shared/game-presentation';
import type { GameSeat, PlayerInfo, Seat } from '@shared/types';
import type { CrazyEightsGameState } from '@shared/games/crazyeights/types';
import * as decisions from '../../src/bots/bot-decisions';
import * as games from '../../src/managers/game-manager';
import * as players from '../../src/managers/player-manager';
import * as rooms from '../../src/managers/room-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { startTurnTimers } from '../../src/runtime/turn-timers';
import { BOT_ACTION_DELAY_MS, startBotTurns } from '../../src/runtime/bot-turns';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

const CODE = 'CER001';
const SEATS: readonly GameSeat[] = GAME_SEAT_ORDER.slice(0, 4);
const info = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
});
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, info(seat)]));

function crazyEights(code = CODE): CrazyEightsGameState {
  const game = games.getGameState(code);
  if (game?.gameType !== 'crazyeights') throw new Error('Expected a Crazy Eights game');
  return game;
}

describe('Crazy Eights through the game manager', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); games.restoreGames([]); });
  afterEach(() => { games.restoreGames([]); vi.useRealTimers(); });

  it('presents the opening deal before the first turn and rejects early or foreign actions', () => {
    expect(games.startGame(CODE, 'crazyeights', PLAYERS, { baseSeconds: 5, bankSeconds: 20 }, { crazyeights: { actionCards: true } }))
      .toEqual({ success: true });
    const game = crazyEights();
    expect(game.options).toEqual({ actionCards: true });
    expect(game.presentation?.logStart).toBe(0);
    expect(getPresentationFrames(game).map((frame) => frame.kind)).toEqual(['deal']);
    expect(game.clock?.turn?.startsAt).toBe(getPresentationEndsAt(game));
    const seat = game.currentTurnSeat;
    const card = game.hands[seat][0];
    expect(games.handleGameAction(CODE, seat, { gameType: 'crazyeights', action: { type: 'play', card, suit: 'hearts' } }, true))
      .toEqual({ success: false, reason: 'Please wait for the current action to finish.' });
    expect(games.handleGameAction(CODE, seat, { gameType: 'ninetynine', action: { type: 'play', card } }, true))
      .toEqual({ success: false, reason: 'This action is not available in this game.' });
  });

  it('derives public frames for a wild, an action card, a draw and a hand end', () => {
    games.startGame(CODE, 'crazyeights', PLAYERS, undefined, { crazyeights: { actionCards: true } });
    const game = crazyEights();
    game.presentation = { id: 'p', startedAt: 0, logStart: 0, timingVersion: 3 };
    game.log.push(
      { type: 'play', seat: 'N', card: { suit: 'clubs', rank: 8 }, suit: 'hearts', effect: null, target: null, drawn: 0, timestamp: 1 },
      { type: 'play', seat: 'W', card: { suit: 'hearts', rank: 2 }, suit: null, effect: 'draw', target: 'S', drawn: 2, timestamp: 2 },
      { type: 'draw', seat: 'E', timestamp: 3 },
      { type: 'pass', seat: 'E', timestamp: 3 },
      { type: 'handEnd', hand: 1, winner: 'N', points: Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, 0])) as never, timestamp: 4 },
    );
    const frames = getPresentationFrames(game);
    expect(frames.map((frame) => frame.kind)).toEqual(['deal', 'play', 'play', 'hit', 'pass', 'settle']);
    expect(frames[1]).toMatchObject({ seat: 'N', suit: 'hearts', durationMs: 1900 });
    expect(frames[2]).toMatchObject({ seat: 'W', effect: 'draw', target: 'S', count: 2 });
    expect(frames[3]).toMatchObject({ seat: 'E', count: 1, cards: [] });
    expect(frames[5]).toMatchObject({ seat: 'N' });
    expect(JSON.stringify(frames)).not.toContain('"hands"');
  });

  it('shows spectators every hand and no seat anyone else’s', () => {
    games.startGame(CODE, 'crazyeights', PLAYERS);
    const game = crazyEights();
    const spectator = games.getRecipientVisibleState(CODE, null);
    expect(spectator?.gameType === 'crazyeights' && spectator.observer).toBe('spectator');
    expect(spectator?.gameType === 'crazyeights' && spectator.observedHands).toEqual(game.hands);
    for (const seat of SEATS) {
      const view = games.getRecipientVisibleState(CODE, seat);
      expect(view).not.toHaveProperty('observer');
      expect(view).not.toHaveProperty('observedHands');
      expect(view?.gameType === 'crazyeights' && view.myHand).toEqual(game.hands[seat]);
    }
  });

  it('keeps the hand, stock count, scores and direction across a restart', () => {
    games.startGame(CODE, 'crazyeights', PLAYERS, undefined, { crazyeights: { actionCards: true } });
    const before = structuredClone(crazyEights());
    const stored = JSON.parse(JSON.stringify(games.exportGames())) as ReturnType<typeof games.exportGames>;
    games.restoreGames(stored);
    expect(crazyEights()).toEqual(before);
    expect(games.getPlayerVisibleState(CODE, 'N')).toMatchObject({ gameType: 'crazyeights', hand: 1, stockCount: before.stock.length });
  });

  it('ends without a record when aborted', () => {
    games.startGame(CODE, 'crazyeights', PLAYERS);
    games.abortGame(CODE);
    expect(games.getGameState(CODE)).toBeNull();
  });
});

describe('Crazy Eights turn automation', () => {
  const stops: (() => void)[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
  afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.restoreAllMocks(); games.restoreGames([]); vi.useRealTimers(); });

  async function fixture(bots: boolean) {
    let saved: RuntimeSnapshot | null = null;
    const repository = {
      loadRuntime: async (): Promise<RuntimeSnapshot | null> => structuredClone(saved),
      saveRuntime: vi.fn(async (state: RuntimeSnapshot): Promise<void> => {
        expect(isRuntimeSnapshot(state)).toBe(true);
        saved = structuredClone(state);
      }),
    };
    const runtime = await createRuntimeCoordinator(repository);
    let code = '';
    await runtime.mutate(() => {
      code = rooms.createRoom('crazyeights', 'N');
      const human = info('N');
      players.attachPlayer('socket', human);
      players.setPlayerRoom(human.id, code);
      rooms.changeSeat(code, human, 'N');
      if (bots) {
        rooms.fillBots(code, human.id);
        rooms.setReady(code, human.id, true);
      } else {
        for (const seat of SEATS.slice(1)) {
          players.attachPlayer(seat, info(seat));
          players.setPlayerRoom(seat, code);
          rooms.joinRoom(code, seat);
          rooms.changeSeat(code, info(seat), seat as Seat);
        }
      }
      rooms.setRoomStatus(code, 'playing');
      games.startGame(code, 'crazyeights', rooms.getSeatPlayers(code)!, { baseSeconds: 5, bankSeconds: 20 });
    });
    return { code, runtime, saved: () => saved! };
  }

  it('commits one filtered legal action when a human runs out of time', async () => {
    const { code, runtime, saved } = await fixture(false);
    const game = (): CrazyEightsGameState => crazyEights(code);
    const turn = game().clock!.turn!;
    const choose = vi.spyOn(decisions, 'getBotAction');
    const publish = vi.fn(() => expect(saved().games[0]).toEqual(game()));
    stops.push(await startTurnTimers(runtime, publish));
    await vi.advanceTimersByTimeAsync(turn.deadline - Date.now() - 1);
    expect(publish).not.toHaveBeenCalled();
    const before = game().log.length;
    await vi.advanceTimersByTimeAsync(1);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game().log.length).toBeGreaterThan(before);
    expect(choose.mock.calls[0][0]).not.toHaveProperty('hands');
    expect(choose.mock.calls[0][0]).not.toHaveProperty('stock');
    expect(game().clock!.lastTimeout).toMatchObject({ seat: turn.seat });
  });

  it('lets bots play through a private view and commits before publishing', async () => {
    const { code, runtime, saved } = await fixture(true);
    const game = (): CrazyEightsGameState => crazyEights(code);
    // A bot holds the turn and the opening deal is over.
    await runtime.mutate(() => {
      game().currentTurnSeat = 'E';
      delete game().presentation;
      delete game().clock;
      games.initializeClock(code);
    });
    const choose = vi.spyOn(decisions, 'getBotAction');
    const publish = vi.fn(() => expect(saved().games[0]).toEqual(game()));
    stops.push(startBotTurns(runtime, publish));
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS + 50);
    await runtime.idle();
    expect(choose).toHaveBeenCalled();
    expect(choose.mock.calls[0][0]).not.toHaveProperty('hands');
    expect(choose.mock.calls[0][0]).not.toHaveProperty('stock');
    expect(game().log.length).toBeGreaterThan(1);
    expect(publish).toHaveBeenCalled();
  });
});
