/** Preserves each fixture's RNG and action oracles while bounding full-game progress. */
export function runSeededGame(
  name: string, limit: number, finished: () => boolean, step: (index: number) => void,
): number {
  let actions = 0;
  while (!finished() && actions < limit) {
    step(actions);
    actions++;
  }
  if (!finished()) throw new Error(`${name} did not finish within ${limit} actions.`);
  return actions;
}
