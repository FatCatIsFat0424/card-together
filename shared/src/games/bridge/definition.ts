import type { Seat } from '../../types/player';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const bridgeDefinition: GameDefinition<'bridge'> = {
  gameType: 'bridge',
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 4, flexible: false, expandable: false, numbered: false },
  presentation: {
    logFrames: (game, index, key, timing): PresentationFrame[] => {
      const entry = game.log[index];
      if (entry.type === 'play') {
        return [{ key, kind: 'play', durationMs: timing.playMs, seat: entry.seat, cards: [entry.card] }];
      }
      if (entry.type === 'trick_end') {
        const trick = game.playing?.completedTricks[entry.trickIndex - 1];
        const cardSeats = trick ? Object.keys(trick.cards) as Seat[] : [];
        return [{ key, kind: 'trick', durationMs: 2000, seat: entry.winnerSeat,
          cards: trick ? cardSeats.map((seat) => trick.cards[seat]) : [], cardSeats }];
      }
      return [];
    },
    finishSeat: () => undefined,
  },
};
