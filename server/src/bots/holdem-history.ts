import type { GameSeat, HoldemLogEntry, HoldemStreet } from '@shared/types';

// Reads the public log (every action of the match so far) into per-seat tendencies and a summary of the current
// hand. Hole cards never enter the log before a showdown, so nothing here depends on private information.

export interface Rate {
  readonly hits: number;
  readonly trials: number;
}

/** Posterior mean of a rate when `weight` imaginary observations at `prior` back the real ones. */
export function blendRate(rate: Rate, prior: number, weight: number): number {
  return (rate.hits + prior * weight) / (rate.trials + weight);
}

export interface SeatStats {
  /** Raised preflop when nobody had raised yet. */
  open: Rate;
  /** Raised preflop facing a raise. */
  reraise: Rate;
  /** Went all-in with a raise, per preflop decision. */
  shove: Rate;
  /** Folded preflop to the first raise of a hand. */
  foldToOpen: Rate;
  /** Bet after the flop when checked to. */
  bet: Rate;
  /** Raised a bet after the flop. */
  raise: Rate;
  /** Folded to a bet after the flop. */
  foldToBet: Rate;
}

export type RaiseKind = 'open' | 'reraise' | 'shove';

export interface SeatHand {
  /** Latest preflop raise, or null when the seat never raised this hand. */
  raiseKind: RaiseKind | null;
  /** Called a raise preflop. */
  calledRaise: boolean;
  /** Latest bet or raise on each street. */
  aggression: Partial<Record<HoldemStreet, 'bet' | 'raise'>>;
}

export interface HandSummary {
  preflopRaises: number;
  /** Seats that only called the big blind before any raise. */
  limpers: number;
  /** Raises the viewer made preflop this hand. */
  ownPreflopRaises: number;
  /** The viewer already checked on the current street. */
  checkedThisStreet: boolean;
  seats: Map<GameSeat, SeatHand>;
}

export interface MatchHistory {
  stats: Map<GameSeat, SeatStats>;
  hand: HandSummary;
}

const emptyRate = (): Rate => ({ hits: 0, trials: 0 });

function emptyStats(): SeatStats {
  return {
    open: emptyRate(), reraise: emptyRate(), shove: emptyRate(), foldToOpen: emptyRate(),
    bet: emptyRate(), raise: emptyRate(), foldToBet: emptyRate(),
  };
}

function emptyHand(): HandSummary {
  return { preflopRaises: 0, limpers: 0, ownPreflopRaises: 0, checkedThisStreet: false, seats: new Map() };
}

function count(stats: SeatStats, key: keyof SeatStats, hit: boolean): void {
  const rate = stats[key];
  stats[key] = { hits: rate.hits + (hit ? 1 : 0), trials: rate.trials + 1 };
}

export function readHistory(log: readonly HoldemLogEntry[], viewer: GameSeat): MatchHistory {
  const stats = new Map<GameSeat, SeatStats>();
  let hand = emptyHand();
  let street: HoldemStreet = 'preflop';
  let currentBet = 0;
  const statsOf = (seat: GameSeat): SeatStats => {
    const found = stats.get(seat) ?? emptyStats();
    stats.set(seat, found);
    return found;
  };
  const handOf = (seat: GameSeat): SeatHand => {
    const found = hand.seats.get(seat) ?? { raiseKind: null, calledRaise: false, aggression: {} };
    hand.seats.set(seat, found);
    return found;
  };

  for (const entry of log) {
    if (entry.type === 'hand') {
      hand = emptyHand();
      street = 'preflop';
      currentBet = entry.bigBlind;
    } else if (entry.type === 'street') {
      street = entry.street;
      currentBet = 0;
      hand.checkedThisStreet = false;
    } else if (entry.type === 'action') {
      const { seat, action } = entry;
      const mine = statsOf(seat);
      const seatHand = handOf(seat);
      const aggressive = action === 'bet' || action === 'raise';
      if (street === 'preflop') {
        count(mine, 'shove', aggressive && entry.allIn);
        if (hand.preflopRaises === 0) {
          count(mine, 'open', aggressive);
          if (action === 'call') hand.limpers += 1;
        } else {
          count(mine, 'reraise', aggressive);
          if (hand.preflopRaises === 1) count(mine, 'foldToOpen', action === 'fold');
          if (action === 'call') seatHand.calledRaise = true;
        }
        if (aggressive) {
          seatHand.raiseKind = entry.allIn ? 'shove' : hand.preflopRaises === 0 ? 'open' : 'reraise';
          hand.preflopRaises += 1;
          if (seat === viewer) hand.ownPreflopRaises += 1;
        }
      } else {
        if (currentBet === 0) count(mine, 'bet', aggressive);
        else {
          count(mine, 'raise', aggressive);
          count(mine, 'foldToBet', action === 'fold');
        }
        if (aggressive) seatHand.aggression[street] = currentBet === 0 ? 'bet' : 'raise';
        if (action === 'check' && seat === viewer) hand.checkedThisStreet = true;
      }
      if (aggressive) currentBet = Math.max(currentBet, entry.to);
    }
  }
  return { stats, hand };
}

export function statsOfSeat(history: MatchHistory, seat: GameSeat): SeatStats {
  return history.stats.get(seat) ?? emptyStats();
}

export function handOfSeat(history: MatchHistory, seat: GameSeat): SeatHand {
  return history.hand.seats.get(seat) ?? { raiseKind: null, calledRaise: false, aggression: {} };
}
