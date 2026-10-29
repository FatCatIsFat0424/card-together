import type { ReactNode } from 'react';
import { DEFAULT_DOUDIZHU_OPTIONS } from '@shared/doudizhu-options';
import { RoomOption } from '../../components/RoomOption';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

export function DouDizhuRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  return <RoomOption id="doudizhu-grab-hint" label={t('doudizhu.grabOption')} hint={t('doudizhu.grabOptionHint')}
    checked={(gameOptions?.doudizhu ?? DEFAULT_DOUDIZHU_OPTIONS).variant === 'grab'} disabled={disabled}
    onChange={(grab) => setGameOptions({ gameType: 'doudizhu', options: { variant: grab ? 'grab' : 'score' } })} />;
}
