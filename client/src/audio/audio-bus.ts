import { channelGain } from './mix';
import { masterLevel, useAudioSettingsStore } from '../stores/audio-settings-store';
import { useSoundEffectsStore } from '../stores/sound-effects-store';

/** Seconds a gain change takes to settle; long enough to avoid clicks while a slider moves. */
const GAIN_SMOOTHING_SECONDS = 0.015;

interface EffectsBus {
  readonly input: GainNode;
  readonly unsubscribe: () => void;
}

const buses = new WeakMap<AudioContext, EffectsBus>();

/** Moves a gain smoothly when the node supports automation and jumps otherwise. */
export function setGain(audio: BaseAudioContext, node: GainNode, value: number): void {
  if (typeof node.gain.setTargetAtTime === 'function') {
    node.gain.setTargetAtTime(value, audio.currentTime, GAIN_SMOOTHING_SECONDS);
  } else {
    node.gain.value = value;
  }
}

/**
 * Effects channel gain under a master gain for one context. Game effects, turn reminders, and interface cues all
 * connect here, so the effects slider and the master slider scale them together. Release it with the context.
 */
export function effectsOutput(audio: AudioContext): AudioNode {
  const existing = buses.get(audio);
  if (existing) return existing.input;
  const master = audio.createGain();
  const input = audio.createGain();
  const levels = (): { master: number; effects: number } => {
    const settings = useAudioSettingsStore.getState();
    return {
      master: channelGain(masterLevel(settings)),
      effects: channelGain(useSoundEffectsStore.getState()),
    };
  };
  const initial = levels();
  master.gain.value = initial.master;
  input.gain.value = initial.effects;
  input.connect(master);
  master.connect(audio.destination);
  const sync = (): void => {
    const next = levels();
    setGain(audio, master, next.master);
    setGain(audio, input, next.effects);
  };
  const stopSettings = useAudioSettingsStore.subscribe(sync);
  const stopEffects = useSoundEffectsStore.subscribe(sync);
  buses.set(audio, {
    input,
    unsubscribe: () => {
      stopSettings();
      stopEffects();
      for (const node of [input, master]) {
        try { node.disconnect(); } catch { /* The context may already be closed. */ }
      }
    },
  });
  return input;
}

/** Stops following settings for a context that is being closed. */
export function releaseEffectsBus(audio: AudioContext): void {
  buses.get(audio)?.unsubscribe();
  buses.delete(audio);
}
