const SAMPLE_RATE = 22050;
const BEEP_SECONDS = 0.22;
const GAP_SECONDS = 0.08;
const FREQUENCIES = [523.25, 659.25];
const PEAK = 0.4;

/** Two short sine beeps as a mono 16-bit PCM WAV file. */
export function createToneWav(): Uint8Array<ArrayBuffer> {
  const beep = Math.floor(SAMPLE_RATE * BEEP_SECONDS);
  const gap = Math.floor(SAMPLE_RATE * GAP_SECONDS);
  const total = FREQUENCIES.length * beep + (FREQUENCIES.length - 1) * gap;
  const bytes = new Uint8Array(44 + total * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + total * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, total * 2, true);
  FREQUENCIES.forEach((frequency, note) => {
    const start = note * (beep + gap);
    for (let index = 0; index < beep; index += 1) {
      // A short fade at both ends avoids clicks.
      const edge = Math.min(1, index / 400, (beep - index) / 400);
      const sample = Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * PEAK * edge;
      view.setInt16(44 + (start + index) * 2, Math.round(sample * 32767), true);
    }
  });
  return bytes;
}

/** Plays the test tone on the chosen speaker at `volume` (0-1). Resolves when it ends or cannot play. */
export async function playTestTone(outputDeviceId: string | null, volume: number): Promise<void> {
  if (typeof Audio === 'undefined') return;
  const url = URL.createObjectURL(new Blob([createToneWav()], { type: 'audio/wav' }));
  const audio = new Audio(url);
  audio.volume = Math.max(0, Math.min(1, volume));
  try {
    if (outputDeviceId && typeof audio.setSinkId === 'function') await audio.setSinkId(outputDeviceId);
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.addEventListener('ended', () => resolve(), { once: true });
      audio.addEventListener('error', () => resolve(), { once: true });
    });
  } catch {
    // A blocked or unavailable output simply stays silent.
  } finally {
    URL.revokeObjectURL(url);
  }
}
