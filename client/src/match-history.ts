import type { GameSeat, GameType, MatchResult, MatchSummary, PublicAccount } from '@shared/types';
import { accountStanding, matchStatistics } from './match-statistics';
import { clientGame } from './games/registry';
import type { TranslationKey } from './i18n';

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
  return clientGame(result.gameType).result.winners(result);
}

/** Side games follow the winning side; a tie for first place is a tie in the list but counts as a win in statistics. */
export function matchOutcome(match: MatchSummary, accountId?: string): MatchOutcome {
  const standing = accountStanding(match, accountId);
  if (!standing) return 'completed';
  if (!standing.won) return 'loss';
  return standing.rank !== null && standing.tied ? 'tie' : 'win';
}

export interface GameHistoryStatistics {
  readonly gameType: GameType;
  readonly played: number;
  readonly wins: number;
  readonly ties: number;
  readonly winRate: number | null;
}

/** Per-game counts of the human-only matches among the loaded ones, independently of table filters. */
export function gameHistoryStatistics(
  matches: readonly MatchSummary[], accountId?: string,
): GameHistoryStatistics[] {
  return matchStatistics(matches, accountId, 'human').games.map((game) => ({
    gameType: game.gameType, played: game.matches, wins: game.wins, ties: game.ties, winRate: game.winRate }));
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

export type OutcomeTone = 'win' | 'loss' | 'tie' | 'neutral';

/** Translation key and color tone of the compact result badge. */
export function outcomeBadge(outcome: MatchOutcome): { readonly label: TranslationKey; readonly tone: OutcomeTone } {
  switch (outcome) {
    case 'win': return { label: 'history.outcome.win', tone: 'win' };
    case 'loss': return { label: 'history.outcome.loss', tone: 'loss' };
    case 'tie': return { label: 'history.outcome.tie', tone: 'tie' };
    case 'completed': return { label: 'history.outcome.completed', tone: 'neutral' };
  }
}

/** One choice of the combined sort control: the column and its direction. */
export interface HistorySortOption {
  readonly id: string;
  readonly key: HistorySortKey;
  readonly direction: SortDirection;
  readonly label: TranslationKey;
}

export const HISTORY_SORT_OPTIONS: readonly HistorySortOption[] = [
  { id: 'date-desc', key: 'date', direction: 'desc', label: 'history.sort.dateDesc' },
  { id: 'date-asc', key: 'date', direction: 'asc', label: 'history.sort.dateAsc' },
  { id: 'game-asc', key: 'game', direction: 'asc', label: 'history.sort.game' },
  { id: 'room-asc', key: 'room', direction: 'asc', label: 'history.sort.room' },
  { id: 'result-asc', key: 'result', direction: 'asc', label: 'history.sort.result' },
];

/** The option matching the current sort, or the default newest-first option for combinations the control cannot show. */
export function sortOptionFor(key: HistorySortKey, direction: SortDirection): HistorySortOption {
  return HISTORY_SORT_OPTIONS.find((option) => option.key === key && option.direction === direction)
    ?? HISTORY_SORT_OPTIONS[0];
}
