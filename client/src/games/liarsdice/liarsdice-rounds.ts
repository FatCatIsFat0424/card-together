import type { HistoryInputOf, RoundBuilder } from '../round-builder';

export function deriveLiarsDiceRounds(game: HistoryInputOf<'liarsdice'>, builder: RoundBuilder): void {
  for (const entry of game.log) {
    if (entry.type === 'round') {
      const open = builder.current();
      if (open) open.complete = true;
      builder.start().diceInPlay = Object.values(entry.counts).reduce((sum, count) => sum + count, 0);
      continue;
    }
    const round = builder.open();
    if (entry.type === 'bid') {
      round.actions.push({ kind: 'bid', seat: entry.seat, cards: [], bid: { quantity: entry.quantity, face: entry.face } });
    } else {
      round.actions.push({ kind: 'challenge', seat: entry.seat, cards: [], target: entry.target,
        bid: { quantity: entry.quantity, face: entry.face }, found: entry.count, bidTrue: entry.bidTrue,
        loser: entry.loser, eliminated: entry.eliminated });
      round.complete = true;
    }
  }
}
