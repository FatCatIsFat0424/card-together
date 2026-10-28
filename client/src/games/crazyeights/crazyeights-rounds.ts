import type { HistoryInputOf, RoundBuilder } from '../round-builder';

/** Each hand is one round: the starter, every play, draw and pass, and each seat's leftover points. */
export function deriveCrazyEightsRounds(game: HistoryInputOf<'crazyeights'>, builder: RoundBuilder): void {
  const seats = game.seats;
  for (const entry of game.log) {
    if (entry.type === 'hand') {
      const previous = builder.current();
      if (previous) previous.complete = true;
      builder.start().actions.push({ kind: 'deal', seat: entry.first, cards: [entry.starter] });
    } else if (entry.type === 'play') {
      builder.open().actions.push({ kind: 'play', seat: entry.seat, cards: [entry.card], target: entry.target,
        ...(entry.suit ? { suit: entry.suit } : {}), ...(entry.effect ? { effect: entry.effect } : {}),
        ...(entry.drawn > 0 ? { count: entry.drawn } : {}) });
    } else if (entry.type === 'draw') {
      builder.open().actions.push({ kind: 'hit', seat: entry.seat, cards: [] });
    } else if (entry.type === 'pass') {
      builder.open().actions.push({ kind: 'pass', seat: entry.seat, cards: [] });
    } else {
      const round = builder.open();
      for (const seat of seats) round.actions.push({ kind: 'settle', seat, cards: [], points: entry.points[seat] });
      round.complete = true;
      builder.release();
    }
  }
}
