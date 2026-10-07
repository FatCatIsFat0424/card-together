/** Prefer better evaluations while varying only among reasonably close choices. */
export function selectNearBest<T>(
  options: readonly { value: T; score: number }[],
  random: () => number,
  margin: number,
): T | null {
  if (options.length === 0) return null;
  const best = Math.max(...options.map((option) => option.score));
  const candidates = options.filter((option) => option.score >= best - margin);
  if (candidates.length === 1) return candidates[0].value;
  const weights = candidates.map((option) => 1 / (1 + best - option.score));
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('Bot random source must return a number in [0, 1).');
  }
  let ticket = sample * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < candidates.length; i++) {
    ticket -= weights[i];
    if (ticket < 0) return candidates[i].value;
  }
  return candidates[candidates.length - 1].value;
}
