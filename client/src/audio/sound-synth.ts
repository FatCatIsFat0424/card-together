import { noiseEnvelope } from './sound-pack';
import type { BiquadSpec, Cue, NoiseVoice, ToneVoice } from './sound-pack';

/** Registers a started source and the nodes to disconnect with it. */
export type TrackVoice = (source: AudioScheduledSourceNode, nodes: AudioNode[]) => void;

export interface VoiceTracker {
  readonly track: TrackVoice;
  /** Stops every voice that has not ended and releases its nodes. */
  readonly stopAll: () => void;
}

/** Tracks scheduled voices so they can be cut short and are always disconnected once. */
export function createVoiceTracker(): VoiceTracker {
  const active = new Set<() => void>();
  const track: TrackVoice = (source, nodes) => {
    const release = (): void => {
      source.onended = null;
      for (const node of [source, ...nodes]) {
        try { node.disconnect(); } catch { /* Cleanup must not interrupt other voices. */ }
      }
      active.delete(stop);
    };
    const stop = (): void => {
      try { source.stop(); } catch { /* A source may already have ended. */ }
      release();
    };
    source.onended = release;
    active.add(stop);
  };
  return { track, stopAll: () => { for (const stop of active) stop(); } };
}

function createFilter(audio: AudioContext, spec: BiquadSpec): BiquadFilterNode {
  const filter = audio.createBiquadFilter();
  filter.type = spec.type;
  filter.frequency.value = spec.frequency;
  filter.Q.value = spec.q;
  return filter;
}

function renderTone(audio: AudioContext, voice: ToneVoice, track: TrackVoice, base: number): void {
  const at = base + voice.at;
  const floor = voice.floor ?? 0.0001;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const filter = voice.filter ? createFilter(audio, voice.filter) : null;
  track(oscillator, filter ? [filter, gain] : [gain]);
  oscillator.type = voice.wave;
  oscillator.frequency.value = voice.frequency;
  if (voice.glide) {
    oscillator.frequency.setValueAtTime(voice.frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(voice.frequency * voice.glide.ratio, at + voice.glide.time);
  }
  if (voice.attackCurve === 'linear') {
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(voice.level, at + voice.attack);
  } else {
    gain.gain.setValueAtTime(floor, at);
    gain.gain.exponentialRampToValueAtTime(voice.level, at + voice.attack);
  }
  gain.gain.exponentialRampToValueAtTime(floor, at + voice.decay);
  if (filter) {
    oscillator.connect(filter);
    filter.connect(gain);
  } else {
    oscillator.connect(gain);
  }
  gain.connect(audio.destination);
  oscillator.start(at);
  oscillator.stop(at + voice.decay + (voice.tail ?? 0));
}

function renderNoise(audio: AudioContext, voice: NoiseVoice, track: TrackVoice, base: number): void {
  const at = base + voice.at;
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * voice.length), audio.sampleRate);
  const data = buffer.getChannelData(0);
  const envelope = noiseEnvelope(voice.envelope);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * envelope(i / data.length);
  const source = audio.createBufferSource();
  const filter = createFilter(audio, voice.filter);
  const gain = audio.createGain();
  track(source, [filter, gain]);
  source.buffer = buffer;
  if (voice.sweepTo !== undefined) {
    filter.frequency.setValueAtTime(voice.filter.frequency, at);
    filter.frequency.exponentialRampToValueAtTime(voice.sweepTo, at + voice.length);
  }
  gain.gain.value = voice.level;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  source.start(at);
}

/**
 * Schedules every voice of a cue. `offset` seconds after the context's current time is the cue's start. Callers
 * own error handling so a failed cue can dispose of its own context.
 */
export function renderCue(audio: AudioContext, cue: Cue, track: TrackVoice, offset = 0): void {
  const base = audio.currentTime + offset;
  for (const voice of cue) {
    if (voice.kind === 'tone') renderTone(audio, voice, track, base);
    else renderNoise(audio, voice, track, base);
  }
}
