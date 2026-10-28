import { SEAT_ORDER_CLOCKWISE } from '../../constants/game-rules';
import type { GameSeat, Seat } from '../../types/player';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

const COMPASS: readonly GameSeat[] = SEAT_ORDER_CLOCKWISE;

export const bridgeDefinition: GameDefinition<'bridge'> = {
  gameType: 'bridge',
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 4, flexible: false, expandable: false, numbered: false },
  result: {
    kind: 'team',
    scoreKind: null,
    standing: (result, seat, seats) => {
      const declaring = COMPASS.indexOf(seat) % 2 === SEAT_ORDER_CLOCKWISE.indexOf(result.contract.declarer) % 2;
      return { seat, players: seats.length, rank: null, tied: false, won: declaring === result.declarerTeamWins,
        side: declaring ? 'declarer' : 'defender', score: null,
        role: seat === result.contract.declarer ? 'declarer' : declaring ? 'partner' : 'defender' };
    },
  },
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
