import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import type { MatchHistory, MatchSummary, PlayerInfo, PublicAccount } from '@shared/types';
import { apiRequest } from '../api';
import { resultSeats } from '../game-view';
import { seatLabel } from '../games/seat-names';
import { replayableHistory } from '../room-replay';
import type { MemberReplayHistory } from '../room-replay';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import { dialogPaperClass, dialogParts } from '../styles/dialog';
import styles from './RoomReplayPicker.module.css';

function MatchRow({ match, players, busy, onWatch }: {
  readonly match: MatchSummary;
  readonly players: Readonly<Record<string, PublicAccount>>;
  readonly busy: boolean;
  readonly onWatch: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const seats = resultSeats(match.result);
  const names = match.accountIds.map((id, index) => {
    const label = seatLabel(t, match.result.gameType, seats[index]);
    return id.startsWith('bot:') ? t('player.botSeat', { seat: label }) : players[id]?.nickname ?? label;
  }).join(', ');
  return <li className={styles.match}>
    <span className={styles.matchGame}>{t(`gameType.${match.result.gameType}`)}</span>
    <span className={styles.matchMeta}>
      {new Date(match.finishedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
    </span>
    <span className={styles.matchPlayers} title={names}>{names}</span>
    <button type="button" className="btn btn-primary" disabled={busy} onClick={onWatch}>{t('replay.sharedWatch')}</button>
  </li>;
}

/**
 * Host-only list of recorded matches the host may view: the host's own history and each
 * member's history while it is public. Choosing one starts the shared replay.
 */
export function RoomReplayPicker({ members, selfId, busy, onWatch, onClose }: {
  readonly members: readonly PlayerInfo[];
  readonly selfId: string;
  readonly busy: boolean;
  readonly onWatch: (subjectId: string, matchId: string) => void;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const titleId = useId();
  const [histories, setHistories] = useState<Readonly<Record<string, MemberReplayHistory>>>({});
  const memberKey = members.map((member) => member.id).join(',');

  useEffect(() => {
    let active = true;
    for (const id of memberKey.split(',').filter(Boolean)) {
      void apiRequest<MatchHistory>(`/api/players/${encodeURIComponent(id)}/history`).then((result) => {
        if (!active) return;
        const history: MemberReplayHistory = result.success ? replayableHistory(result)
          : { status: result.status === 403 ? 'private' : 'failed' };
        setHistories((current) => ({ ...current, [id]: history }));
      });
    }
    return () => { active = false; };
  }, [memberKey]);

  return <Dialog open onClose={onClose} aria-labelledby={titleId}
    slotProps={{ paper: { className: dialogPaperClass('medium') }, backdrop: { className: styles.backdrop } }}>
    <DialogTitle component="div" className={`${dialogParts.header} ${styles.header}`}>
      <h2 id={titleId}>{t('replay.sharedPickerTitle')}</h2>
      <button type="button" className={`btn btn-secondary ${styles.close}`} onClick={onClose} aria-label={t('table.close')}>
        <AppIcon name="close" />
      </button>
    </DialogTitle>
    <DialogContent className={dialogParts.body} aria-busy={busy}>
      <p className={styles.hint}>{t('replay.sharedPickerHint')}</p>
      {members.map((member) => {
        const history = histories[member.id] ?? { status: 'loading' };
        const name = member.id === selfId ? `${member.nickname} ${t('common.me')}` : member.nickname;
        const headingId = `${titleId}-${member.id}`;
        return <section key={member.id} className={styles.member} aria-labelledby={headingId}>
          <h3 id={headingId}>{t('replay.sharedMemberHistory', { name })}</h3>
          {history.status === 'loading' && <p role="status" className={styles.note}>{t('common.loading')}</p>}
          {history.status === 'private' && <p className={styles.note}>{t('replay.sharedPrivate')}</p>}
          {history.status === 'failed' && <p role="alert" className={styles.note}>{t('replay.sharedHistoryFailed')}</p>}
          {history.status === 'loaded' && (history.matches.length === 0
            ? <p className={styles.note}>{t('replay.sharedNoRecordings')}</p>
            : <ul className={styles.matches}>{history.matches.map((match) => <MatchRow key={match.id} match={match}
              players={history.players} busy={busy} onWatch={() => onWatch(member.id, match.id)} />)}</ul>)}
        </section>;
      })}
    </DialogContent>
  </Dialog>;
}
