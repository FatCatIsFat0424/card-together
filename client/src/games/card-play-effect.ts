import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { identifyCombo } from '@shared/rules/bigtwo';
import { isNapoleonFinalTrick, isNapoleonJoker, sameNapoleonCard } from '@shared/rules/napoleon';
import type { PlayerVisibleGameState } from '@shared/types';

export type CardPlayEffectKind = 'bomb' | 'straightFlush' | 'secretary' | 'bigJoker' | 'smallJoker' | 'reset' | 'redAce';

export interface CardPlayEffect {
  readonly kind: CardPlayEffectKind;
}

/** Only rare combinations and a mode's exceptional cards receive decorative feedback. */
export function cardPlayEffect(game: PlayerVisibleGameState, frame: PresentationFrame): CardPlayEffect | null {
  if (frame.kind !== 'play' && frame.kind !== 'capture') return null;
  const card = frame.cards[0];
  if (game.gameType === 'bigtwo' && frame.kind === 'play') {
    const combo = identifyCombo(frame.cards);
    if (combo?.type === 'straightFlush') return { kind: 'straightFlush' };
    if (combo?.type === 'fourOfAKind') return { kind: 'bomb' };
  } else if (game.gameType === 'napoleon' && frame.kind === 'play') {
    const played = frame.napoleonCards?.[0];
    const index = frameLogIndex(frame);
    if (!played || index === null || index < 0 || index >= game.log.length) return null;
    if (game.secretaryCard && sameNapoleonCard(played, game.secretaryCard)) return { kind: 'secretary' };
    if (isNapoleonJoker(played)) {
      // The committed trick list can already include the trick this frame is still showing.
      const trickIndex = game.log.slice(0, index).filter((entry) => entry.type === 'trick_end').length;
      if (isNapoleonFinalTrick(trickIndex, game.seats.length)) return null;
      return { kind: played.joker === 'big' ? 'bigJoker' : 'smallJoker' };
    }
  } else if (game.gameType === 'ninetynine' && frame.kind === 'play' && card) {
    if (card.rank === 14 && card.suit === 'spades') return { kind: 'reset' };
  } else if (game.gameType === 'redpoints' && frame.kind === 'capture') {
    const redCards = frame.cards.filter((item) => item.suit === 'hearts' || item.suit === 'diamonds');
    if (redCards.some((item) => item.rank === 14)) return { kind: 'redAce' };
  }
  return null;
}

export const CARD_EFFECT_DURATION_MS = 1000;

/** A late mount resumes the effect; it never creates another animation window. */
export function cardEffectElapsed(elapsedMs: number, frameDurationMs: number): number | null {
  const elapsed = Math.max(0, elapsedMs);
  return elapsed < Math.min(CARD_EFFECT_DURATION_MS, frameDurationMs) ? elapsed : null;
}
