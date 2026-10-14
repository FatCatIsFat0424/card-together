export type MusicMode = 'loop-one' | 'sequential' | 'shuffle';

/**
 * Index of the track to play next among `playable` ones; `loop-one` stays put and shuffle
 * never repeats the current track. The current track may itself be unplayable after its
 * group is deselected, so sequential order walks the full list from it.
 */
export function nextTrackIndex(
  current: number,
  playable: readonly boolean[],
  mode: MusicMode,
  random: () => number,
  direction: 1 | -1 = 1,
): number {
  const count = playable.length;
  const at = Math.max(0, Math.min(current, count - 1));
  if (count <= 1 || mode === 'loop-one') return at;
  if (mode === 'sequential') {
    for (let step = 1; step <= count; step += 1) {
      const index = (((at + direction * step) % count) + count) % count;
      if (playable[index]) return index;
    }
    return at;
  }
  const candidates = playable.flatMap((enabled, index) => enabled && index !== at ? [index] : []);
  if (!candidates.length) return at;
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
}
