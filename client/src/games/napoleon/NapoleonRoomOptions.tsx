import type { ReactNode } from 'react';
import { DEFAULT_NAPOLEON_OPTIONS } from '@shared/napoleon-options';
import { RoomOption } from '../../components/RoomOption';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

export function NapoleonRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  return <RoomOption id="napoleon-joker-summon-hint" label={t('napoleon.jokerSummon')}
    hint={t('napoleon.jokerSummonHint')} checked={(gameOptions?.napoleon ?? DEFAULT_NAPOLEON_OPTIONS).jokerSummon}
    disabled={disabled} onChange={(jokerSummon) => setGameOptions({ gameType: 'napoleon', options: { jokerSummon } })} />;
}
