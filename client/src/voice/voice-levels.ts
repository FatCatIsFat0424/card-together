/** Loudness above which a person counts as speaking, on the 0-1 scale of `levelFromSamples`. */
export const SPEAKING_LEVEL = 0.12;
/** The speaking ring lingers this long after the last loud frame, so pauses between words do not flicker it. */
export const SPEAKING_HOLD_MS = 350;
/** Typical speech peaks near 0.3 RMS; scaling lets the meter use most of its range. */
const LEVEL_GAIN = 3.2;

/** Loudness 0-1 from unsigned 8-bit time-domain samples (128 is silence). */
export function levelFromSamples(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const centered = (samples[index] - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN);
}

/**
 * Tracks whether someone is speaking from their loudness frames: loud frames switch it on at once and a quiet
 * stretch shorter than the hold keeps it on.
 */
export function createSpeakingTracker(now: () => number = () => performance.now()): (level: number) => boolean {
  let lastLoud = -Infinity;
  return (level) => {
    // Exact silence means no signal at all (muted or stopped), so the ring drops at once.
    if (level === 0) {
      lastLoud = -Infinity;
      return false;
    }
    const time = now();
    if (level >= SPEAKING_LEVEL) lastLoud = time;
    return time - lastLoud < SPEAKING_HOLD_MS;
  };
}

interface Watch {
  readonly analyser: AnalyserNode;
  readonly source: MediaStreamAudioSourceNode;
  readonly samples: Uint8Array<ArrayBuffer>;
  readonly listener: (level: number) => void;
}

let context: AudioContext | null = null;
const watches = new Set<Watch>();
let frame = 0;

/** One context serves every meter; browsers cap how many may exist. */
export function sharedAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

function tick(): void {
  for (const watch of watches) {
    watch.analyser.getByteTimeDomainData(watch.samples);
    watch.listener(levelFromSamples(watch.samples));
  }
  frame = watches.size > 0 ? requestAnimationFrame(tick) : 0;
}

/** Reports the loudness of a stream every frame until stopped. One animation frame loop serves all watchers. */
export function watchLevel(stream: MediaStream, listener: (level: number) => void): () => void {
  const audio = sharedAudioContext();
  if (!audio || stream.getAudioTracks().length === 0) return () => undefined;
  const source = audio.createMediaStreamSource(stream);
  const analyser = audio.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const watch: Watch = { analyser, source, samples: new Uint8Array(analyser.fftSize), listener };
  watches.add(watch);
  if (frame === 0) frame = requestAnimationFrame(tick);
  return () => {
    watches.delete(watch);
    source.disconnect();
    analyser.disconnect();
    listener(0);
  };
}

/** Plays a stream through the speakers at `gain`, for hearing one's own microphone. */
export function monitorStream(stream: MediaStream, gain: number): () => void {
  const audio = sharedAudioContext();
  if (!audio || stream.getAudioTracks().length === 0) return () => undefined;
  const source = audio.createMediaStreamSource(stream);
  const output = audio.createGain();
  output.gain.value = Math.max(0, Math.min(1, gain));
  source.connect(output);
  output.connect(audio.destination);
  return () => {
    source.disconnect();
    output.disconnect();
  };
}
