// ─── PlayerCard: in-game popover with a player's identity, record, and friendship; seats and the spectator list open it ───

import { useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import Popover from '@mui/material/Popover';
import { Link } from 'react-router-dom';
import type { FriendsData, GameType, PlayerInfo } from '@shared/types';
import { apiRequest } from '../api';
import { usePlayerStats } from '../hooks/use-player-stats';
import { useStatsScope } from '../hooks/use-stats-scope';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { Avatar } from './Avatar';
import { Button, buttonClassName } from './Button';
import { Nameplate } from './Nameplate';
import styles from './PlayerCard.module.css';

export function PlayerCard({ player, gameType, anchor, onClose }: {
  readonly player: PlayerInfo;
  readonly gameType: GameType;
  readonly anchor: HTMLElement;
  readonly onClose: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const accountId = useAccountStore((state) => state.account?.id);
  const self = player.id === accountId;
  const [scope] = useStatsScope();
  // Counters, not the match list: one small request, and the server applies the history privacy flag to it.
  const stats = usePlayerStats(player.isBot ? null : player.id);
  const [friends, setFriends] = useState<FriendsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (player.isBot) return undefined;
    let live = true;
    if (!self) void apiRequest<FriendsData>('/api/friends').then((result) => {
      if (live && result.success) setFriends(result);
    });
    return () => { live = false; };
  }, [player.id, player.isBot, self]);

  const addFriend = async (): Promise<void> => {
    setBusy(true);
    setError('');
    const result = await apiRequest('/api/friends/requests', 'POST', { username: player.username });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    const refreshed = await apiRequest<FriendsData>('/api/friends');
    if (refreshed.success) setFriends(refreshed);
  };

  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const counters = stats.status === 'ready' ? stats.stats.scopes[scope] : null;
  const current = counters?.games.find((game) => game.gameType === gameType);
  const total = counters?.games.reduce((count, game) => count + game.matches, 0) ?? 0;
  const streak = counters?.account?.streak.current ?? 0;
  const isFriend = friends?.friends.some((friend) => friend.id === player.id) ?? false;
  const incoming = friends?.incoming.some((request) => request.requester.id === player.id) ?? false;
  const outgoing = friends?.outgoing.some((request) => request.recipient.id === player.id) ?? false;
  const game = t(`gameType.${gameType}`);

  return <Popover open anchorEl={anchor} onClose={onClose}
    // The card is portalled but React still bubbles its events to the seat or row that opened it.
    slotProps={{ root: { onClick: (event: MouseEvent) => event.stopPropagation() }, paper: { className: styles.card, role: 'dialog', 'aria-label': t('playerCard.label', { nickname: player.nickname }) } }}
    anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}>
    <div className={styles.identity}>
      <Avatar avatar={player.avatar} image={player.avatarImage} border={player.avatarBorder} color={player.color} size="large" />
      <div className={styles.names}>
        <strong style={{ color: player.color }}>{player.nickname}</strong>
        {player.isBot
          ? <span className={styles.muted}>{t('player.bot')} · {t(`room.botDifficulty.${player.botDifficulty ?? 'hard'}`)}</span>
          : <span className={styles.muted}>@{player.username}</span>}
        <Nameplate id={player.nameplate} />
      </div>
    </div>
    {!player.isBot && <div className={styles.record}>
      {stats.status === 'loading' ? <span className={styles.muted}>{t('common.loading')}</span>
        : stats.status === 'private' ? <span className={styles.muted}>{t('playerCard.private')}</span>
          : stats.status === 'error' ? <span className={styles.muted}>{t('common.error')}</span>
            : <>
              <span>{current?.matches ? t('playerCard.thisGame', {
                game, played: String(current.matches), rate: percent.format(current.wins / current.matches),
              }) : t('playerCard.noGames', { game })}</span>
              <span className={styles.muted}>{t('playerCard.total', { n: String(total) })}
                {streak >= 2 && ` · ${t('playerCard.streak', { n: String(streak) })}`}</span>
            </>}
    </div>}
    {!player.isBot && <div className={styles.actions}>
      {!self && friends && (isFriend || incoming || outgoing
        ? <span className={styles.muted}>{t(isFriend ? 'player.friends' : incoming ? 'player.incoming' : 'player.outgoing')}</span>
        : <Button size="small" variant="primary" disabled={busy} onClick={() => void addFriend()}>{t('friends.add')}</Button>)}
      <Link className={buttonClassName('ghost', 'small', styles.profile)} to={`/players/${encodeURIComponent(player.id)}`}
        onClick={onClose}>{t('playerCard.viewProfile')}</Link>
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </Popover>;
}
