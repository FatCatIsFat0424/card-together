import { describe, expect, it } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import { EXPANDABLE_ROOM_GAMES, GAME_DEFINITIONS, gameDefinition, isGameType } from '@shared/games/registry';
import { isNumberedSeatGame, maxPlayers, minPlayers } from '@shared/rules/seats';
import type { GameType } from '@shared/types';

/** Seat rules as they were before the registry: four fixed seats unless listed here. */
const PREVIOUS_SEATS: Readonly<Record<GameType, readonly [min: number, max: number, flexible: boolean, numbered: boolean]>> = {
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
  crazyeights: [2, 8, true, false],
  stud: [2, 8, true, false],
};

describe('shared game registry', () => {
  it('defines every game type exactly once under its own key', () => {
    expect(Object.keys(GAME_DEFINITIONS).sort()).toEqual([...GAME_TYPES].sort());
    for (const gameType of GAME_TYPES) expect(gameDefinition(gameType).gameType).toBe(gameType);
  });

  it.each(GAME_TYPES)('keeps the previous seat limits for %s', (gameType) => {
    const [min, max, flexible, numbered] = PREVIOUS_SEATS[gameType];
    expect(gameDefinition(gameType).seats).toEqual({ minPlayers: min, maxPlayers: max, flexible, expandable: flexible, numbered });
    expect([minPlayers(gameType), maxPlayers(gameType), isNumberedSeatGame(gameType)]).toEqual([min, max, numbered]);
  });

  it('lists the expandable rooms in lobby order', () => {
    expect(EXPANDABLE_ROOM_GAMES).toEqual(['ninetynine', 'blackjack', 'holdem', 'napoleon', 'tenhalf', 'liarsdice', 'crazyeights', 'stud']);
  });

  it('classifies the dice game by its category and gives chips only to the betting games', () => {
    for (const gameType of GAME_TYPES) {
      const definition = gameDefinition(gameType);
      if (gameType === 'liarsdice') {
        expect([definition.category, definition.equipment]).toEqual(['dice', []]);
        continue;
      }
      expect(definition.category).toBe('cards');
      expect(definition.equipment).toEqual(gameType === 'blackjack' || gameType === 'holdem' || gameType === 'tenhalf' || gameType === 'stud' ? ['cards', 'chips'] : ['cards']);
    }
  });

  it('recognizes only registered game types', () => {
    for (const gameType of GAME_TYPES) expect(isGameType(gameType)).toBe(true);
    for (const value of ['', 'chess', 'BRIDGE', null, undefined, 4, {}]) expect(isGameType(value)).toBe(false);
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
    ]);
  });

  it('gives only Hold\'em and Crazy Eights the waiting-room fixed hand count', () => {
    expect(GAME_TYPES.flatMap((gameType) => {
      const hands = gameDefinition(gameType).matchHands;
      return hands === undefined ? [] : [[gameType, hands]];
    })).toEqual([['holdem', 20], ['crazyeights', 3], ['stud', 20]]);
  });
});
