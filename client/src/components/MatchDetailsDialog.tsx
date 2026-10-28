import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import type { MatchSummary, PublicAccount } from '@shared/types';
import { matchOutcome, outcomeBadge } from '../match-history';
import { resultSeats } from '../game-view';
import { seatLabel } from '../games/seat-names';
import { useI18nStore } from '../stores/i18n-store';
import { dialogPaperClass, dialogParts } from '../styles/dialog';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { MatchResultLabel } from './MatchResultLabel';
import { PlayerLink } from './PlayerLink';
import historyStyles from './MatchHistoryList.module.css';
import styles from './MatchDetailsDialog.module.css';

/** Players, result and replay entry of one match; compact history rows open it instead of showing every column. */
export function MatchDetailsDialog({ match, players, accountId, onReplay, onClose }: {
  readonly match: MatchSummary;
  readonly players: Readonly<Record<string, PublicAccount>>;
  readonly accountId?: string;
  /** Called with the match when a replay is available for the viewed account. */
  readonly onReplay: (match: MatchSummary) => void;
  readonly onClose: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const badge = outcomeBadge(matchOutcome(match, accountId));
  const finished = new Date(match.finishedAt);
  const title = `${t(`gameType.${match.result.gameType}`)} · ${match.roomCode}`;
  return <Dialog open onClose={onClose} aria-labelledby="match-details-title"
    slotProps={{ paper: { className: dialogPaperClass('narrow') } }}>
    <div className={dialogParts.header}>
      <h2 id="match-details-title" className={styles.title}>{title}</h2>
      <IconButton icon="close" label={t('table.close')} onClick={onClose} />
    </div>
    <div className={`${dialogParts.body} ${styles.body}`}>
      <p className={styles.result}>
        <span className={`${historyStyles.badge} ${historyStyles[badge.tone]}`}>{t(badge.label)}</span>
        <MatchResultLabel match={match} players={players} accountId={accountId} />
      </p>
      <p className={styles.time}>
        <time dateTime={finished.toISOString()}>{finished.toLocaleDateString(locale)} {finished.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time>
      </p>
      <h3 className={styles.heading}>{t('history.players')}</h3>
      <ul className={styles.players}>{match.accountIds.map((id, index) => <li key={id}>
        {id.startsWith('bot:')
          ? <span className={styles.bot}>{t('player.botSeat', { seat: seatLabel(t, match.result.gameType, resultSeats(match.result)[index]) })}</span>
          : players[id] && <PlayerLink player={players[id]} dense />}
      </li>)}</ul>
    </div>
    <div className={dialogParts.footer}>
      {match.hasReplay && accountId
        ? <Button variant="primary" onClick={() => onReplay(match)}>{t('replay.open')}</Button>
        : <span className={styles.unavailable}>{t('replay.unavailable')}</span>}
      <Button onClick={onClose}>{t('table.close')}</Button>
    </div>
  </Dialog>;
}
