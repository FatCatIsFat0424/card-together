import { thApplyEntry, thEmptyTable, thHalves, thHandKind } from '@shared/rules/tenhalf';
import type { GameSeat } from '@shared/types';
import type { HistoryInputOf, RoundBuilder } from '../round-builder';

/** Each hand is one round; the face-down cards appear only at the showdown row, as in the public log. */
export function deriveTenHalfRounds(game: HistoryInputOf<'tenhalf'>, builder: RoundBuilder): void {
  const table = thEmptyTable(game.seats);
  let autoBets: GameSeat[] = [];
  for (const entry of game.log) {
    if (entry.type === 'bet') {
      if (entry.auto) autoBets.push(entry.seat);
      continue;
    }
    thApplyEntry(table, entry);
    if (entry.type === 'deal') {
      const previous = builder.current();
      if (previous) previous.complete = true;
      const round = builder.start();
      for (const seat of table.dealt) {
        round.actions.push({ kind: 'deal', seat, cards: [], ...(seat === entry.banker
          ? { dealer: true } : { bet: entry.bets[seat], ...(autoBets.includes(seat) ? { auto: true } : {}) }) });
      }
      autoBets = [];
      continue;
    }
    const round = builder.open();
    if (entry.type === 'hit' || entry.type === 'stand') {
      round.actions.push({ kind: entry.type, seat: entry.seat, cards: entry.type === 'hit' ? [entry.card] : [] });
    } else if (entry.type === 'showdown') {
      for (const seat of table.dealt) {
        const hole = entry.holes[seat];
        if (!hole) continue;
        const cards = [hole, ...table.ups[seat]];
        round.actions.push({ kind: 'showdown', seat, cards, handTotal: thHalves(cards), handKind: thHandKind(cards) });
      }
    } else if (entry.type === 'settle') {
      for (const seat of table.dealt) {
        const outcome = entry.outcomes[seat];
        round.actions.push({ kind: 'settle', seat, cards: [], net: entry.net[seat],
          ...(outcome ? { outcomes: [outcome] } : { dealer: true }) });
      }
      round.complete = true;
    }
  }
}
