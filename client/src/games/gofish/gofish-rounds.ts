import type { HistoryInputOf, RoundBuilder } from '../round-builder';

/** Each hand is one round: every ask with its result, the books laid down, and each seat's book count. */
export function deriveGoFishRounds(game: HistoryInputOf<'gofish'>, builder: RoundBuilder): void {
  const seats = game.seats;
  for (const entry of game.log) {
    if (entry.type === 'hand') {
      const previous = builder.current();
      if (previous) previous.complete = true;
      builder.start().actions.push({ kind: 'deal', seat: entry.first, cards: [] });
    } else if (entry.type === 'ask') {
      builder.open().actions.push({ kind: 'ask', seat: entry.seat, cards: [], target: entry.target, rank: entry.rank,
        count: entry.given, fished: entry.fished });
    } else if (entry.type === 'book') {
      builder.open().actions.push({ kind: 'book', seat: entry.seat, cards: [], rank: entry.rank });
    } else if (entry.type === 'refill') {
      builder.open().actions.push({ kind: 'hit', seat: entry.seat, cards: [] });
    } else {
      const round = builder.open();
      for (const seat of seats) round.actions.push({ kind: 'settle', seat, cards: [], points: entry.books[seat] });
      round.complete = true;
      builder.release();
    }
  }
}
