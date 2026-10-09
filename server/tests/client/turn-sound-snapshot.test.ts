import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTurnSoundSnapshot } from '../../../client/src/hooks/use-turn-sound';
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
