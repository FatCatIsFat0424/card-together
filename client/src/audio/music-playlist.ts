export type MusicMode = 'loop-one' | 'sequential' | 'shuffle';

/** Index of the track to play next; `loop-one` stays put, shuffle never repeats the current track. */
export function nextTrackIndex(
  current: number,
  count: number,
  mode: MusicMode,
  random: () => number,
  direction: 1 | -1 = 1,
): number {
  if (count <= 1 || mode === 'loop-one') return Math.max(0, Math.min(current, count - 1));
  if (mode === 'sequential') return (current + direction + count) % count;
  const pick = Math.min(count - 2, Math.floor(random() * (count - 1)));
  return pick >= current ? pick + 1 : pick;
}
