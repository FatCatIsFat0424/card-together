import type { GameType } from '../types';

/**
 * Version of the record definitions below. Adding a record raises it, and the new record carries the
 * new version: stored counters keep their values and the new record starts at zero when an account's
 * counters first move to that version (`GameStats.versionSince`). Never renumber or reuse record IDs.
 */
export const STATS_VERSION = 1;

/** Where a record's facts come from: the stored result, or the log of the replay's final frame. */
export type StatsSource = 'result' | 'log';

/**
 * `count` adds occurrences, `total` adds a signed amount, `max`/`min` keep the best single match.
 * Remembered counts also keep the latest match that added to them, so it can be replayed.
 */
export type StatsRecordKind = 'count' | 'total' | 'max' | 'min';

export interface StatsRecordDefinition {
  readonly id: string;
  readonly source: StatsSource;
  readonly kind: StatsRecordKind;
  readonly remember?: true;
  /** The definitions version that introduced the record */
  readonly version: number;
}

function record(id: string, source: StatsSource, kind: StatsRecordKind, remember = false): StatsRecordDefinition {
  return { id, source, kind, version: 1, ...(remember ? { remember: true as const } : {}) };
}

/**
 * Special records shown per game, in display order. Only facts the engine records publicly are used:
 * played combinations, revealed showdowns and settled results, never undisclosed cards.
 */
export const STATS_RECORDS: Readonly<Record<GameType, readonly StatsRecordDefinition[]>> = {
  bridge: [
    record('slams', 'result', 'count', true),
    record('topContract', 'result', 'max'),
    record('ntMade', 'result', 'count'),
  ],
  bigtwo: [
    record('dragons', 'result', 'count', true),
    record('topCollect', 'result', 'max'),
    record('straightFlushes', 'log', 'count'),
    record('fourOfAKinds', 'log', 'count'),
    record('fullHouses', 'log', 'count'),
    record('caughtTwos', 'result', 'count'),
  ],
  redpoints: [
    record('topPoints', 'result', 'max'),
    record('hundreds', 'result', 'count', true),
    record('heartAces', 'log', 'count'),
    record('diamondAces', 'log', 'count'),
  ],
  ninetynine: [
    record('sharedWins', 'result', 'count', true),
    record('spadeAces', 'log', 'count'),
    record('kings', 'log', 'count'),
    record('knockouts', 'log', 'count'),
  ],
  sevens: [
    record('clean', 'result', 'count', true),
    record('lowPenalty', 'result', 'min'),
    record('highPenalty', 'result', 'max'),
    record('slays', 'log', 'count'),
  ],
  chinesepoker: [
    record('shoots', 'result', 'count'),
    record('homeRuns', 'result', 'count', true),
    record('straightFlushRows', 'result', 'count'),
    record('fourOfAKindRows', 'result', 'count'),
    record('topScore', 'result', 'max'),
  ],
  liarsdeck: [
    record('survivedShots', 'log', 'count'),
    record('shotsInWin', 'result', 'max'),
    record('caughtLies', 'log', 'count'),
    record('honestCalled', 'log', 'count'),
  ],
  blackjack: [
    record('topChips', 'result', 'max'),
    record('blackjacks', 'log', 'count'),
    record('bestHand', 'log', 'max'),
    record('dealerNet', 'log', 'total'),
  ],
  holdem: [
    record('bestShowdown', 'log', 'max'),
    record('biggestPot', 'log', 'max'),
    record('knockouts', 'log', 'count'),
    record('allInWins', 'log', 'count'),
  ],
  napoleon: [
    record('soloWins', 'result', 'count', true),
    record('topContract', 'result', 'max'),
    record('allSixteen', 'result', 'count', true),
    record('ntMade', 'result', 'count'),
  ],
  tenhalf: [
    record('topChips', 'result', 'max'),
    record('specialHands', 'log', 'count'),
    record('bestHand', 'log', 'max'),
    record('bankerNet', 'log', 'total'),
  ],
};

/**
 * Counters behind the per-game figures (not shown as records). `log` ones count only logged matches;
 * every other key in `GameStats.counts`/`sums` comes from the result.
 */
export const LOG_METRICS: Readonly<Partial<Record<GameType, readonly string[]>>> = {
  blackjack: ['handsPlayed', 'busts'],
  holdem: ['showdowns', 'showdownWins'],
  tenhalf: ['handsPlayed', 'busts'],
};

/** Suits in contract order, for encoding contracts as comparable numbers. */
const CONTRACT_SUITS = ['clubs', 'diamonds', 'hearts', 'spades', 'nt'] as const;

export type ContractSuit = typeof CONTRACT_SUITS[number];

/** A made contract as a number that orders by level, then suit. */
export function encodeContract(level: number, suit: ContractSuit): number {
  return level * CONTRACT_SUITS.length + CONTRACT_SUITS.indexOf(suit);
}

export function decodeContract(value: number): { readonly level: number; readonly suit: ContractSuit } {
  return { level: Math.floor(value / CONTRACT_SUITS.length), suit: CONTRACT_SUITS[value % CONTRACT_SUITS.length] };
}
