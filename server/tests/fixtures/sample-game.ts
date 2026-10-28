import type { GameClock, GameSeat, ObserverRole, PlayerInfo, RoomCode, Seat } from '@shared/types';
import type { GameAutomation, GamePresentation } from '@shared/types/game';
import type { PresentationFrame } from '@shared/games/presentation';
import { commonGame, object, oneOf, sameJson, seats, text } from '../../src/runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../src/runtime/validation-helpers';
import type { GameActionContext, GameActionResult, GameStartRequest } from '../../src/managers/games/game-adapter';

export interface SampleAction {
  readonly type: 'claim';
  readonly token: string;
}

interface SampleVisibleState {
  readonly gameType: 'sample';
  readonly id: string;
  readonly startedAt: number;
  readonly roomCode: RoomCode;
  readonly players: Partial<Record<GameSeat, PlayerInfo>>;
  readonly phase: 'playing';
  readonly log: readonly { seat: GameSeat }[];
  readonly result: null;
  readonly currentTurnSeat: GameSeat;
  readonly ownToken: string | null;
  readonly presentation?: GamePresentation;
}

export interface SampleGameState extends Omit<SampleVisibleState, 'ownToken' | 'log' | 'currentTurnSeat'>, GameAutomation {
  currentTurnSeat: GameSeat;
  log: { seat: GameSeat }[];
  tokens: Partial<Record<GameSeat, string>>;
  clock?: GameClock;
}

const initialTokens = { N: 'north-private', E: 'east-private', S: 'south-private', W: 'west-private' };

const games = new Map<RoomCode, SampleGameState>();

export function parseSampleAction(value: unknown): SampleAction | string {
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'claim'
    || !('token' in value) || typeof value.token !== 'string' || value.token.length > 32) return 'Invalid claim.';
  return { type: 'claim', token: value.token };
}

// This independent token game exercises runtime registration. The production GameType and state
// unions are closed, so this fixture does not claim compile-time GameAdapter<'sample'> acceptance.
export const sampleAdapter = {
  gameType: 'sample',
  getGameState: (code: RoomCode): SampleGameState | null => games.get(code) ?? null,
  exportGames: (): SampleGameState[] => [...games.values()],
  restoreGames: (records: SampleGameState[]): void => { games.clear(); records.forEach((game) => games.set(game.roomCode, game)); },
  abortGame: (code: RoomCode): void => { games.delete(code); },
  start: ({ roomCode, players }: GameStartRequest): GameActionResult => {
    games.set(roomCode, {
      gameType: 'sample', id: `sample-${roomCode}`, startedAt: Date.now(), roomCode, players, phase: 'playing', result: null,
      currentTurnSeat: 'N', log: [], tokens: { ...initialTokens },
    });
    return { success: true };
  },
  applyAction: (code: RoomCode, seat: GameSeat, action: SampleAction, context: GameActionContext): GameActionResult =>
    context.timed(() => context.present(() => {
      const game = games.get(code);
      if (!game || game.currentTurnSeat !== seat || game.tokens[seat] !== action.token) {
        return { success: false, reason: 'Claim your own token on your turn.' };
      }
      delete game.tokens[seat];
      game.log.push({ seat });
      game.currentTurnSeat = seats[(seats.indexOf(seat as Seat) + 1) % seats.length];
      return { success: true };
    })),
  getPlayerVisibleState: (code: RoomCode, seat: GameSeat): SampleVisibleState | null => {
    const game = games.get(code);
    if (!game) return null;
    return {
      gameType: 'sample', id: game.id, startedAt: game.startedAt, roomCode: game.roomCode,
      players: game.players, phase: game.phase, log: game.log, result: game.result,
      currentTurnSeat: game.currentTurnSeat, presentation: game.presentation, ownToken: game.tokens[seat] ?? null,
    };
  },
  withObserverView: (visible: SampleVisibleState, game: SampleGameState, observer: ObserverRole) =>
    ({ ...visible, observer, observedTokens: game.tokens }),
  turnSeat: (game: SampleGameState): GameSeat => game.currentTurnSeat,
  matchResult: (): null => null,
};

export const sampleDefinition = {
  gameType: 'sample', category: 'board', equipment: [],
  seats: { minPlayers: 4, maxPlayers: 4, flexible: false, expandable: false, numbered: false },
  presentation: {
    logFrames: (_game: unknown, _index: number, key: string): PresentationFrame[] =>
      [{ key, kind: 'pass', seat: 'N', durationMs: 5000, cards: [] }],
    finishSeat: (): undefined => undefined,
  },
  result: { kind: 'ranking', scoreKind: null },
};

export const sampleValidator = {
  shape: (value: ObjectValue, player: PlayerValidator): boolean =>
    value.gameType === 'sample' && commonGame(value, player) && value.phase === 'playing' && value.result === null
      && oneOf(value.currentTurnSeat, seats) && object(value.tokens)
      && Object.entries(value.tokens).every(([seat, token]) => seats.includes(seat as Seat) && text(token) && token.length <= 32)
      && Array.isArray(value.log) && value.log.length <= seats.length
      && value.log.every((entry: unknown) => object(entry) && Object.keys(entry).length === 1 && oneOf(entry.seat, seats)),
  coherent: (game: SampleGameState): boolean => {
    const tokens: Partial<Record<GameSeat, string>> = { ...initialTokens };
    let next = 0;
    for (const entry of game.log) {
      if (entry.seat !== seats[next] || !tokens[entry.seat]) return false;
      delete tokens[entry.seat];
      next = (next + 1) % seats.length;
    }
    return sameJson(game.tokens, tokens) && game.currentTurnSeat === seats[next];
  },
};
