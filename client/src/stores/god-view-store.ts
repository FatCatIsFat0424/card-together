// ─── God View Store: other seats' hands for spectators and eliminated players ───

import { scopedStore } from './scoped-store';
import type { Card, DiceFace, LiarCard, NapoleonCard, ObserverRole, PlayerVisibleGameState, GameSeat } from '@shared/types';
import { clientGame } from '../games/registry';
import { retainSnapshotValue } from './snapshot-equality';

export interface GodView {
  /** Set once the hands may be shown; an eliminated seat waits for its elimination frame. */
  readonly role: ObserverRole | null;
  readonly hands: Partial<Record<GameSeat, readonly Card[]>> | null;
  readonly covered: Partial<Record<GameSeat, readonly Card[]>> | null;
  readonly liarHands: Partial<Record<GameSeat, readonly LiarCard[]>> | null;
  readonly diceHands: Partial<Record<GameSeat, readonly DiceFace[]>> | null;
  /** Napoleon hands, which may hold jokers */
  readonly napoleonHands: Partial<Record<GameSeat, readonly NapoleonCard[]>> | null;
  /** Blackjack's face-down dealer card */
  readonly hole: Card | null;
}

export const HIDDEN_GOD_VIEW: GodView = {
  role: null, hands: null, covered: null, liarHands: null, diceHands: null, napoleonHands: null, hole: null,
};

function godViewOf(visible: PlayerVisibleGameState, role: ObserverRole): GodView {
  return { ...HIDDEN_GOD_VIEW, role, ...clientGame(visible.gameType).observedView(visible) };
}

/**
 * Hands and covered cards stay as they were while a presentation plays, so god view never
 * shows a result before its frame; an eliminated view opens after the eliminating frame.
 */
export function nextGodView(
  current: GodView, visible: PlayerVisibleGameState | null, locked: boolean,
): GodView {
  const role = visible?.observer;
  if (!visible || !role) return HIDDEN_GOD_VIEW;
  if (locked && (current.role !== null || role === 'eliminated')) return current;
  return retainSnapshotValue(current, godViewOf(visible, role));
}

interface GodViewStore extends GodView {
  update: (visible: PlayerVisibleGameState | null, locked: boolean) => void;
}

export const useGodViewStore = scopedStore<GodViewStore>((set) => ({
  ...HIDDEN_GOD_VIEW,
  update: (visible, locked) => set((state) => {
    const current: GodView = { role: state.role, hands: state.hands, covered: state.covered,
      liarHands: state.liarHands, diceHands: state.diceHands, napoleonHands: state.napoleonHands, hole: state.hole };
    const next = nextGodView(current, visible, locked);
    return next === current ? state : next;
  }),
}));
