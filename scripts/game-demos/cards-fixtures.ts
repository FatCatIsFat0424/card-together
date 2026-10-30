import type { GameSeat, GameType, PlayerInfo, PlayerVisibleGameState, Seat } from '../../shared/src/types';
import { createDeck, shuffleDeck } from '../../server/src/engine/deck';
import * as bigtwo from '../../server/src/managers/games/bigtwo-game';
import * as redpoints from '../../server/src/managers/games/redpoints-game';
import * as ninetynine from '../../server/src/managers/games/ninetynine-game';
import * as sevens from '../../server/src/managers/games/sevens-game';
import * as crazyeights from '../../server/src/managers/games/crazyeights-game';
import * as oldmaid from '../../server/src/managers/games/oldmaid-game';
import * as gofish from '../../server/src/managers/games/gofish-game';
import * as doudizhu from '../../server/src/managers/games/doudizhu-game';
import * as liarsdeck from '../../server/src/managers/games/liarsdeck-game';
import { getBigTwoBotAction } from '../../server/src/bots/bigtwo-strategy';
import { getRedPointsBotAction } from '../../server/src/bots/redpoints-strategy';
import { getNinetyNineBotAction } from '../../server/src/bots/ninetynine-strategy';
import { getSevensBotAction } from '../../server/src/bots/sevens-strategy';
import { getCrazyEightsBotAction } from '../../server/src/bots/crazyeights-strategy';
import { getOldMaidBotAction } from '../../server/src/bots/oldmaid-strategy';
import { getGoFishBotAction } from '../../server/src/bots/gofish-strategy';
import { getDouDizhuBotAction } from '../../server/src/bots/doudizhu-strategy';
import type { BotAction } from '../../server/src/bots/bot-decisions';
import { ldIsTruth } from '../../shared/src/rules/liarsdeck';
import { createDemoRecorder, DEMO_NOW } from './demo-recorder';
import type { DemoFixture } from './demo-fixture-types';

export type CardsGameType = Extract<GameType,
  'bigtwo' | 'redpoints' | 'ninetynine' | 'sevens' | 'crazyeights' | 'oldmaid' | 'gofish' | 'doudizhu' | 'liarsdeck'>;

type CardsVisibleState = Extract<PlayerVisibleGameState, { gameType: CardsGameType }>;

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: `demo-${seat}`, username: `demo_${seat.toLowerCase()}`, nickname: `Demo ${seat}`,
  color: '#4a9eff', avatar: 'cat', avatarImage: null,
} satisfies PlayerInfo])) as Record<Seat, PlayerInfo>;

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing card tutorial state or action.');
  return value;
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function read(code: string, game: CardsGameType, seat: GameSeat): CardsVisibleState {
  switch (game) {
    case 'bigtwo': return required(bigtwo.getPlayerVisibleState(code, seat as Seat));
    case 'redpoints': return required(redpoints.getPlayerVisibleState(code, seat as Seat));
    case 'ninetynine': return required(ninetynine.getPlayerVisibleState(code, seat));
    case 'sevens': return required(sevens.getPlayerVisibleState(code, seat as Seat));
    case 'crazyeights': return required(crazyeights.getPlayerVisibleState(code, seat));
    case 'oldmaid': return required(oldmaid.getPlayerVisibleState(code, seat));
    case 'gofish': return required(gofish.getPlayerVisibleState(code, seat));
    case 'doudizhu': return required(doudizhu.getPlayerVisibleState(code, seat));
    case 'liarsdeck': return required(liarsdeck.getPlayerVisibleState(code, seat as Seat));
  }
}

function choose(visible: PlayerVisibleGameState, random: () => number): BotAction {
  switch (visible.gameType) {
    case 'bigtwo': return required(getBigTwoBotAction(visible, random));
    case 'redpoints': return required(getRedPointsBotAction(visible, random));
    case 'ninetynine': return required(getNinetyNineBotAction(visible, random));
    case 'sevens': return required(getSevensBotAction(visible, random));
    case 'crazyeights': return required(getCrazyEightsBotAction(visible, random));
    case 'oldmaid': return required(getOldMaidBotAction(visible, random));
    case 'gofish': return required(getGoFishBotAction(visible, random));
    case 'doudizhu':
      // A positive opening bid avoids uninformative all-pass redeals.
      if (visible.phase === 'calling' && visible.log.at(-1)?.type === 'deal') {
        return { type: 'game-action', request: { gameType: 'doudizhu', action: { type: 'bid', score: 1 } } };
      }
      return required(getDouDizhuBotAction(visible, random));
    case 'liarsdeck': {
      if (visible.lastPlay) return { type: 'liarsdeck-challenge' };
      // Each actor chooses from their own view; alternate honest claims and bluffs across rounds.
      const truth = visible.round % 2 === 1;
      const card = visible.myHand.find((entry) => ldIsTruth(entry.face, visible.tableFace) === truth) ?? visible.myHand[0];
      return { type: 'liarsdeck-play', cardIds: [required(card).id] };
    }
    default: throw new Error(`Unexpected card tutorial game: ${visible.gameType}.`);
  }
}

function apply(code: string, seat: GameSeat, action: BotAction, random: () => number): { success: boolean; reason?: string } {
  switch (action.type) {
    case 'bigtwo-play': return bigtwo.play(code, seat as Seat, action.cards);
    case 'bigtwo-pass': return bigtwo.pass(code, seat as Seat);
    case 'redpoints-play': return redpoints.play(code, seat as Seat, action.card, action.capture);
    case 'redpoints-flip': return redpoints.chooseFlip(code, seat as Seat, required(action.capture));
    case 'ninetynine-play': return ninetynine.play(code, seat, action.card, action.choice, action.target);
    case 'sevens-play': return sevens.play(code, seat as Seat, action.card);
    case 'sevens-cover': return sevens.cover(code, seat as Seat, action.card);
    case 'liarsdeck-play': return liarsdeck.play(code, seat as Seat, action.cardIds);
    case 'liarsdeck-challenge': return liarsdeck.challenge(code, seat as Seat, random);
    case 'game-action': {
      const request = action.request;
      switch (request.gameType) {
        case 'crazyeights': {
          const move = request.action;
          if (move.type === 'play') return crazyeights.play(code, seat, move.card, move.suit, DEMO_NOW);
          return move.type === 'draw' ? crazyeights.draw(code, seat, DEMO_NOW) : crazyeights.pass(code, seat, DEMO_NOW);
        }
        case 'oldmaid': {
          const move = request.action;
          return move.type === 'draw' ? oldmaid.draw(code, seat, move.index, move.reorder, DEMO_NOW, random)
            : oldmaid.reorder(code, seat, move.order);
        }
        case 'gofish': return gofish.ask(code, seat, request.action.target, request.action.rank, DEMO_NOW);
        case 'doudizhu': {
          const move = request.action;
          switch (move.type) {
            case 'bid': return doudizhu.bid(code, seat, move.score, DEMO_NOW, random);
            case 'claim': return doudizhu.claim(code, seat, move.take, DEMO_NOW, random);
            case 'play': return doudizhu.play(code, seat, move.cards, DEMO_NOW, random);
            case 'pass': return doudizhu.pass(code, seat, DEMO_NOW);
          }
        }
      }
      break;
    }
  }
  throw new Error(`Unexpected tutorial action: ${action.type}.`);
}

/** Records public request fields only; private rearrangements and face-down cards never enter the action tape. */
function publicAction(action: BotAction, own: boolean): unknown {
  if (action.type === 'liarsdeck-play') return own ? { type: 'play', cardIds: action.cardIds }
    : { type: 'play', count: action.cardIds.length };
  if (action.type === 'sevens-cover') return own ? { type: 'cover', card: action.card } : { type: 'cover' };
  if (action.type === 'game-action') {
    if (action.request.gameType === 'oldmaid') {
      const move = action.request.action;
      return move.type === 'draw' ? { type: 'draw', index: move.index } : { type: 'reorder' };
    }
    return action.request.action;
  }
  switch (action.type) {
    case 'bigtwo-play': return { type: 'play', cards: action.cards };
    case 'bigtwo-pass': return { type: 'pass' };
    case 'redpoints-play': return { type: 'play', card: action.card, ...(action.capture ? { capture: action.capture } : {}) };
    case 'redpoints-flip': return { type: 'chooseFlip', capture: action.capture };
    case 'ninetynine-play': return { type: 'play', card: action.card,
      ...(action.choice ? { choice: action.choice } : {}), ...(action.target ? { target: action.target } : {}) };
    case 'sevens-play': return { type: 'play', card: action.card };
    case 'liarsdeck-challenge': return { type: 'challenge' };
    default: throw new Error('Unexpected public tutorial action.');
  }
}

function fixture(game: CardsGameType, seed: number): DemoFixture {
  const code = `DEMO-${game.toUpperCase()}`;
  const random = seededRandom(seed);
  const originalRandom = Math.random;
  // Later Crazy Eights / Go Fish hands use the engine's Math.random default rather than a per-match hook.
  Math.random = random;
  try {
    const deck = shuffleDeck(createDeck(), random);
    const seats = game === 'doudizhu' ? SEATS.slice(0, 3) : SEATS;
    const players = Object.fromEntries(seats.map((seat) => [seat, PLAYERS[seat]]));
    switch (game) {
      case 'bigtwo': bigtwo.startGame(code, PLAYERS, deck); break;
      case 'redpoints': redpoints.startGame(code, PLAYERS, deck, 'N'); break;
      case 'ninetynine': ninetynine.startGame(code, players, deck, 'N'); break;
      case 'sevens': sevens.startGame(code, PLAYERS, deck, { closeOnEnd: true }); break;
      case 'crazyeights': crazyeights.startGame(code, players, deck, 'N', { actionCards: true }, DEMO_NOW); break;
      case 'oldmaid': oldmaid.startGame(code, players, random, DEMO_NOW); break;
      case 'gofish': gofish.startGame(code, players, deck, 'N', DEMO_NOW); break;
      case 'doudizhu': doudizhu.startGame(code, players, { variant: 'score' }, DEMO_NOW, random); break;
      case 'liarsdeck': liarsdeck.startGame(code, PLAYERS, random); break;
    }
    const opening = read(code, game, 'N');
    const focus = game === 'bigtwo' || game === 'sevens' || game === 'liarsdeck'
      ? opening.currentTurnSeat : game === 'redpoints' ? 'E' : game === 'crazyeights' ? 'W' : 'N';
    const recorder = createDemoRecorder(code, focus, seats, () => read(code, game, focus));
    for (let step = 0; step < 3000; step++) {
      const visible = read(code, game, focus);
      if (visible.result) {
        const result = recorder.finish();
        return { ...result, ...(game === 'sevens' ? { roomOptions: { sevens: { closeOnEnd: true } } }
          : game === 'crazyeights' ? { roomOptions: { crazyeights: { actionCards: true } } }
            : game === 'doudizhu' ? { roomOptions: { doudizhu: { variant: 'score' } } } : {}) };
      }
      const seat = visible.currentTurnSeat;
      const action = choose(read(code, game, seat), random);
      const publicMove = publicAction(action, seat === focus);
      const kind = (publicMove as { type: string }).type;
      recorder.act(seat, publicMove, `${game}-${kind}`, () => apply(code, seat, action, random));
    }
    throw new Error(`${game}: tutorial exceeded the legal-action limit.`);
  } finally {
    Math.random = originalRandom;
    switch (game) {
      case 'bigtwo': bigtwo.abortGame(code); break;
      case 'redpoints': redpoints.abortGame(code); break;
      case 'ninetynine': ninetynine.abortGame(code); break;
      case 'sevens': sevens.abortGame(code); break;
      case 'crazyeights': crazyeights.abortGame(code); break;
      case 'oldmaid': oldmaid.abortGame(code); break;
      case 'gofish': gofish.abortGame(code); break;
      case 'doudizhu': doudizhu.abortGame(code); break;
      case 'liarsdeck': liarsdeck.abortGame(code); break;
    }
  }
}

/** Generates complete legal matches without import-time I/O or observer snapshots. */
export function generateCardsFixtures(): Record<CardsGameType, DemoFixture> {
  const originalNow = Date.now;
  Date.now = () => DEMO_NOW;
  try {
    return {
      bigtwo: fixture('bigtwo', 11), redpoints: fixture('redpoints', 12), ninetynine: fixture('ninetynine', 13),
      sevens: fixture('sevens', 14), crazyeights: fixture('crazyeights', 15), oldmaid: fixture('oldmaid', 16),
      gofish: fixture('gofish', 17), doudizhu: fixture('doudizhu', 18), liarsdeck: fixture('liarsdeck', 19),
    };
  } finally {
    Date.now = originalNow;
  }
}
