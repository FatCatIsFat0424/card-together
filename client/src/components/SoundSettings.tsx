import type { ReactNode } from 'react';
import type { TranslationKey } from '../i18n';
import { useI18nStore } from '../stores/i18n-store';
import { useMusicStore } from '../stores/music-store';
import { useSoundEffectsStore } from '../stores/sound-effects-store';
import { useTurnSoundStore } from '../stores/turn-sound-store';
import { AppCheckbox } from './AppCheckbox';
import styles from './SoundSettings.module.css';

interface SoundToggle {
  id: string;
  label: TranslationKey;
  hint: TranslationKey;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Device-local switches for game sound effects, background music, and the turn and join chimes. */
export function SoundSettings(): ReactNode {
  const { t } = useI18nStore();
  const effectsEnabled = useSoundEffectsStore((state) => state.enabled);
  const setEffectsEnabled = useSoundEffectsStore((state) => state.setEnabled);
  const musicEnabled = useMusicStore((state) => state.enabled);
  const setMusicEnabled = useMusicStore((state) => state.setEnabled);
  const turnSoundEnabled = useTurnSoundStore((state) => state.enabled);
  const setTurnSoundEnabled = useTurnSoundStore((state) => state.setEnabled);
  const toggles: SoundToggle[] = [
    { id: 'effects', label: 'sound.effects', hint: 'sound.effectsHint', checked: effectsEnabled, onChange: setEffectsEnabled },
    { id: 'music', label: 'sound.music', hint: 'sound.musicHint', checked: musicEnabled, onChange: setMusicEnabled },
    { id: 'turn', label: 'music.turnSound', hint: 'music.turnSoundHint', checked: turnSoundEnabled, onChange: setTurnSoundEnabled },
  ];
  return (
    <div className={styles.settings}>
      <ul className={styles.list}>
        {toggles.map((toggle) => <li key={toggle.id}>
          <label className={styles.toggle}>
            <AppCheckbox checked={toggle.checked} data-sound-setting={toggle.id}
              slotProps={{ input: { 'aria-describedby': `sound-setting-${toggle.id}-hint` } }}
              onChange={(event) => toggle.onChange(event.target.checked)} />
            <span className={styles.label}>{t(toggle.label)}</span>
          </label>
          <p id={`sound-setting-${toggle.id}-hint`} className={styles.hint}>{t(toggle.hint)}</p>
        </li>)}
      </ul>
      <p className={styles.hint}>{t('sound.deviceNotice')}</p>
    </div>
  );
}
