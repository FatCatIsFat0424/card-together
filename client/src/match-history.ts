import type { GameSeat, GameType, MatchResult, MatchSummary, PublicAccount } from '@shared/types';
import { GAME_TYPES, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { resultSeats } from './game-view';

export type MatchOutcome = 'win' | 'loss' | 'tie' | 'completed';
export type HistorySortKey = 'date' | 'room' | 'game' | 'result';
export type SortDirection = 'asc' | 'desc';

export interface HistoryFilters {
  readonly accountId?: string;
  readonly query: string;
  readonly gameType: GameType | 'all';
  readonly outcome: MatchOutcome | 'all';
  readonly sortKey: HistorySortKey;
  readonly direction: SortDirection;
  readonly locale: string;
  readonly gameName: (gameType: GameType) => string;
  readonly outcomeName: (outcome: MatchOutcome) => string;
}

/** Seats that won a finished match: Bridge counts the whole winning partnership, ties list every tied seat. */
export function resultWinnerSeats(result: MatchResult): readonly GameSeat[] {
  if (result.gameType === 'bridge') {
    const declarerParity = SEAT_ORDER_CLOCKWISE.indexOf(result.contract.declarer) % 2;
    return SEAT_ORDER_CLOCKWISE.filter((_, index) => (index % 2 === declarerParity) === result.declarerTeamWins);
  }
  if ('winnerSeat' in result) return [result.winnerSeat];
  return result.winners;
}

/** Bridge and Napoleon outcomes follow sides; tied winners count as ties, not losses. */
export function matchOutcome(match: MatchSummary, accountId?: string): MatchOutcome {
  const index = accountId ? match.accountIds.indexOf(accountId) : -1;
  // accountIds follow the recorded seats; Blackjack and Hold'em may record fewer than four
  const seat = resultSeats(match.result)[index];
  if (!seat) return 'completed';
  const { result } = match;
  if (!resultWinnerSeats(result).includes(seat)) return 'loss';
  // A Bridge or Napoleon side wins together, so several winners are a team win rather than a tie.
  return result.gameType !== 'bridge' && result.gameType !== 'napoleon' && 'winners' in result
    && result.winners.length > 1 ? 'tie' : 'win';
}

export interface GameHistoryStatistics {
  readonly gameType: GameType;
  readonly played: number;
  readonly wins: number;
  readonly ties: number;
  readonly winRate: number | null;
}

/** Summarize the subject's loaded matches, independently of table filters. */
export function gameHistoryStatistics(
  matches: readonly MatchSummary[], accountId?: string,
): GameHistoryStatistics[] {
  return GAME_TYPES.map((gameType) => {
    let played = 0;
    let wins = 0;
    let ties = 0;
    for (const match of matches) {
      if (match.result.gameType !== gameType) continue;
      const outcome = matchOutcome(match, accountId);
      if (outcome === 'completed') continue;
      played += 1;
      if (outcome === 'win') wins += 1;
      if (outcome === 'tie') ties += 1;
    }
    return { gameType, played, wins, ties, winRate: played ? wins / played : null };
  });
}

/** Filter only the loaded records and sort a copy, preserving the API response. */
export function selectHistoryMatches(
  matches: readonly MatchSummary[],
  players: Readonly<Record<string, PublicAccount>>,
  filters: HistoryFilters,
): MatchSummary[] {
  const normalize = (text: string): string => text.normalize('NFKC').toLocaleLowerCase(filters.locale);
  const terms = normalize(filters.query.trim()).split(/\s+/).filter(Boolean);
  const collator = new Intl.Collator(filters.locale, { numeric: true, sensitivity: 'base' });
  const selected = matches.filter((match) => {
    const outcome = matchOutcome(match, filters.accountId);
    if (filters.gameType !== 'all' && match.result.gameType !== filters.gameType) return false;
    if (filters.outcome !== 'all' && outcome !== filters.outcome) return false;
    const searchText = normalize([
      match.roomCode, match.result.gameType, filters.gameName(match.result.gameType),
      filters.outcomeName(outcome), ...match.accountIds.flatMap((id) => {
        const player = players[id];
        return player ? [player.nickname, player.username] : [];
      }),
    ].join(' '));
    return terms.every((term) => searchText.includes(term));
  });
  const sortText = (match: MatchSummary): string => {
    if (filters.sortKey === 'room') return match.roomCode;
    if (filters.sortKey === 'game') return filters.gameName(match.result.gameType);
    return filters.outcomeName(matchOutcome(match, filters.accountId));
  };
  return selected.sort((first, second) => {
    const comparison = filters.sortKey === 'date' ? first.finishedAt - second.finishedAt
      : collator.compare(sortText(first), sortText(second));
    return comparison ? comparison * (filters.direction === 'asc' ? 1 : -1)
      : second.finishedAt - first.finishedAt || collator.compare(first.id, second.id);
  });
}
