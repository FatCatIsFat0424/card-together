import type {
  AnyGameState, Card, ChinesePokerRow, LiarFace, LiarTableFace, PlayerVisibleGameState,
} from './types/game';
import type { Seat } from './types/player';
import { rpScore } from './rules/redpoints';

export interface PresentationFrame {
  readonly key: string;
  readonly kind: 'play' | 'pass' | 'trick' | 'round' | 'capture' | 'eliminated' | 'cover' | 'reveal' | 'shoot'
    | 'homerun' | 'deal' | 'challenge' | 'roulette' | 'shot' | 'finish';
  readonly durationMs: number;
  readonly seat?: Seat;
  readonly cards: readonly Card[];
  readonly cardSeats?: readonly Seat[];
  readonly total?: number;
  readonly previousTotal?: number;
  readonly points?: number;
  readonly target?: Seat;
  readonly passedSeats?: readonly Seat[];
  readonly direction?: 'ccw' | 'cw';
  readonly choice?: 'plus' | 'minus' | null;
  readonly flipped?: boolean;
  /** Chinese Poker row revealed by this frame */
  readonly row?: ChinesePokerRow;
  /** Liar's Deck: face-down cards played */
  readonly count?: number;
  /** Liar's Deck: the round's table face */
  readonly tableFace?: LiarTableFace;
  /** Liar's Deck: the challenged play, revealed */
  readonly liarFaces?: readonly LiarFace[];
  readonly lied?: boolean;
  /** Liar's Deck: the shooter's trigger pull count including this one */
  readonly shot?: number;
  /** Liar's Deck: present only on the frame that resolves the pull */
  readonly survived?: boolean;
}

/** Reconstructs only public events; private hands and stock never enter presentation frames. */
export function getPresentationFrames(
  game: AnyGameState | PlayerVisibleGameState,
): PresentationFrame[] {
  if (!game.presentation) return [];
  const { id, logStart } = game.presentation;
  // New plays include 300 ms arrival plus one full second of readable results.
  const playDuration = game.presentation.timingVersion === 2 ? 1300 : 400;
  const passDuration = game.presentation.timingVersion === 2 ? 1000 : 350;
  const frames: PresentationFrame[] = [];
  for (let index = logStart; index < game.log.length; index++) {
    const key = `${id}:${index}`;
    if (game.gameType === 'bridge') {
      const entry = game.log[index];
      if (entry.type === 'play') {
        frames.push({ key, kind: 'play', durationMs: playDuration, seat: entry.seat, cards: [entry.card] });
      } else if (entry.type === 'trick_end') {
        const trick = game.playing?.completedTricks[entry.trickIndex - 1];
        const cardSeats = trick ? Object.keys(trick.cards) as Seat[] : [];
        frames.push({ key, kind: 'trick', durationMs: 2000, seat: entry.winnerSeat,
          cards: trick ? cardSeats.map((seat) => trick.cards[seat]) : [], cardSeats });
      }
    } else if (game.gameType === 'bigtwo') {
      const entry = game.log[index];
      if (entry.type === 'play') {
        frames.push({ key, kind: 'play', durationMs: playDuration, seat: entry.seat, cards: entry.cards });
      } else if (entry.type === 'pass') {
        frames.push({ key, kind: 'pass', durationMs: passDuration, seat: entry.seat, cards: [] });
      } else if (entry.type === 'round_end') {
        const preceding = game.log.slice(0, index);
        const lastPlay = [...preceding].reverse().find((event) => event.type === 'play');
        let previousRound = preceding.length - 1;
        while (previousRound >= 0 && preceding[previousRound].type !== 'round_end') previousRound--;
        const passedSeats = preceding.slice(previousRound + 1)
          .filter((event) => event.type === 'pass').map((event) => event.seat);
        frames.push({ key, kind: 'round', durationMs: 2000, seat: entry.leaderSeat,
          cards: lastPlay?.type === 'play' ? lastPlay.cards : [], passedSeats });
      }
    } else if (game.gameType === 'redpoints') {
      const entry = game.log[index];
      const cards = entry.captured ? [entry.card, entry.captured] : [entry.card];
      frames.push({ key, kind: entry.captured ? 'capture' : 'play', durationMs: 1900,
        seat: entry.seat, cards, flipped: entry.type === 'flip', points: entry.captured ? rpScore(cards) : 0 });
    } else if (game.gameType === 'sevens') {
      const entry = game.log[index];
      if (entry.type === 'play') {
        frames.push({ key, kind: 'play', durationMs: playDuration, seat: entry.seat, cards: [entry.card] });
      } else {
        frames.push({ key, kind: 'cover', durationMs: passDuration, seat: entry.seat, cards: [] });
      }
    } else if (game.gameType === 'chinesepoker') {
      // Submissions are private and simultaneous, so only the showdown is presented.
      const entry = game.log[index];
      if (entry.type === 'reveal') {
        frames.push({ key, kind: 'reveal', durationMs: 2500, cards: [], row: entry.row });
      } else if (entry.type === 'shoot') {
        frames.push({ key, kind: 'shoot', durationMs: 1500, seat: entry.seat, target: entry.target, cards: [] });
      } else if (entry.type === 'homerun') {
        frames.push({ key, kind: 'homerun', durationMs: 2500, seat: entry.seat, cards: [] });
      }
    } else if (game.gameType === 'liarsdeck') {
      const entry = game.log[index];
      if (entry.type === 'round') {
        frames.push({ key, kind: 'deal', durationMs: 2000, seat: entry.starter, cards: [], tableFace: entry.tableFace });
      } else if (entry.type === 'play') {
        frames.push({ key, kind: 'play', durationMs: playDuration, seat: entry.seat, cards: [], count: entry.count });
      } else if (entry.type === 'challenge') {
        frames.push({ key, kind: 'challenge', durationMs: 2500, seat: entry.seat, target: entry.target, cards: [],
          liarFaces: entry.revealed, lied: entry.lied });
      } else {
        // The suspense frame carries no outcome so the table cannot reveal it early.
        frames.push({ key, kind: 'roulette', durationMs: 2500, seat: entry.seat, cards: [], shot: entry.shot });
        frames.push({ key: `${key}:result`, kind: 'shot', durationMs: 1500, seat: entry.seat, cards: [],
          shot: entry.shot, survived: entry.survived });
      }
    } else {
      const entry = game.log[index];
      if (entry.type === 'play') {
        const previousPlay = game.log.slice(0, index).reverse()
          .find((event) => event.type === 'play');
        const previousTotal = previousPlay?.type === 'play' ? previousPlay.total : 0;
        frames.push({ key, kind: 'play', durationMs: 1900, seat: entry.seat,
          cards: [entry.card], total: entry.total, previousTotal, direction: game.direction, choice: entry.choice, ...(entry.target ? { target: entry.target } : {}) });
      } else {
        frames.push({ key, kind: 'eliminated', durationMs: 2500, seat: entry.seat, cards: [] });
      }
    }
  }
  if (game.phase === 'scoring') {
    const winners = (game.gameType === 'sevens' || game.gameType === 'chinesepoker') && game.result
      ? game.result.winners : [];
    const seat = game.gameType === 'bigtwo' || game.gameType === 'ninetynine' || game.gameType === 'liarsdeck'
      ? game.result?.winnerSeat : winners.length === 1 ? winners[0] : undefined;
    const lastCards = [...frames].reverse().find((frame) => frame.cards.length > 0);
    frames.push({ key: `${id}:finish`, kind: 'finish', durationMs: 3000,
      cards: lastCards?.cards ?? [],
      ...(lastCards?.cardSeats ? { cardSeats: lastCards.cardSeats } : {}),
      ...(seat ? { seat } : {}) });
  }
  return frames;
}

export function getPresentationEndsAt(game: AnyGameState | PlayerVisibleGameState): number {
  if (!game.presentation) return 0;
  return game.presentation.startedAt
    + getPresentationFrames(game).reduce((duration, frame) => duration + frame.durationMs, 0);
}

/** Log index a frame presents, or null for the closing result frame; keys are `${id}:${index}[:part]`. */
export function frameLogIndex(frame: PresentationFrame): number | null {
  const index = Number(frame.key.split(':')[1]);
  return Number.isInteger(index) ? index : null;
}
