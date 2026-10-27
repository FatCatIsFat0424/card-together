import type { ReactNode } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { GAME_TYPES } from '@shared/constants';
import { DEFAULT_NAPOLEON_OPTIONS } from '@shared/napoleon-options';
import { LEGACY_SEVENS_OPTIONS, SEVENS_SLAY_EFFECTS, sevensSlayEffect } from '@shared/sevens-options';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import type {
  BlackjackOptions, GameType, NapoleonOptions, NinetyNineOptions, RoomInfo, SevensOptions, TimeControl,
} from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { AppCheckbox } from './AppCheckbox';
import { TimeControlSettings } from './TimeControlSettings';
import styles from './RoomSettings.module.css';

export interface RoomSettingsActions {
  readonly setGameType: (gameType: GameType) => void;
  readonly setTimeControl: (settings: TimeControl) => void;
  readonly setShuffleSeats: (enabled: boolean) => void;
  readonly setSevensOptions: (options: SevensOptions) => void;
  readonly setNinetyNineOptions: (options: NinetyNineOptions) => void;
  readonly setBlackjackOptions: (options: BlackjackOptions) => void;
  readonly setNapoleonOptions: (options: NapoleonOptions) => void;
}

interface RoomSettingsProps extends RoomSettingsActions {
  readonly room: RoomInfo;
  /** Only the host edits, and only while the room waits and the connection is idle. */
  readonly editable: boolean;
  readonly isHost: boolean;
  /** A request is in flight: keep the enabled look while input is locked. */
  readonly pending: boolean;
}

/** One labelled switch row; the whole row toggles, and the hint stays readable to screen readers. */
function Option({ id, label, hint, checked, disabled, onChange }: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}): ReactNode {
  return <label className={styles.option} title={hint}>
    <span>{label}</span>
    <AppCheckbox checked={checked} disabled={disabled} slotProps={{ input: { 'aria-describedby': id } }}
      onChange={(event) => onChange(event.target.checked)} />
    <span id={id} className={styles.srOnly}>{hint}</span>
  </label>;
}

/** Everything the host can configure for the room: game, turn timer, seat shuffling and the game's own options. */
export function RoomSettings({ room, editable, isHost, pending, ...actions }: RoomSettingsProps): ReactNode {
  const { t } = useI18nStore();
  const lock = !editable;
  const pendingFlag = pending && isHost && room.status === 'waiting' || undefined;
  return <div className={styles.panel}>
    <label className={styles.field}>
      <span className={styles.label}>{t('gameType.label')}</span>
      <Select size="small" className={styles.select} value={room.gameType} disabled={lock}
        data-pending-disabled={pendingFlag}
        title={isHost ? undefined : t('room.hostOnly')}
        inputProps={{ 'aria-label': t('gameType.label') }}
        MenuProps={{ slotProps: { paper: { className: styles.menu } } }}
        onChange={(event) => {
          const selected = GAME_TYPES.find((gameType) => gameType === event.target.value);
          if (selected) actions.setGameType(selected);
        }}>
        {GAME_TYPES.map((gameType) => <MenuItem key={gameType} value={gameType}>{t(`gameType.${gameType}`)}</MenuItem>)}
      </Select>
    </label>
    <TimeControlSettings
      key={`${room.code}:${room.hostId}:${room.timeControl?.baseSeconds}:${room.timeControl?.bankSeconds}`}
      value={room.timeControl ?? DEFAULT_TIME_CONTROL} disabled={lock} onSave={actions.setTimeControl} />
    <Option id="room-shuffle-hint" label={t('room.shuffleSeats')} hint={t('room.shuffleSeats')}
      checked={room.shuffleSeats ?? false} disabled={lock} onChange={actions.setShuffleSeats} />
    {room.gameType === 'sevens' && <Option id="sevens-close-on-end-hint" label={t('sevens.closeOnEnd')}
      hint={t('sevens.closeOnEndHint')} checked={room.sevensOptions?.closeOnEnd ?? false} disabled={lock}
      onChange={(closeOnEnd) => actions.setSevensOptions({ ...(room.sevensOptions ?? LEGACY_SEVENS_OPTIONS), closeOnEnd })} />}
    {/* The effect only matters once Dragon Slaying is on, so it appears beside that option. */}
    {room.gameType === 'sevens' && room.sevensOptions?.closeOnEnd && <label className={styles.option}
      title={t('sevens.slayEffectHint')}>
      <span>{t('sevens.slayEffect')}</span>
      <Select size="small" className={styles.select} value={sevensSlayEffect(room.sevensOptions)} disabled={lock}
        inputProps={{ 'aria-label': t('sevens.slayEffect'), 'aria-describedby': 'sevens-slay-effect-hint' }}
        MenuProps={{ slotProps: { paper: { className: styles.menu } } }}
        onChange={(event) => {
          const slayEffect = SEVENS_SLAY_EFFECTS.find((effect) => effect === event.target.value);
          if (slayEffect && room.sevensOptions) actions.setSevensOptions({ ...room.sevensOptions, slayEffect });
        }}>
        {SEVENS_SLAY_EFFECTS.map((effect) => <MenuItem key={effect} value={effect}>{t(`sevens.slayEffect.${effect}`)}</MenuItem>)}
      </Select>
      <span id="sevens-slay-effect-hint" className={styles.srOnly}>{t('sevens.slayEffectHint')}</span>
    </label>}
    {room.gameType === 'ninetynine' && <Option id="ninetynine-two-decks-hint" label={t('ninetynine.twoDecks')}
      hint={t('ninetynine.twoDecksHint')} checked={room.ninetyNineOptions?.twoDecks ?? false} disabled={lock}
      onChange={(twoDecks) => actions.setNinetyNineOptions({ twoDecks })} />}
    {room.gameType === 'blackjack' && <Option id="blackjack-player-dealer-hint" label={t('blackjack.playerDealer')}
      hint={t('blackjack.playerDealerHint')} checked={room.blackjackOptions?.playerDealer ?? false} disabled={lock}
      onChange={(playerDealer) => actions.setBlackjackOptions({ playerDealer })} />}
    {room.gameType === 'napoleon' && <Option id="napoleon-joker-summon-hint" label={t('napoleon.jokerSummon')}
      hint={t('napoleon.jokerSummonHint')} checked={(room.napoleonOptions ?? DEFAULT_NAPOLEON_OPTIONS).jokerSummon}
      disabled={lock} onChange={(jokerSummon) => actions.setNapoleonOptions({ jokerSummon })} />}
    {!isHost && <p className={styles.note}>{t('room.hostOnly')}</p>}
  </div>;
}
