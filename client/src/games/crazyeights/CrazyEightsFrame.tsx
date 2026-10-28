import type { ReactNode } from 'react';
import { SUIT_SYMBOLS } from '@shared/constants';
import type { FrameProps } from '../game-ui';
import { useI18nStore } from '../../stores/i18n-store';

/** What an 8 declared and what an action card did, drawn under a Crazy Eights play frame. */
export function CrazyEightsFrameEffects({ frame, name, className }: FrameProps & {
  readonly className: string;
}): ReactNode {
  const { t } = useI18nStore();
  const target = frame.target ? name(frame.target) : '';
  return <>
    {frame.suit && <div className={className}>
      {t('crazyeights.declares', { suit: '' })}<strong aria-label={t(`crazyeights.suit.${frame.suit}`)}>{SUIT_SYMBOLS[frame.suit]}</strong>
    </div>}
    {frame.effect === 'skip' && <div className={className}>{t('crazyeights.effectSkip', { name: target })}</div>}
    {frame.effect === 'draw' && <div className={className}>
      {t('crazyeights.effectDraw', { name: target, n: String(frame.count ?? 0) })}</div>}
    {frame.effect === 'reverse' && <div className={className}>
      {t('crazyeights.effectReverse')}{target && <> · {t('crazyeights.effectSkip', { name: target })}</>}</div>}
  </>;
}
