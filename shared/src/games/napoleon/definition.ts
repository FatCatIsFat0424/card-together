import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

/** Napoleon secretary-card announcement and summon notices. */
export const NAPOLEON_NOTICE_MS = 2000;

export const napoleonDefinition: GameDefinition<'napoleon'> = {
  gameType: 'napoleon',
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 6, flexible: true, expandable: true, numbered: true },
  presentation: {
    logFrames: (game, index, key, timing): PresentationFrame[] => {
      const entry = game.log[index];
      if (entry.type === 'call') {
        return [{ key, kind: 'call', durationMs: NAPOLEON_NOTICE_MS, seat: entry.seat, cards: [],
          napoleonCards: [entry.card] }];
      }
      if (entry.type === 'play') {
        const frames: PresentationFrame[] = [
          { key, kind: 'play', durationMs: timing.playMs, seat: entry.seat, cards: [], napoleonCards: [entry.card] },
        ];
        if (entry.summon) {
          frames.push({ key: `${key}:summon`, kind: 'summon', durationMs: NAPOLEON_NOTICE_MS, seat: entry.seat, cards: [],
            napoleonCards: [entry.card], summon: entry.summon });
        }
        return frames;
      }
      if (entry.type === 'trick_end') {
        const trick = game.tricks[entry.trickIndex - 1];
        return [{ key, kind: 'trick', durationMs: 2000, seat: entry.winnerSeat, cards: [],
          napoleonCards: trick?.plays.map((play) => play.card) ?? [], cardSeats: trick?.plays.map((play) => play.seat) ?? [] }];
      }
      return [];
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
