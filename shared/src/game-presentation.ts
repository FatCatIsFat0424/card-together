import type { AnyGameState, Card, PlayerVisibleGameState } from './types/game';
import type { Seat } from './types/player';
import { rpScore } from './rules/redpoints';

export interface PresentationFrame {
  readonly key: string;
  readonly kind: 'play' | 'pass' | 'trick' | 'round' | 'capture' | 'eliminated' | 'finish';
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
    const seat = game.gameType === 'bigtwo' || game.gameType === 'ninetynine'
      ? game.result?.winnerSeat : undefined;
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
