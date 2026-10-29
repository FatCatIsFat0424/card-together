import { GAME_SEAT_ORDER } from '@shared/constants';
import type { HistoryInputOf, RoundBuilder } from '../round-builder';

/** Each deal is one round: the opening discards, every draw, and the settlement. */
export function deriveOldMaidRounds(game: HistoryInputOf<'oldmaid'>, builder: RoundBuilder): void {
  for (const entry of game.log) {
    if (entry.type === 'deal') {
      const previous = builder.current();
      if (previous) previous.complete = true;
      const round = builder.start();
      for (const seat of GAME_SEAT_ORDER) {
        if ((game.seats as readonly string[]).includes(seat)) {
          round.actions.push({ kind: 'deal', seat, cards: entry.discards[seat] });
        }
      }
      continue;
    }
    const round = builder.open();
    if (entry.type === 'draw') {
      round.actions.push({ kind: 'draw', seat: entry.seat, target: entry.from, index: entry.index, cards: entry.discarded });
    } else {
      round.actions.push({ kind: 'settle', seat: entry.loser, cards: [], order: entry.order });
      round.complete = true;
    }
  }
}
