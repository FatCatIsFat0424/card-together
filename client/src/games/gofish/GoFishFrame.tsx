import type { ReactNode } from 'react';
import { RANK_DISPLAY } from '@shared/constants';
import type { FrameProps } from '../game-ui';
import { useI18nStore } from '../../stores/i18n-store';

/** The ask and its result, or the rank of a book, drawn under a Go Fish presentation heading. */
export function GoFishFrame({ frame, name }: FrameProps): ReactNode {
  const { t } = useI18nStore();
  const data = frame.goFish;
  if (!data) return null;
  const rank = RANK_DISPLAY[data.rank];
  if (frame.kind === 'award') return <p>{t('gofish.frameBook', { rank })}</p>;
  if (frame.kind !== 'play' || !frame.target) return null;
  const result = data.given ? t('gofish.frameGot', { n: String(data.given) })
    : data.fished === 'lucky' ? t('gofish.frameLucky', { rank })
      : data.fished === 'empty' ? t('gofish.frameEmpty') : t('gofish.frameFish');
  return <>
    <p>{t('gofish.frameFor', { name: name(frame.target), rank })}</p>
    <p><strong>{result}</strong></p>
  </>;
}
