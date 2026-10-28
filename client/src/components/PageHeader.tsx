import type { CSSProperties, ReactNode } from 'react';
import { AppIcon } from './AppIcon';
import type { AppIconName } from './AppIcon';
import styles from './PageHeader.module.css';

/**
 * A page's title, tabs, short summary and actions as one row at the top of the page. Desktop pages get a 56px row
 * with the title and tabs on the left and the summary and actions on the right; elsewhere it is a slim 40px header
 * that sticks to the top. Short landscape screens hide the title text (the rail marks the page) and use
 * `compactSummary` in place of `summary`.
 */
export function PageHeader({ title, titleHidden = false, icon, iconColor, tabs, summary, compactSummary, actions }: {
  readonly title: string;
  /** Keep the heading for screen readers only, for pages whose tabs already name them. */
  readonly titleHidden?: boolean;
  readonly icon?: AppIconName;
  /** CSS colour of the title and summary icons */
  readonly iconColor?: string;
  readonly tabs?: ReactNode;
  readonly summary?: ReactNode;
  readonly compactSummary?: ReactNode;
  /** Page-level buttons at the right end of the row. */
  readonly actions?: ReactNode;
}): ReactNode {
  const style = iconColor ? { '--page-header-icon': iconColor } as CSSProperties : undefined;
  return <header className={styles.header} style={style}>
    <h1 className={`${styles.title} ${titleHidden ? styles.hidden : ''}`}>
      {icon && <AppIcon name={icon} />}<span className={styles.titleText}>{title}</span>
    </h1>
    {tabs && <div className={styles.tabs}>{tabs}</div>}
    {(summary || actions) && <div className={styles.end}>
      {summary && <p className={styles.summary}>
        <span className={compactSummary ? styles.full : undefined}>{summary}</span>
        {compactSummary && <span className={styles.compact} aria-hidden="true">{compactSummary}</span>}
      </p>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>}
  </header>;
}
