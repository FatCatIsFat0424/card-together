import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PlayerInfo } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { Avatar } from './Avatar';
import { Nameplate } from './Nameplate';
import styles from './PlayerLink.module.css';

interface PlayerLinkProps {
  player: PlayerInfo;
  showUsername?: boolean;
  size?: 'small' | 'compact' | 'medium';
  linked?: boolean;
  /** Equipped nameplate title; compact lists such as the spectator area leave it out. */
  showTitle?: boolean;
}

export function PlayerLink({
  player, showUsername = false, size = 'small', linked = true, showTitle = true,
}: PlayerLinkProps): ReactNode {
  const { t } = useI18nStore();
  const identity = <>
    <Avatar avatar={player.avatar} image={player.avatarImage} border={player.avatarBorder} color={player.color} size={size} />
    <span className={styles.identity}>
      <span className={styles.nickname}>{player.nickname}</span>
      {player.isBot && <span className={styles.botBadge}>{t('player.bot')}</span>}
      {player.isBot && <span className={styles.botBadge}>{t(`room.botDifficulty.${player.botDifficulty ?? 'hard'}`)}</span>}
      {showTitle && <span data-cosmetic-title className={styles.title}><Nameplate id={player.nameplate} /></span>}
      {showUsername && !player.isBot && <span className={styles.username}>@{player.username}</span>}
    </span>
  </>;
  if (player.isBot || !linked) return <span className={styles.link} data-player-identity>{identity}</span>;
  return (
    <Link className={styles.link} data-player-identity to={`/players/${encodeURIComponent(player.id)}`}
      aria-label={t('player.view', { nickname: player.nickname })}>
      {identity}
    </Link>
  );
}
