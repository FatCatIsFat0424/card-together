import { GAME_SEAT_ORDER } from '@shared/constants';
import { studApplyEntry, studEmptyTable, studHand } from '@shared/rules/stud';
import type { HistoryInputOf, RoundBuilder } from '../round-builder';
import { studChipsAdded } from './stud-view';

/** Each hand is one round; payouts and categories come from replaying the public log alongside. */
export function deriveStudRounds(game: HistoryInputOf<'stud'>, builder: RoundBuilder): void {
  const table = studEmptyTable(game.seats);
  game.log.forEach((entry, index) => {
    if (entry.type === 'hand') {
      const previous = builder.current();
      if (previous) previous.complete = true;
      const round = builder.start();
      for (const seat of GAME_SEAT_ORDER) {
        if (entry.antes[seat] === 0) continue;
        round.actions.push({ kind: 'ante', seat, cards: [], amount: entry.antes[seat],
          ...(round.actions.length === 0 ? { stakes: { ante: entry.ante, minBet: entry.minBet } } : {}) });
      }
    } else if (entry.type === 'street') {
      const round = builder.open();
      round.actions.push({ kind: 'street', seat: null, cards: [], studStreet: entry.street });
      for (const seat of GAME_SEAT_ORDER) {
        if (entry.cards[seat].length > 0) round.actions.push({ kind: 'deal', seat, cards: entry.cards[seat] });
      }
    } else if (entry.type === 'action') {
      const kind = entry.allIn ? 'allIn' : entry.action;
      builder.open().actions.push({ kind, seat: entry.seat, cards: [],
        ...(kind === 'fold' || kind === 'check' ? {}
          : { amount: kind === 'call' ? studChipsAdded(game.log, index) : entry.to }) });
    } else if (entry.type === 'showdown') {
      const round = builder.open();
      for (const seat of GAME_SEAT_ORDER) {
        const cards = entry.cards[seat];
        if (cards.length === 0) continue;
        round.actions.push({ kind: 'showdown', seat, cards: [...cards, ...table.up[seat]],
          category: studHand(cards, table.up[seat]).category });
      }
    } else {
      const round = builder.open();
      for (const seat of GAME_SEAT_ORDER) {
        const payout = entry.chips[seat] - table.chips[seat];
        if (payout > 0) round.actions.push({ kind: 'award', seat, cards: [], amount: payout });
      }
      for (const seat of entry.eliminated) round.actions.push({ kind: 'eliminated', seat, cards: [] });
      round.complete = true;
    }
    studApplyEntry(table, entry);
  });
}
