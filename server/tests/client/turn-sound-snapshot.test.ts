import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChineseCheckersMove, ChineseCheckersVisibleState, GameSeat } from '../../../shared/src/types';
import { BOARD_TURN_CUE_DELAY_MS, getTurnSoundSnapshot } from '../../../client/src/hooks/use-turn-sound';
import { useAccountStore } from '../../../client/src/stores/account-store';
import { useGameStore } from '../../../client/src/stores/game-store';
import { useRoomStore } from '../../../client/src/stores/room-store';

vi.mock('../../../client/src/stores/account-store', async () => {
  const { create } = await import('zustand');
  return { useAccountStore: create(() => ({ status: 'authenticated', connection: 'ready' })) };
});

afterEach(() => {
  vi.restoreAllMocks();
  useGameStore.getState().reset();
  useRoomStore.getState().leaveRoom();
  useAccountStore.setState({ status: 'authenticated', connection: 'ready' });
});

describe('turn sound snapshot', () => {
  it('waits for presentation to finish before exposing an owned turn', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    useRoomStore.setState({ currentRoomCode: 'ROOM', mySeat: 'N' });
    useGameStore.getState().restore({
      gameType: 'bigtwo', phase: 'playing', mySeat: 'N', myHand: [],
      handCounts: { N: 1, E: 1, S: 1, W: 1 }, currentTurnSeat: 'N',
      lastPlay: null, lockedSeats: [], firstPlay: false, result: null, revealedHands: null,
      presentation: { id: 'round', startedAt: 5000, serverNow: 5000, logStart: 0 },
      log: [{ type: 'round_end', leaderSeat: 'N', timestamp: 5000 }],
    });
    expect(getTurnSoundSnapshot().turn).toBeNull();
    clock.mockReturnValue(2999);
    expect(getTurnSoundSnapshot().turn).toBeNull();
    clock.mockReturnValue(3000);
    expect(getTurnSoundSnapshot().turn).not.toBeNull();
  });

  it('should identify only actionable owned turns and ignore unrelated updates', () => {
    useRoomStore.setState({ currentRoomCode: 'ROOM', mySeat: 'N' });
    useGameStore.setState({ gameType: 'bridge', phase: 'bidding', currentTurnSeat: 'N' });
    const turn = getTurnSoundSnapshot().turn;
    expect(turn).not.toBeNull();
    useGameStore.setState((state) => ({ log: [...state.log, { type: 'system', message: 'unchanged', timestamp: 1 }] }));
    expect(getTurnSoundSnapshot().turn).toBe(turn);
    useGameStore.setState({ phase: 'scoring' });
    expect(getTurnSoundSnapshot().turn).toBeNull();
    useGameStore.setState({ phase: 'playing' });
    useAccountStore.setState({ connection: 'connecting' });
    expect(getTurnSoundSnapshot().turn).toBeNull();
    useAccountStore.setState({ connection: 'ready' });
    useRoomStore.setState({ mySeat: null });
    expect(getTurnSoundSnapshot().turn).toBeNull();
    useRoomStore.getState().leaveRoom();
    expect(getTurnSoundSnapshot().turn).toBeNull();
  });
});

describe('board turn sound snapshot', () => {
  const step = (seat: GameSeat, extra: Partial<ChineseCheckersMove> = { from: '0,0', to: '1,1' }): ChineseCheckersMove =>
    ({ seat, timestamp: 1, ...extra });
  const checkers = (turn: GameSeat, log: ChineseCheckersMove[], extra: Partial<ChineseCheckersVisibleState> = {}): void => {
    useGameStore.getState().restore({
      gameType: 'chinesecheckers', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'W'], corners: [0, 2, 4],
      holes: new Array(121).fill(null), currentTurnSeat: turn, drawOffer: { offeredBy: null, cooldown: {} },
      resigned: [], log, result: null, ...extra,
    });
  };

  it('should give every three-player Chinese checkers turn its own cue, including skipped and resigned seats', () => {
    useRoomStore.setState({ currentRoomCode: 'ROOM', mySeat: 'N' });
    checkers('N', []);
    const first = getTurnSoundSnapshot();
    expect(first.turn).not.toBeNull();
    expect(first.delayMs).toBe(BOARD_TURN_CUE_DELAY_MS);
    checkers('E', [step('N')]);
    expect(getTurnSoundSnapshot().turn).toBeNull();
    checkers('N', [step('N'), step('E'), step('W')]);
    const second = getTurnSoundSnapshot().turn;
    expect(second).not.toBeNull();
    expect(second).not.toBe(first.turn);
    // Both opponents blocked: the turn comes straight back in one snapshot and still cues again.
    const blocked = [step('N'), step('E'), step('W'), step('N'), step('E', {}), step('W', {})];
    checkers('N', blocked);
    const third = getTurnSoundSnapshot().turn;
    expect(third).not.toBe(second);
    checkers('N', [...blocked, step('N'), step('E', { resigned: true }), step('W')], { resigned: ['E'] });
    expect(getTurnSoundSnapshot().turn).not.toBe(third);
  });

  it('should not cue spectators or a seat that resigned', () => {
    useRoomStore.setState({ currentRoomCode: 'ROOM', mySeat: null });
    checkers('N', [], { observer: 'spectator' });
    expect(getTurnSoundSnapshot().turn).toBeNull();
    useRoomStore.setState({ mySeat: 'N' });
    expect(getTurnSoundSnapshot().turn).toBeNull();
    checkers('E', [step('N', { resigned: true })], { resigned: ['N'] });
    expect(getTurnSoundSnapshot().turn).toBeNull();
  });

  it('should keep one cue while the viewer goes on with the same turn', () => {
    useRoomStore.setState({ currentRoomCode: 'ROOM', mySeat: 'N' });
    // A Banqi capture chain: the capturing seat keeps the turn after its own capture.
    useGameStore.setState({ gameType: 'banqi', phase: 'playing', currentTurnSeat: 'N',
      banqi: { log: [{ seat: 'E', to: 'a1', timestamp: 1 }] } as never });
    const chainStart = getTurnSoundSnapshot().turn;
    expect(chainStart).not.toBeNull();
    useGameStore.setState({ banqi: { log: [{ seat: 'E', to: 'a1', timestamp: 1 },
      { seat: 'N', from: 'a2', to: 'a3', captured: 3, timestamp: 2 }] } as never });
    expect(getTurnSoundSnapshot().turn).toBe(chainStart);
    expect(getTurnSoundSnapshot().delayMs).toBe(BOARD_TURN_CUE_DELAY_MS);
    // Card tables keep cueing at once.
    useGameStore.setState({ gameType: 'ninetynine', banqi: null, ninetyNine: { log: [] } as never });
    expect(getTurnSoundSnapshot().delayMs).toBe(0);
  });
});
