/** One output channel's switch and volume; `volume` is 0-1. */
export interface ChannelLevel {
  readonly enabled: boolean;
  readonly volume: number;
}

export function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Restores a stored 0-1 volume; missing or unparsable values use the fallback and out-of-range ones are clamped. */
export function parseVolume(stored: string | null, fallback: number): number {
  if (stored === null || stored.trim() === '') return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? clampVolume(value) : fallback;
}

/** Linear gain for one channel on its own: its volume while switched on, silence while off. */
export function channelGain(level: ChannelLevel): number {
  return level.enabled ? clampVolume(level.volume) : 0;
}

/** Master and channel gains multiply, so either switch or slider can silence the channel. */
export function mixedGain(master: ChannelLevel, channel: ChannelLevel): number {
  return channelGain(master) * channelGain(channel);
}

/** Per-player voice volume under the overall voice output gain. */
export function peerOutputVolume(peerVolume: number, outputGain: number): number {
  return clampVolume(clampVolume(peerVolume) * clampVolume(outputGain));
}

/** 0-1 volume as the whole percent shown beside a slider. */
export function volumePercent(volume: number): number {
  return Math.round(clampVolume(volume) * 100);
}
