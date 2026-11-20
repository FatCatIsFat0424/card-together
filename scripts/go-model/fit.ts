// Fits the Go bot's move model to self-play records and writes server/src/bots/go-model-weights.ts.
// The model is a generalized Bradley-Terry model (Coulom, "Computing Elo Ratings of Move Patterns in the Game of
// Go", 2007): every legal move is a team of features (`moveFeatures` in go-features.ts), the searched move wins
// against the others, and minorization-maximization updates one feature group at a time. Each feature also plays
// one virtual win and one virtual loss against strength 1, which keeps rare features near neutral.
// Usage: npx tsx --tsconfig server/tsconfig.json scripts/go-model/fit.ts [--sweeps 30] [--out FILE] FILE.jsonl...
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { GoCell, GoPosition } from '@shared/rules/go';
import { GO_KOMI } from '@shared/rules/go';
import { PASS, boardFromPosition, isEye, isLegal } from '../../server/src/bots/go-board';
import {
  ATARI_BASE, CAPTURE_BASE, DIST2_BASE, DIST_BASE, ESCAPE_BASE, FEATURE_COUNT, LINE_BASE, MAX_MOVE_FEATURES,
  PATTERN_FEATURES, SELF_ATARI_BASE, analyzeMoves, moveFeatures,
} from '../../server/src/bots/go-features';
import { isSelfPlayRecord } from './records';

const WEIGHTS_PATH = fileURLToPath(new URL('../../server/src/bots/go-model-weights.ts', import.meta.url));
/** Patterns seen among fewer candidates than this share one "rare pattern" strength. */
const MIN_PATTERN_COUNT = 30;
const RARE = FEATURE_COUNT;

const { values, positionals } = parseArgs({
  options: { sweeps: { type: 'string', default: '30' }, out: { type: 'string', default: WEIGHTS_PATH } }, allowPositionals: true,
});
const sweeps = Number(values.sweeps);
if (positionals.length === 0 || !Number.isInteger(sweeps) || sweeps < 1) throw new Error('Usage: fit.ts [--sweeps N] FILE.jsonl...');

/** Feature group of an id: one feature per group and move, so a group's strengths update together. */
const GROUP_STARTS = [0, CAPTURE_BASE, ESCAPE_BASE, ATARI_BASE, SELF_ATARI_BASE, LINE_BASE, DIST_BASE, DIST2_BASE];
const groupOf = (id: number): number => {
  if (id === RARE || id < PATTERN_FEATURES) return 0;
  let group = 0;
  for (let index = 0; index < GROUP_STARTS.length; index++) if (id >= GROUP_STARTS[index]) group = index;
  return group;
};

// ─── Load the records as candidate teams ───

const offsets: number[] = [0];
const winners: number[] = [];
let teams = new Int32Array(1 << 20);
let candidateCount = 0;
const features = new Int32Array(MAX_MOVE_FEATURES);
for (const file of positionals) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const record: unknown = JSON.parse(line);
    if (!isSelfPlayRecord(record) || record.move < 0) continue;
    const stones: GoCell[] = [...record.stones].map((char) => (char === 'X' ? 0 : char === 'O' ? 1 : null));
    const position: GoPosition = {
      size: record.size, stones, toMove: record.toMove, komi: GO_KOMI, captures: [0, 0], passes: 0, moves: 0,
    };
    const board = boardFromPosition(position);
    const { toPoint } = board.geometry.layout;
    const [older, newer] = record.recent.length === 2 ? record.recent : [-1, record.recent[0] ?? -1];
    board.last = newer >= 0 ? toPoint[newer] : PASS;
    board.last2 = older >= 0 ? toPoint[older] : PASS;
    const analysis = analyzeMoves(board);
    const chosen = toPoint[record.move];
    let winner = -1;
    const first = candidateCount;
    for (let slot = 0; slot < board.emptyCount; slot++) {
      const point = board.empties[slot];
      if (isEye(board, point, board.toMove) || !isLegal(board, point)) continue;
      if ((candidateCount + 1) * MAX_MOVE_FEATURES > teams.length) {
        const grown = new Int32Array(teams.length * 2);
        grown.set(teams);
        teams = grown;
      }
      const count = moveFeatures(board, point, analysis, features);
      const base = candidateCount * MAX_MOVE_FEATURES;
      for (let index = 0; index < MAX_MOVE_FEATURES; index++) teams[base + index] = index < count ? features[index] : -1;
      if (point === chosen) winner = candidateCount;
      candidateCount++;
    }
    if (winner < 0 || candidateCount - first < 2) {
      candidateCount = first;
      continue;
    }
    winners.push(winner);
    offsets.push(candidateCount);
  }
}
const positions = winners.length;
console.error(`${positions} positions, ${candidateCount} candidate moves`);

// Rare patterns share one id.
const patternSeen = new Int32Array(PATTERN_FEATURES);
for (let candidate = 0; candidate < candidateCount; candidate++) patternSeen[teams[candidate * MAX_MOVE_FEATURES]]++;
for (let candidate = 0; candidate < candidateCount; candidate++) {
  const slot = candidate * MAX_MOVE_FEATURES;
  if (patternSeen[teams[slot]] < MIN_PATTERN_COUNT) teams[slot] = RARE;
}

// ─── Minorization-maximization ───

const gamma = new Float64Array(FEATURE_COUNT + 1).fill(1);
const wins = new Float64Array(FEATURE_COUNT + 1);
for (const winner of winners) {
  for (let index = 0; index < MAX_MOVE_FEATURES; index++) {
    const id = teams[winner * MAX_MOVE_FEATURES + index];
    if (id >= 0) wins[id]++;
  }
}
const present = new Uint8Array(FEATURE_COUNT + 1);
for (let slot = 0; slot < candidateCount * MAX_MOVE_FEATURES; slot++) if (teams[slot] >= 0) present[teams[slot]] = 1;

const strength = (candidate: number): number => {
  let product = 1;
  for (let index = 0; index < MAX_MOVE_FEATURES; index++) {
    const id = teams[candidate * MAX_MOVE_FEATURES + index];
    if (id >= 0) product *= gamma[id];
  }
  return product;
};

const denominator = new Float64Array(FEATURE_COUNT + 1);
const strengths = new Float64Array(candidateCount);
function logLikelihood(): number {
  let total = 0;
  for (let position = 0; position < positions; position++) {
    let sum = 0;
    for (let candidate = offsets[position]; candidate < offsets[position + 1]; candidate++) sum += strength(candidate);
    total += Math.log(strength(winners[position]) / sum);
  }
  return total / positions;
}

for (let sweep = 0; sweep < sweeps; sweep++) {
  for (let group = 0; group < GROUP_STARTS.length; group++) {
    denominator.fill(0);
    for (let position = 0; position < positions; position++) {
      let sum = 0;
      for (let candidate = offsets[position]; candidate < offsets[position + 1]; candidate++) {
        strengths[candidate] = strength(candidate);
        sum += strengths[candidate];
      }
      for (let candidate = offsets[position]; candidate < offsets[position + 1]; candidate++) {
        for (let index = 0; index < MAX_MOVE_FEATURES; index++) {
          const id = teams[candidate * MAX_MOVE_FEATURES + index];
          if (id < 0 || groupOf(id) !== group) continue;
          denominator[id] += strengths[candidate] / gamma[id] / sum;
        }
      }
    }
    for (let id = 0; id <= FEATURE_COUNT; id++) {
      if (!present[id] || groupOf(id) !== group) continue;
      gamma[id] = (wins[id] + 1) / (denominator[id] + 2 / (gamma[id] + 1));
    }
  }
  console.error(`sweep ${sweep + 1}: mean log-likelihood ${logLikelihood().toFixed(4)}`);
}

// Top-1 agreement of the fitted model with the search.
let agreed = 0;
for (let position = 0; position < positions; position++) {
  let best = offsets[position];
  for (let candidate = offsets[position]; candidate < offsets[position + 1]; candidate++) {
    if (strength(candidate) > strength(best)) best = candidate;
  }
  if (best === winners[position]) agreed++;
}
console.error(`model's top move matches the search in ${(100 * agreed / positions).toFixed(1)}% of positions`);

// ─── Write the weights ───

const round = (value: number): number => Math.round(Math.log(value) * 1000) / 1000;
const patterns: number[] = [];
for (let code = 0; code < PATTERN_FEATURES; code++) {
  if (present[code] && Math.abs(round(gamma[code])) > 0) patterns.push(code, round(gamma[code]));
}
const others: number[] = [];
for (let id = CAPTURE_BASE; id < FEATURE_COUNT; id++) others.push(present[id] ? round(gamma[id]) : 0);
const rows = (list: readonly number[], perRow: number): string => {
  const lines: string[] = [];
  for (let index = 0; index < list.length; index += perRow) lines.push(`  ${list.slice(index, index + perRow).join(', ')},`);
  return lines.join('\n');
};
writeFileSync(values.out, `// Generated by scripts/go-model/fit.ts from ${positions} self-play positions; do not edit by hand.
// Log-strengths of the Go bot's move model: 3 × 3 patterns (canonical code, value) and the other features in id
// order from \`CAPTURE_BASE\` (see \`go-features.ts\`).

export const GO_MODEL_PATTERNS: readonly number[] = [
${rows(patterns, 12)}
];
export const GO_MODEL_RARE_PATTERN = ${present[RARE] ? round(gamma[RARE]) : 0};
export const GO_MODEL_FEATURES: readonly number[] = [
${rows(others, 12)}
];
`);
console.error(`wrote ${patterns.length / 2} patterns and ${others.length} other features to ${values.out}`);
