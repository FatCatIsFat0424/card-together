let context: AudioContext | null = null;
const active = new Set<() => void>();

/** Call only from a trusted user gesture; missed sounds are never queued. */
export function unlockCardSounds(): void {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
  } catch {
    // Audio support and browser permission are optional.
  }
}

export function disposeCardSounds(): void {
  for (const stop of active) stop();
  const audio = context;
  context = null;
  if (audio) {
    try { void audio.close().catch(() => undefined); } catch { /* Already closed. */ }
  }
}

function track(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
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
}

/** Falling three-note tone: a player is eliminated. */
export function playOutSound(): void {
  const audio = context;
  if (!audio || audio.state !== 'running') return;
  try {
    for (const [frequency, start, length] of [[523, 0, 0.2], [392, 0.16, 0.2], [262, 0.32, 0.45]]) {
      const at = audio.currentTime + start;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      track(osc, [gain]);
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(at);
      osc.stop(at + length);
    }
  } catch {
    disposeCardSounds();
  }
}

/** Card snap for a play; a softer, lower knock for a pass. */
export function playCardSound(pass = false): void {
  const audio = context;
  if (!audio || audio.state !== 'running') return;
  try {
    const duration = pass ? 0.12 : 0.08;
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    track(source, [filter, gain]);
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = pass ? 700 : 2400;
    filter.Q.value = 0.9;
    gain.gain.value = pass ? 0.35 : 0.6;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audio.destination);
    source.start();
  } catch {
    disposeCardSounds();
  }
}

/** Noise burst shaped by `envelope` (0 at the start, 1 at the end of the buffer). */
function noiseVoice(
  audio: AudioContext, seconds: number, at: number, type: BiquadFilterType, frequency: number, level: number,
  envelope: (position: number) => number,
): void {
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * seconds), audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * envelope(i / data.length);
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  track(source, [filter, gain]);
  source.buffer = buffer;
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = 0.7;
  gain.gain.value = level;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  source.start(at);
}

/**
 * Dragon Slaying: a fire roar while the fire burns, a whoosh rising across the blade's sweep, and an impact as
 * it reaches the far end. Times are seconds from the start of the presentation.
 */
export function playSlashSound(timing: {
  readonly fireStart: number; readonly fireEnd: number; readonly strike: number; readonly cut: number;
}): void {
  const audio = context;
  if (!audio || audio.state !== 'running') return;
  try {
    const now = audio.currentTime;
    noiseVoice(audio, timing.fireEnd - timing.fireStart, now + timing.fireStart, 'lowpass', 750, 0.35, (position) => {
      const crackle = Math.random() < 0.004 ? 3 : 1;
      return Math.min(1, position * 6) * (1 - position ** 6) * crackle;
    });
    noiseVoice(audio, timing.cut + 0.02, now + timing.strike - 0.02, 'bandpass', 4200, 0.6, (position) => position ** 2);
    noiseVoice(audio, 0.5, now + timing.strike + timing.cut, 'lowpass', 280, 0.9, (position) => (1 - position) ** 3);
  } catch {
    disposeCardSounds();
  }
}
