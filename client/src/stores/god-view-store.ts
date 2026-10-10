// ─── God View Store: other seats' hands for spectators and eliminated players ───

import { create } from 'zustand';
import type { Card, LiarCard, ObserverRole, PlayerVisibleGameState, Seat } from '@shared/types';
import { retainSnapshotValue } from './snapshot-equality';

export interface GodView {
  /** Set once the hands may be shown; an eliminated seat waits for its elimination frame. */
  readonly role: ObserverRole | null;
  readonly hands: Record<Seat, readonly Card[]> | null;
  readonly covered: Record<Seat, readonly Card[]> | null;
  readonly liarHands: Record<Seat, readonly LiarCard[]> | null;
  /** Blackjack's face-down dealer card */
  readonly hole: Card | null;
}

export const HIDDEN_GOD_VIEW: GodView = { role: null, hands: null, covered: null, liarHands: null, hole: null };

function godViewOf(visible: PlayerVisibleGameState, role: ObserverRole): GodView {
  if (visible.gameType === 'blackjack') return { ...HIDDEN_GOD_VIEW, role, hole: visible.observedHole ?? null };
  if (visible.gameType === 'liarsdeck') return { ...HIDDEN_GOD_VIEW, role, liarHands: visible.observedHands ?? null };
  if (visible.gameType === 'sevens') return { ...HIDDEN_GOD_VIEW, role,
    hands: visible.observedHands ?? null, covered: visible.observedCovered ?? null };
  return { ...HIDDEN_GOD_VIEW, role, hands: visible.observedHands ?? null };
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

export const useGodViewStore = create<GodViewStore>((set) => ({
  ...HIDDEN_GOD_VIEW,
  update: (visible, locked) => set((state) => {
    const current: GodView = { role: state.role, hands: state.hands, covered: state.covered,
      liarHands: state.liarHands, hole: state.hole };
    const next = nextGodView(current, visible, locked);
    return next === current ? state : next;
  }),
}));
