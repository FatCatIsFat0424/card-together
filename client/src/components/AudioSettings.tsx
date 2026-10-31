import { useId } from 'react';
import type { ReactNode } from 'react';
import { volumePercent } from '../audio/mix';
import type { TranslationKey } from '../i18n';
import { useAudioSettingsDialogStore } from '../stores/audio-settings-dialog-store';
import { useAudioSettingsStore } from '../stores/audio-settings-store';
import { useI18nStore } from '../stores/i18n-store';
import { useMusicStore } from '../stores/music-store';
import { useSoundEffectsStore } from '../stores/sound-effects-store';
import { useTurnSoundStore } from '../stores/turn-sound-store';
import { useChatMentionStore } from '../stores/chat-mention-store';
import { AppIcon } from './AppIcon';
import styles from './AudioSettings.module.css';

interface SwitchProps {
  readonly id: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

/** Named by the label that wraps it. */
function Switch({ id, checked, onChange }: SwitchProps): ReactNode {
  return <input id={id} type="checkbox" role="switch" className={styles.switch} checked={checked}
    onChange={(event) => onChange(event.target.checked)} />;
}

interface ChannelProps {
  readonly name: TranslationKey;
  readonly enabled: boolean;
  readonly volume: number;
  readonly onEnabled: (enabled: boolean) => void;
  readonly onVolume: (volume: number) => void;
  readonly children?: ReactNode;
}

function Channel({ name, enabled, volume, onEnabled, onVolume, children }: ChannelProps): ReactNode {
  const { t } = useI18nStore();
  const id = useId();
  const label = t(name);
  const percent = volumePercent(volume);
  return <div className={styles.channel} data-enabled={enabled}>
    <div className={styles.channelHead}>
      <label htmlFor={`${id}-switch`} className={styles.channelName}>
        <Switch id={`${id}-switch`} checked={enabled} onChange={onEnabled} />
        <span>{label}</span>
      </label>
      <output htmlFor={`${id}-volume`} className={styles.value}>{percent}</output>
    </div>
    <input id={`${id}-volume`} type="range" min={0} max={100} step={1} value={percent} className={styles.slider}
      aria-label={label}
      onChange={(event) => onVolume(Number(event.target.value) / 100)} />
    {children}
  </div>;
}

/** Per-channel switches and volumes. Shared by the dialog and the account page, so every entry point is the same panel. */
export function AudioSettings({ showTitle = true, onClose }: {
  readonly showTitle?: boolean;
  /** Adds a close button beside the title when the panel is shown in a dialog. */
  readonly onClose?: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const turnId = useId();
  const mentionMode = useChatMentionStore((state) => state.mode);
  const master = useAudioSettingsStore();
  const musicEnabled = useMusicStore((state) => state.enabled);
  const musicVolume = useMusicStore((state) => state.volume);
  const effects = useSoundEffectsStore();
  const turnEnabled = useTurnSoundStore((state) => state.enabled);
  const setTurnEnabled = useTurnSoundStore((state) => state.setEnabled);
  const setMusicEnabled = useMusicStore((state) => state.setEnabled);
  const setMusicVolume = useMusicStore((state) => state.setVolume);
  return <section className={styles.panel} aria-labelledby={showTitle ? `${turnId}-title` : undefined}
    aria-label={showTitle ? undefined : t('audio.title')}>
    {showTitle && <div className={styles.header}>
      <h2 id={`${turnId}-title`} className={styles.title}>{t('audio.title')}</h2>
      {onClose && <button type="button" className={styles.close} aria-label={t('audio.close')}
        title={t('audio.close')} onClick={onClose}><AppIcon name="close" /></button>}
    </div>}
    <div className={styles.body}>
    <Channel name="audio.master" enabled={master.masterEnabled} volume={master.masterVolume}
      onEnabled={master.setMasterEnabled} onVolume={master.setMasterVolume} />
    <Channel name="audio.music" enabled={musicEnabled} volume={musicVolume}
      onEnabled={setMusicEnabled} onVolume={setMusicVolume} />
    <Channel name="audio.effects" enabled={effects.enabled} volume={effects.volume}
      onEnabled={effects.setEnabled} onVolume={effects.setVolume}>
      <label htmlFor={`${turnId}-turn`} className={styles.sub}>
        <Switch id={`${turnId}-turn`} checked={turnEnabled} onChange={setTurnEnabled} />
        <span>{t('audio.turnReminder')}</span>
      </label>
      <label className={styles.mentionLabel} htmlFor={`${turnId}-mentions`}>{t('chat.notifications')}</label>
      <select id={`${turnId}-mentions`} className={styles.mentionSelect} value={mentionMode}
        onChange={(event) => {
          const mode = event.target.value;
          if (mode === 'sound' || mode === 'visual' || mode === 'off') useChatMentionStore.getState().setMode(mode);
        }}>
        {(['sound', 'visual', 'off'] as const).map((mode) =>
          <option key={mode} value={mode}>{t(`chat.notifications.${mode}`)}</option>)}
      </select>
      <p className={styles.note}>{t('chat.notifications.note')}</p>
    </Channel>
    <Channel name="audio.voice" enabled={master.voiceEnabled} volume={master.voiceVolume}
      onEnabled={master.setVoiceEnabled} onVolume={master.setVoiceVolume} />
    <p className={styles.note}>{t('audio.effectsNote')}</p>
    <p className={styles.note}>{t('audio.voiceNote')}</p>
    <p className={styles.note}>{t('audio.deviceNotice')}</p>
    </div>
  </section>;
}

/** Entry point that opens the shared audio settings dialog. */
export function AudioSettingsButton({ className = '', label }: {
  readonly className?: string;
  readonly label?: string;
}): ReactNode {
  const { t } = useI18nStore();
  const openDialog = useAudioSettingsDialogStore((state) => state.openDialog);
  return <button type="button" className={`${styles.open} ${className}`} onClick={openDialog}>
    <AppIcon name="volume" />
    <span>{label ?? t('audio.title')}</span>
  </button>;
}
