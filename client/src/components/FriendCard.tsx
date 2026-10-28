import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FriendEntry, FriendPlayStats } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import type { AppIconName } from './AppIcon';
import { Avatar } from './Avatar';
import { Button, buttonClassName } from './Button';
import { IconLink } from './IconButton';
import { Nameplate } from './Nameplate';
import { OverflowMenu } from './OverflowMenu';
import { friendActivityText, friendStatsText } from './friend-activity-text';
import type { FriendAction } from './lobby-friend-activity';
import styles from './FriendCard.module.css';

const ACTIVITY_ICONS: Readonly<Record<'playing' | 'replaying' | 'waiting' | 'lobby', AppIconName>> = {
  playing: 'cards', replaying: 'cards', waiting: 'room', lobby: 'home',
};

export interface FriendCardProps {
  readonly friend: FriendEntry;
  readonly stats: FriendPlayStats | undefined;
  readonly unread: number;
  readonly action: FriendAction | null;
  readonly invited: boolean;
  readonly busy: boolean;
  /** Phone landscape: a two-line row with an icon message button. */
  readonly compact: boolean;
  readonly confirming: boolean;
  readonly onAction: (action: FriendAction) => void;
  readonly onRemove: () => void;
  readonly onConfirmRemove: () => void;
  readonly onCancelRemove: () => void;
}

/** The friend's avatar with frame and a presence dot, linking to their profile. */
export function PresenceAvatar({ friend, size }: {
  readonly friend: Pick<FriendEntry, 'avatar' | 'avatarImage' | 'avatarBorder' | 'color' | 'online'>;
  readonly size: 'row' | 'compact' | 'medium';
}): ReactNode {
  const { t } = useI18nStore();
  return <span className={styles.presenceAvatar} data-size={size}>
    <Avatar avatar={friend.avatar} image={friend.avatarImage} border={friend.avatarBorder} color={friend.color} size={size} />
    <span className={styles.presenceDot} data-online={friend.online} role="img"
      aria-label={t(friend.online ? 'friends.online' : 'friends.offline')} />
  </span>;
}

export function FriendCard({
  friend, stats, unread, action, invited, busy, compact, confirming, onAction, onRemove, onConfirmRemove, onCancelRemove,
}: FriendCardProps): ReactNode {
  const { locale, t } = useI18nStore();
  const navigate = useNavigate();
  const activity = friendActivityText(friend, locale);
  const statParts = friendStatsText(stats, locale);
  const profile = `/players/${encodeURIComponent(friend.id)}`;
  const messages = `/messages/${encodeURIComponent(friend.id)}`;
  const menu = <OverflowMenu label={t('friends.moreFor', { nickname: friend.nickname })} disabled={busy}
    items={[
      { label: t('friends.viewProfile'), onSelect: () => navigate(profile) },
      { label: t('friends.remove'), danger: true, onSelect: onRemove },
    ]} />;
  const primary = action && <Button size={compact ? 'small' : 'regular'} variant="primary" disabled={busy || (action === 'invite' && invited)}
    className={styles.primary} icon={action === 'spectate' && !compact ? 'spectate' : undefined}
    aria-label={action === 'join' ? t('friends.joinRoomLabel', { nickname: friend.nickname })
      : action === 'spectate' ? t('friends.spectateLabel', { nickname: friend.nickname })
        : `${t('invite.send')} ${friend.nickname}`}
    onClick={() => onAction(action)}>
    {action === 'join' ? t('friends.join') : action === 'spectate' ? t('friends.spectate')
      : t(invited ? 'invite.sent' : 'invite.send')}
  </Button>;
  const unreadLabel = unread > 0 ? `${t('messages.openFor', { nickname: friend.nickname })}, ${t('social.unread', { n: String(unread) })}`
    : t('messages.openFor', { nickname: friend.nickname });
  const confirm = <div className={styles.confirm}>
    <span>{t('friends.confirmRemove')}</span>
    <Button size="small" variant="danger-text" disabled={busy} onClick={onConfirmRemove}>{t('friends.remove')}</Button>
    <Button size="small" disabled={busy} onClick={onCancelRemove}>{t('common.cancel')}</Button>
  </div>;

  if (compact) {
    return <li className={styles.row} data-online={friend.online || undefined}>
      <Link to={profile} className={styles.rowIdentity} aria-label={t('player.view', { nickname: friend.nickname })}>
        <PresenceAvatar friend={friend} size="compact" />
        <span className={styles.rowText}>
          <b>{friend.nickname}</b>
          {activity && <small>{friend.online && <span className={styles.liveDot} aria-hidden="true" />}
            {friend.online || !statParts || !stats?.together ? activity.short : `${activity.short} · ${statParts[0]}`}</small>}
        </span>
      </Link>
      {confirming ? confirm : <div className={styles.rowActions}>
        <IconLink to={messages} icon="chat" label={unreadLabel} badge={unread} />
        {primary}
        {menu}
      </div>}
    </li>;
  }

  return <li className={styles.card} data-online={friend.online || undefined}>
    <div className={styles.top}>
      <Link to={profile} className={styles.avatarLink} tabIndex={-1} aria-hidden="true">
        <PresenceAvatar friend={friend} size="medium" />
      </Link>
      <div className={styles.identity}>
        <span className={styles.nameLine}>
          <Link to={profile} className={styles.name} aria-label={t('player.view', { nickname: friend.nickname })}>
            {friend.nickname}</Link>
          <Nameplate id={friend.nameplate} />
        </span>
        <small>@{friend.username}</small>
      </div>
      <div className={styles.menu}>{menu}</div>
    </div>
    {activity && (activity.kind === 'offline'
      ? <p className={styles.seen}><span className={styles.offDot} aria-hidden="true" />{activity.title}</p>
      : <div className={styles.activity} data-kind={activity.kind}>
        <AppIcon name={ACTIVITY_ICONS[activity.kind]} />
        <div><b>{activity.title}</b>{activity.detail && <small>{activity.detail}</small>}</div>
      </div>)}
    {statParts && <p className={styles.meta}>{statParts.map((part) => <span key={part}>{part}</span>)}</p>}
    {confirming ? confirm : <div className={styles.actions}>
      <Link className={buttonClassName('ghost', 'regular', styles.message)} to={messages} aria-label={unreadLabel}>
        {t('messages.open')}
        {unread > 0 && <span className={styles.count} aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </Link>
      {primary}
    </div>}
  </li>;
}
