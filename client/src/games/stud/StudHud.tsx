import type { ReactNode } from 'react';
import { STUD_HANDS } from '@shared/rules/stud';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { useGamePresentation } from '../use-game-presentation';
import { studView } from './stud-view';

/** The table's info line: hand number, stakes and street, following the presentation frame. */
export function StudHud(): ReactNode {
  const { t } = useI18nStore();
  const stud = useGameStore((state) => state.stud);
  const { frame } = useGamePresentation();
  const view = stud && studView(stud, frame);
  if (!view || view.hand <= 0) return null;
  return <>
    {t('holdem.handOf', { n: String(view.hand), total: String(STUD_HANDS) })} ·
    {' '}{t('stud.stakes', { ante: String(view.ante), bet: String(view.minBet) })} ·
    {' '}{t(`stud.street.${view.street}`)}
  </>;
}
