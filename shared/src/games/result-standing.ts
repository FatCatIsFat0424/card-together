import type { GameSeat, Seat } from '../types';
import type { MatchStanding } from '../rules/match-standing';

/** Games without a `seats` list only ever use compass seats. */
export function compassScore(values: Readonly<Record<Seat, number>>, seat: GameSeat): number {
  return values[seat as Seat];
}

/** Winners share first, then each seat ranks by how many others are strictly ahead of it. */
export function rankAfterWinners(
  seats: readonly GameSeat[], winners: readonly GameSeat[], seat: GameSeat,
  value: (seat: GameSeat) => number, lowerIsBetter: boolean,
): number {
  if (winners.includes(seat)) return 1;
  const ahead = seats.filter((other) => !winners.includes(other)
    && (lowerIsBetter ? value(other) < value(seat) : value(other) > value(seat))).length;
  return winners.length + 1 + ahead;
}

export interface RankedFinish {
  readonly rank: number;
  readonly score: number | null;
}

export function rankedStanding(
  seats: readonly GameSeat[], seat: GameSeat, finish: (seat: GameSeat) => RankedFinish,
): MatchStanding {
  const { rank, score } = finish(seat);
  const tied = seats.some((other) => other !== seat && finish(other).rank === rank);
  return { seat, players: seats.length, rank, tied, won: rank === 1, side: null, role: null, score };
}

/** Chip-race match: busted seats rank by elimination order, survivors by their remaining chips. */
export function chipRaceStanding(
  result: {
    readonly chips: Readonly<Record<GameSeat, number>>;
    readonly winners: readonly GameSeat[];
    readonly eliminationOrder: readonly GameSeat[];
  },
  seat: GameSeat, seats: readonly GameSeat[], startingChips: number,
): MatchStanding {
  const survivors = seats.filter((other) => !result.eliminationOrder.includes(other));
  return rankedStanding(seats, seat, (other) => {
    const out = result.eliminationOrder.indexOf(other);
    return { rank: out >= 0 ? seats.length - out
      : rankAfterWinners(survivors, result.winners, other, (member) => result.chips[member], false),
    score: result.chips[other] - startingChips };
  });
}
