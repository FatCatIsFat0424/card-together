import type { AnyGameState, PlayerVisibleGameState } from './types/game';
import type { GamePresentationRules } from './games/game-definition';
import { gameDefinition } from './games/registry';
import { FINAL_RESULT_MS, frameTiming } from './games/presentation';
import type { PresentationFrame } from './games/presentation';

export { PRESENTATION_TIMING_VERSION } from './games/presentation';
export type { PresentationFrame } from './games/presentation';
export { NAPOLEON_NOTICE_MS } from './games/napoleon/definition';

/** Reconstructs only public events; private hands and stock never enter presentation frames. */
export function getPresentationFrames(
  game: AnyGameState | PlayerVisibleGameState,
): PresentationFrame[] {
  if (!game.presentation) return [];
  const { id, logStart, timingVersion } = game.presentation;
  // Each game's rules accept both its server state and its filtered view, matching `game` by type.
  const rules: GamePresentationRules<typeof game.gameType> = gameDefinition(game.gameType).presentation;
  const timing = frameTiming(timingVersion);
  const frames: PresentationFrame[] = [];
  for (let index = logStart; index < game.log.length; index++) {
    frames.push(...rules.logFrames(game, index, `${id}:${index}`, timing));
  }
  if (game.phase === 'scoring') {
    const seat = rules.finishSeat(game);
    const lastCards = [...frames].reverse().find((frame) => frame.cards.length > 0 || (frame.jokerCards?.length ?? 0) > 0);
    frames.push({ key: `${id}:finish`, kind: 'finish', durationMs: rules.finishMs?.(game) ?? FINAL_RESULT_MS,
      cards: lastCards?.cards ?? [],
      ...(lastCards?.jokerCards ? { jokerCards: lastCards.jokerCards } : {}),
      ...(lastCards?.cardSeats ? { cardSeats: lastCards.cardSeats } : {}),
      ...(seat ? { seat } : {}) });
  }
  return frames;
}

export function getPresentationEndsAt(game: AnyGameState | PlayerVisibleGameState): number {
  if (!game.presentation) return 0;
  return game.presentation.startedAt
    + getPresentationFrames(game).reduce((duration, frame) => duration + frame.durationMs, 0);
}

/** Log index a frame presents, or null for the closing result frame; keys are `${id}:${index}[:part]`. */
export function frameLogIndex(frame: PresentationFrame): number | null {
  const index = Number(frame.key.split(':')[1]);
  return Number.isInteger(index) ? index : null;
}
