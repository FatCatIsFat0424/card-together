import type { ReactNode } from 'react';
import { DEFAULT_BATTLESHIP_OPTIONS } from '@shared/rules/battleship';
import { RoomOption } from '../../components/RoomOption';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

export function BattleshipRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  const options = gameOptions?.battleship ?? DEFAULT_BATTLESHIP_OPTIONS;
  return <>
    <RoomOption id="battleship-no-touching-hint" label={t('battleship.noTouching')} hint={t('battleship.noTouchingHint')}
      checked={options.noTouching} disabled={disabled}
      onChange={(noTouching) => setGameOptions({ gameType: 'battleship', options: { ...options, noTouching } })} />
    <RoomOption id="battleship-hit-again-hint" label={t('battleship.hitAgain')} hint={t('battleship.hitAgainHint')}
      checked={options.hitAgain} disabled={disabled}
      onChange={(hitAgain) => setGameOptions({ gameType: 'battleship', options: { ...options, hitAgain } })} />
  </>;
}
