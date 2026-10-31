import type { ReactNode } from 'react';
import { useI18nStore } from '../stores/i18n-store';
import { IconButton } from './IconButton';
import { Tabs, tabElementId } from './Tabs';
import type { TabItem } from './Tabs';
import styles from './Dock.module.css';

export interface DockTab<T extends string> extends TabItem<T> {
  /** Content of the tab; every panel stays mounted so drafts and scroll positions survive tab changes. */
  readonly panel: ReactNode;
}

/**
 * A side panel with text tabs and a collapse button, shared by the waiting room and the tables.
 * It fills the height of its grid cell; the page decides the cell and whether the dock is shown.
 */
export function Dock<T extends string>({ id, label, tabs, value, onChange, onCollapse, className }: {
  /** Element id; also the prefix of the tab ids. */
  readonly id: string;
  /** Accessible name of the whole dock. */
  readonly label: string;
  readonly tabs: readonly DockTab<T>[];
  readonly value: T;
  readonly onChange: (tab: T) => void;
  readonly onCollapse: () => void;
  readonly className?: string;
}): ReactNode {
  const { t } = useI18nStore();
  const panelId = `${id}-panel`;
  return <aside id={id} aria-label={label} className={`${styles.dock} ${className ?? ''}`}>
    <div className={`${styles.head} ${tabs.length > 3 ? styles.dense : ''}`}>
      <Tabs className={styles.tabs} label={label} idPrefix={id} controls={panelId} value={value} onChange={onChange}
        tabs={tabs.map(({ id: tabId, label: tabLabel }) => ({ id: tabId, label: tabLabel }))} />
      <IconButton icon="nextPage" label={t('dock.collapse')} onClick={onCollapse} />
    </div>
    <div id={panelId} role="tabpanel" aria-labelledby={tabElementId(id, value)} className={styles.body}>
      {tabs.map((tab) => <div key={tab.id} className={styles.panel} hidden={tab.id !== value}>{tab.panel}</div>)}
    </div>
  </aside>;
}

/** Count beside a tab name, such as unread messages. */
export function DockCount({ label, children, mention = false }: {
  readonly label?: string; readonly children: ReactNode; readonly mention?: boolean;
}): ReactNode {
  return <span className={`${styles.count} ${mention ? styles.mentionCount : ''}`} aria-label={label}>{children}</span>;
}
