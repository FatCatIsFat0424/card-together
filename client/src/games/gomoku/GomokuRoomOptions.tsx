import type { ReactNode } from 'react';
import { DEFAULT_GOMOKU_OPTIONS } from '@shared/rules/gomoku';
import { RoomOption } from '../../components/RoomOption';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

export function GomokuRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  const options = gameOptions?.gomoku ?? DEFAULT_GOMOKU_OPTIONS;
  return <>
    <RoomOption id="gomoku-renju-hint" label={t('gomoku.renju')} hint={t('gomoku.renjuHint')}
      checked={options.renju} disabled={disabled}
      onChange={(renju) => setGameOptions({ gameType: 'gomoku', options: { ...options, renju } })} />
    <RoomOption id="gomoku-swap-hint" label={t('gomoku.swap')} hint={t('gomoku.swapHint')}
      checked={options.swap} disabled={disabled}
      onChange={(swap) => setGameOptions({ gameType: 'gomoku', options: { ...options, swap } })} />
  </>;
}
