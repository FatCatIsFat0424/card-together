// Self-play records for fitting the Go bot's move model: the bot plays itself with a fixed search budget and every
// searched move is written as one JSON line (the board before the move, the last two moves, and the choice).
// Usage: npx tsx --tsconfig server/tsconfig.json scripts/go-model/selfplay.ts --size 9 --games 40 --ms 1000 \
//   --seed 1 --out /tmp/go-9-1.jsonl      (one process per core; see docs/games/board.md, "圍棋的逾時與 bot")
import { appendFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { goMoveLimit, goPlay, goStart, isGoSize } from '@shared/rules/go';
import type { GoMove, GoSize } from '@shared/rules/go';
import { goBestMove } from '../../server/src/bots/go-search';
import { goOpeningMove } from '../../server/src/bots/go-opening';
import { seededRandom } from '../../server/src/bots/search/seeded-random';
import type { SelfPlayRecord } from './records';

const { values } = parseArgs({
  options: {
    size: { type: 'string', default: '9' }, games: { type: 'string', default: '10' }, ms: { type: 'string', default: '1000' },
    seed: { type: 'string', default: '1' }, out: { type: 'string' },
  },
});
const size = Number(values.size);
const games = Number(values.games);
const budgetMs = Number(values.ms);
const seed = Number(values.seed);
if (!isGoSize(size) || !Number.isInteger(games) || games < 1 || !(budgetMs > 0) || !Number.isInteger(seed) || !values.out) {
  throw new Error('Usage: selfplay.ts --size 9|13|19 --games N --ms M --seed S --out FILE');
}
const out = values.out;
writeFileSync(out, '');

function playGame(boardSize: GoSize, random: () => number): number {
  const start = goStart({ size: boardSize, handicap: 0 });
  let position = start.position;
  const history = [...start.history];
  const moves: GoMove[] = [];
  let written = 0;
  while (position.passes < 2 && position.moves < goMoveLimit(boardSize)) {
    const book = goOpeningMove(position, random);
    let move: GoMove;
    if (book !== null) {
      move = book;
    } else {
      const began = performance.now();
      move = goBestMove(position, history, {
        random, recent: moves.slice(-2), noBook: true,
        budget: { expired: () => performance.now() - began >= budgetMs, timeLeftMs: () => Math.max(0, budgetMs - (performance.now() - began)) },
      });
      const record: SelfPlayRecord = {
        size: boardSize,
        stones: position.stones.map((cell) => (cell === null ? '.' : cell === 0 ? 'X' : 'O')).join(''),
        toMove: position.toMove,
        recent: moves.slice(-2).map((recent) => (recent === 'pass' ? -1 : recent)),
        move: move === 'pass' ? -1 : move,
      };
      appendFileSync(out, `${JSON.stringify(record)}\n`);
      written++;
    }
    const result = goPlay(position, move, history);
    if (!result) throw new Error(`The bot chose an illegal move at ${position.moves}.`);
    position = result.position;
    if (move !== 'pass') history.push(result.hash);
    moves.push(move);
  }
  return written;
}

for (let game = 0; game < games; game++) {
  const written = playGame(size, seededRandom(seed * 1_000 + game));
  console.error(`game ${game + 1}/${games}: ${written} positions`);
}
