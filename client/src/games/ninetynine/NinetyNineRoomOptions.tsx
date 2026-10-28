import type { ReactNode } from 'react';
import { RoomOption } from '../../components/RoomOption';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

export function NinetyNineRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  return <RoomOption id="ninetynine-two-decks-hint" label={t('ninetynine.twoDecks')}
    hint={t('ninetynine.twoDecksHint')} checked={gameOptions?.ninetynine?.twoDecks ?? false} disabled={disabled}
    onChange={(twoDecks) => setGameOptions({ gameType: 'ninetynine', options: { twoDecks } })} />;
}
