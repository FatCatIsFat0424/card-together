import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useShellStore } from '../stores/shell-store';
import { AppIcon } from './AppIcon';
import type { AppIconName } from './AppIcon';
import { DESKTOP_SHELL_QUERY } from './desktop-nav';
import styles from './PageHeader.module.css';

/**
 * A page's title, tabs and short summary. The desktop shell shows them in its top bar's empty left half;
 * elsewhere they form a slim header that sticks to the top. Short landscape screens hide the title text (the rail
 * marks the page) and use `compactSummary` in place of `summary`.
 */
export function PageHeader({ title, icon, iconColor, tabs, summary, compactSummary }: {
  readonly title: string;
  readonly icon?: AppIconName;
  /** CSS colour of the title and summary icons */
  readonly iconColor?: string;
  readonly tabs?: ReactNode;
  readonly summary?: ReactNode;
  readonly compactSummary?: ReactNode;
}): ReactNode {
  const slot = useShellStore((state) => state.headerSlot);
  const desktop = useMediaQuery(DESKTOP_SHELL_QUERY);
  const content = <>
    <h1 className={styles.title}>{icon && <AppIcon name={icon} />}<span className={styles.titleText}>{title}</span></h1>
    {tabs && <div className={styles.tabs}>{tabs}</div>}
    {summary && <p className={styles.summary}>
      <span className={compactSummary ? styles.full : undefined}>{summary}</span>
      {compactSummary && <span className={styles.compact} aria-hidden="true">{compactSummary}</span>}
    </p>}
  </>;
  const style = iconColor ? { '--page-header-icon': iconColor } as CSSProperties : undefined;
  if (desktop && slot) {
    return createPortal(<div className={`${styles.header} ${styles.inBar}`} style={style}>{content}</div>, slot);
  }
  return <header className={styles.header} style={style}>{content}</header>;
}
