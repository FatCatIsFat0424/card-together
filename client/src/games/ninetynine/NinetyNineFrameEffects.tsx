import type { ReactNode } from 'react';
import type { FrameProps } from '../game-ui';
import { useI18nStore } from '../../stores/i18n-store';

/** Direction change and target markers that follow a Ninety-Nine frame's running total. */
export function NinetyNineFrameEffects({ frame, name, className }: FrameProps & {
  readonly className: string;
}): ReactNode {
  const { t } = useI18nStore();
  return <>
    {frame.direction && <div className={className}>
      <span aria-label={t(frame.direction === 'cw' ? 'presentation.clockwise' : 'presentation.counterclockwise')}>
        {frame.direction === 'cw' ? '↻' : '↺'}
      </span>
      {frame.choice && ` ${frame.choice === 'plus' ? '+' : '−'}${frame.cards[0]?.rank === 12 ? 20 : 10}`}
    </div>}
    {frame.target && <div className={className}>
      → <strong>{name(frame.target)}</strong>
    </div>}
  </>;
}
