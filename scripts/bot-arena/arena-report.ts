import type { MatchRecord, Side, SideTally } from './arena-match';

export interface SideSummary {
  /** Seat-matches this side played in finished matches. */
  readonly seats: number;
  /** Of those, seats that finished first or on the winning side (ties count for everyone tied). */
  readonly wins: number;
  /** Mean of the game's own score per seat, when the game has one. */
  readonly meanScore: number | null;
  readonly decisions: number;
  readonly meanMs: number;
  readonly maxMs: number;
  readonly fallbacks: number;
}

export interface ArenaSummary {
  readonly matches: number;
  readonly unfinished: number;
  /** Candidate wins as a share of all wins; 0.5 when the sides are equally strong. */
  readonly candidateShare: number;
  readonly sides: Readonly<Record<Side, SideSummary>>;
  readonly pairs: {
    readonly complete: number;
    readonly candidateBoth: number;
    readonly baselineBoth: number;
    /** Each side won one match, or both matches were even. */
    readonly split: number;
    /** Pairs with a net winner (including a win and an even match): candidate ahead and baseline ahead. */
    readonly candidateAhead: number;
    readonly baselineAhead: number;
    /** Two-sided sign test on the pairs with a net winner; small values mean the difference is not luck. */
    readonly signTestP: number;
  };
  readonly errors: readonly string[];
  readonly fallbackReasons: readonly string[];
}

/** +1 when the candidate's seats won at a higher rate than the baseline's in this match, -1 lower, 0 even. */
function matchOutcome(record: MatchRecord): number {
  const rate = (side: Side): number => {
    const seats = record.seats!.filter((seat) => seat.side === side);
    return seats.filter((seat) => seat.won).length / seats.length;
  };
  return Math.sign(rate('candidate') - rate('baseline'));
}

function logChoose(n: number, k: number, logFactorials: readonly number[]): number {
  return logFactorials[n] - logFactorials[k] - logFactorials[n - k];
}

/** Exact two-sided binomial test of `wins` against `losses` at even odds. */
export function signTestPValue(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const logFactorials = [0];
  for (let index = 1; index <= n; index++) logFactorials.push(logFactorials[index - 1] + Math.log(index));
  let tail = 0;
  for (let k = 0; k <= Math.min(wins, losses); k++) tail += Math.exp(logChoose(n, k, logFactorials) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

function sideSummary(records: readonly MatchRecord[], side: Side): SideSummary {
  const outcomes = records.flatMap((record) => record.seats ?? []).filter((seat) => seat.side === side);
  const scores = outcomes.flatMap((seat) => (seat.score === null ? [] : [seat.score]));
  const tally = records.reduce<SideTally>((sum, record) => ({
    decisions: sum.decisions + record.tally[side].decisions,
    totalMs: sum.totalMs + record.tally[side].totalMs,
    maxMs: Math.max(sum.maxMs, record.tally[side].maxMs),
    fallbacks: sum.fallbacks + record.tally[side].fallbacks,
  }), { decisions: 0, totalMs: 0, maxMs: 0, fallbacks: 0 });
  return {
    seats: outcomes.length,
    wins: outcomes.filter((seat) => seat.won).length,
    meanScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    decisions: tally.decisions,
    meanMs: tally.decisions ? tally.totalMs / tally.decisions : 0,
    maxMs: tally.maxMs,
    fallbacks: tally.fallbacks,
  };
}

export function summarize(records: readonly MatchRecord[]): ArenaSummary {
  const finished = records.filter((record) => record.seats !== null);
  const candidate = sideSummary(records, 'candidate');
  const baseline = sideSummary(records, 'baseline');
  const byPair = new Map<number, MatchRecord[]>();
  for (const record of finished) byPair.set(record.pair, [...byPair.get(record.pair) ?? [], record]);
  const pairs = [...byPair.values()].filter((pair) => pair.length === 2).map((pair) => pair.map(matchOutcome));
  const candidateAhead = pairs.filter(([a, b]) => a + b > 0).length;
  const baselineAhead = pairs.filter(([a, b]) => a + b < 0).length;
  return {
    matches: finished.length,
    unfinished: records.length - finished.length,
    candidateShare: candidate.wins + baseline.wins ? candidate.wins / (candidate.wins + baseline.wins) : 0.5,
    sides: { candidate, baseline },
    pairs: {
      complete: pairs.length,
      candidateBoth: pairs.filter(([a, b]) => a > 0 && b > 0).length,
      baselineBoth: pairs.filter(([a, b]) => a < 0 && b < 0).length,
      split: pairs.filter(([a, b]) => a + b === 0).length,
      candidateAhead,
      baselineAhead,
      signTestP: signTestPValue(candidateAhead, baselineAhead),
    },
    errors: records.flatMap((record) => (record.error ? [`pair ${record.pair}${record.swapped ? ' (swapped)' : ''}: ${record.error}`] : [])),
    fallbackReasons: records.flatMap((record) => record.fallbackReasons),
  };
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** Human-readable report; `header` lines describe the run. */
export function formatSummary(summary: ArenaSummary, header: readonly string[]): string {
  const { pairs, sides } = summary;
  const side = (name: Side): string => {
    const stats = sides[name];
    const score = stats.meanScore === null ? '' : `, mean score ${stats.meanScore.toFixed(2)}`;
    return `${name.padEnd(9)} won ${stats.wins}/${stats.seats} seats (${percent(stats.seats ? stats.wins / stats.seats : 0)})${score}; `
      + `${stats.decisions} decisions, mean ${stats.meanMs.toFixed(2)} ms, max ${stats.maxMs.toFixed(1)} ms; `
      + `${stats.fallbacks} fallbacks`;
  };
  const verdict = pairs.signTestP < 0.05
    ? (pairs.candidateAhead > pairs.baselineAhead ? 'candidate is stronger' : 'baseline is stronger')
    : 'no significant difference';
  const lines = [
    ...header,
    `matches   ${summary.matches} finished${summary.unfinished ? `, ${summary.unfinished} unfinished` : ''}`,
    `win share candidate ${percent(summary.candidateShare)} / baseline ${percent(1 - summary.candidateShare)}`,
    side('candidate'),
    side('baseline'),
    `pairs     ${pairs.complete}: candidate won both ${pairs.candidateBoth}, baseline won both ${pairs.baselineBoth}, `
      + `split or even ${pairs.split}`,
    `sign test candidate ahead ${pairs.candidateAhead} vs baseline ahead ${pairs.baselineAhead}: `
      + `p = ${pairs.signTestP.toPrecision(3)} (${verdict})`,
  ];
  if (summary.fallbackReasons.length) lines.push('fallbacks:', ...summary.fallbackReasons.slice(0, 10).map((reason) => `  ${reason}`));
  if (summary.errors.length) lines.push('errors:', ...summary.errors.slice(0, 10).map((error) => `  ${error}`));
  return `${lines.join('\n')}\n`;
}
