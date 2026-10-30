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
  size?: 'small' | 'row' | 'compact' | 'medium';
  linked?: boolean;
  /** Equipped nameplate title; compact lists such as the spectator area leave it out. */
  showTitle?: boolean;
  details?: ReactNode;
  /** List-row layout: nickname and @username share a line, details sit on the next one. */
  dense?: boolean;
  /** Opens the player's card over the current page instead of navigating to the profile. */
  onOpen?: (anchor: HTMLElement) => void;
}

export function PlayerLink({
  player, showUsername = false, size = 'small', linked = true, showTitle = true, details, dense = false, onOpen,
}: PlayerLinkProps): ReactNode {
  const { t } = useI18nStore();
  const identity = <>
    <Avatar avatar={player.isBot ? 'bot' : player.avatar} image={player.avatarImage} border={player.avatarBorder} color={player.color} size={size} />
    <span className={styles.identity}>
      <span className={styles.nickname}>{player.nickname}</span>
      {player.isBot && <span className={styles.botBadge}>{t('player.bot')}</span>}
      {player.isBot && <span className={styles.botBadge} data-bot-difficulty>
        {t(`room.botDifficulty.${player.botDifficulty ?? 'hard'}`)}</span>}
      {showTitle && <span data-cosmetic-title className={styles.title}><Nameplate id={player.nameplate} /></span>}
      {showUsername && !player.isBot && <span className={styles.username}>@{player.username}</span>}
      {details && <span className={styles.details}>{details}</span>}
    </span>
  </>;
  const className = dense ? `${styles.link} ${styles.dense}` : styles.link;
  if (player.isBot || !linked) return <span className={className} data-player-identity>{identity}</span>;
  if (onOpen) return (
    <button type="button" className={`${className} ${styles.opener}`} data-player-identity aria-haspopup="dialog"
      aria-label={t('playerCard.open', { nickname: player.nickname })}
      onClick={(event) => onOpen(event.currentTarget)}>
      {identity}
    </button>
  );
  return (
    <Link className={className} data-player-identity to={`/players/${encodeURIComponent(player.id)}`}
      aria-label={t('player.view', { nickname: player.nickname })}>
      {identity}
    </Link>
  );
}
