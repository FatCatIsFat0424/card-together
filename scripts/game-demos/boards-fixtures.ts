import type { GameSeat, PlayerInfo, PlayerVisibleGameState } from '../../shared/src/types';
import type { GameActionEnvelope } from '../../shared/src/games/actions';
import { DEFAULT_BATTLESHIP_OPTIONS } from '../../shared/src/rules/battleship';
import * as reversi from '../../server/src/managers/games/reversi-game';
import * as gomoku from '../../server/src/managers/games/gomoku-game';
import * as xiangqi from '../../server/src/managers/games/xiangqi-game';
import * as jungle from '../../server/src/managers/games/jungle-game';
import * as landbattle from '../../server/src/managers/games/landbattle-game';
import * as battleship from '../../server/src/managers/games/battleship-game';
import * as banqi from '../../server/src/managers/games/banqi-game';
import * as chinesecheckers from '../../server/src/managers/games/chinesecheckers-game';
import { easyReversiAction } from '../../server/src/bots/reversi-strategy';
import { easyXiangqiAction } from '../../server/src/bots/xiangqi-strategy';
import { easyJungleAction } from '../../server/src/bots/jungle-strategy';
import { easyLandBattleAction } from '../../server/src/bots/landbattle-strategy';
import { getBattleshipBotAction } from '../../server/src/bots/battleship-strategy';
import { easyBanqiAction } from '../../server/src/bots/banqi-strategy';
import { getChineseCheckersBotAction } from '../../server/src/bots/chinesecheckers-strategy';
import type { BotAction } from '../../server/src/bots/bot-decisions';
import { createDemoRecorder, DEMO_NOW } from './demo-recorder';
import type { DemoFixture } from './demo-fixture-types';

type AssignedGameType = 'reversi' | 'gomoku' | 'xiangqi' | 'jungle' | 'landbattle' | 'battleship' | 'banqi' | 'chinesecheckers';
type BoardView = Extract<PlayerVisibleGameState, { gameType: AssignedGameType }>;
type BoardRequest = Extract<GameActionEnvelope, { gameType: AssignedGameType }>;
type ActionResult = { readonly success: boolean; readonly reason?: string };

const SEATS = ['N', 'E'] as const;
const PLAYERS: Partial<Record<GameSeat, PlayerInfo>> = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: `demo-${seat}`, username: `demo_${seat.toLowerCase()}`, nickname: `Demo ${seat}`,
  color: '#4a9eff', avatar: 'cat', avatarImage: null,
} satisfies PlayerInfo]));

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function required<T>(value: T | null | undefined, context: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${context}.`);
  return value;
}

function read(code: string, type: AssignedGameType, seat: GameSeat): BoardView {
  const managers = { reversi, gomoku, xiangqi, jungle, landbattle, battleship, banqi, chinesecheckers };
  return required(managers[type].getPlayerVisibleState(code, seat), `${type} player view`);
}

function choose(view: BoardView, random: () => number): BotAction | null {
  switch (view.gameType) {
    case 'reversi': return easyReversiAction(view, random);
    case 'xiangqi': return easyXiangqiAction(view, random);
    case 'jungle': return easyJungleAction(view, random);
    case 'landbattle': return easyLandBattleAction(view, random);
    case 'battleship': return getBattleshipBotAction(view, random);
    case 'banqi': return easyBanqiAction(view, random);
    case 'chinesecheckers': return getChineseCheckersBotAction(view, random);
    case 'gomoku': throw new Error('Gomoku uses the scripted swap opening.');
  }
}

function apply(code: string, seat: GameSeat, request: BoardRequest): ActionResult {
  switch (request.gameType) {
    case 'reversi': return request.action.type === 'place'
      ? reversi.place(code, seat, request.action.to, DEMO_NOW) : reversi.control(code, seat, request.action);
    case 'gomoku': return request.action.type === 'place'
      ? gomoku.place(code, seat, request.action.to, DEMO_NOW)
      : request.action.type === 'choose-side'
        ? gomoku.chooseSide(code, seat, request.action.swap, DEMO_NOW) : gomoku.control(code, seat, request.action);
    case 'xiangqi': return request.action.type === 'move'
      ? xiangqi.move(code, seat, request.action.from, request.action.to, DEMO_NOW) : xiangqi.control(code, seat, request.action);
    case 'jungle': return request.action.type === 'move'
      ? jungle.move(code, seat, request.action.from, request.action.to, DEMO_NOW) : jungle.control(code, seat, request.action);
    case 'landbattle': return request.action.type === 'deploy'
      ? landbattle.deploy(code, seat, request.action.layout, false, DEMO_NOW)
      : request.action.type === 'move'
        ? landbattle.move(code, seat, request.action.from, request.action.to, DEMO_NOW) : landbattle.control(code, seat, request.action);
    case 'battleship': return request.action.type === 'place-fleet'
      ? battleship.placeFleet(code, seat, request.action.fleet, false, DEMO_NOW)
      : request.action.type === 'fire'
        ? battleship.fire(code, seat, request.action.to, DEMO_NOW) : battleship.control(code, seat, request.action);
    case 'banqi': return request.action.type === 'flip'
      ? banqi.flip(code, seat, request.action.to, DEMO_NOW)
      : request.action.type === 'move'
        ? banqi.move(code, seat, request.action.from, request.action.to, DEMO_NOW)
        : request.action.type === 'stop' ? banqi.stop(code, seat) : banqi.control(code, seat, request.action);
    case 'chinesecheckers': return request.action.type === 'move'
      ? chinesecheckers.move(code, seat, request.action.from, request.action.to, DEMO_NOW)
      : chinesecheckers.control(code, seat, request.action, DEMO_NOW);
  }
}

function automatedFixture(type: Exclude<AssignedGameType, 'gomoku'>, seed: number): DemoFixture {
  const code = `DEMO-${type.toUpperCase()}`;
  const random = seededRandom(seed);
  switch (type) {
    case 'reversi': reversi.startGame(code, PLAYERS, DEMO_NOW); break;
    case 'xiangqi': xiangqi.startGame(code, PLAYERS, undefined, DEMO_NOW); break;
    case 'jungle': jungle.startGame(code, PLAYERS, DEMO_NOW); break;
    case 'landbattle': landbattle.startGame(code, PLAYERS, 600_000, DEMO_NOW); break;
    case 'battleship': battleship.startGame(code, PLAYERS, DEFAULT_BATTLESHIP_OPTIONS, 600_000, DEMO_NOW); break;
    case 'banqi': banqi.startGame(code, PLAYERS, undefined, random, DEMO_NOW); break;
    case 'chinesecheckers': {
      const result = chinesecheckers.startGame(code, PLAYERS, DEMO_NOW);
      if (!result.success) throw new Error(result.reason);
      break;
    }
  }
  const recorder = createDemoRecorder(code, 'N', SEATS, () => read(code, type, 'N'));
  try {
    for (let index = 0; index < 2_000; index++) {
      const visible = read(code, type, 'N');
      if (visible.result) return recorder.finish();
      const seat = visible.gameType === 'landbattle' && visible.phase === 'deploying'
        ? required(SEATS.find((other) => !visible.deployed.includes(other)), 'deployment seat')
        : visible.gameType === 'battleship' && visible.phase === 'placing'
          ? required(SEATS.find((other) => !visible.placed.includes(other)), 'placement seat') : visible.currentTurnSeat;
      const decision = required(choose(read(code, type, seat), random), `${type} legal decision`);
      if (decision.type !== 'game-action' || decision.request.gameType !== type) throw new Error(`Wrong ${type} decision.`);
      const request = decision.request as BoardRequest;
      // Opponents' submitted identities and ship positions are never public actions.
      const publicAction = seat !== 'N' && ['deploy', 'place-fleet'].includes(request.action.type)
        ? { type: request.action.type } : request.action;
      recorder.act(seat, publicAction, `${type}-${request.action.type}`, () => apply(code, seat, request));
    }
    throw new Error(`${type} exceeded the tutorial move limit.`);
  } finally {
    const managers = { reversi, xiangqi, jungle, landbattle, battleship, banqi, chinesecheckers };
    managers[type].abortGame(code);
  }
}

function gomokuFixture(): DemoFixture {
  const code = 'DEMO-GOMOKU';
  const options = { renju: true, swap: true };
  gomoku.startGame(code, PLAYERS, options, DEMO_NOW);
  const recorder = createDemoRecorder(code, 'N', SEATS, () => gomoku.getPlayerVisibleState(code, 'N'));
  try {
    const placements = ['7,7', '7,9', '8,7', '8,9', '9,7', '9,9', '10,7', '10,9', '11,7'];
    for (const [index, to] of placements.entries()) {
      if (index === 3) recorder.act('E', { type: 'choose-side', swap: false }, 'gomoku-choose',
        () => gomoku.chooseSide(code, 'E', false, DEMO_NOW));
      const seat = required(gomoku.getGameState(code), 'Gomoku state').currentTurnSeat;
      recorder.act(seat, { type: 'place', to }, index < 3 ? 'gomoku-opening' : 'gomoku-place',
        () => gomoku.place(code, seat, to, DEMO_NOW));
    }
    return { ...recorder.finish(), roomOptions: { gomoku: options } };
  } finally {
    gomoku.abortGame(code);
  }
}

/** Complete legal matches, always recorded from N's filtered player perspective. */
export function generateBoardFixtures(): Record<AssignedGameType, DemoFixture> {
  return {
    reversi: automatedFixture('reversi', 11),
    gomoku: gomokuFixture(),
    xiangqi: automatedFixture('xiangqi', 12),
    jungle: automatedFixture('jungle', 13),
    landbattle: automatedFixture('landbattle', 14),
    battleship: automatedFixture('battleship', 15),
    banqi: automatedFixture('banqi', 16),
    chinesecheckers: automatedFixture('chinesecheckers', 17),
  };
}
