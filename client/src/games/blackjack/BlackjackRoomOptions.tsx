import type { ReactNode } from 'react';
import { RoomOption } from '../../components/RoomOption';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

export function BlackjackRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  return <RoomOption id="blackjack-player-dealer-hint" label={t('blackjack.playerDealer')}
    hint={t('blackjack.playerDealerHint')} checked={gameOptions?.blackjack?.playerDealer ?? false} disabled={disabled}
    onChange={(playerDealer) => setGameOptions({ gameType: 'blackjack', options: { playerDealer } })} />;
}
