import type { HistoryInputOf, RoundBuilder } from '../round-builder';

/** Each round is one history entry: who led, every tile, draw and pass, and each seat's leftover pips. */
export function deriveDominoesRounds(game: HistoryInputOf<'dominoes'>, builder: RoundBuilder): void {
  for (const entry of game.log) {
    if (entry.type === 'round') {
      const previous = builder.current();
      if (previous) previous.complete = true;
      builder.start().actions.push({ kind: 'deal', seat: entry.leader, cards: [] });
    } else if (entry.type === 'play') {
      builder.open().actions.push({ kind: 'play', seat: entry.seat, cards: [], tile: entry.tile });
    } else if (entry.type === 'draw') {
      builder.open().actions.push({ kind: 'hit', seat: entry.seat, cards: [] });
    } else if (entry.type === 'pass') {
      builder.open().actions.push({ kind: 'pass', seat: entry.seat, cards: [] });
    } else {
      const round = builder.open();
      for (const seat of game.seats) {
        const pips = entry.hands[seat].reduce((sum, tile) => sum + tile[0] + tile[1], 0);
        round.actions.push({ kind: 'settle', seat, cards: [], points: pips, ...(seat === entry.winner ? { total: entry.points } : {}) });
      }
      round.complete = true;
      builder.release();
    }
  }
}
