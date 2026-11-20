// Builds the Reversi opening book (server/src/bots/reversi-book.bin) by searching the opening tree deeper than
// the live bot can. For both colours, every position the bot can face within the first --plies moves, given its
// own book moves and any opponent replies, is searched to --depth plies with the fitted evaluation.
// Usage: npm run reversi:book -- [--plies 8] [--depth 14] [--workers 4]
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Bitboards } from '../../server/src/bots/reversi-board';
import { REVERSI_BOOK_PATH, canonicalBoard, encodeBook } from '../../server/src/bots/reversi-book';
import { emptiesOf, rootMoves, searchPosition } from '../../server/src/bots/reversi-engine';
import { START } from './selfplay';

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

type Message = { readonly id: number; readonly board: Bitboards };

/** Worker: answers each position with its deep-search move. */
function runWorker(): void {
  const depth = Number(option('depth', '14'));
  process.on('message', ({ id, board }: Message) => {
    const { move } = searchPosition(board, { maxDepth: depth, expired: () => false, clock: null, solveEmpties: 0, tableBits: 20 });
    process.send!({ id, move });
  });
}

const keyOf = (board: Bitboards): string => [board.pl, board.ph, board.ol, board.oh].join(',');

/** Positions where the bot moves next after any opponent reply; openings this short never pass. */
const botPositionsAfter = (board: Bitboards): Bitboards[] => rootMoves(board).filter((reply) => rootMoves(reply).length > 0);

async function main(): Promise<void> {
  const plies = Number(option('plies', '8'));
  const workers = Number(option('workers', '4'));
  const depth = option('depth', '14');
  const pool: ChildProcess[] = Array.from({ length: workers }, () => fork(fileURLToPath(import.meta.url), ['--worker', '--depth', depth], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  }));
  const pending = new Map<number, (move: number) => void>();
  for (const child of pool) child.on('message', ({ id, move }: { id: number; move: number }) => pending.get(id)?.(move));
  let nextId = 0;
  const busy = new Set<ChildProcess>();
  const queue: (() => void)[] = [];
  const search = (board: Bitboards): Promise<number> => new Promise((resolve) => {
    const start = (): void => {
      const child = pool.find((candidate) => !busy.has(candidate))!;
      busy.add(child);
      const id = nextId++;
      pending.set(id, (move) => {
        pending.delete(id);
        busy.delete(child);
        queue.shift()?.();
        resolve(move);
      });
      child.send({ id, board });
    };
    if (busy.size < pool.length) start();
    else queue.push(start);
  });

  const entries = new Map<string, { board: Bitboards; move: number }>();
  // The bot as dark starts at the opening; as light, after any first move (all four are mirror images).
  let frontier: Bitboards[] = [START, botPositionsAfter(START)[0]];
  for (let level = 0; frontier.length > 0; level++) {
    const unique = new Map<string, Bitboards>();
    for (const board of frontier) {
      if (60 - emptiesOf(board) >= plies) continue;
      const canonical = canonicalBoard(board).board;
      const key = keyOf(canonical);
      if (!entries.has(key)) unique.set(key, canonical);
    }
    const started = Date.now();
    const boards = [...unique.values()];
    const moves = await Promise.all(boards.map((board) => search(board)));
    const next: Bitboards[] = [];
    boards.forEach((board, k) => {
      entries.set(keyOf(board), { board, move: moves[k] });
      const child = rootMoves(board).find((candidate) => candidate.move === moves[k])!;
      next.push(...botPositionsAfter(child));
    });
    console.error(`level ${level}: ${boards.length} positions in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    frontier = next;
  }
  for (const child of pool) child.kill();
  const bytes = encodeBook([...entries.values()]);
  writeFileSync(REVERSI_BOOK_PATH, bytes);
  console.error(`wrote ${entries.size} positions (${bytes.length} bytes) to ${REVERSI_BOOK_PATH}`);
}

if (process.argv.includes('--worker')) runWorker();
else {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
