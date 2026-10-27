import type { PresentationFrame } from '@shared/game-presentation';
import type { PlayerVisibleGameState } from '@shared/types';
import type { FrameCue } from './game-ui';
import { gameUi } from './ui-registry';

/** Sound a frame triggers when it first appears; a game's own cue wins over the shared rules. */
export function frameCue(game: PlayerVisibleGameState | null, frame: PresentationFrame): FrameCue | null {
  const own = game ? gameUi(game.gameType).presentation?.cue?.(game, frame) : undefined;
  if (own) return own;
  switch (frame.kind) {
    case 'play': case 'capture': case 'reveal': case 'challenge': case 'hit': case 'double': case 'split':
    case 'dealerReveal': case 'dealerHit': case 'street': case 'showdown':
      return 'card';
    case 'pass': case 'cover': case 'fold': case 'check':
      return 'soft';
    case 'eliminated':
      return 'out';
    default:
      return frame.survived === false ? 'out' : null;
  }
}
