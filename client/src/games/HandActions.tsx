import type { ReactNode } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';

/** Preserve the original control row's footprint while its usable copy floats beside the hand. */
export function HandActions({ children, className, layout = 'stack' }: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly layout?: 'stack' | 'bigtwo' | 'wide' | 'group';
}): ReactNode {
  const landscape = useMediaQuery('(max-height: 500px) and (min-width: 600px)');
  return <>
    {landscape && <div className={className} data-hand-actions-placeholder={layout} inert aria-hidden="true">
      {children}
    </div>}
    <div className={className} data-hand-actions={layout}>{children}</div>
  </>;
}
