import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';

// Game setup shuffles with Math.random in some games and node:crypto randomInt in others (Bridge and Spades
// dealers, most card decks). Routing both through one swappable seeded source makes a match depend only on
// its seed and the moves played, so a duplicate pair replays the same deals with the sides exchanged.

let source: () => number = Math.random;

function randomInt(first: number, second?: unknown): number {
  if (second !== undefined && typeof second !== 'number') throw new Error('The arena does not support randomInt callbacks.');
  const [min, max] = second === undefined ? [0, first] : [first, second];
  return min + Math.floor(source() * (max - min));
}

/** Replaces Math.random and crypto.randomInt for the whole process; returns a function that restores them. */
export function installSeededRandom(): () => void {
  const original = { random: Math.random, randomInt: crypto.randomInt };
  Math.random = () => source();
  Object.assign(crypto, { randomInt });
  // Updates the named `node:crypto` exports that ES modules already imported.
  syncBuiltinESMExports();
  return () => {
    Math.random = original.random;
    Object.assign(crypto, { randomInt: original.randomInt });
    syncBuiltinESMExports();
  };
}

/** Draws from `random` until replaced; returns the previous source. */
export function setRandomSource(random: () => number): () => number {
  const previous = source;
  source = random;
  return previous;
}

/** Runs `task` with its own source, so a bot that calls Math.random does not shift the game's deals. */
export function withRandomSource<T>(random: () => number, task: () => T): T {
  const previous = setRandomSource(random);
  try {
    return task();
  } finally {
    setRandomSource(previous);
  }
}
