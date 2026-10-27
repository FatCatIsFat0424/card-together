import type { HistoryInputOf, RoundBuilder } from '../round-builder';

/** Every seat acts once per rotation, so each four actions form one round. */
export function deriveSevensRounds(game: HistoryInputOf<'sevens'>, builder: RoundBuilder): void {
  game.log.forEach((entry, index) => {
    const round = index % 4 === 0 ? builder.start() : builder.open();
    round.actions.push({ kind: entry.type, seat: entry.seat, cards: entry.type === 'play' ? [entry.card] : [] });
    if (round.actions.length === 4) {
      round.complete = true;
      builder.release();
    }
  });
}
