import type { ReactNode } from 'react';

/**
 * Explicit hand actions. On landscape phones the stylesheet floats them as pills in the bottom corner,
 * beside the hand; elsewhere they stay in the flow under it. `corner` leaves the hand's width alone on phones, for
 * a hand that reserves the pill column itself so it does not reflow when a pill appears.
 */
export function HandActions({ children, className, layout = 'stack' }: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly layout?: 'stack' | 'grid' | 'wide' | 'group' | 'row' | 'sheet' | 'corner';
}): ReactNode {
  return <div className={className} data-hand-actions={layout}>{children}</div>;
}
