import type { GameSeat, PlayerInfo, PlayerVisibleGameState } from '../../shared/src/types';
import type { GameActionEnvelope } from '../../shared/src/games/actions';
import { DEFAULT_BATTLESHIP_OPTIONS } from '../../shared/src/rules/battleship';
import { chessApply, chessInitialPosition, chessLegalMoves, chessNode, chessSan } from '../../shared/src/rules/chess';
import type { ChessPosition } from '../../shared/src/rules/chess';
import { goNode, goParsePoint } from '../../shared/src/rules/go';
import * as reversi from '../../server/src/managers/games/reversi-game';
import * as gomoku from '../../server/src/managers/games/gomoku-game';
import * as xiangqi from '../../server/src/managers/games/xiangqi-game';
import * as chess from '../../server/src/managers/games/chess-game';
import * as go from '../../server/src/managers/games/go-game';
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

type AssignedGameType = 'reversi' | 'gomoku' | 'go' | 'xiangqi' | 'chess' | 'jungle' | 'landbattle' | 'battleship' | 'banqi' | 'chinesecheckers';
/** Lessons scripted move by move instead of played by a bot. */
type ScriptedGameType = 'gomoku' | 'go' | 'chess';
type BoardView = Extract<PlayerVisibleGameState, { gameType: AssignedGameType }>;
type BoardRequest = Extract<GameActionEnvelope, { gameType: Exclude<AssignedGameType, 'go' | 'chess'> }>;
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
  const managers = { reversi, gomoku, go, xiangqi, chess, jungle, landbattle, battleship, banqi, chinesecheckers };
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
    case 'gomoku': case 'go': case 'chess': throw new Error(`${view.gameType} uses a scripted game.`);
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

function automatedFixture(type: Exclude<AssignedGameType, ScriptedGameType>, seed: number): DemoFixture {
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

/** A short legal game with a bishop-blocked check, a captured checker, a promotion, castling and a queen mate. */
const CHESS_GAME = [
  'Nc3', 'd6', 'Nf3', 'Nc6', 'e4', 'Qd7', 'd4', 'e6', 'd5', 'exd5', 'exd5', 'Qe7+', 'Be3', 'Nb4', 'a3', 'Nxc2+', 'Qxc2',
  'Bg4', 'Bb5+', 'c6', 'dxc6', 'Bxf3', 'cxb7+', 'Kd8', 'bxa8=Q+', 'Bxa8', 'O-O', 'Kc8', 'Nd5+', 'Bc6', 'Qxc6+', 'Kd8', 'Qa8#',
] as const;

function chessFixture(): DemoFixture {
  const code = 'DEMO-CHESS';
  chess.startGame(code, PLAYERS, DEMO_NOW);
  const recorder = createDemoRecorder(code, 'N', SEATS, () => chess.getPlayerVisibleState(code, 'N'));
  try {
    let position: ChessPosition = chessInitialPosition();
    for (const [index, san] of CHESS_GAME.entries()) {
      const seat = SEATS[index % 2];
      const matches = chessLegalMoves(position).filter((candidate) => chessSan(position, candidate) === san);
      const move = required(matches.length === 1 ? matches[0] : null, `unique legal move for ${san}`);
      const action = {
        type: 'move' as const, from: chessNode(move.from), to: chessNode(move.to), ...move.promotion ? { promotion: move.promotion } : {},
      };
      recorder.act(seat, action, 'chess-move',
        () => chess.move(code, seat, action.from, action.to, move.promotion, DEMO_NOW));
      position = chessApply(position, move);
    }
    const result = required(chess.getGameState(code)?.result, 'Chess result');
    if (result.reason !== 'checkmate' || result.winners.join() !== 'N') {
      throw new Error('The Chess lesson no longer ends in checkmate for white.');
    }
    return recorder.finish();
  } finally {
    chess.abortGame(code);
  }
}

/** A 9 × 9 game played once offline by the hard bot and kept as a fixed list; the marking steps are scripted. */
const GO_GAME = (
  'E4 D4 E6 E5 F5 E3 D5 C5 C4 D3 F3 C3 B4 B5 B2 B3 E2 F2 A4 A3 G2 G8 D7 F4 G4 E8 F7 H7 F8 G9 H6 F1 C6 C8 B6 A5 B7 F9 B8 '
  + 'G6 H5 J7 E1 D2 D8 D1 G7 J6 E7 H4 J5 J4 G5 G3 H3 H8 J9 G1 H1 H2 J2 D9 A6 C9 E1 E2 E9 A9 E8 pass pass'
).split(' ');
/** The server's estimate leaves this lone corner stone alive; the lesson marks it dead by hand. */
const GO_MARKED = 'J9';
const GO_MARK_MS = 90_000;

function goFixture(): DemoFixture {
  const code = 'DEMO-GO';
  go.startGame(code, PLAYERS, { size: 9, handicap: 0 }, DEMO_NOW);
  const recorder = createDemoRecorder(code, 'N', SEATS, () => go.getPlayerVisibleState(code, 'N'));
  const node = (name: string): string => goNode(9, required(goParsePoint(9, name), `Go point ${name}`));
  try {
    for (const [index, name] of GO_GAME.entries()) {
      const seat = SEATS[index % 2];
      if (name === 'pass') {
        recorder.act(seat, { type: 'pass' }, 'go-pass', () => go.pass(code, seat, GO_MARK_MS, DEMO_NOW));
      } else {
        const to = node(name);
        recorder.act(seat, { type: 'place', to }, 'go-place', () => go.place(code, seat, to, GO_MARK_MS, DEMO_NOW));
      }
    }
    const marked = node(GO_MARKED);
    recorder.act('N', { type: 'toggle-dead', to: marked }, 'go-mark', () => go.toggleDead(code, 'N', marked, false, DEMO_NOW));
    for (const seat of SEATS) {
      const dead = [...required(go.getGameState(code), 'Go game').dead];
      recorder.act(seat, { type: 'confirm-score', dead }, 'go-confirm', () => go.confirmScore(code, seat, dead, false, DEMO_NOW));
    }
    const result = required(go.getGameState(code)?.result, 'Go result');
    if (result.reason !== 'score' || result.winners.join() !== 'N' || result.margin !== 3.5) {
      throw new Error('The Go lesson no longer ends with black winning by 3.5 points.');
    }
    return recorder.finish();
  } finally {
    go.abortGame(code);
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
    go: goFixture(),
    chess: chessFixture(),
  };
}
