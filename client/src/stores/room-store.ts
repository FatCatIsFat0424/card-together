// ─── Room Store ───

import { scopedStore } from './scoped-store';
import type { RoomCode, RoomInfo, GameSeat } from '@shared/types';
import { retainSnapshotValue } from './snapshot-equality';

interface RoomStoreState {
  currentRoomCode: RoomCode | null;
  roomInfo: RoomInfo | null;
  mySeat: GameSeat | null;
  /** Server clock minus local clock from the last snapshot with a replay session. */
  replayClockOffset: number;
}

interface RoomStoreActions {
  setRoom: (roomCode: RoomCode, roomInfo: RoomInfo) => void;
  updateRoomInfo: (roomInfo: RoomInfo) => void;
  setMySeat: (seat: GameSeat | null) => void;
  setReplayClockOffset: (offset: number) => void;
  leaveRoom: () => void;
}

const initialState: RoomStoreState = {
  currentRoomCode: null,
  roomInfo: null,
  mySeat: null,
  replayClockOffset: 0,
};

export const useRoomStore = scopedStore<RoomStoreState & RoomStoreActions>((set) => ({
  ...initialState,
  setRoom: (roomCode, roomInfo) => set((state) => {
    const nextRoom = retainSnapshotValue(state.roomInfo, roomInfo);
    return state.currentRoomCode === roomCode && state.roomInfo === nextRoom
      ? state : { currentRoomCode: roomCode, roomInfo: nextRoom };
  }),
  updateRoomInfo: (roomInfo) => set((state) => {
    const nextRoom = retainSnapshotValue(state.roomInfo, roomInfo);
    return state.roomInfo === nextRoom ? state : { roomInfo: nextRoom };
  }),
  setMySeat: (seat) => set((state) => state.mySeat === seat ? state : { mySeat: seat }),
  setReplayClockOffset: (offset) => set((state) =>
    state.replayClockOffset === offset ? state : { replayClockOffset: offset }),
  leaveRoom: () => set((state) => state.currentRoomCode === null && state.roomInfo === null &&
    state.mySeat === null && state.replayClockOffset === 0 ? state : initialState),
}));
