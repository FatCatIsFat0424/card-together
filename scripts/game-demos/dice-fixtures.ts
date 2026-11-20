import type { CodeBreakerVisibleState, GameSeat, PlayerInfo } from '../../shared/src/types';
import type { DominoesAction } from '../../shared/src/games/dominoes/actions';
import type { YachtGameAction } from '../../shared/src/games/yacht/actions';
import type { YachtVisibleState } from '../../shared/src/games/yacht/types';
import type { DominoesVisibleState } from '../../shared/src/games/dominoes/types';
import { dmAllTiles, dmTurnOptions } from '../../shared/src/rules/dominoes';
import * as yacht from '../../server/src/managers/games/yacht-game';
import * as dominoes from '../../server/src/managers/games/dominoes-game';
import * as codebreaker from '../../server/src/managers/games/codebreaker-game';
import { getYachtBotAction } from '../../server/src/bots/yacht-strategy';
import { scoreDominoesPlays } from '../../server/src/bots/dominoes-strategy';
import { selectNearBest } from '../../server/src/bots/selection';
import { getCodeBreakerBotAction } from '../../server/src/bots/codebreaker-strategy';
import type { BotAction } from '../../server/src/bots/bot-decisions';
import type { DemoFixture } from './demo-fixture-types';
import { createDemoRecorder, DEMO_NOW } from './demo-recorder';

/** The newest modes: two dice-category games and the code-breaking puzzle. */
export type DiceDemoGame = 'yacht' | 'dominoes' | 'codebreaker';
const SEATS = ['N', 'E'] as const;
const PLAYERS: Partial<Record<GameSeat, PlayerInfo>> = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: `demo-${seat}`, username: `demo_${seat.toLowerCase()}`, nickname: `Demo ${seat}`,
  color: '#4a9eff', avatar: 'cat', avatarImage: null,
} satisfies PlayerInfo]));

/** Shuffle and bot seed of the Dominoes lesson, and the points N scores by going out. */
const DOMINOES_SEED = 14_997;
const DOMINOES_POINTS = 56;
/** Seed of E's hard-bot guesses in the Code Breaker lesson. */
const CODEBREAKER_SEED = 1;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Returns the listed values in order, failing when the scripted values run out. */
function tape(values: readonly number[]): () => number {
  let cursor = 0;
  return (): number => {
    const value = values[cursor++];
    if (value === undefined) throw new Error('Tutorial random tape exhausted.');
    return value;
  };
}

/** Random inputs that make `Math.floor(random() * sides)` return each listed value. */
function rolls(values: readonly number[], sides: number, offset: number): () => number {
  return tape(values.map((value) => (value - offset + 0.5) / sides));
}

function required<T>(value: T | null | undefined, context: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${context}.`);
  return value;
}

function botRequest<Action>(decision: BotAction | null, gameType: string): Action {
  if (decision?.type !== 'game-action' || decision.request.gameType !== gameType) throw new Error(`Missing ${gameType} decision.`);
  return decision.request.action as Action;
}

/** N scores four sixes after keeping three, E takes a first-roll large straight, then the hard bot plays both seats. */
function yachtFixture(): DemoFixture {
  const code = 'DEMOYA';
  yacht.startGame(code, PLAYERS, { mode: 'turns' }, 30_000, DEMO_NOW);
  try {
    const recorder = createDemoRecorder(code, 'N', SEATS, () => yacht.getPlayerVisibleState(code, 'N'));
    const random = seededRandom(1);
    const act = (seat: GameSeat, action: YachtGameAction, chapter: string, dice?: () => number): void => {
      recorder.act(seat, action, chapter, () => {
        switch (action.type) {
          case 'roll': return yacht.roll(code, seat, action.held, dice ?? random);
          case 'hold': return yacht.hold(code, seat, action.held);
          case 'score': return yacht.score(code, seat, action.box, DEMO_NOW);
          case 'auto': throw new Error('The tutorial never times out.');
        }
      });
    };
    act('N', { type: 'roll' }, 'yacht-roll', rolls([6, 2, 6, 4, 6], 6, 1));
    act('N', { type: 'hold', held: [true, false, true, false, true] }, 'yacht-hold');
    act('N', { type: 'roll', held: [true, false, true, false, true] }, 'yacht-reroll', rolls([6, 1], 6, 1));
    act('N', { type: 'score', box: 'sixes' }, 'yacht-score');
    act('E', { type: 'roll' }, 'yacht-straight', rolls([3, 5, 1, 4, 2], 6, 1));
    act('E', { type: 'score', box: 'largeStraight' }, 'yacht-straight');
    for (let index = 0; index < 500; index++) {
      const game = required(yacht.getGameState(code), 'Yacht game');
      if (game.phase !== 'playing') break;
      const seat = required(game.currentTurnSeat, 'Yacht turn');
      const view: YachtVisibleState = required(yacht.getPlayerVisibleState(code, seat), 'Yacht player view');
      act(seat, botRequest<YachtGameAction>(getYachtBotAction(view), 'yacht'), 'yacht-rest');
    }
    const fixture = recorder.finish();
    const result = required(yacht.getGameState(code)?.result, 'Yacht result');
    if (result.winners.join() !== 'N' || result.totals.N !== 216 || result.totals.E !== 191 || !result.upperBonus.N) {
      throw new Error('The Yacht lesson no longer ends 216:191 with the upper bonus for N.');
    }
    return { ...fixture, roomOptions: { yacht: { mode: 'turns' } } };
  } finally {
    yacht.abortGame(code);
  }
}

/**
 * The lesson's scripted player: the heuristic play scores with close choices varied by the seeded generator, so
 * the recorded lesson stays fixed when the search bot changes.
 */
function lessonDominoesAction(view: DominoesVisibleState, random: () => number): DominoesAction {
  const options = dmTurnOptions(view.myHand, view.line, view.boneyardCount, view.openingTile);
  if (options.plays.length === 0) return { type: options.canDraw ? 'draw' : 'pass' };
  const play = selectNearBest(scoreDominoesPlays(view, options).map(({ play: value, score }) => ({ value, score })), random, 0.25)!;
  return { type: 'play', tile: play.tile, ...(play.side ? { side: play.side } : {}) };
}

/** One heads-up round to 50 points: N opens with the highest double and goes out while E holds many pips. */
function dominoesFixture(): DemoFixture {
  const code = 'DEMODO';
  const random = seededRandom(DOMINOES_SEED);
  const set = dmAllTiles();
  for (let index = set.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [set[index], set[swap]] = [set[swap], set[index]];
  }
  const options = { targetScore: 50 } as const;
  dominoes.startGame(code, PLAYERS, set, options, DEMO_NOW);
  try {
    const recorder = createDemoRecorder(code, 'N', SEATS, () => dominoes.getPlayerVisibleState(code, 'N'));
    for (let index = 0; index < 200; index++) {
      const game = required(dominoes.getGameState(code), 'Dominoes game');
      if (game.phase !== 'playing') break;
      const seat = game.currentTurnSeat;
      const view = required(dominoes.getPlayerVisibleState(code, seat), 'Dominoes player view');
      const action = lessonDominoesAction(view, random);
      recorder.act(seat, action, `dominoes-${action.type}`, () => {
        switch (action.type) {
          case 'play': return dominoes.play(code, seat, action.tile, action.side, DEMO_NOW);
          case 'draw': return dominoes.draw(code, seat, DEMO_NOW);
          case 'pass': return dominoes.pass(code, seat, DEMO_NOW);
        }
      });
    }
    const fixture = recorder.finish();
    const result = required(dominoes.getGameState(code)?.result, 'Dominoes result');
    if (result.rounds !== 1 || result.winners.join() !== 'N' || result.scores.N !== DOMINOES_POINTS) {
      throw new Error(`The Dominoes lesson no longer ends after one round with N scoring ${DOMINOES_POINTS}.`);
    }
    return { ...fixture, roomOptions: { dominoes: options } };
  } finally {
    dominoes.abortGame(code);
  }
}
/** Both seats crack 1429 in digits mode: N with four scripted guesses, E with the hard bot one guess later. */
function codeBreakerFixture(): DemoFixture {
  const code = 'DEMOCB';
  const options = { variant: 'digits' } as const;
  codebreaker.startGame(code, PLAYERS, options, 60_000, DEMO_NOW, rolls([1, 4, 2, 9], 10, 0));
  try {
    const recorder = createDemoRecorder(code, 'N', SEATS, () => codebreaker.getPlayerVisibleState(code, 'N'));
    const random = seededRandom(CODEBREAKER_SEED);
    const own = [[1, 2, 3, 4], [1, 4, 5, 2], [0, 1, 2, 9], [1, 4, 2, 9]];
    for (let round = 0; round < 10; round++) {
      for (const seat of SEATS) {
        const game = required(codebreaker.getGameState(code), 'Code Breaker game');
        if (game.phase !== 'playing' || !codebreaker.pendingSeats(game).includes(seat)) continue;
        const view: CodeBreakerVisibleState = required(codebreaker.getPlayerVisibleState(code, seat), 'Code Breaker player view');
        const guess = seat === 'N' ? required(own[round], 'scripted guess')
          : botRequest<{ code: number[] }>(getCodeBreakerBotAction(view, random), 'codebreaker').code;
        // Another seat's guesses stay private until the match ends.
        const action = seat === 'N' ? { type: 'guess', code: guess } : { type: 'guess' };
        recorder.act(seat, action, 'codebreaker-guess', () => codebreaker.guess(code, seat, guess, false, DEMO_NOW));
      }
    }
    const fixture = recorder.finish();
    const result = required(codebreaker.getGameState(code)?.result, 'Code Breaker result');
    if (result.winners.join() !== 'N' || result.guesses.N !== 4 || result.guesses.E !== 5) {
      throw new Error('The Code Breaker lesson no longer ends with N cracking the code first.');
    }
    return { ...fixture, roomOptions: { codebreaker: options } };
  } finally {
    codebreaker.abortGame(code);
  }
}
/** Complete legal matches, recorded from N's filtered player perspective. */
export function generateDiceFixtures(): Record<DiceDemoGame, DemoFixture> {
  return { yacht: yachtFixture(), dominoes: dominoesFixture(), codebreaker: codeBreakerFixture() };
}
