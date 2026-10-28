import { useState } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import type { GameType, MatchSummary } from '@shared/types';
import type { StandingRole } from '@shared/rules/match-standing';
import { matchStatistics } from '../match-statistics';
import type { GameStatistics, MatchStatistics, StatsScope } from '../match-statistics';
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

const NAPOLEON_ROLES = ['napoleon', 'secretary', 'defender'] as const;

function RoleMetrics({ game }: { readonly game: GameStatistics }): ReactNode {
  const { t } = useI18nStore();
  const { percent } = useFormats();
  const record = (role: StandingRole): { readonly played: number; readonly won: number } =>
    game.roles[role] ?? { played: 0, won: 0 };
  const metric = (label: string, played: number, won: number): ReactNode =>
    <Metric key={label} label={label} value={played ? percent(won / played) : '—'}
      note={played ? t('history.stats.roleRecord', { won: String(won), played: String(played) }) : t('history.notPlayed')} />;
  if (game.gameType === 'bridge') {
    const declarer = record('declarer');
    const partner = record('partner');
    return <>
      {metric(t('history.stats.bridge.declarerSide'), declarer.played + partner.played, declarer.won + partner.won)}
      {metric(t('history.stats.bridge.declarer'), declarer.played, declarer.won)}
      {metric(t('history.stats.bridge.defender'), record('defender').played, record('defender').won)}
    </>;
  }
  return <>{NAPOLEON_ROLES.map((role) =>
    metric(t(`history.stats.role.${role}`), record(role).played, record(role).won))}</>;
}

function GamePanel({ game }: { readonly game: GameStatistics }): ReactNode {
  const { t } = useI18nStore();
  const { percent, decimal, signed, integer } = useFormats();
  const sides = game.gameType === 'bridge' || game.gameType === 'napoleon';
  const scoreLabel = game.scoreKind === 'penalty' ? t('history.stats.averagePenalty')
    : game.scoreKind === 'chips' ? t('history.stats.averageChips') : t('history.stats.averagePoints');
  return <div className={styles.panel}>
    <div className={styles.title}>
      <h3>{t(`gameType.${game.gameType}`)}</h3>
      <span>{t('history.summary.matchCount', { n: integer(game.matches) })} · {t(
        game.gameType === 'napoleon' ? 'history.stats.kind.roles' : sides ? 'history.stats.kind.team' : 'history.stats.kind.ranking')}</span>
    </div>
    <div className={styles.metrics}>
      <Metric label={t(sides ? 'history.winRate' : 'history.stats.winRateRanked')} emphasis
        value={game.winRate === null ? '—' : percent(game.winRate)}
        note={game.expectedWinRate === null ? undefined : t('history.stats.expected', { value: percent(game.expectedWinRate) })} />
      {sides ? <RoleMetrics game={game} /> : <>
        {game.averageRank !== null && <Metric label={t('history.stats.averageRank')} value={decimal(game.averageRank)}
          note={game.expectedAverageRank === null ? undefined : t('history.stats.expected', { value: decimal(game.expectedAverageRank) })} />}
        {game.topTwoRate !== null && <Metric label={t('history.stats.topTwo')} value={percent(game.topTwoRate)}
          note={t('history.summary.matchCount', { n: integer(game.topTwoCount) })} />}
        {game.averageScore !== null && <Metric label={scoreLabel}
          value={game.scoreKind === 'chips' ? signed(game.averageScore) : decimal(game.averageScore)} />}
      </>}
    </div>
    {!sides && <RankDistribution game={game} />}
  </div>;
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

/** Per-game statistics of the loaded matches in one scope; the data source is `matchStatistics`. */
export function MatchStatsDialog({ matches, accountId, scope, onScopeChange, onClose }: {
  readonly matches: readonly MatchSummary[];
  readonly accountId?: string;
  readonly scope: StatsScope;
  readonly onScopeChange: (scope: StatsScope) => void;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const { integer } = useFormats();
  const [selection, setSelection] = useState<Selection>('overview');
  const statistics = matchStatistics(matches, accountId, scope);
  const game = selection === 'overview' ? undefined : statistics.games.find((entry) => entry.gameType === selection);
  const shown = game && game.matches > 0 ? game : undefined;
  return <Dialog open onClose={onClose} aria-labelledby="match-stats-title"
    slotProps={{ paper: { className: dialogPaperClass('wide', styles.paper) } }}>
    <div className={`${dialogParts.header} ${styles.header}`}>
      <h2 id="match-stats-title">{t('history.statistics')}</h2>
      <StatsScopeToggle scope={scope} onChange={onScopeChange} className={styles.scope} />
      <IconButton icon="close" label={t('table.close')} onClick={onClose} />
    </div>
    <div className={`${dialogParts.body} ${styles.body}`}>
      <GameList statistics={statistics} selected={shown ? shown.gameType : 'overview'} onSelect={setSelection} />
      <div className={styles.content}>
        {statistics.matches === 0
          ? <div className={styles.empty}>
            <p>{statistics.allMatches > 0 && scope === 'human'
              ? t('history.scopeEmpty', { n: integer(statistics.allMatches) }) : t('history.stats.empty')}</p>
            {statistics.allMatches > 0 && scope === 'human'
              && <Button size="small" onClick={() => onScopeChange('all')}>{t('history.scopeShowAll')}</Button>}
          </div>
          : shown ? <GamePanel game={shown} /> : <OverviewPanel statistics={statistics} />}
        <p className={styles.footnote}>{t('history.stats.footnote', { n: integer(statistics.allMatches) })}</p>
      </div>
    </div>
  </Dialog>;
}
