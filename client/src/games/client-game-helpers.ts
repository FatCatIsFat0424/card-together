import { SUIT_DISPLAY_ORDER } from '@shared/constants';
import type { GameSeat } from '@shared/types';
import type { GameRulesContextFields } from '../game-rules-context';
import type { GodView } from '../stores/god-view-store';
import type { HandOrder, SpectatorPatch } from './client-game';

/** Rank order of a standard deck, with Aces high. */
export const STANDARD_HAND_ORDER: HandOrder = {
  rank: (card) => card.rank,
  suit: (card) => SUIT_DISPLAY_ORDER.indexOf(card.suit),
};

/** Rules context of a game that has no room options. */
export const NO_RULES_OPTION: GameRulesContextFields = { option: null };

/** The seat's hand from the hands a spectator may see. */
export function spectatorHand(view: GodView, seat: GameSeat): SpectatorPatch {
  return { myHand: [...view.hands?.[seat] ?? []] };
}
