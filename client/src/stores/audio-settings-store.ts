import { create } from 'zustand';
import { channelGain, clampVolume, mixedGain, parseVolume } from '../audio/mix';
import type { ChannelLevel } from '../audio/mix';
import { readPreference, writePreference } from '../utils/preference-storage';

const MASTER_ENABLED_KEY = 'audio.master.enabled';
const MASTER_VOLUME_KEY = 'audio.master.volume';
const VOICE_ENABLED_KEY = 'audio.voice.enabled';
const VOICE_VOLUME_KEY = 'audio.voice.volume';

interface AudioSettingsState {
  /** Switch and volume applied on top of every other channel. */
  masterEnabled: boolean;
  masterVolume: number;
  /** Overall voice chat output; each player's own volume is applied under it. */
  voiceEnabled: boolean;
  voiceVolume: number;
  setMasterEnabled: (enabled: boolean) => void;
  setMasterVolume: (volume: number) => void;
  setVoiceEnabled: (enabled: boolean) => void;
  setVoiceVolume: (volume: number) => void;
}

export const useAudioSettingsStore = create<AudioSettingsState>((set) => ({
  masterEnabled: readPreference(MASTER_ENABLED_KEY) !== 'false',
  masterVolume: parseVolume(readPreference(MASTER_VOLUME_KEY), 1),
  voiceEnabled: readPreference(VOICE_ENABLED_KEY) !== 'false',
  voiceVolume: parseVolume(readPreference(VOICE_VOLUME_KEY), 1),
  setMasterEnabled: (enabled) => {
    set({ masterEnabled: enabled });
    writePreference(MASTER_ENABLED_KEY, String(enabled));
  },
  setMasterVolume: (value) => {
    if (!Number.isFinite(value)) return;
    const volume = clampVolume(value);
    set({ masterVolume: volume });
    writePreference(MASTER_VOLUME_KEY, String(volume));
  },
  setVoiceEnabled: (enabled) => {
    set({ voiceEnabled: enabled });
    writePreference(VOICE_ENABLED_KEY, String(enabled));
  },
  setVoiceVolume: (value) => {
    if (!Number.isFinite(value)) return;
    const volume = clampVolume(value);
    set({ voiceVolume: volume });
    writePreference(VOICE_VOLUME_KEY, String(volume));
  },
}));

export function masterLevel(state: Pick<AudioSettingsState, 'masterEnabled' | 'masterVolume'>): ChannelLevel {
  return { enabled: state.masterEnabled, volume: state.masterVolume };
}

/** Master gain alone, for channels that apply their own level afterwards. */
export function currentMasterGain(): number {
  return channelGain(masterLevel(useAudioSettingsStore.getState()));
}

/** Overall voice output gain (master x voice channel), before each player's own volume. */
export function currentVoiceGain(): number {
  const state = useAudioSettingsStore.getState();
  return mixedGain(masterLevel(state), { enabled: state.voiceEnabled, volume: state.voiceVolume });
}
