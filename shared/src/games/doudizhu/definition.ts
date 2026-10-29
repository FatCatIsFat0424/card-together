import { DEFAULT_DOUDIZHU_OPTIONS, isDouDizhuOptions } from '../../doudizhu-options';
import { DDZ_DEALS } from '../../rules/doudizhu';
import { rankedStanding, rankAfterWinners } from '../result-standing';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

/** Landlord reveal, which shows the three bottom cards. */
export const DOUDIZHU_LANDLORD_MS = 2200;

export const douDizhuDefinition: GameDefinition<'doudizhu'> = {
  gameType: 'doudizhu',
  options: {
    defaults: DEFAULT_DOUDIZHU_OPTIONS,
    legacyDefaults: DEFAULT_DOUDIZHU_OPTIONS,
    isValid: isDouDizhuOptions,
  },
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: 3, maxPlayers: 3, flexible: true, expandable: false, numbered: true },
  matchHands: DDZ_DEALS,
  result: {
    kind: 'ranking',
    scoreKind: 'points',
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: rankAfterWinners(seats, result.winners, other, (value) => result.scores[value], false),
      score: result.scores[other],
    })),
  },
  presentation: {
    logFrames: (game, index, key, timing): PresentationFrame[] => {
      const entry = game.log[index];
      switch (entry.type) {
        // The seats show each bid, so bids never hold up the next seat.
        case 'bid':
        case 'claim': return [];
        case 'deal': return [{ key, kind: 'deal', durationMs: 1500, seat: entry.firstCaller, cards: [] }];
        case 'redeal': return [{ key, kind: 'redeal', durationMs: 1500, cards: [] }];
        case 'landlord': return [{ key, kind: 'call', durationMs: DOUDIZHU_LANDLORD_MS, seat: entry.seat, cards: [],
          napoleonCards: entry.bottom }];
        case 'play': return [{ key, kind: 'play', durationMs: timing.playMs, seat: entry.seat, cards: [],
          napoleonCards: entry.cards }];
        case 'pass': return [{ key, kind: 'pass', durationMs: timing.passMs, seat: entry.seat, cards: [] }];
        case 'round_end': {
          const lastPlay = [...game.log.slice(0, index)].reverse().find((event) => event.type === 'play');
          return [{ key, kind: 'round', durationMs: 1000, seat: entry.leaderSeat, cards: [],
            napoleonCards: lastPlay?.type === 'play' ? lastPlay.cards : [] }];
        }
        case 'deal_end': return [{ key, kind: 'settle', durationMs: 3200, seat: entry.landlord, cards: [] }];
      }
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
