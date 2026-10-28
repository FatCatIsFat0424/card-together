import type { GameSeat, GameType, MatchResult, MatchSummary, PublicAccount } from '@shared/types';
import { GAME_TYPES } from '@shared/constants';
import { resultSeats } from './game-view';
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

/** Bridge and Napoleon outcomes follow sides; tied winners count as ties, not losses. */
export function matchOutcome(match: MatchSummary, accountId?: string): MatchOutcome {
  const index = accountId ? match.accountIds.indexOf(accountId) : -1;
  // accountIds follow the recorded seats; Blackjack and Hold'em may record fewer than four
  const seat = resultSeats(match.result)[index];
  if (!seat) return 'completed';
  const { result } = match;
  const winners = resultWinnerSeats(result);
  if (!winners.includes(seat)) return 'loss';
  // A Bridge or Napoleon side wins together, so several winners are a team win rather than a tie.
  return !clientGame(result.gameType).result.sidesWin && winners.length > 1 ? 'tie' : 'win';
}

export interface GameHistoryStatistics {
  readonly gameType: GameType;
  readonly played: number;
  readonly wins: number;
  readonly ties: number;
  readonly winRate: number | null;
}

/** Summarize human-only matches, independently of table filters. */
export function gameHistoryStatistics(
  matches: readonly MatchSummary[], accountId?: string,
): GameHistoryStatistics[] {
  return GAME_TYPES.map((gameType) => {
    let played = 0;
    let wins = 0;
    let ties = 0;
    for (const match of matches) {
      if (match.result.gameType !== gameType || match.accountIds.some((id) => id.startsWith('bot:'))) continue;
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

export interface HistorySummary {
  /** Finished human-only matches the account took part in. */
  readonly matches: number;
  readonly wins: number;
  readonly winRate: number | null;
  /** Most played game; the first game in registry order wins a tie. */
  readonly topGame: GameType | null;
}

export function historySummary(matches: readonly MatchSummary[], accountId?: string): HistorySummary {
  let played = 0;
  let wins = 0;
  let topGame: GameType | null = null;
  let topPlayed = 0;
  for (const game of gameHistoryStatistics(matches, accountId)) {
    played += game.played;
    wins += game.wins;
    if (game.played > topPlayed) { topGame = game.gameType; topPlayed = game.played; }
  }
  return { matches: played, wins, winRate: played ? wins / played : null, topGame };
}

export interface HistorySummaryItem {
  readonly id: 'matches' | 'winRate' | 'topGame';
  readonly label: string;
  readonly value: string;
}

/** Label and value pairs for the profile header; items without data are left out. */
export function historySummaryItems(
  summary: HistorySummary, text: (key: TranslationKey) => string,
  gameName: (gameType: GameType) => string, locale: string,
): HistorySummaryItem[] {
  if (summary.matches === 0) return [];
  const items: HistorySummaryItem[] = [
    { id: 'matches', label: text('history.summary.matches'), value: new Intl.NumberFormat(locale).format(summary.matches) },
  ];
  if (summary.winRate !== null) {
    items.push({ id: 'winRate', label: text('history.summary.winRate'),
      value: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(summary.winRate) });
  }
  if (summary.topGame) {
    items.push({ id: 'topGame', label: text('history.summary.topGame'), value: gameName(summary.topGame) });
  }
  return items;
}
