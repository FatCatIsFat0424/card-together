import type { ReactNode } from 'react';
import { RoomOption } from '../../components/RoomOption';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

export function CrazyEightsRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  return <RoomOption id="crazyeights-action-cards-hint" label={t('crazyeights.actionCards')}
    hint={t('crazyeights.actionCardsHint')} checked={gameOptions?.crazyeights?.actionCards ?? false} disabled={disabled}
    onChange={(actionCards) => setGameOptions({ gameType: 'crazyeights', options: { actionCards } })} />;
}
