import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const chinesePokerDefinition: GameDefinition<'chinesepoker'> = {
  gameType: 'chinesepoker',
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 4, flexible: false, expandable: false, numbered: false },
  presentation: {
    // Submissions are private and simultaneous, so only the showdown is presented.
    logFrames: (game, index, key): PresentationFrame[] => {
      const entry = game.log[index];
      if (entry.type === 'reveal') return [{ key, kind: 'reveal', durationMs: 2500, cards: [], row: entry.row }];
      if (entry.type === 'shoot') {
        return [{ key, kind: 'shoot', durationMs: 1500, seat: entry.seat, target: entry.target, cards: [] }];
      }
      if (entry.type === 'homerun') return [{ key, kind: 'homerun', durationMs: 2500, seat: entry.seat, cards: [] }];
      return [];
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
