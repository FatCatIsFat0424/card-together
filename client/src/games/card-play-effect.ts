import type { PresentationFrame } from '@shared/game-presentation';
import type { PlayerVisibleGameState } from '@shared/types';
import { gameUi } from './ui-registry';

export type CardPlayEffectKind = 'bomb' | 'straightFlush' | 'secretary' | 'bigJoker' | 'smallJoker' | 'reset' | 'redAce';

export interface CardPlayEffect {
  readonly kind: CardPlayEffectKind;
}

/** Only rare combinations and a mode's exceptional cards receive decorative feedback. */
export function cardPlayEffect(game: PlayerVisibleGameState, frame: PresentationFrame): CardPlayEffect | null {
  if (frame.kind !== 'play' && frame.kind !== 'capture') return null;
  return gameUi(game.gameType).presentation?.playEffect?.(game, frame) ?? null;
}

export const CARD_EFFECT_DURATION_MS = 1000;

/** A late mount resumes the effect; it never creates another animation window. */
export function cardEffectElapsed(elapsedMs: number, frameDurationMs: number): number | null {
  const elapsed = Math.max(0, elapsedMs);
  return elapsed < Math.min(CARD_EFFECT_DURATION_MS, frameDurationMs) ? elapsed : null;
}
