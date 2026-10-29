import { CEILING_RANGE, EFFECTS_BOOST_DB, ceilingCurve, channelGain, dbToGain } from './mix';
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
 * Effects bus for one context: a boost into a soft ceiling, then the effects channel gain under the master gain.
 * Game effects, turn reminders, and interface cues all connect here, so the effects slider and the master slider
 * scale them together. The ceiling sits before the sliders, so overlapping cues stay below full scale however they
 * are mixed and a lowered slider still lowers the output. Release it with the context.
 */
export function effectsOutput(audio: AudioContext): AudioNode {
  const existing = buses.get(audio);
  if (existing) return existing.input;
  const master = audio.createGain();
  const channel = audio.createGain();
  const input = audio.createGain();
  const ceiling = typeof audio.createWaveShaper === 'function' ? audio.createWaveShaper() : null;
  const levels = (): { master: number; effects: number } => {
    const settings = useAudioSettingsStore.getState();
    return {
      master: channelGain(masterLevel(settings)),
      effects: channelGain(useSoundEffectsStore.getState()),
    };
  };
  const initial = levels();
  master.gain.value = initial.master;
  channel.gain.value = initial.effects;
  const boost = dbToGain(EFFECTS_BOOST_DB);
  if (ceiling) {
    // The curve spans CEILING_RANGE, so the input is scaled down by the same factor to keep the boost exact.
    input.gain.value = boost / CEILING_RANGE;
    ceiling.curve = ceilingCurve();
    // Oversampling would let the output filter ring past the ceiling.
    ceiling.oversample = 'none';
    input.connect(ceiling);
    ceiling.connect(channel);
  } else {
    input.gain.value = boost;
    input.connect(channel);
  }
  channel.connect(master);
  master.connect(audio.destination);
  const sync = (): void => {
    const next = levels();
    setGain(audio, master, next.master);
    setGain(audio, channel, next.effects);
  };
  const stopSettings = useAudioSettingsStore.subscribe(sync);
  const stopEffects = useSoundEffectsStore.subscribe(sync);
  buses.set(audio, {
    input,
    unsubscribe: () => {
      stopSettings();
      stopEffects();
      for (const node of [input, ...(ceiling ? [ceiling] : []), channel, master]) {
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
