import { lazy, Suspense, useId, useState } from 'react';
import type { ReactNode } from 'react';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import useMediaQuery from '@mui/material/useMediaQuery';
import Select from '@mui/material/Select';
import type { GameType, MatchHistory, MatchSummary, PublicAccount, GameSeat } from '@shared/types';
import { GAME_TYPES } from '@shared/constants';
import { matchOutcome, selectHistoryMatches } from '../match-history';
import type { HistorySortKey, MatchOutcome, SortDirection } from '../match-history';
import { resultSeats } from '../game-view';
import { clientGame } from '../games/registry';
import { seatLabel } from '../games/seat-names';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { joinNames } from '../games/seat-names';
import { PlayerLink } from './PlayerLink';
import { MatchHistoryStatistics } from './MatchHistoryStatistics';
import { AppIcon } from './AppIcon';
import { Button } from './Button';
import styles from './MatchHistoryList.module.css';

/** Narrow windows and short landscape phones fold the charts and turn the table into cards. */
const COMPACT_QUERY = '(max-width: 52rem), (max-height: 500px) and (min-width: 600px)';

/** Matches revealed per step on narrow screens. */
const COMPACT_PAGE = 8;

const MatchReplayDialog = lazy(() => import('./MatchReplayDialog').then((module) => ({ default: module.MatchReplayDialog })));

function MatchResultLabel({ match, players, accountId }: {
  match: MatchSummary; players: Record<string, PublicAccount>; accountId?: string;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const { result } = match;
  // accountIds follow the recorded seats in N, E, S, W order
  const seats = resultSeats(result);
  const mySeat = seats[match.accountIds.indexOf(accountId ?? '')];
  const seatName = (seat: GameSeat): string => {
    const id = match.accountIds[seats.indexOf(seat)];
    const label = seatLabel(t, result.gameType, seat);
    return id?.startsWith('bot:') ? t('player.botSeat', { seat: label }) : players[id]?.nickname ?? label;
  };
  const summary = clientGame(result.gameType).result.summary(result, mySeat, t);
  if (summary.kind === 'text') return <span>{summary.text}</span>;
  return <span><AppIcon name="trophy" /> {joinNames(summary.winners.map(seatName), locale)}{summary.suffix}
    {summary.detail && <> · {t(summary.detail.key, { n: summary.detail.n })}</>}</span>;
}

export function MatchHistoryList({ matches, players, accountId }: MatchHistory & {
  readonly accountId?: string;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const viewerId = useAccountStore((state) => state.account?.id);
  const filterId = useId();
  const [query, setQuery] = useState('');
  const [gameType, setGameType] = useState<GameType | 'all'>('all');
  const [outcome, setOutcome] = useState<MatchOutcome | 'all'>('all');
  const [sortKey, setSortKey] = useState<HistorySortKey>('date');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [replayMatch, setReplayMatch] = useState<MatchSummary | null>(null);
  const [pages, setPages] = useState(1);
  const compact = useMediaQuery(COMPACT_QUERY, { noSsr: true });
  const subjectId = accountId ?? viewerId;
  const visibleMatches = selectHistoryMatches(matches, players, {
    accountId: subjectId, query, gameType, outcome, sortKey, direction, locale,
    gameName: (type) => t(`gameType.${type}`),
    outcomeName: (value) => t(`history.outcome.${value}`),
  });
  const sortColumn = (key: HistorySortKey, label: string): ReactNode => (
    <th scope="col" aria-sort={sortKey === key ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
      <button type="button" onClick={() => {
        if (sortKey === key) setDirection(direction === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setDirection(key === 'date' ? 'desc' : 'asc'); }
      }}>
        {label}<AppIcon name={sortKey === key ? direction === 'asc' ? 'arrowUp' : 'arrowDown' : 'sort'} />
      </button>
    </th>
  );
  const reset = (): void => {
    setQuery(''); setGameType('all'); setOutcome('all'); setSortKey('date'); setDirection('desc');
  };
  // Phones show the newest matches first and reveal the rest in steps, so the page stays short.
  const shownMatches = compact ? visibleMatches.slice(0, pages * COMPACT_PAGE) : visibleMatches;
  // Phones fold the charts so the match list is the first thing on the page.
  const statistics = compact
    ? <details className={styles.fold}>
      <summary>{t('history.statistics')}</summary>
      <div className={styles.foldBody}><MatchHistoryStatistics matches={matches} accountId={subjectId} hideTitle /></div>
    </details>
    : <MatchHistoryStatistics matches={matches} accountId={subjectId} />;
  if (matches.length === 0) return <div className={styles.history}>
    {statistics}
    <p className={styles.empty}>{t('history.noMatches')}</p>
  </div>;
  return <div className={styles.history}>
    {statistics}
    {!compact && <hr className={styles.divider} aria-hidden="true" />}
    <div className={styles.toolbar}>
      <div className={`${styles.field} ${styles.search}`}>
        <label htmlFor={`${filterId}-search`}>{t('history.search')}</label>
        <input id={`${filterId}-search`} type="search" value={query}
          placeholder={t('history.searchPlaceholder')} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <FormControl className={`${styles.field} ${styles.selectField}`} size="small" variant="outlined">
        <InputLabel id={`${filterId}-game-label`}>{t('history.game')}</InputLabel>
        <Select id={`${filterId}-game`} labelId={`${filterId}-game-label`}
          label={t('history.game')} value={gameType} className={styles.select}
          MenuProps={{ disableScrollLock: true, slotProps: { paper: { className: styles.filterMenu } } }}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'all') setGameType(value);
            else {
              const type = GAME_TYPES.find((option) => option === value);
              if (type) setGameType(type);
            }
          }}>
          <MenuItem value="all">{t('history.allGames')}</MenuItem>
          {GAME_TYPES.map((type) => <MenuItem key={type} value={type}>{t(`gameType.${type}`)}</MenuItem>)}
        </Select>
      </FormControl>
      <FormControl className={`${styles.field} ${styles.selectField}`} size="small" variant="outlined">
        <InputLabel id={`${filterId}-outcome-label`}>{t('history.result')}</InputLabel>
        <Select id={`${filterId}-outcome`} labelId={`${filterId}-outcome-label`}
          label={t('history.result')} value={outcome} className={styles.select}
          MenuProps={{ disableScrollLock: true, slotProps: { paper: { className: styles.filterMenu } } }}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'all' || value === 'win' || value === 'loss' || value === 'tie' || value === 'completed') {
              setOutcome(value);
            }
          }}>
          <MenuItem value="all">{t('history.allResults')}</MenuItem>
          {(['win', 'loss', 'tie', 'completed'] as const).map((value) =>
            <MenuItem key={value} value={value}>{t(`history.outcome.${value}`)}</MenuItem>)}
        </Select>
      </FormControl>
      <Button onClick={reset}
        disabled={!query && gameType === 'all' && outcome === 'all' && sortKey === 'date' && direction === 'desc'}>
        {t('history.reset')}
      </Button>
    </div>
    <p role="status" className={styles.count}>
      {t('history.count', { shown: String(visibleMatches.length), total: String(matches.length) })}
    </p>
    <div className={styles.tableViewport} role="region" aria-label={t('history.matches')} tabIndex={0}>
      <table className={styles.table}>
        <caption className={styles.caption}>{t('history.tableCaption')}</caption>
        <thead><tr>
          {sortColumn('date', t('history.date'))}
          {sortColumn('room', t('room.title'))}
          {sortColumn('game', t('history.game'))}
          {sortColumn('result', t('history.result'))}
          <th scope="col">{t('history.players')}</th>
          <th scope="col">{t('replay.actions')}</th>
        </tr></thead>
        <tbody>{shownMatches.map((match) => {
          const value = matchOutcome(match, subjectId);
          return <tr key={match.id}>
            <td><time dateTime={new Date(match.finishedAt).toISOString()} className={styles.time}>
              <span>{new Date(match.finishedAt).toLocaleDateString(locale)}</span>
              <span>{new Date(match.finishedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
            </time></td>
            <td className={styles.room}>{match.roomCode}</td>
            <td>{t(`gameType.${match.result.gameType}`)}</td>
            <td><div className={styles.result}>
              <span className={`${styles.outcome} ${styles[value]}`}>{t(`history.outcome.${value}`)}</span>
              <span className={styles.details}><MatchResultLabel match={match} players={players} accountId={subjectId} /></span>
            </div></td>
            <td><div className={styles.players}>
              {match.accountIds.map((id, index) => id.startsWith('bot:')
                ? <span key={id} className={styles.bot}>{t('player.botSeat', {
                  seat: seatLabel(t, match.result.gameType, resultSeats(match.result)[index]) })}</span>
                : players[id] && <PlayerLink key={id} player={players[id]} />)}
            </div></td>
            <td>{match.hasReplay && subjectId
              ? <Button size="small" className={styles.replayButton}
                onClick={() => setReplayMatch(match)}>{t('replay.open')}</Button>
              : <span className={styles.unavailable}>{t('replay.unavailable')}</span>}</td>
          </tr>;
        })}
          {visibleMatches.length === 0 && <tr><td colSpan={6} className={styles.noResults}>
            {t('history.noResults')}
          </td></tr>}
        </tbody>
      </table>
    </div>
    {shownMatches.length < visibleMatches.length && <Button className={styles.more} onClick={() => setPages(pages + 1)}>
      {t('history.showMore', { n: String(visibleMatches.length - shownMatches.length) })}</Button>}
    {replayMatch && subjectId && <Suspense fallback={<p role="status">{t('replay.loading')}</p>}>
      <MatchReplayDialog key={replayMatch.id} match={replayMatch} players={players}
        accountId={subjectId} onClose={() => setReplayMatch(null)} />
    </Suspense>}
  </div>;
}
