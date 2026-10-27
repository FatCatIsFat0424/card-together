import type { ReactNode } from 'react';
import { HE_HANDS } from '@shared/rules/holdem';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { useGamePresentation } from '../use-game-presentation';
import { holdemView } from './holdem-view';

/** The table's info line: hand number, blinds and street, following the presentation frame. */
export function HoldemHud(): ReactNode {
  const { t } = useI18nStore();
  const holdem = useGameStore((state) => state.holdem);
  const { frame } = useGamePresentation();
  const view = holdem && holdemView(holdem, frame);
  if (!view || view.hand <= 0) return null;
  return <>
    {t('holdem.handOf', { n: String(view.hand), total: String(HE_HANDS) })} ·
    {' '}{t('holdem.blinds', { sb: String(view.smallBlind), bb: String(view.bigBlind) })} ·
    {' '}{t(`holdem.street.${view.street}`)}
  </>;
}
