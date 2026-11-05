import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPresentationEndsAt } from '@shared/game-presentation';
import type { GameSeat, PlayerInfo, Seat } from '@shared/types';
import * as games from '../../src/managers/game-manager';
import { getTurnSeat } from '../../src/managers/game-clock';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import { applyAutomatedAction, firstLegalAction } from '../../src/runtime/automated-action';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { startTurnTimers } from '../../src/runtime/turn-timers';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

const TRICK_GAMES = ['hearts', 'gongzhu', 'spades'] as const;
const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const SETTINGS = { baseSeconds: 5, bankSeconds: 10 };
const human = (seat: Seat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
});

/** Simultaneous submissions and ordinary turns both use the recipient's own filtered view. */
function nextAction(code: string): { seat: GameSeat; action: NonNullable<ReturnType<typeof firstLegalAction>> } {
  for (const seat of SEATS) {
    const view = games.getPlayerVisibleState(code, seat);
    const action = view && firstLegalAction(view);
    if (action) return { seat, action };
  }
  throw new Error('Expected a pending trick-game action');
}

describe('trick-game durable turn timers', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
    games.restoreGames([]);
    rooms.restoreRooms([]);
    players.restorePlayers([]);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(TRICK_GAMES)('refills %s on a new hand and executes a restored timeout exactly once', async (gameType) => {
    vi.useFakeTimers({ now: 100_000 });
    let saved: RuntimeSnapshot | null = null;
    const repository = {
      loadRuntime: async (): Promise<RuntimeSnapshot | null> => structuredClone(saved),
      saveRuntime: vi.fn(async (snapshot: RuntimeSnapshot): Promise<void> => {
        expect(isRuntimeSnapshot(snapshot)).toBe(true);
        saved = structuredClone(snapshot);
      }),
    };
    const runtime = await createRuntimeCoordinator(repository);
    let code = '';
    await runtime.mutate(() => {
      code = rooms.createRoom(gameType, 'N');
      for (const seat of SEATS) {
        const info = human(seat);
        players.attachPlayer(seat, info);
        players.setPlayerRoom(seat, code);
        if (seat !== 'N') expect(rooms.joinRoom(code, seat).success).toBe(true);
        expect(rooms.changeSeat(code, info, seat).success).toBe(true);
      }
      rooms.setRoomStatus(code, 'playing');
      expect(games.startGame(code, gameType, rooms.getSeatPlayers(code)!, SETTINGS)).toEqual({ success: true });
    });
    const game = (): NonNullable<ReturnType<typeof games.getGameState>> => games.getGameState(code)!;
    const deals = (): number => game().log.filter((entry) => 'type' in entry && entry.type === 'deal').length;
    const act = async (): Promise<void> => {
      vi.setSystemTime(Math.max(Date.now(), getPresentationEndsAt(game())) + 1);
      const next = nextAction(code);
      await runtime.mutate(() => expect(applyAutomatedAction(code, next.seat, next.action)).toEqual({ success: true }));
    };
    // Hearts starts with a shared passing window; complete it before charging one actor's bank.
    for (let step = 0; step < 4 && getTurnSeat(game()) === null; step++) await act();
    const first = game().clock!.turn!;
    expect(first.startsAt).toBeGreaterThanOrEqual(getPresentationEndsAt(game()));
    vi.setSystemTime(first.startsAt + SETTINGS.baseSeconds * 1000 + 2_000);
    const next = nextAction(code);
    await runtime.mutate(() => expect(applyAutomatedAction(code, next.seat, next.action)).toEqual({ success: true }));
    expect(game().clock!.bankRemainingMs[first.seat]).toBe(8_000);
    for (let step = 0; step < 60 && deals() === 1; step++) await act();
    expect(deals()).toBe(2);
    expect(SEATS.map((seat) => game().clock!.bankRemainingMs[seat])).toEqual(SEATS.map(() => 10_000));
    for (let step = 0; step < 4 && getTurnSeat(game()) === null; step++) await act();
    const turn = game().clock!.turn!;
    expect(turn.startsAt).toBeGreaterThanOrEqual(getPresentationEndsAt(game()));
    const logLength = game().log.length;
    games.restoreGames([]);
    const resumed = await createRuntimeCoordinator(repository);
    const publish = vi.fn(() => expect(saved?.games[0]).toEqual(game()));
    stop = await startTurnTimers(resumed, publish);
    await vi.advanceTimersByTimeAsync(turn.deadline - Date.now() - 1);
    expect(publish).not.toHaveBeenCalled();
    expect(game().log).toHaveLength(logLength);
    await vi.advanceTimersByTimeAsync(1);
    await resumed.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game().log).toHaveLength(logLength + 1);
    expect(game().clock?.lastTimeout?.seat).toBe(turn.seat);
    expect(game().clock?.turn?.id).not.toBe(turn.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
