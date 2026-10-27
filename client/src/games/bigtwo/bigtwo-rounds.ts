import type { HistoryInputOf, RoundBuilder } from '../round-builder';

export function deriveBigTwoRounds(game: HistoryInputOf<'bigtwo'>, builder: RoundBuilder): void {
  for (const entry of game.log) {
    const round = builder.open();
    round.actions.push({ kind: entry.type,
      seat: entry.type === 'round_end' ? entry.leaderSeat : entry.seat,
      cards: entry.type === 'play' ? entry.cards : [],
      ...(entry.type === 'play' ? { comboType: entry.comboType } : {}),
    });
    if (entry.type === 'round_end' || entry.type === 'dragon') {
      round.complete = true;
      builder.release();
    }
  }
}
