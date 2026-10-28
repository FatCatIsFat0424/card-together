import { useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { MatchSummary } from '@shared/types';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { gameHistoryStatistics } from '../match-history';
import { useI18nStore } from '../stores/i18n-store';
import styles from './MatchHistoryStatistics.module.css';

interface MatchHistoryStatisticsProps {
  readonly matches: readonly MatchSummary[];
  readonly accountId?: string;
  /** The surrounding section already names the statistics. */
  readonly hideTitle?: boolean;
  /** `wide` lays the game mix and the per-game table side by side; `compact` lists only the games played. */
  readonly layout?: 'stacked' | 'wide' | 'compact';
}

const GAME_COLORS = ['#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#4ade80',
  '#facc15', '#22d3ee', '#f87171', '#a3e635', '#e879f9'] as const;
/** Each bar lines up with its table row: the axis matches the table head and every band one row. */
const AXIS_HEIGHT = 32;
const ROW_HEIGHT = 52;

export function MatchHistoryStatistics({ matches, accountId, hideTitle = false, layout = 'stacked' }: MatchHistoryStatisticsProps): ReactNode {
  const { t, locale } = useI18nStore();
  const headingId = useId();
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const number = new Intl.NumberFormat(locale);
  const statistics = gameHistoryStatistics(matches, accountId);
  const total = statistics.reduce((count, game) => count + game.played, 0);
  const distribution = statistics.map((game, index) => ({
    id: game.gameType, label: t(`gameType.${game.gameType}`), value: game.played,
    color: GAME_COLORS[index % GAME_COLORS.length],
  }));
  if (layout === 'compact') return <section className={styles.statistics} aria-labelledby={headingId}>
    <h3 id={headingId} className={styles.srOnly}>{t('history.statistics')}</h3>
    {total > 0 ? <ul className={styles.gameList}>{statistics.filter((game) => game.played > 0).map((game) => <li key={game.gameType}>
      <span className={styles.gameName}>{t(`gameType.${game.gameType}`)}</span>
      <span className={styles.gameMeta}>{number.format(game.played)} {t('history.totalPlayed')}
        {game.winRate !== null && <> · <strong className={styles.rate}>{percent.format(game.winRate)}</strong></>}</span>
    </li>)}</ul> : <p className={styles.emptyMix}>{t('history.notPlayed')}</p>}
    <p className={styles.hint}>{t('history.statisticsHint')}</p>
  </section>;
  return <section className={`${styles.statistics} ${layout === 'wide' ? styles.wide : ''}`} aria-labelledby={headingId}>
    <h3 id={headingId} className={hideTitle ? styles.srOnly : undefined}>{t('history.statistics')}</h3>
    <p className={styles.hint}>{t('history.statisticsHint')}</p>
    <div className={styles.mix}>
      <div className={styles.donut}>
        {total > 0 ? <>
          <PieChart height={240} margin={0} hideLegend skipAnimation
            series={[{ data: distribution.filter((game) => game.value > 0), innerRadius: 65,
              outerRadius: 100, paddingAngle: 3, cornerRadius: 4,
              highlightScope: { highlight: 'item', fade: 'global' },
              valueFormatter: (game) => `${number.format(game.value)} · ${percent.format(game.value / total)}` }]}
            title={t('history.gameMix')} desc={t('history.gameMixHint')}
            slotProps={{ tooltip: { className: styles.tooltip } }} />
          <div className={styles.donutCenter}>
            <strong>{number.format(total)}</strong><span>{t('history.totalPlayed')}</span>
          </div>
        </> : <p className={styles.emptyMix}>{t('history.notPlayed')}</p>}
      </div>
      <div className={styles.mixDetails}>
        <h4>{t('history.gameMix')}</h4>
        <ul className={styles.legend}>
          {distribution.map((game) => <li key={game.id}>
            <span className={styles.swatch} style={{ background: game.color }} aria-hidden="true" />
            <span className={styles.legendName}>{game.label}</span>
            <span className={styles.share}>{percent.format(total ? game.value / total : 0)}</span>
          </li>)}
        </ul>
      </div>
    </div>
    <div className={styles.visualization}
      style={{ '--axis-height': `${AXIS_HEIGHT}px`, '--row-height': `${ROW_HEIGHT}px` } as CSSProperties}>
      <table className={styles.metrics} aria-labelledby={headingId}>
        <thead><tr><th scope="col">{t('history.game')}</th>
          <th scope="col">{t('history.played')}</th><th scope="col">{t('history.winRate')}</th></tr></thead>
        <tbody>{statistics.map((game) => <tr key={game.gameType}>
          <th scope="row"><span>{t(`gameType.${game.gameType}`)}</span>
            <small>{t('history.wins', { n: number.format(game.wins) })}
              {game.ties > 0 && <> · {t('history.ties', { n: number.format(game.ties) })}</>}</small>
          </th>
          <td>{number.format(game.played)}</td>
          <td className={game.winRate === null ? styles.unplayed : styles.rate}>
            {game.winRate === null ? <span aria-label={t('history.notPlayed')}>—</span> : percent.format(game.winRate)}
          </td>
        </tr>)}</tbody>
      </table>
      <div className={styles.chart}>
        <BarChart layout="horizontal" height={AXIS_HEIGHT + statistics.length * ROW_HEIGHT}
          margin={{ top: 0, bottom: 0, left: 14, right: 22 }}
          series={[{ data: statistics.map((game) => game.winRate), label: t('history.winRate'),
            color: 'var(--color-success)', valueFormatter: (value) => value === null
              ? t('history.notPlayed') : percent.format(value) }]}
          yAxis={[{ scaleType: 'band', data: statistics.map((game) => t(`gameType.${game.gameType}`)),
            position: 'none', categoryGapRatio: 0.5 }]}
          xAxis={[{ min: 0, max: 1, position: 'top', height: AXIS_HEIGHT, tickInterval: [0, 0.5, 1],
            tickLabelInterval: () => true,
            tickLabelStyle: { fill: 'var(--text-secondary)', fontFamily: 'var(--font-primary)' },
            valueFormatter: (value: number) => percent.format(value) }]}
          grid={{ vertical: true }} borderRadius={4} hideLegend skipAnimation
          title={t('history.winRate')} desc={t('history.statisticsHint')}
          localeText={{ noData: t('history.noMatches'), loading: t('common.loading') }}
          slotProps={{ tooltip: { className: styles.tooltip } }} />
      </div>
    </div>
  </section>;
}
