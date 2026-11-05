import type { Card, PlayerInfo, PlayerVisibleGameState, Seat } from '../../shared/src/types';
import { createDeck, shuffleDeck } from '../../server/src/engine/deck';
import * as hearts from '../../server/src/managers/games/hearts-game';
import * as gongzhu from '../../server/src/managers/games/gongzhu-game';
import * as spades from '../../server/src/managers/games/spades-game';
import { createCardRecipe } from './card-recipe';
import type { GameActionEnvelope } from '../../shared/src/games/actions';
import { createDemoRecorder, DEMO_NOW } from './demo-recorder';
import type { DemoFixture } from './demo-fixture-types';

export type TrickDemoGame = 'hearts' | 'gongzhu' | 'spades';
type TrickView = Extract<PlayerVisibleGameState, { gameType: TrickDemoGame }>;
const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: `demo-${seat}`, username: `demo_${seat.toLowerCase()}`, nickname: `Demo ${seat}`,
  color: '#4a9eff', avatar: 'cat', avatarImage: null,
} satisfies PlayerInfo])) as Record<Seat, PlayerInfo>;

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing trick tutorial state or action.');
  return value;
}
function read(code: string, game: TrickDemoGame, seat: Seat): TrickView {
  switch (game) {
    case 'hearts': return required(hearts.getPlayerVisibleState(code, seat));
    case 'gongzhu': return required(gongzhu.getPlayerVisibleState(code, seat));
    case 'spades': return required(spades.getPlayerVisibleState(code, seat));
  }
}
function apply(code: string, seat: Seat, request: GameActionEnvelope, deck: () => Card[]): { success: boolean; reason?: string } {
  switch (request.gameType) {
    case 'hearts': return hearts.act(code, seat, request.action, DEMO_NOW, deck);
    case 'gongzhu': return gongzhu.playCard(code, seat, request.action.card, DEMO_NOW);
    case 'spades': return spades.act(code, seat, request.action, DEMO_NOW);
    default: throw new Error(`Unexpected trick tutorial action: ${request.gameType}.`);
  }
}
function pending(view: TrickView): Seat {
  if (view.gameType === 'hearts' && view.phase === 'passing') {
    return required(SEATS.find((seat) => !view.passedSeats.includes(seat)));
  }
  return required(view.currentTurnSeat);
}
function fixture(game: TrickDemoGame, seed: number): DemoFixture {
  const code = `DEMO${game.slice(0, 2).toUpperCase()}`;
  const originalRandom = Math.random;
  const originalNow = Date.now;
  let state = seed;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const recipe = createCardRecipe(game, random);
  const deck = (): Card[] => shuffleDeck(createDeck(), random);
  Math.random = random;
  Date.now = () => DEMO_NOW;
  try {
    switch (game) {
      case 'hearts': hearts.startGame(code, PLAYERS, 30_000, deck(), DEMO_NOW); break;
      case 'gongzhu': gongzhu.startGame(code, PLAYERS, deck(), DEMO_NOW); break;
      case 'spades': spades.startGame(code, PLAYERS, deck(), 'W', DEMO_NOW); break;
    }
    const recorder = createDemoRecorder(code, 'N', SEATS, () => read(code, game, 'N'));
    for (let step = 0; step < 5_000; step++) {
      const visible = read(code, game, 'N');
      if (visible.result) { recipe.finish(); return recorder.finish(); }
      const seat = pending(visible);
      const action = recipe.next(seat);
      if (action.type !== 'game-action') throw new Error('Expected a trick game action.');
      const request = action.request;
      // Opponents' exchanged cards are private even though their submitted status is public.
      const recorded = request.gameType === 'hearts' && request.action.type === 'pass' && seat !== 'N'
        ? { type: 'pass' } : request.action;
      recorder.act(seat, recorded, `${game}-${recorded.type}`, () => apply(code, seat, request, deck));
    }
    throw new Error(`${game}: tutorial exceeded the legal-action limit.`);
  } finally {
    Math.random = originalRandom;
    Date.now = originalNow;
    switch (game) {
      case 'hearts': hearts.abortGame(code); break;
      case 'gongzhu': gongzhu.abortGame(code); break;
      case 'spades': spades.abortGame(code); break;
    }
  }
}

/** Complete legal matches from one player's perspective, with reproducible deals and decisions. */
export function generateTrickFixtures(): Record<TrickDemoGame, DemoFixture> {
  return { hearts: fixture('hearts', 31), gongzhu: fixture('gongzhu', 32), spades: fixture('spades', 33) };
}
