import { MAX_ROOM_SEATS, MIN_FLEXIBLE_PLAYERS } from '../../constants/game-rules';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const blackjackDefinition: GameDefinition<'blackjack'> = {
  gameType: 'blackjack',
  category: 'cards',
  equipment: ['cards', 'chips'],
  seats: { minPlayers: MIN_FLEXIBLE_PLAYERS, maxPlayers: MAX_ROOM_SEATS, flexible: true, expandable: true, numbered: false },
  presentation: {
    logFrames: (game, index, key): PresentationFrame[] => {
      const entry = game.log[index];
      switch (entry.type) {
        // Bets stay hidden until the deal, so they have no frame and never delay other bettors.
        case 'bet': return [];
        case 'deal': return [{ key, kind: 'deal', durationMs: 1800, cards: [] }];
        case 'hit':
        case 'double':
          return [{ key, kind: entry.type, durationMs: entry.type === 'hit' ? 1000 : 1300, seat: entry.seat,
            cards: [entry.card], handIndex: entry.handIndex }];
        case 'stand':
          return [{ key, kind: 'stand', durationMs: 700, seat: entry.seat, cards: [], handIndex: entry.handIndex }];
        case 'split':
          return [{ key, kind: 'split', durationMs: 1300, seat: entry.seat, cards: [...entry.cards],
            handIndex: entry.handIndex }];
        case 'reveal': return [{ key, kind: 'dealerReveal', durationMs: 1300, cards: [entry.card] }];
        case 'dealerHit': return [{ key, kind: 'dealerHit', durationMs: 1000, cards: [entry.card] }];
        case 'dealerStand': return [{ key, kind: 'dealerStand', durationMs: 700, cards: [] }];
        case 'settle': return [{ key, kind: 'settle', durationMs: 2500, cards: [] }];
      }
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
