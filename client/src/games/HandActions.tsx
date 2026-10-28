import type { ReactNode } from 'react';

/**
 * Explicit hand actions. On landscape phones the stylesheet floats them as pills in the bottom corner,
 * beside the hand; elsewhere they stay in the flow under it.
 */
export function HandActions({ children, className, layout = 'stack' }: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly layout?: 'stack' | 'grid' | 'wide' | 'group' | 'row' | 'sheet';
}): ReactNode {
  return <div className={className} data-hand-actions={layout}>{children}</div>;
}
