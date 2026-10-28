import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { AppIcon } from './AppIcon';
import type { AppIconName } from './AppIcon';
import { badgeText } from './IconButton';
import styles from './ActionButton.module.css';

export interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  readonly icon: AppIconName;
  /** Visible text. */
  readonly text: string;
  /** Accessible name when it should say more than the text (a count, a longer phrase); it must contain the text. */
  readonly label?: string;
  /** A count (hidden at 0, `99+` above 99) or a plain dot. */
  readonly badge?: number | 'dot';
  readonly badgeTone?: 'danger' | 'success';
  /** Red outline for a leaving or destructive action. */
  readonly danger?: boolean;
  /** The text hides, leaving a square icon button with a tooltip, when the nearest size container is narrow. */
  readonly collapsible?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}

/** An icon and text in a 36px pill. Inside a size container, `collapsible` ones shrink to icons without changing role. */
export function ActionButton({
  icon, text, label, badge, badgeTone, danger = false, collapsible = false, className, type = 'button', title, ...props
}: ActionButtonProps): ReactNode {
  const count = badgeText(badge);
  const classes = [styles.action, danger && styles.danger, collapsible && styles.collapsible, badgeTone === 'success' && styles.success,
    className].filter(Boolean).join(' ');
  return <button {...props} type={type} aria-label={label ?? text} title={title ?? label ?? text} className={classes}>
    <AppIcon name={icon} />
    <span className={styles.text}>{text}</span>
    {badge === 'dot' && <span className={styles.dot} aria-hidden="true" />}
    {count && <span className={styles.count} aria-hidden="true">{count}</span>}
  </button>;
}
