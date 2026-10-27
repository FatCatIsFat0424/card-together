import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabItem<T extends string> {
  readonly id: T;
  readonly label: ReactNode;
}

/** Index a navigation key moves to in a horizontal tab list, or null when the key is not a tab key. */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight': return (index + 1) % count;
    case 'ArrowLeft': return (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

export function tabElementId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

/**
 * Underlined text tabs. Selection follows focus; only the selected tab is in the Tab order and
 * arrow keys, Home and End move between tabs. The labelled panel must carry `id={controls}`.
 */
export function Tabs<T extends string>({ tabs, value, onChange, label, idPrefix, controls, className }: {
  readonly tabs: readonly TabItem<T>[];
  readonly value: T;
  readonly onChange: (id: T) => void;
  /** Accessible name of the tab list. */
  readonly label: string;
  /** Prefix of the generated tab ids; the panel can reference one with `tabElementId`. */
  readonly idPrefix: string;
  /** Id of the panel the tabs switch. */
  readonly controls: string;
  readonly className?: string;
}): ReactNode {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const selected = Math.max(0, tabs.findIndex((tab) => tab.id === value));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = nextTabIndex(event.key, selected, tabs.length);
    if (target === null) return;
    event.preventDefault();
    const next = tabs[target];
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };

  return <div role="tablist" aria-label={label} aria-orientation="horizontal" onKeyDown={onKeyDown}
    className={`${styles.tabs} ${className ?? ''}`}>
    {tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={tabElementId(idPrefix, tab.id)}
      ref={(element) => { if (element) refs.current.set(tab.id, element); else refs.current.delete(tab.id); }}
      aria-selected={index === selected} aria-controls={controls} tabIndex={index === selected ? 0 : -1}
      className={`${styles.tab} ${index === selected ? styles.selected : ''}`} onClick={() => onChange(tab.id)}>
      {tab.label}
    </button>)}
  </div>;
}
