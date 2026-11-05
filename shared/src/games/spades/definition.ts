import { spadesTeam } from '../../rules/spades';
import type { Seat } from '../../types/player';
import type { GameDefinition } from '../game-definition';

export const spadesDefinition: GameDefinition<'spades'> = {
  gameType: 'spades', category: 'cards', equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 4, flexible: false, expandable: false, numbered: false },
  result: { kind: 'team', scoreKind: 'points', standing: (result, seat, seats) => ({
    seat, players: seats.length, rank: null, tied: false, won: result.winners.includes(seat as Seat),
    side: spadesTeam(seat as Seat), role: null, score: result.scores[spadesTeam(seat as Seat)],
  }) },
  presentation: {
    logFrames: (game, index, key, timing) => {
      const entry = game.log[index];
      if (entry.type === 'deal') return [{ key, kind: 'deal', durationMs: 1500, cards: [] }];
      if (entry.type === 'play') return [{ key, kind: 'play', durationMs: timing.playMs, seat: entry.seat, cards: [entry.card] }];
      if (entry.type === 'trick_end') return [{ key, kind: 'trick', durationMs: 2000,
        seat: entry.winnerSeat, cards: entry.cards, cardSeats: entry.cardSeats }];
      if (entry.type === 'hand_end') return [{ key, kind: 'settle', durationMs: 3000, cards: [] }];
      return [];
    },
    finishSeat: () => undefined,
  },
};
