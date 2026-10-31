import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import type { AppIconName } from './AppIcon';
import styles from './IconButton.module.css';

export interface IconButtonLook {
  readonly icon: AppIconName;
  /** Accessible name; include any badge count, because the badge itself is decorative. */
  readonly label: string;
  /** A count (hidden at 0, `99+` above 99) or a plain dot. */
  readonly badge?: number | 'dot';
  /** Unread mentions replace an ordinary chat count with an explicit @ count. */
  readonly mentionCount?: number;
  readonly badgeTone?: 'danger' | 'success';
  /** The control stands for the current page or an open panel. */
  readonly current?: boolean;
  readonly className?: string;
}

/** Text of a count badge, or null when nothing should show. */
export function badgeText(badge: number | 'dot' | undefined): string | null {
  if (typeof badge !== 'number' || badge <= 0) return null;
  return badge > 99 ? '99+' : String(badge);
}

function classNameOf({ badgeTone, current, className }: IconButtonLook): string {
  return [styles.iconButton, current && styles.current, badgeTone === 'success' && styles.successBadge, className]
    .filter(Boolean).join(' ');
}

function Content({ icon, badge, mentionCount }: Pick<IconButtonLook, 'icon' | 'badge' | 'mentionCount'>): ReactNode {
  const mentions = badgeText(mentionCount);
  const text = mentions ? `@${mentions}` : badgeText(badge);
  return <>
    <AppIcon name={icon} />
    {badge === 'dot' && <span className={styles.dot} aria-hidden="true" />}
    {text && <span className={`${styles.count} ${mentions ? styles.mentionCount : ''}`} aria-hidden="true">{text}</span>}
  </>;
}

export interface IconButtonProps extends IconButtonLook,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'aria-label'> {
  readonly ref?: Ref<HTMLButtonElement>;
}

/** A 20px glyph in a 40px hit area, without a background or border. */
export function IconButton({ icon, label, badge, mentionCount, badgeTone, current, className, type = 'button', title, ...props }: IconButtonProps): ReactNode {
  return <button {...props} type={type} aria-label={label} title={title ?? label}
    className={classNameOf({ icon, label, badge, badgeTone, current, className })}>
    <Content icon={icon} badge={badge} mentionCount={mentionCount} />
  </button>;
}

export interface IconLinkProps extends IconButtonLook {
  readonly to: string;
  readonly onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** `IconButton` look for navigation; `current` also sets `aria-current="page"`. */
export function IconLink({ to, icon, label, badge, mentionCount, badgeTone, current, className, onClick }: IconLinkProps): ReactNode {
  return <Link to={to} aria-label={label} title={label} onClick={onClick}
    aria-current={current ? 'page' : undefined}
    className={classNameOf({ icon, label, badge, badgeTone, current, className })}>
    <Content icon={icon} badge={badge} mentionCount={mentionCount} />
  </Link>;
}
