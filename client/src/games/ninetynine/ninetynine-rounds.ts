import type { HistoryInputOf, RoundBuilder } from '../round-builder';

export function deriveNinetyNineRounds(game: HistoryInputOf<'ninetynine'>, builder: RoundBuilder): void {
  let previousTotal = 0;
  for (const entry of game.log) {
    const round = entry.type === 'play' ? builder.start() : builder.open();
    round.complete = true;
    if (entry.type === 'play') {
      round.actions.push({ kind: 'play', seat: entry.seat, cards: [entry.card],
        previousTotal, total: entry.total, choice: entry.choice, target: entry.target });
      previousTotal = entry.total;
    } else round.actions.push({ kind: 'eliminated', seat: entry.seat, cards: [] });
  }
}
