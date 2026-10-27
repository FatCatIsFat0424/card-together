import { rpScore } from '@shared/rules/redpoints';
import type { HistoryInputOf, RoundBuilder } from '../round-builder';

export function deriveRedPointsRounds(game: HistoryInputOf<'redpoints'>, builder: RoundBuilder): void {
  for (const entry of game.log) {
    const previous = builder.current();
    if (entry.type === 'play' && previous) previous.complete = true;
    const round = entry.type === 'play' ? builder.start() : builder.open();
    round.actions.push({ kind: entry.type, seat: entry.seat, cards: [entry.card],
      captured: entry.captured,
      points: entry.captured ? rpScore([entry.card, entry.captured]) : 0,
    });
    if (entry.type === 'flip') {
      round.complete = true;
      builder.release();
    }
  }
  const open = builder.current();
  if (game.pendingFlip) {
    builder.open().actions.push({ kind: 'flip', seat: game.currentTurnSeat,
      cards: [game.pendingFlip], pending: true });
  } else if (open && open.actions[0]?.seat !== game.currentTurnSeat) {
    open.complete = true;
  }
}
