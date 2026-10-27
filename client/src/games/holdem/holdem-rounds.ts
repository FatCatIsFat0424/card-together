import { heApplyEntry, heBestHand, heEmptyTable } from '@shared/rules/holdem';
import type { GameSeat } from '@shared/types';
import type { HistoryInputOf, RoundBuilder } from '../round-builder';
import { chipsAdded } from './holdem-view';

const SEATS: readonly GameSeat[] = ['N', 'E', 'S', 'W'];

/** Each hand is one round; payouts and categories come from replaying the public log alongside. */
export function deriveHoldemRounds(game: HistoryInputOf<'holdem'>, builder: RoundBuilder): void {
  const table = heEmptyTable(game.seats);
  game.log.forEach((entry, index) => {
    if (entry.type === 'hand') {
      const previous = builder.current();
      if (previous) previous.complete = true;
      const round = builder.start();
      round.actions.push({ kind: 'button', seat: entry.button, cards: [],
        blinds: { small: entry.smallBlind, big: entry.bigBlind } });
      for (const seat of SEATS) {
        if (entry.blinds[seat] > 0) round.actions.push({ kind: 'blind', seat, cards: [], amount: entry.blinds[seat] });
      }
    } else if (entry.type === 'action') {
      const kind = entry.allIn ? 'allIn' : entry.action;
      builder.open().actions.push({ kind, seat: entry.seat, cards: [],
        ...(kind === 'fold' || kind === 'check' ? {}
          : { amount: kind === 'call' ? chipsAdded(game.log, index) : entry.to }) });
    } else if (entry.type === 'street') {
      builder.open().actions.push({ kind: 'street', seat: null, cards: entry.cards, street: entry.street });
    } else if (entry.type === 'showdown') {
      const round = builder.open();
      for (const seat of SEATS) {
        const cards = entry.cards[seat];
        if (cards.length === 0) continue;
        round.actions.push({ kind: 'showdown', seat, cards,
          ...(cards.length + table.board.length >= 5 ? { category: heBestHand([...cards, ...table.board]).category } : {}) });
      }
    } else {
      const round = builder.open();
      for (const seat of SEATS) {
        const payout = entry.chips[seat] - table.chips[seat];
        if (payout > 0) round.actions.push({ kind: 'award', seat, cards: [], amount: payout });
      }
      for (const seat of entry.eliminated) round.actions.push({ kind: 'eliminated', seat, cards: [] });
      round.complete = true;
    }
    heApplyEntry(table, entry);
  });
}
