import type { HistoryInputOf, RoundBuilder } from '../round-builder';

/** Each deal is one round: the auction, the landlord reveal, the plays, and the settlement. */
export function deriveDouDizhuRounds(game: HistoryInputOf<'doudizhu'>, builder: RoundBuilder): void {
  for (const entry of game.log) {
    switch (entry.type) {
      case 'deal': {
        if (entry.redeal === 0) {
          const previous = builder.current();
          if (previous) previous.complete = true;
          builder.start();
        }
        builder.open().actions.push({ kind: 'deal', seat: entry.firstCaller, cards: [] });
        break;
      }
      case 'bid':
        builder.open().actions.push({ kind: 'bid', seat: entry.seat, cards: [], ddzBid: { kind: 'score', value: entry.score } });
        break;
      case 'claim':
        builder.open().actions.push({ kind: 'bid', seat: entry.seat, cards: [], ddzBid: { kind: 'claim', value: Number(entry.take) } });
        break;
      case 'redeal':
        builder.open().actions.push({ kind: 'redeal', seat: null, cards: [] });
        break;
      case 'landlord':
        builder.open().actions.push({ kind: 'call', seat: entry.seat, cards: entry.bottom, amount: entry.base });
        break;
      case 'play':
        builder.open().actions.push({ kind: 'play', seat: entry.seat, cards: entry.cards, ddzCombo: entry.combo.type });
        break;
      case 'pass':
        builder.open().actions.push({ kind: 'pass', seat: entry.seat, cards: [] });
        break;
      case 'round_end':
        break;
      case 'deal_end': {
        const round = builder.open();
        for (const seat of game.seats) {
          round.actions.push({ kind: 'settle', seat, cards: [], net: entry.scores[seat], ...(seat === entry.landlord ? {
            ddzDeal: { landlord: entry.landlord, landlordWins: entry.landlordWins, multiplier: entry.multiplier,
              spring: entry.spring, antiSpring: entry.antiSpring, bombs: entry.bombs },
          } : {}) });
        }
        round.complete = true;
        builder.release();
        break;
      }
    }
  }
}
