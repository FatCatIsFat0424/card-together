import { bjApplyEntry, bjEmptyTable, bjTotal } from '@shared/rules/blackjack';
import type { GameSeat } from '@shared/types';
import type { HistoryInputOf, RoundBuilder } from '../round-builder';

const SEATS: readonly GameSeat[] = ['N', 'E', 'S', 'W'];

/** Each hand is one round; totals come from replaying the public log alongside. */
export function deriveBlackjackRounds(game: HistoryInputOf<'blackjack'>, builder: RoundBuilder): void {
  const table = bjEmptyTable(game.seats);
  let autoBets: GameSeat[] = [];
  for (const entry of game.log) {
    if (entry.type === 'bet') {
      if (entry.auto) autoBets.push(entry.seat);
      continue;
    }
    bjApplyEntry(table, entry);
    if (entry.type === 'deal') {
      const previous = builder.current();
      if (previous) previous.complete = true;
      const round = builder.start();
      for (const seat of SEATS) {
        if (entry.bets[seat] === 0) continue;
        round.actions.push({ kind: 'deal', seat, cards: entry.cards[seat], bet: entry.bets[seat],
          handTotal: bjTotal(entry.cards[seat]).total, ...(autoBets.includes(seat) ? { auto: true } : {}) });
      }
      round.actions.push({ kind: 'deal', seat: null, cards: [entry.upCard] });
      autoBets = [];
      continue;
    }
    const round = builder.open();
    if (entry.type === 'hit' || entry.type === 'double' || entry.type === 'stand' || entry.type === 'split') {
      const hands = table.hands[entry.seat];
      round.actions.push({ kind: entry.type, seat: entry.seat,
        cards: entry.type === 'stand' ? [] : entry.type === 'split' ? entry.cards : [entry.card],
        ...(hands.length > 1 && entry.type !== 'split' ? { handIndex: entry.handIndex } : {}),
        ...(entry.type === 'split' ? {} : { handTotal: bjTotal(hands[entry.handIndex].cards).total }) });
    } else if (entry.type === 'reveal' || entry.type === 'dealerHit') {
      round.actions.push({ kind: entry.type === 'reveal' ? 'dealerReveal' : 'dealerHit', seat: null,
        cards: [entry.card], handTotal: bjTotal(table.dealer).total });
    } else if (entry.type === 'dealerStand') {
      round.actions.push({ kind: 'dealerStand', seat: null, cards: [], handTotal: bjTotal(table.dealer).total });
    } else if (entry.type === 'settle') {
      for (const seat of SEATS) {
        if (entry.outcomes[seat].length === 0) continue;
        round.actions.push({ kind: 'settle', seat, cards: [], outcomes: entry.outcomes[seat], net: entry.net[seat] });
      }
      // A player dealer's row records the chips it collected or paid.
      if (table.dealerSeat) {
        round.actions.push({ kind: 'settle', seat: table.dealerSeat, cards: [], net: entry.net[table.dealerSeat],
          dealer: true });
      }
      round.complete = true;
    }
  }
}
