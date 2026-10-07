// ─── 投票終止對局：資訊欄按鈕、牌桌橫幅、通過提示 ───

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ABORT_VOTE_THRESHOLD } from '@shared/constants';
import type { PlayerInfo, RoomInfo } from '@shared/types';
import { socket } from '../socket';
import { useChatStore } from '../stores/chat-store';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomStore } from '../stores/room-store';
import { Avatar } from '../components/Avatar';
import { formatCountdown } from '../game-view';
import styles from './AbortVote.module.css';

/** Current time, ticking every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function seatedPlayer(room: RoomInfo, id: string): PlayerInfo | null {
  return Object.values(room.seats).find((seat) => seat.player?.id === id)?.player ?? null;
}

type Done = (timeout: Error | null, result?: { success: boolean; error?: string }) => void;

/** Busy flag, last error and a runner for one vote request. */
function useVoteAction(): [boolean, string, (send: (done: Done) => void) => void] {
  const { t } = useI18nStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = (send: (done: Done) => void): void => {
    setBusy(true);
    setError('');
    send((timeout, result) => {
      setBusy(false);
      if (timeout) setError(t('auth.connectionError'));
      else if (!result?.success) setError(result?.error ?? t('common.error'));
    });
  };
  return [busy, error, run];
}

export function AbortVoteButton(): ReactNode {
  const { t } = useI18nStore();
  const room = useRoomStore((state) => state.roomInfo);
  const mySeat = useRoomStore((state) => state.mySeat);
  const [busy, error, run] = useVoteAction();
  const cooldownUntil = room?.abortVoteCooldownUntil ?? 0;
  const now = useNow(cooldownUntil > Date.now());
  if (!room || room.status !== 'playing' || !mySeat) return null;
  const cooling = cooldownUntil > now;
  return (
    <div className={styles.rail}>
      <button type="button" className={`btn btn-outline ${styles.railBtn}`}
        disabled={busy || cooling || room.abortVote !== null}
        onClick={() => run((done) => socket.timeout(10000).emit('game:abortVote:start', done))}>
        <span aria-hidden="true">🏳️</span>{' '}
        {cooling ? t('abortVote.cooldown', { time: formatCountdown(cooldownUntil - now) }) : t('abortVote.button')}
      </button>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

function Tally({ room, ids, label }: { room: RoomInfo; ids: readonly string[]; label: string }): ReactNode {
  return <div className={styles.tally}>
    <span className={styles.tallyLabel}>{label} {ids.length}</span>
    {ids.map((id) => {
      const player = seatedPlayer(room, id);
      return player && <span key={id} title={player.nickname}>
        <Avatar avatar={player.avatar} image={player.avatarImage} color={player.color} size="small" />
      </span>;
    })}
  </div>;
}

export function AbortVoteBanner(): ReactNode {
  const { t } = useI18nStore();
  const room = useRoomStore((state) => state.roomInfo);
  const mySeat = useRoomStore((state) => state.mySeat);
  const myId = mySeat ? room?.seats[mySeat].player?.id : undefined;
  const vote = room?.abortVote ?? null;
  const now = useNow(vote !== null);
  const [busy, error, run] = useVoteAction();
  if (!room || !vote) return null;
  const starter = seatedPlayer(room, vote.startedBy);
  const threshold = Math.min(ABORT_VOTE_THRESHOLD,
    Object.values(room.seats).filter(({ player }) => player && !player.isBot).length);
  const canVote = myId !== undefined && !vote.yes.includes(myId) && !vote.no.includes(myId);
  const cast = (agree: boolean): void =>
    run((done) => socket.timeout(10000).emit('game:abortVote:cast', { agree }, done));
  return (
    <div className={styles.banner} role="dialog" aria-live="polite" aria-label={t('abortVote.button')}>
      <p className={styles.title}>
        <span aria-hidden="true">🏳️</span> {t('abortVote.title', { name: starter?.nickname ?? '' })}
      </p>
      <p className={styles.meta}>
        {t('abortVote.timeLeft', { time: formatCountdown(vote.expiresAt - now) })} · {t('abortVote.needed', { n: String(threshold) })}
      </p>
      <Tally room={room} ids={vote.yes} label={`✅ ${t('abortVote.agree')}`} />
      <Tally room={room} ids={vote.no} label={`❌ ${t('abortVote.disagree')}`} />
      {canVote && <div className={styles.actions}>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => cast(true)}>
          {t('abortVote.agree')}</button>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => cast(false)}>
          {t('abortVote.disagree')}</button>
      </div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

/** Brief notice when a vote this client watched passes; mounted app-wide so it survives the route change. */
export function AbortVoteToast(): ReactNode {
  const { t } = useI18nStore();
  const messages = useChatStore((state) => state.messages);
  const seen = useRef<Set<string> | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const previous = seen.current;
    seen.current = new Set(messages.map((message) => message.id));
    if (previous && messages.some((message) => !previous.has(message.id)
      && message.system && message.content === 'abortVote.passed')) setVisible(true);
  }, [messages]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [visible]);

  return visible ? <p className={styles.toast} role="status">{t('abortVote.passedToast')}</p> : null;
}
