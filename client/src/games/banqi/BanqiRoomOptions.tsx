import type { ReactNode } from 'react';
import { LEGACY_BANQI_OPTIONS } from '@shared/banqi-options';
import { RoomOption } from '../../components/RoomOption';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

export function BanqiRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  // Rooms saved before the options existed played without them; new rooms always carry the defaults.
  const options = gameOptions?.banqi ?? LEGACY_BANQI_OPTIONS;
  return <>
    <RoomOption id="banqi-chain-hint" label={t('banqi.chain')} hint={t('banqi.chainHint')} checked={options.chain}
      disabled={disabled} onChange={(chain) => setGameOptions({ gameType: 'banqi', options: { ...options, chain } })} />
    <RoomOption id="banqi-rook-dash-hint" label={t('banqi.rookDash')} hint={t('banqi.rookDashHint')}
      checked={options.rookDash} disabled={disabled}
      onChange={(rookDash) => setGameOptions({ gameType: 'banqi', options: { ...options, rookDash } })} />
  </>;
}
