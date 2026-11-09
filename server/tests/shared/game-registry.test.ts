import { describe, expect, it } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import { EXPANDABLE_ROOM_GAMES, GAME_DEFINITIONS, gameDefinition, isGameType } from '@shared/games/registry';
import { isNumberedSeatGame, maxPlayers, minPlayers } from '@shared/rules/seats';
import type { GameType } from '@shared/types';

/** Seat rules as they were before the registry: four fixed seats unless listed here. */
const PREVIOUS_SEATS: Readonly<Record<GameType, readonly [min: number, max: number, flexible: boolean, numbered: boolean]>> = {
  spades: [4, 4, false, false],
  hearts: [4, 4, false, false],
  bridge: [4, 4, false, false],
  bigtwo: [4, 4, false, false],
  redpoints: [4, 4, false, false],
  ninetynine: [2, 8, true, false],
  sevens: [4, 4, false, false],
  chinesepoker: [4, 4, false, false],
  liarsdeck: [4, 4, false, false],
  blackjack: [2, 8, true, false],
  holdem: [2, 8, true, false],
  napoleon: [4, 6, true, true],
  tenhalf: [2, 8, true, false],
  liarsdice: [2, 8, true, false],
  reversi: [2, 2, true, false],
  jungle: [2, 2, true, false],
  gomoku: [2, 2, true, false],
  go: [2, 2, true, false],
  xiangqi: [2, 2, true, false],
  chess: [2, 2, true, false],
  crazyeights: [2, 8, true, false],
  stud: [2, 8, true, false],
  oldmaid: [2, 8, true, false],
  gofish: [2, 6, true, false],
  gongzhu: [4, 4, false, false],
  doudizhu: [3, 3, true, true],
  banqi: [2, 2, true, false],
  chinesecheckers: [2, 6, true, true],
  landbattle: [2, 2, true, false],
  battleship: [2, 2, true, false],
  codebreaker: [2, 6, true, false],
  yacht: [2, 8, true, false],
  dominoes: [2, 4, true, false],
};

describe('shared game registry', () => {
  it('defines every game type exactly once under its own key', () => {
    expect(Object.keys(GAME_DEFINITIONS).sort()).toEqual([...GAME_TYPES].sort());
    for (const gameType of GAME_TYPES) expect(gameDefinition(gameType).gameType).toBe(gameType);
  });

  it.each(GAME_TYPES)('keeps the previous seat limits for %s', (gameType) => {
    const [min, max, flexible, numbered] = PREVIOUS_SEATS[gameType];
    expect(gameDefinition(gameType).seats).toEqual({ minPlayers: min, maxPlayers: max, flexible, expandable: flexible && max > 4, numbered,
      ...gameType === 'chinesecheckers' ? { playerCounts: [2, 3, 4, 6] } : {} });
    expect([minPlayers(gameType), maxPlayers(gameType), isNumberedSeatGame(gameType)]).toEqual([min, max, numbered]);
  });

  it('lists the expandable rooms in lobby order', () => {
    expect(EXPANDABLE_ROOM_GAMES).toEqual(['ninetynine', 'blackjack', 'holdem', 'napoleon', 'tenhalf', 'liarsdice', 'crazyeights', 'stud', 'oldmaid', 'gofish', 'chinesecheckers', 'codebreaker', 'yacht']);
  });

  it('classifies the dice game by its category and gives chips only to the betting games', () => {
    for (const gameType of GAME_TYPES) {
      const definition = gameDefinition(gameType);
      if (gameType === 'liarsdice' || gameType === 'yacht' || gameType === 'dominoes') {
        expect([definition.category, definition.equipment]).toEqual(['dice', []]);
        continue;
      }
      if (gameType === 'reversi' || gameType === 'jungle' || gameType === 'gomoku' || gameType === 'go' || gameType === 'xiangqi' || gameType === 'chess' || gameType === 'banqi'
        || gameType === 'chinesecheckers' || gameType === 'landbattle' || gameType === 'battleship' || gameType === 'codebreaker') {
        expect([definition.category, definition.equipment]).toEqual(['board', []]);
        continue;
      }
      expect(definition.category).toBe('cards');
      expect(definition.equipment).toEqual(gameType === 'blackjack' || gameType === 'holdem' || gameType === 'tenhalf' || gameType === 'stud' ? ['cards', 'chips'] : ['cards']);
    }
  });

  it('recognizes only registered game types', () => {
    for (const gameType of GAME_TYPES) expect(isGameType(gameType)).toBe(true);
    for (const value of ['', 'checkers', 'BRIDGE', null, undefined, 4, {}]) expect(isGameType(value)).toBe(false);
  });
});

describe('registered result metadata', () => {
  it('keeps the score units and side-game kinds', () => {
    expect(GAME_TYPES.map((gameType) => [gameType, gameDefinition(gameType).result.kind,
      gameDefinition(gameType).result.scoreKind])).toEqual([
      ['bridge', 'team', null], ['bigtwo', 'ranking', 'penalty'], ['redpoints', 'ranking', 'points'],
      ['ninetynine', 'ranking', null], ['sevens', 'ranking', 'penalty'], ['chinesepoker', 'ranking', 'points'],
      ['liarsdeck', 'ranking', null], ['blackjack', 'ranking', 'chips'], ['holdem', 'ranking', 'chips'],
      ['napoleon', 'roles', null], ['tenhalf', 'ranking', 'chips'], ['liarsdice', 'ranking', null], ['crazyeights', 'ranking', 'penalty'], ['stud', 'ranking', 'chips'],
      ['reversi', 'ranking', null], ['oldmaid', 'ranking', 'points'],
      ['gofish', 'ranking', 'points'], ['gongzhu', 'ranking', 'points'], ['doudizhu', 'ranking', 'points'], ['jungle', 'ranking', null], ['gomoku', 'ranking', null], ['go', 'ranking', null],
      ['xiangqi', 'ranking', null], ['chess', 'ranking', null], ['banqi', 'ranking', null],
      ['chinesecheckers', 'ranking', null], ['landbattle', 'ranking', null], ['battleship', 'ranking', null], ['codebreaker', 'ranking', null], ['spades', 'team', 'points'], ['hearts', 'ranking', 'penalty'], ['yacht', 'ranking', 'points'], ['dominoes', 'ranking', 'points'],
    ]);
  });

  it('lists every fixed-hand match in the waiting room', () => {
    expect(GAME_TYPES.flatMap((gameType) => {
      const hands = gameDefinition(gameType).matchHands;
      return hands === undefined ? [] : [[gameType, hands]];
    })).toEqual([['holdem', 20], ['crazyeights', 3], ['stud', 20], ['oldmaid', 3], ['gofish', 3], ['gongzhu', 4], ['doudizhu', 6]]);
  });
});
