import { useState } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import type { GameType, MatchSummary } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { gameStatisticsRules } from '../games/statistics-registry';
import { decodeContract } from '@shared/stats/definitions';
import { decodePokerHand } from '@shared/stats/holdem';
import { usePlayerStats } from '../hooks/use-player-stats';
import type { PlayerStatsState } from '../hooks/use-player-stats';
import type { GameMetric, GameStatistics, MatchStatistics, SpecialRecord, StatsScope } from '../match-statistics';
import { serverStatistics } from '../player-stats';
import type { TranslationKey } from '../i18n';
import { useI18nStore } from '../stores/i18n-store';
import { dialogPaperClass, dialogParts } from '../styles/dialog';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { RecentDots } from './MatchStatsStrip';
import { StatsScopeToggle } from './StatsScopeToggle';
import styles from './MatchStatsDialog.module.css';

type Selection = GameType | 'overview';

/** Placement colors from best to worst; a table of any size spreads over the same four steps. */
const PLACE_COLORS = ['var(--color-success)', 'var(--color-primary)', 'var(--color-warning)', 'var(--color-danger)'] as const;

function placeColor(index: number, count: number): string {
  return PLACE_COLORS[count <= 1 ? 0 : Math.round(index * (PLACE_COLORS.length - 1) / (count - 1))];
}

function Metric({ label, value, note, emphasis }: {
  readonly label: string; readonly value: string; readonly note?: string; readonly emphasis?: boolean;
}): ReactNode {
  return <div className={styles.metric}>
    <small>{label}</small>
    <b className={emphasis ? styles.up : undefined}>{value}</b>
    {note && <span className={styles.note}>{note}</span>}
  </div>;
}

function useFormats(): {
  readonly percent: (value: number) => string;
  readonly decimal: (value: number) => string;
  readonly signed: (value: number) => string;
  readonly integer: (value: number) => string;
} {
  const { locale } = useI18nStore();
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const signed = new Intl.NumberFormat(locale, { maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  const integer = new Intl.NumberFormat(locale);
  return { percent: (value) => percent.format(value), decimal: (value) => decimal.format(value),
    signed: (value) => signed.format(value), integer: (value) => integer.format(value) };
}

function GameList({ statistics, selected, onSelect }: {
  readonly statistics: MatchStatistics; readonly selected: Selection; readonly onSelect: (value: Selection) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const { percent, integer } = useFormats();
  const played = statistics.games.filter((game) => game.matches > 0).sort((first, second) => second.matches - first.matches);
  const unplayed = statistics.games.filter((game) => game.matches === 0);
  return <nav className={styles.list} aria-label={t('history.statistics')}>
    <button type="button" className={`${styles.item} ${styles.overview}`} aria-current={selected === 'overview' || undefined}
      onClick={() => onSelect('overview')}>
      <span className={styles.itemName}>{t('history.stats.overview')}</span>
      <span className={styles.itemMeta}>{t('history.summary.matchCount', { n: integer(statistics.matches) })}
        {statistics.winRate !== null && <> · {percent(statistics.winRate)}</>}</span>
    </button>
    {played.length > 0 && <p className={styles.listHint}>{t('history.stats.byMatches')}</p>}
    {played.map((game) => <button key={game.gameType} type="button" className={styles.item}
      aria-current={selected === game.gameType || undefined} onClick={() => onSelect(game.gameType)}>
      <span className={styles.itemName}>{t(`gameType.${game.gameType}`)}</span>
      <span className={styles.itemMeta}>{t('history.summary.matchCount', { n: integer(game.matches) })}
        {game.winRate !== null && <> · {percent(game.winRate)}</>}</span>
      {game.winRate !== null && game.expectedWinRate !== null && <span className={styles.bar} aria-hidden="true">
        <i style={{ width: `${game.winRate * 100}%` }} />
        <u style={{ left: `${game.expectedWinRate * 100}%` }} />
      </span>}
    </button>)}
    {unplayed.length > 0 && <p className={styles.unplayed}>
      {t('history.stats.notPlayedList', { games: unplayed.map((game) => t(`gameType.${game.gameType}`)).join('、') })}</p>}
  </nav>;
}

function RankDistribution({ game }: { readonly game: GameStatistics }): ReactNode {
  const { t } = useI18nStore();
  const total = game.rankCounts.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  return <section className={styles.section}>
    <h4>{t('history.stats.rankDistribution')}</h4>
    <div className={styles.rankBar} role="img"
      aria-label={game.rankCounts.map((count, index) => `${t('history.stats.place', { n: String(index + 1) })} ${count}`).join(', ')}>
      {game.rankCounts.map((count, index) => count > 0 && <div key={index}
        style={{ flexGrow: count, background: placeColor(index, game.rankCounts.length) }}>{count}</div>)}
    </div>
    <ul className={styles.legend}>
      {game.rankCounts.map((count, index) => <li key={index}>
        <i style={{ background: placeColor(index, game.rankCounts.length) }} />
        {t('history.stats.place', { n: String(index + 1) })} {count}</li>)}
    </ul>
    <p className={styles.tieNote}>{t('history.stats.tiesNote', { n: String(game.ties) })}</p>
  </section>;
}

function RoleMetrics({ game }: { readonly game: GameStatistics }): ReactNode {
  const { t } = useI18nStore();
  const { percent } = useFormats();
  return <>{gameStatisticsRules(game.gameType).roleMetrics.map(({ label, roles }) => {
    const { played, won } = roles.reduce((total, role) => ({
      played: total.played + (game.roles[role]?.played ?? 0),
      won: total.won + (game.roles[role]?.won ?? 0),
    }), { played: 0, won: 0 });
    return <Metric key={label} label={t(label)} value={played ? percent(won / played) : '—'}
      note={played ? t('history.stats.roleRecord', { won: String(won), played: String(played) }) : t('history.notPlayed')} />;
  })}</>;
}

function GamePanel({ game, matches, onReplay }: {
  readonly game: GameStatistics;
  readonly matches: readonly MatchSummary[];
  readonly onReplay?: (match: MatchSummary) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const { percent, decimal, signed, integer } = useFormats();
  const kind = gameDefinition(game.gameType).result.kind;
  const sides = kind !== 'ranking';
  const scoreLabel = game.scoreKind === 'penalty' ? t('history.stats.averagePenalty')
    : game.scoreKind === 'chips' ? t('history.stats.averageChips') : t('history.stats.averagePoints');
  return <div className={styles.panel}>
    <div className={styles.title}>
      <h3>{t(`gameType.${game.gameType}`)}</h3>
      <span>{t('history.summary.matchCount', { n: integer(game.matches) })} · {t(
        kind === 'roles' ? 'history.stats.kind.roles' : sides ? 'history.stats.kind.team' : 'history.stats.kind.ranking')}</span>
    </div>
    <div className={styles.figures}>
      <div className={styles.metrics}>
        <Metric label={t(sides ? 'history.winRate' : 'history.stats.winRateRanked')} emphasis
          value={game.winRate === null ? '—' : percent(game.winRate)}
          note={game.expectedWinRate === null ? undefined : t(kind === 'roles' ? 'stats.expectedRoles'
            : 'history.stats.expected', { value: percent(game.expectedWinRate) })} />
        {sides ? <RoleMetrics game={game} /> : <>
          {game.averageRank !== null && <Metric label={t('history.stats.averageRank')} value={decimal(game.averageRank)}
            note={game.expectedAverageRank === null ? undefined : t('history.stats.expected', { value: decimal(game.expectedAverageRank) })} />}
          {game.topTwoRate !== null && <Metric label={t('history.stats.topTwo')} value={percent(game.topTwoRate)}
            note={t('history.summary.matchCount', { n: integer(game.topTwoCount) })} />}
          {game.averageScore !== null && <Metric label={scoreLabel}
            value={game.scoreKind === 'chips' ? signed(game.averageScore) : decimal(game.averageScore)}
            note={game.lossAverageScore === null ? undefined : t('stats.lossAverage', { value: decimal(game.lossAverageScore) })} />}
        </>}
        {game.metrics.map((metric) => <GameMetricCard key={metric.id} metric={metric} />)}
      </div>
      {!sides && <RankDistribution game={game} />}
    </div>
    <SpecialRecords game={game} matches={matches} onReplay={onReplay} />
  </div>;
}

function GameMetricCard({ metric }: { readonly metric: GameMetric }): ReactNode {
  const { t } = useI18nStore();
  const { percent, decimal, integer } = useFormats();
  const signedDecimal = (value: number): string => `${value > 0 ? '+' : ''}${decimal(value)}`;
  const value = metric.format === 'rate' ? percent(metric.value) : metric.format === 'signed' ? signedDecimal(metric.value)
    : decimal(metric.value);
  return <Metric label={t(`stats.metric.${metric.id}`)} value={value} note={t('stats.metric.basis', { n: integer(metric.basis) })} />;
}

type RecordUnit = 'times' | 'points' | 'chips' | 'signedChips' | 'contract' | 'hand';

const RECORD_UNITS: Readonly<Record<string, RecordUnit>> = {
  'bridge.topContract': 'contract', 'napoleon.topContract': 'contract', 'holdem.bestShowdown': 'hand',
  'bigtwo.topCollect': 'points', 'redpoints.topPoints': 'points', 'sevens.lowPenalty': 'points', 'sevens.highPenalty': 'points',
  'chinesepoker.topScore': 'points', 'blackjack.topChips': 'chips', 'holdem.biggestPot': 'chips',
  'blackjack.bestHand': 'signedChips', 'blackjack.dealerNet': 'signedChips',
  'tenhalf.topChips': 'chips', 'tenhalf.bestHand': 'signedChips', 'tenhalf.bankerNet': 'signedChips',
};

const SUIT_SYMBOLS = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠', nt: 'NT' } as const;
const RANK_LABELS: Readonly<Record<number, string>> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function useRecordValue(gameType: GameType): (record: SpecialRecord, value: number) => string {
  const { t } = useI18nStore();
  const { integer, signed } = useFormats();
  return (record, value) => {
    switch (RECORD_UNITS[`${gameType}.${record.id}`] ?? 'times') {
      case 'times': return t('stats.times', { n: integer(value) });
      case 'points': return t('stats.points', { n: integer(value) });
      case 'chips': return t('stats.chips', { n: integer(value) });
      case 'signedChips': return t('stats.chips', { n: signed(value) });
      case 'contract': {
        const contract = decodeContract(value);
        return `${contract.level}${SUIT_SYMBOLS[contract.suit]}`;
      }
      case 'hand': {
        const hand = decodePokerHand(value);
        const ranks = hand.ranks.map((rank) => RANK_LABELS[rank] ?? String(rank)).join('-');
        return `${t(`chinesepoker.category.${hand.category}`)} ${ranks}`;
      }
    }
  };
}

function RecordCard({ gameType, record, replayMatch, onReplay }: {
  readonly gameType: GameType;
  readonly record: SpecialRecord;
  readonly replayMatch: MatchSummary | undefined;
  readonly onReplay?: (match: MatchSummary) => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const format = useRecordValue(gameType);
  const day = (time: number): string => new Date(time).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
  const key = `${gameType}.${record.id}`;
  const notable = record.value !== null && (record.remember ? record.value > 0 : record.mark !== null);
  return <li className={`${styles.record} ${notable ? styles.notable : ''}`}>
    <span className={styles.recordIcon} aria-hidden="true">{t(`stats.icon.${key}` as TranslationKey)}</span>
    <span className={styles.recordLabel}>{t(`stats.record.${key}` as TranslationKey)}</span>
    <span className={styles.recordValue}>
      {!record.tracked ? <small>{t('stats.notLogged')}</small> : record.value === null ? '—' : format(record, record.value)}
      {record.mark && record.value !== null && <small>{day(record.mark.at)}</small>}
      {replayMatch && onReplay && <button type="button" className={styles.replay}
        onClick={() => onReplay(replayMatch)}>{t('stats.replay')}</button>}
      {record.since !== null && <small>{t('stats.since', { date: day(record.since) })}</small>}
    </span>
    {record.source === 'log' && <span className={styles.logTag}>{t('stats.logTag')}</span>}
  </li>;
}

function SpecialRecords({ game, matches, onReplay }: {
  readonly game: GameStatistics;
  readonly matches: readonly MatchSummary[];
  readonly onReplay?: (match: MatchSummary) => void;
}): ReactNode {
  const { t } = useI18nStore();
  if (game.records.length === 0) return null;
  return <section className={`${styles.section} ${styles.records}`}>
    <h4>{t('stats.records')} <em>{t('stats.recordsHint')}</em></h4>
    <ul className={styles.recordList}>
      {game.records.map((record) => <RecordCard key={record.id} gameType={game.gameType} record={record} onReplay={onReplay}
        replayMatch={record.mark ? matches.find((match) => match.id === record.mark?.matchId && match.hasReplay) : undefined} />)}
    </ul>
  </section>;
}

function OverviewPanel({ statistics }: { readonly statistics: MatchStatistics }): ReactNode {
  const { t } = useI18nStore();
  const { percent, integer } = useFormats();
  return <div className={styles.panel}>
    <div className={styles.title}>
      <h3>{t('history.stats.overview')}</h3>
      <span>{t('history.summary.humans', { n: integer(statistics.humanMatches) })} · {t('history.summary.all', { n: integer(statistics.allMatches) })}</span>
    </div>
    <div className={styles.metrics}>
      <Metric label={t('history.summary.matches')} value={integer(statistics.matches)} />
      <Metric label={t('history.winRate')} emphasis value={statistics.winRate === null ? '—' : percent(statistics.winRate)}
        note={t('history.stats.wins', { n: integer(statistics.wins) })} />
      <Metric label={t('history.summary.bestStreak')} value={integer(statistics.bestStreak)}
        note={t('history.summary.streakNow', { n: integer(statistics.currentStreak) })} />
      <Metric label={t('history.stats.tiedFirst')} value={integer(statistics.ties)} />
    </div>
    <section className={styles.section}>
      <h4>{t('history.summary.recent')}</h4>
      <RecentDots statistics={statistics} />
    </section>
  </div>;
}

/**
 * The server's accumulated statistics of one player in one scope. `stats` comes from a page that already
 * loads them; otherwise the dialog requests them. `matches` (the loaded history) find replays of records.
 */
export function MatchStatsDialog({ accountId, stats, matches, scope, onScopeChange, onReplay, onClose }: {
  readonly accountId: string;
  readonly stats?: PlayerStatsState;
  readonly matches: readonly MatchSummary[];
  readonly scope: StatsScope;
  readonly onScopeChange: (scope: StatsScope) => void;
  readonly onReplay?: (match: MatchSummary) => void;
  readonly onClose: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const { integer } = useFormats();
  const [selection, setSelection] = useState<Selection>('overview');
  const requested = usePlayerStats(stats ? null : accountId);
  const state = stats ?? requested;
  const statistics = state.status === 'ready' ? serverStatistics(state.stats, scope) : null;
  const game = selection === 'overview' ? undefined : statistics?.games.find((entry) => entry.gameType === selection);
  const shown = game && game.matches > 0 ? game : undefined;
  const date = (time: number): string => new Date(time).toLocaleDateString(locale);
  return <Dialog open onClose={onClose} aria-labelledby="match-stats-title"
    slotProps={{ paper: { className: dialogPaperClass('wide', styles.paper) } }}>
    <div className={`${dialogParts.header} ${styles.header}`}>
      <h2 id="match-stats-title">{t('history.statistics')}</h2>
      <StatsScopeToggle scope={scope} onChange={onScopeChange} className={styles.scope} />
      {statistics && <span className={styles.since}>
        {statistics.since === null ? t('stats.cumulative') : t('stats.countingSince', { date: date(statistics.since) })}
        {statistics.recordsSince !== null && <> · {t('stats.recordsSince', { date: date(statistics.recordsSince) })}</>}
      </span>}
      <IconButton icon="close" label={t('table.close')} onClick={onClose} />
    </div>
    {!statistics ? <div className={`${dialogParts.body} ${styles.status}`}>
      <p role={state.status === 'loading' ? 'status' : 'alert'}>{state.status === 'loading' ? t('stats.loading')
        : state.status === 'private' ? t('history.private') : state.status === 'error' ? state.error : ''}</p>
    </div> : <div className={`${dialogParts.body} ${styles.body}`}>
      <GameList statistics={statistics} selected={shown ? shown.gameType : 'overview'} onSelect={setSelection} />
      <div className={styles.content}>
        {statistics.matches === 0
          ? <div className={styles.empty}>
            <p>{statistics.allMatches > 0 && scope === 'human'
              ? t('history.scopeEmpty', { n: integer(statistics.allMatches) }) : t('history.stats.empty')}</p>
            {statistics.allMatches > 0 && scope === 'human'
              && <Button size="small" onClick={() => onScopeChange('all')}>{t('history.scopeShowAll')}</Button>}
          </div>
          : shown ? <GamePanel game={shown} matches={matches} onReplay={onReplay} /> : <OverviewPanel statistics={statistics} />}
        <p className={styles.footnote}>{t('stats.footnote')}</p>
      </div>
    </div>}
  </Dialog>;
}
