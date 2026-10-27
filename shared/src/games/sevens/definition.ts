import type { SevensLogEntry } from '../../types/game';
import { SEVENS_COLLAPSE_MS, SEVENS_COLLAPSE_SETTLE_MS, SEVENS_SLAY_FRAME_MS, sevensSlayEffect } from '../../sevens-options';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import { FINAL_RESULT_MS, PRESENTATION_TIMING_VERSION } from '../presentation';
import type { PresentationFrame } from '../presentation';

/** Slay frame length before the dragon and fire effects had their own durations. */
const LEGACY_SLAY_FRAME_MS = 2400;

function isAutoCover(entry: SevensLogEntry | undefined): boolean {
  return entry?.type === 'cover' && entry.auto === true;
}

export const sevensDefinition: GameDefinition<'sevens'> = {
  gameType: 'sevens',
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 4, flexible: false, expandable: false, numbered: false },
  presentation: {
    logFrames: (game, index, key, timing): PresentationFrame[] => {
      const entry = game.log[index];
      if (entry.type === 'play') {
        const frames: PresentationFrame[] = [
          { key, kind: 'play', durationMs: timing.playMs, seat: entry.seat, cards: [entry.card] },
        ];
        // Under Dragon Slaying an A or K always reaches its row end, which closes the whole suit.
        if (game.options?.closeOnEnd && (entry.card.rank === 14 || entry.card.rank === 13)) {
          const durationMs = timing.timingVersion === PRESENTATION_TIMING_VERSION
            ? SEVENS_SLAY_FRAME_MS[sevensSlayEffect(game.options)]
            : LEGACY_SLAY_FRAME_MS;
          frames.push({ key: `${key}:slay`, kind: 'slay', durationMs, seat: entry.seat, cards: [entry.card] });
        }
        return frames;
      }
      if (!entry.auto) return [{ key, kind: 'cover', durationMs: timing.passMs, seat: entry.seat, cards: [] }];
      // The remaining hands are covered all at once, shown as the table collapsing rather than card by card.
      return isAutoCover(game.log[index - 1]) ? [] : [{ key, kind: 'collapse', durationMs: SEVENS_COLLAPSE_MS, cards: [] }];
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
    // After a collapse the broken table holds briefly instead of showing the usual closing frame.
    finishMs: (game) => (game.log.some(isAutoCover) ? SEVENS_COLLAPSE_SETTLE_MS : FINAL_RESULT_MS),
  },
};
