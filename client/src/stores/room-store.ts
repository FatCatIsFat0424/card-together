// ─── Room Store ───

import { create } from 'zustand';
import type { RoomCode, RoomInfo, Seat } from '@shared/types';
import { retainSnapshotValue } from './snapshot-equality';

interface RoomStoreState {
  currentRoomCode: RoomCode | null;
  roomInfo: RoomInfo | null;
  mySeat: Seat | null;
}

interface RoomStoreActions {
  setRoom: (roomCode: RoomCode, roomInfo: RoomInfo) => void;
  updateRoomInfo: (roomInfo: RoomInfo) => void;
  setMySeat: (seat: Seat | null) => void;
  leaveRoom: () => void;
}

const initialState: RoomStoreState = {
  currentRoomCode: null,
  roomInfo: null,
  mySeat: null,
};

export const useRoomStore = create<RoomStoreState & RoomStoreActions>((set) => ({
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
  leaveRoom: () => set((state) => state.currentRoomCode === null && state.roomInfo === null &&
    state.mySeat === null ? state : initialState),
}));
