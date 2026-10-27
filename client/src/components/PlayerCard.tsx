// ─── PlayerCard: in-game popover with a seated player's identity, record, and friendship ───

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Popover from '@mui/material/Popover';
import { Link } from 'react-router-dom';
import type { FriendsData, GameType, MatchHistory, PlayerInfo } from '@shared/types';
import { apiRequest } from '../api';
import { gameHistoryStatistics } from '../match-history';
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
  const [history, setHistory] = useState<MatchHistory | 'private' | 'failed' | null>(null);
  const [friends, setFriends] = useState<FriendsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (player.isBot) return undefined;
    let live = true;
    const id = encodeURIComponent(player.id);
    void apiRequest<MatchHistory>(`/api/players/${id}/history`).then((result) => {
      if (live) setHistory(result.success ? result : result.status === 403 ? 'private' : 'failed');
    });
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
  const statistics = history && typeof history === 'object' ? gameHistoryStatistics(history.matches, player.id) : null;
  const current = statistics?.find((game) => game.gameType === gameType);
  const total = statistics?.reduce((count, game) => count + game.played, 0) ?? 0;
  const isFriend = friends?.friends.some((friend) => friend.id === player.id) ?? false;
  const incoming = friends?.incoming.some((request) => request.requester.id === player.id) ?? false;
  const outgoing = friends?.outgoing.some((request) => request.recipient.id === player.id) ?? false;
  const game = t(`gameType.${gameType}`);

  return <Popover open anchorEl={anchor} onClose={onClose}
    anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}
    slotProps={{ paper: { className: styles.card, role: 'dialog', 'aria-label': t('playerCard.label', { nickname: player.nickname }) } }}>
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
      {history === null ? <span className={styles.muted}>{t('common.loading')}</span>
        : history === 'private' ? <span className={styles.muted}>{t('playerCard.private')}</span>
          : history === 'failed' ? <span className={styles.muted}>{t('common.error')}</span>
            : <>
              <span>{current?.played ? t('playerCard.thisGame', {
                game, played: String(current.played), rate: percent.format(current.winRate ?? 0),
              }) : t('playerCard.noGames', { game })}</span>
              <span className={styles.muted}>{t('playerCard.total', { n: String(total) })}</span>
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
