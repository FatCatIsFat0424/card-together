import { DEFAULT_NAPOLEON_OPTIONS, isNapoleonOptions } from '../../napoleon-options';
import type { StandingRole } from '../../rules/match-standing';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

/** Napoleon secretary-card announcement and summon notices. */
export const NAPOLEON_NOTICE_MS = 2000;

export const napoleonDefinition: GameDefinition<'napoleon'> = {
  gameType: 'napoleon',
  options: {
    defaults: DEFAULT_NAPOLEON_OPTIONS,
    legacyDefaults: DEFAULT_NAPOLEON_OPTIONS,
    isValid: isNapoleonOptions,
  },
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 6, flexible: true, expandable: true, numbered: true },
  result: {
    kind: 'roles',
    scoreKind: null,
    standing: (result, seat, seats) => {
      const role: StandingRole = seat === result.contract.napoleon ? 'napoleon'
        : seat === result.secretarySeat ? 'secretary' : 'defender';
      return { seat, players: seats.length, rank: null, tied: false, won: result.winners.includes(seat),
        side: role === 'defender' ? 'defender' : 'declarer', role, score: null };
    },
  },
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
