import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AppIcon } from './AppIcon';
import type { AppIconName } from './AppIcon';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'success' | 'ghost' | 'text' | 'danger-text';
export type ButtonSize = 'regular' | 'small';

const VARIANT_CLASS: Readonly<Record<ButtonVariant, string>> = {
  primary: styles.primary, success: styles.success, ghost: styles.ghost,
  text: styles.text, 'danger-text': styles.dangerText,
};

/** Class names of a button look, for elements such as router links that cannot render `Button`. */
export function buttonClassName(variant: ButtonVariant = 'ghost', size: ButtonSize = 'regular', extra?: string): string {
  return [styles.button, size === 'small' ? styles.small : styles.regular, VARIANT_CLASS[variant], extra]
    .filter(Boolean).join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** One solid `primary` or `success` action per screen; everything else is `ghost` or `text`. */
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Leading glyph; the visible text still names the button. */
  readonly icon?: AppIconName;
}

export function Button({ variant = 'ghost', size = 'regular', icon, className, type = 'button', children, ...props }: ButtonProps): ReactNode {
  return <button {...props} type={type} className={buttonClassName(variant, size, className)}>
    {icon && <AppIcon name={icon} />}
    {children}
  </button>;
}
