import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import type { GameType, MatchHistory, MatchSummary, PublicAccount, Seat } from '@shared/types';
import { GAME_TYPES, SEAT_ORDER_CLOCKWISE, SUIT_SYMBOLS } from '@shared/constants';
import { matchOutcome, selectHistoryMatches } from '../match-history';
import type { HistorySortKey, MatchOutcome, SortDirection } from '../match-history';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { joinNames } from '../games/seat-names';
import { PlayerLink } from './PlayerLink';
import { MatchHistoryStatistics } from './MatchHistoryStatistics';
import styles from './MatchHistoryList.module.css';

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function MatchResultLabel({ match, players, accountId }: {
  match: MatchSummary; players: Record<string, PublicAccount>; accountId?: string;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const { result } = match;
  // accountIds are ordered by seat N, E, S, W
  const mySeat = SEAT_ORDER_CLOCKWISE[match.accountIds.indexOf(accountId ?? '')];
  const seatName = (seat: Seat): string => {
    const id = match.accountIds[SEAT_ORDER_CLOCKWISE.indexOf(seat)];
    return id?.startsWith('bot:') ? t('player.botSeat', { seat: t(`seat.${seat}`) })
      : players[id]?.nickname ?? t(`seat.${seat}`);
  };
  if (result.gameType === 'redpoints') {
    return <span>🏆 {joinNames(result.winners.map(seatName), locale)}
      {mySeat && <> · {t('history.points', { n: String(result.points[mySeat]) })}</>}</span>;
  }
  if (result.gameType === 'sevens') {
    return <span>🏆 {joinNames(result.winners.map(seatName), locale)}
      {mySeat && <> · {t('history.penalty', { n: String(result.penalties[mySeat]) })}</>}</span>;
  }
  if (result.gameType === 'chinesepoker') {
    return <span>🏆 {joinNames(result.winners.map(seatName), locale)}
      {mySeat && <> · {t('history.score', { n: signed(result.scores[mySeat]) })}</>}</span>;
  }
  if (result.gameType === 'blackjack') {
    return <span>🏆 {joinNames(result.winners.map(seatName), locale)}
      {mySeat && <> · {t('history.chips', { n: String(result.chips[mySeat]) })}</>}</span>;
  }
  if (result.gameType === 'holdem') {
    return <span>🏆 {joinNames(result.winners.map(seatName), locale)}
      {mySeat && <> · {t('history.chips', { n: String(result.chips[mySeat]) })}</>}</span>;
  }
  if (result.gameType === 'ninetynine') {
    // Players eliminated earlier rank lower
    const myRank = mySeat && (mySeat === result.winnerSeat ? 1 : 4 - result.eliminationOrder.indexOf(mySeat));
    return <span>🏆 {seatName(result.winnerSeat)}
      {myRank && <> · {t('history.rank', { n: String(myRank) })}</>}</span>;
  }
  if (result.gameType === 'liarsdeck') {
    const myRank = mySeat && (mySeat === result.winnerSeat ? 1 : 4 - result.eliminationOrder.indexOf(mySeat));
    return <span>🏆 {seatName(result.winnerSeat)}
      {myRank && <> · {t('history.rank', { n: String(myRank) })}</>}</span>;
  }
  if (result.gameType === 'bigtwo') {
    return <span>🏆 {seatName(result.winnerSeat)}
      {result.dragon && ' 🐉'}
      {mySeat && <> · {t('history.penalty', { n: String(result.scores[mySeat]) })}</>}</span>;
  }
  return <span>{result.contract.level}{result.contract.suit === 'nt' ? 'NT'
    : SUIT_SYMBOLS[result.contract.suit]} · {result.declarerTeamTricks}
    /{result.requiredTricks} · {t(result.declarerTeamWins
      ? 'score.declarerWins' : 'score.defenderWins')}</span>;
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
        {label}<span aria-hidden="true">{sortKey === key ? direction === 'asc' ? '↑' : '↓' : '↕'}</span>
      </button>
    </th>
  );
  const reset = (): void => {
    setQuery(''); setGameType('all'); setOutcome('all'); setSortKey('date'); setDirection('desc');
  };
  if (matches.length === 0) return <div className={styles.history}>
    <MatchHistoryStatistics matches={matches} accountId={subjectId} />
    <p className={styles.empty}>{t('history.empty')}</p>
  </div>;
  return <div className={styles.history}>
    <MatchHistoryStatistics matches={matches} accountId={subjectId} />
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
      <button type="button" className="btn btn-outline" onClick={reset}
        disabled={!query && gameType === 'all' && outcome === 'all' && sortKey === 'date' && direction === 'desc'}>
        {t('history.reset')}
      </button>
    </div>
    <p role="status" className={styles.count}>
      {t('history.count', { shown: String(visibleMatches.length), total: String(matches.length) })}
    </p>
    <div className={styles.tableViewport} role="region" aria-label={t('history.title')} tabIndex={0}>
      <table className={styles.table}>
        <caption className={styles.caption}>{t('history.tableCaption')}</caption>
        <thead><tr>
          {sortColumn('date', t('history.date'))}
          {sortColumn('room', t('room.title'))}
          {sortColumn('game', t('history.game'))}
          {sortColumn('result', t('history.result'))}
          <th scope="col">{t('history.players')}</th>
        </tr></thead>
        <tbody>{visibleMatches.map((match) => {
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
                ? <span key={id} className={styles.bot}>{t('player.botSeat', { seat: t(`seat.${SEAT_ORDER_CLOCKWISE[index]}`) })}</span>
                : players[id] && <PlayerLink key={id} player={players[id]} />)}
            </div></td>
          </tr>;
        })}
          {visibleMatches.length === 0 && <tr><td colSpan={5} className={styles.noResults}>
            {t('history.noResults')}
          </td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}
