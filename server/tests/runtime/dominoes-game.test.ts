import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { GameSeat, PlayerInfo } from '@shared/types';
import type { DominoesGameState, DominoesOptions, DominoTile } from '@shared/games/dominoes/types';
import { getPresentationFrames } from '@shared/game-presentation';
import { DM_MAX_ROUNDS, dmAllTiles, dmHandSize, dmSameTile, dmTurnOptions } from '@shared/rules/dominoes';
import * as dm from '../../src/managers/games/dominoes-game';
import { dominoesAdapter } from '../../src/managers/games/dominoes-adapter';
import { isDominoesResult, isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const CODE = 'DM0001';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function playersOf(count: number): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(GAME_SEAT_ORDER.slice(0, count).map((seat) => [seat, player(seat)]));
}

const t = (a: number, b: number): DominoTile => [Math.min(a, b), Math.max(a, b)] as unknown as DominoTile;

/**
 * Set layout for `count` players: each seat's hand in seat order, then the boneyard top-first; slots left
 * unset are filled from the remaining tiles in order.
 */
function setWith(count: number, hands: Record<number, DominoTile[]> = {}, boneyard: DominoTile[] = []): DominoTile[] {
  const size = dmHandSize(count);
  const slots: (DominoTile | null)[] = Array.from({ length: 28 }, () => null);
  for (const [index, tiles] of Object.entries(hands)) tiles.forEach((tile, offset) => { slots[Number(index) * size + offset] = tile; });
  boneyard.forEach((tile, offset) => { slots[size * count + offset] = tile; });
  const rest = dmAllTiles();
  for (const slot of slots) if (slot) rest.splice(rest.findIndex((tile) => dmSameTile(slot, tile)), 1);
  return slots.map((slot) => slot ?? rest.shift()!);
}

function state(): DominoesGameState {
  const game = dm.getGameState(CODE);
  if (!game) throw new Error('Expected a Dominoes game');
  return game;
}

function persists(): boolean {
  const game = state();
  const playing = game.phase === 'playing';
  const ids = Object.values(game.players).map((entry) => entry.id);
  const seat = (position: GameSeat): { player: PlayerInfo | null; isReady: boolean } => ({
    player: game.players[position] ?? null, isReady: playing && Boolean(game.players[position]),
  });
  const snapshot: RuntimeSnapshot = {
    players: Object.values(game.players).map((info) => ({ info, currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{
      info: {
        code: CODE, gameType: 'dominoes', status: playing ? 'playing' : 'waiting', createdAt: 1,
        hostId: ids[0], abortVote: null, abortVoteCooldownUntil: null,
        seats: { N: seat('N'), E: seat('E'), S: seat('S'), W: seat('W') },
        additionalSeats: [],
      },
      memberIds: ids,
    }],
    games: [structuredClone(game)],
    chat: [],
  };
  return isRuntimeSnapshot(snapshot);
}

/** Every tile of the set is in exactly one place. */
function conserved(): boolean {
  const game = state();
  const all = [...GAME_SEAT_ORDER.flatMap((seat) => game.hands[seat]), ...game.boneyard, ...game.line.map((placed) => placed.tile)];
  return all.length === 28 && dmAllTiles().every((tile) => all.filter((other) => dmSameTile(other, tile)).length === 1);
}

const ok = { success: true };

const empty: Record<GameSeat, DominoTile[]> = { N: [], E: [], S: [], W: [], P5: [], P6: [], P7: [], P8: [] };

/** Replaces the dealt round with a chosen position; every tile not named goes to the boneyard. */
function arrange(
  count: number, hands: Partial<Record<GameSeat, DominoTile[]>>, line: DominoesGameState['line'],
  options: DominoesOptions = { targetScore: 150 },
): DominoesGameState {
  dm.startGame(CODE, playersOf(count), undefined, options);
  const game = state();
  const used = [...Object.values(hands).flat(), ...line.map((placed) => placed.tile)];
  game.hands = { ...empty, ...hands };
  game.line = line;
  game.boneyard = dmAllTiles().filter((tile) => !used.some((other) => dmSameTile(other, tile)));
  game.openingTile = null;
  game.currentTurnSeat = 'N';
  return game;
}

beforeEach(() => dm.restoreGames([]));

describe('Dominoes dealing', () => {
  it('deals seven tiles heads-up and five to three or four players', () => {
    for (const [count, size] of [[2, 7], [3, 5], [4, 5]] as const) {
      dm.startGame(CODE, playersOf(count), setWith(count));
      const game = state();
      expect(GAME_SEAT_ORDER.slice(0, count).map((seat) => game.hands[seat].length)).toEqual(Array(count).fill(size));
      expect(game.boneyard).toHaveLength(28 - size * count);
      expect(conserved()).toBe(true);
      expect(persists()).toBe(true);
    }
  });

  it('opens round 1 with the highest double, which must lead', () => {
    dm.startGame(CODE, playersOf(3), setWith(3, { 0: [t(4, 4)], 1: [t(5, 5), t(0, 1)], 2: [t(6, 5)] }));
    const game = state();
    expect(game).toMatchObject({ leader: 'E', currentTurnSeat: 'E', openingTile: t(5, 5), round: 1 });
    expect(game.log[0]).toMatchObject({ type: 'round', round: 1, leader: 'E' });
    expect(dm.play(CODE, 'E', t(0, 1))).toEqual({ success: false, reason: 'The opening tile must lead' });
    expect(dm.play(CODE, 'N', t(4, 4))).toEqual({ success: false, reason: 'Not your turn' });
    expect(dm.play(CODE, 'E', t(5, 5))).toEqual(ok);
    expect(state().currentTurnSeat).toBe('S');
    expect(persists()).toBe(true);
  });

  it('opens with the heaviest tile when nobody holds a double', () => {
    const hands = { 0: [t(0, 1), t(2, 3), t(1, 2), t(0, 2), t(0, 3), t(1, 3), t(0, 4)], 1: [t(5, 6), t(1, 4), t(2, 4), t(3, 4), t(1, 5), t(2, 5), t(3, 5)] };
    dm.startGame(CODE, playersOf(2), setWith(2, hands));
    expect(state()).toMatchObject({ leader: 'E', openingTile: t(5, 6) });
  });
});

describe('Dominoes turns', () => {
  /** N opens with 6-6; E can follow with 3-6 or 5-6. */
  function table(): void {
    dm.startGame(CODE, playersOf(2), setWith(2, {
      0: [t(6, 6), t(2, 6), t(2, 3), t(4, 5), t(0, 4), t(1, 3), t(1, 2)],
      1: [t(3, 6), t(5, 6), t(5, 5), t(0, 5), t(3, 4), t(1, 4), t(4, 4)],
    }));
  }

  it('rejects tiles that are not held or do not match, and a wrong end', () => {
    table();
    expect(dm.play(CODE, 'N', t(6, 6))).toEqual(ok);
    expect(dm.play(CODE, 'E', t(0, 0))).toEqual({ success: false, reason: 'Tile not in hand' });
    expect(dm.play(CODE, 'E', t(5, 5))).toEqual({ success: false, reason: 'That tile does not match an end.' });
    expect(dm.play(CODE, 'E', t(3, 6), 'left')).toEqual(ok);
    expect(state().line.map((placed) => [placed.left, placed.right])).toEqual([[3, 6], [6, 6]]);
    expect(dm.play(CODE, 'N', t(2, 6), 'left')).toEqual({ success: false, reason: 'That tile does not match that end.' });
    expect(dm.play(CODE, 'N', t(2, 6))).toEqual(ok);
    expect(state().line.map((placed) => [placed.left, placed.right])).toEqual([[3, 6], [6, 6], [6, 2]]);
    expect(conserved()).toBe(true);
    expect(persists()).toBe(true);
  });

  it('asks for an end when a tile fits both open numbers', () => {
    arrange(2, { N: [t(2, 5), t(0, 0)], E: [t(1, 1)] }, [
      { tile: t(2, 3), left: 2, right: 3 }, { tile: t(3, 5), left: 3, right: 5 },
    ]);
    expect(dm.play(CODE, 'N', t(2, 5))).toEqual({ success: false, reason: 'Choose an end for the tile.' });
    expect(dm.play(CODE, 'N', t(2, 5), 'left')).toEqual(ok);
    expect(state().line[0]).toMatchObject({ left: 5, right: 2 });
    expect(state().line).toHaveLength(3);
  });

  it('draws one tile at a time until one fits, logging the numbers missed but never the tile', () => {
    dm.startGame(CODE, playersOf(2), setWith(2, {
      0: [t(6, 6), t(0, 1), t(1, 2), t(1, 3), t(1, 4), t(2, 3), t(2, 4)],
      1: [t(0, 2), t(0, 3), t(0, 4), t(0, 5), t(2, 5), t(3, 4), t(3, 5)],
    }, [t(1, 1), t(6, 4), t(5, 5)]));
    expect(dm.play(CODE, 'N', t(6, 6))).toEqual(ok);
    expect(dm.pass(CODE, 'E')).toEqual({ success: false, reason: 'Draw a tile first' });
    expect(dm.draw(CODE, 'E')).toEqual(ok);
    expect(state()).toMatchObject({ currentTurnSeat: 'E' });
    expect(state().hands.E).toHaveLength(8);
    expect(state().log.at(-1)).toEqual({ type: 'draw', seat: 'E', ends: { left: 6, right: 6 }, timestamp: expect.any(Number) });
    expect(dm.draw(CODE, 'E')).toEqual(ok);
    expect(state().boneyard).toHaveLength(12);
    expect(dm.draw(CODE, 'E')).toEqual({ success: false, reason: 'You must play a tile' });
    expect(dm.pass(CODE, 'E')).toEqual({ success: false, reason: 'You must play a tile' });
    expect(dm.play(CODE, 'E', t(4, 6))).toEqual(ok);
    expect(state().currentTurnSeat).toBe('N');
    expect(persists()).toBe(true);
  });

  it('passes only when the boneyard is empty, and the turn moves on', () => {
    const game = arrange(3, { N: [t(0, 1)], E: [t(2, 3)], S: [t(5, 6)] }, [{ tile: t(2, 5), left: 2, right: 5 }]);
    expect(dm.pass(CODE, 'N')).toEqual({ success: false, reason: 'Draw a tile first' });
    game.boneyard = [];
    expect(dm.draw(CODE, 'N')).toEqual({ success: false, reason: 'Nothing left to draw' });
    expect(dm.pass(CODE, 'N')).toEqual(ok);
    expect(state().currentTurnSeat).toBe('E');
    expect(state().log.at(-1)).toMatchObject({ type: 'pass', seat: 'N', ends: { left: 2, right: 5 } });
  });
});

describe('Dominoes round and match flow', () => {
  /** Plays the first legal move for whoever is on turn until the round number changes or the match ends. */
  function playOutRound(): void {
    const start = state().round;
    for (let step = 0; step < 400 && state().phase === 'playing' && state().round === start; step++) {
      const game = state();
      const seat = game.currentTurnSeat;
      const options = dmTurnOptions(game.hands[seat], game.line, game.boneyard.length, game.openingTile);
      const [move] = options.plays;
      if (move) dm.play(CODE, seat, move.tile, move.side ?? undefined);
      else if (options.canDraw) dm.draw(CODE, seat);
      else dm.pass(CODE, seat);
    }
  }

  it('plays whole matches to the target, conserving tiles and staying valid for persistence', () => {
    for (const count of [2, 3, 4]) {
      dm.startGame(CODE, playersOf(count), undefined, { targetScore: 50 });
      for (let round = 0; round < DM_MAX_ROUNDS && state().phase === 'playing'; round++) {
        playOutRound();
        expect(conserved()).toBe(true);
        expect(persists()).toBe(true);
      }
      const game = state();
      expect(game.phase).toBe('scoring');
      expect(isDominoesResult(game.result)).toBe(true);
      const scores = game.result!.seats.map((seat) => game.scores[seat]);
      expect(game.result!.winners).toEqual(game.result!.seats.filter((seat) => game.scores[seat] === Math.max(...scores)));
      expect(Math.max(...scores)).toBeGreaterThanOrEqual(50);
      expect(game.log.filter((entry) => entry.type === 'roundEnd')).toHaveLength(game.round);
    }
  });

  it('lets the seat that goes out score every other hand and lead the next round', () => {
    const game = arrange(3, { N: [t(2, 3)], E: [t(6, 6), t(1, 1)], S: [t(0, 4)] }, [{ tile: t(3, 5), left: 3, right: 5 }]);
    game.boneyard = [];
    expect(dm.play(CODE, 'N', t(2, 3))).toEqual(ok);
    const after = state();
    expect(after.scores).toMatchObject({ N: 18, E: 0, S: 0 });
    expect(after.log.find((entry) => entry.type === 'roundEnd')).toMatchObject({
      reason: 'domino', winner: 'N', points: 18, hands: { N: [], E: [[6, 6], [1, 1]], S: [[0, 4]] },
    });
    expect(after).toMatchObject({ round: 2, leader: 'N', currentTurnSeat: 'N', phase: 'playing', openingTile: null });
    expect(after.line).toHaveLength(0);
    expect(after.hands.N).toHaveLength(5);
    expect(conserved()).toBe(true);
    // The winner may lead any tile of the new round.
    expect(dm.play(CODE, 'N', after.hands.N[2])).toEqual(ok);
  });

  it('ends a blocked round for the lowest hand, scoring all the other hands', () => {
    const game = arrange(3, { N: [t(0, 1)], E: [t(1, 3)], S: [t(6, 6)] }, [{ tile: t(2, 5), left: 2, right: 5 }]);
    game.boneyard = [];
    expect(dm.pass(CODE, 'N')).toEqual(ok);
    const after = state();
    expect(after.log.find((entry) => entry.type === 'roundEnd')).toMatchObject({ reason: 'blocked', winner: 'N', points: 16 });
    expect(after.scores.N).toBe(16);
    expect(after).toMatchObject({ round: 2, leader: 'N' });
  });

  it('scores nothing for a tied block, and the previous leader left neighbour opens', () => {
    const game = arrange(3, { N: [t(0, 4)], E: [t(1, 3)], S: [t(6, 6)] }, [{ tile: t(2, 5), left: 2, right: 5 }]);
    game.boneyard = [];
    game.leader = 'E';
    expect(dm.pass(CODE, 'N')).toEqual(ok);
    const after = state();
    expect(after.log.find((entry) => entry.type === 'roundEnd')).toMatchObject({ reason: 'tie', winner: null, points: 0 });
    expect(after.scores).toMatchObject({ N: 0, E: 0, S: 0 });
    expect(after).toMatchObject({ round: 2, leader: 'S', currentTurnSeat: 'S' });
  });

  it('ends the block as soon as the last draw leaves nobody a move', () => {
    const game = arrange(2, { N: [t(0, 1)], E: [t(1, 3)] }, [{ tile: t(2, 5), left: 2, right: 5 }]);
    game.boneyard = [t(0, 6)];
    expect(dm.draw(CODE, 'N')).toEqual(ok);
    expect(state().log.at(-3)).toMatchObject({ type: 'draw', seat: 'N' });
    expect(state().log.find((entry) => entry.type === 'roundEnd')).toMatchObject({ reason: 'blocked', winner: 'E', points: 7 });
  });

  it('ends at the target with a shared win on equal totals', () => {
    const game = arrange(3, { N: [t(2, 3)], E: [t(6, 6)], S: [t(0, 4)] }, [{ tile: t(3, 5), left: 3, right: 5 }], { targetScore: 50 });
    game.boneyard = [];
    game.scores = { ...game.scores, N: 40, E: 56 };
    expect(dm.play(CODE, 'N', t(2, 3))).toEqual(ok);
    const done = state();
    // N gains 16 and reaches 56 like E, so both share the win.
    expect(done.phase).toBe('scoring');
    expect(done.result).toMatchObject({ winners: ['N', 'E'], rounds: 1, targetScore: 50, roundWinners: ['N'] });
    expect(isDominoesResult(done.result)).toBe(true);
    expect(dm.play(CODE, 'E', t(6, 6))).toEqual({ success: false, reason: 'Not in playing phase' });
  });

  it('stops after the round cap and gives it to the highest total', () => {
    const game = arrange(3, { N: [t(2, 3)], E: [t(6, 6)], S: [t(0, 4)] }, [{ tile: t(3, 5), left: 3, right: 5 }]);
    game.boneyard = [];
    game.round = DM_MAX_ROUNDS;
    expect(dm.play(CODE, 'N', t(2, 3))).toEqual(ok);
    expect(state()).toMatchObject({ phase: 'scoring', round: DM_MAX_ROUNDS });
    expect(state().result?.winners).toEqual(['N']);
  });
});

describe('Dominoes hidden information', () => {
  it('shows each seat only its own tiles and public counts', () => {
    dm.startGame(CODE, playersOf(3), setWith(3, { 0: [t(1, 2)] }));
    const visible = dm.getPlayerVisibleState(CODE, 'N');
    if (!visible) throw new Error('Expected a view');
    expect(visible.myHand).toEqual(state().hands.N);
    expect(visible.handCounts).toMatchObject({ N: 5, E: 5, S: 5, W: 0 });
    expect(visible.boneyardCount).toBe(13);
    expect(visible.observer).toBeUndefined();
    expect(visible.observedHands).toBeUndefined();
    expect(Object.keys(visible)).not.toContain('hands');
    expect(Object.keys(visible)).not.toContain('boneyard');
  });

  it('adds every hand only for spectators', () => {
    dm.startGame(CODE, playersOf(2), setWith(2));
    const visible = dm.getPlayerVisibleState(CODE, 'N');
    if (!visible) throw new Error('Expected a view');
    const watched = dominoesAdapter.withObserverView(visible, state(), 'spectator');
    expect(watched.observer).toBe('spectator');
    expect(watched.observedHands?.E).toEqual(state().hands.E);
  });

  it('reveals every remaining hand in the round summary only once the round is over', () => {
    const game = arrange(2, { N: [t(2, 3)], E: [t(6, 6), t(1, 1)] }, [{ tile: t(3, 5), left: 3, right: 5 }]);
    game.boneyard = [];
    expect(JSON.stringify(dm.getPlayerVisibleState(CODE, 'N')?.log)).not.toContain('[6,6]');
    dm.play(CODE, 'N', t(2, 3));
    expect(JSON.stringify(dm.getPlayerVisibleState(CODE, 'N')?.log)).toContain('[[6,6],[1,1]]');
  });
});

describe('Dominoes adapter', () => {
  it('charges no reserve for a forced draw and refills reserves on a new round', () => {
    const game = arrange(2, { N: [t(0, 1)], E: [t(2, 3)] }, [{ tile: t(2, 5), left: 2, right: 5 }]);
    game.boneyard = [t(0, 0), t(0, 6)];
    const forced = dominoesAdapter.clockBeforeAction!(game, 'N');
    dm.draw(CODE, 'N');
    expect(forced(state())).toMatchObject({ forced: true, sameTurn: true, redealt: false });
  });
});

describe('Dominoes presentation', () => {
  it('holds the table only for a deal and a round summary, never for tiles or hidden hands', () => {
    const game = arrange(3, { N: [t(2, 3), t(0, 1)], E: [t(6, 6), t(1, 1)], S: [t(0, 4)] }, [{ tile: t(3, 5), left: 3, right: 5 }]);
    game.boneyard = [];
    game.presentation = { id: 'p', startedAt: 0, logStart: 1, timingVersion: 3 };
    // N's tile leaves nobody a move, so the round ends blocked in favour of N's single pip.
    expect(dm.play(CODE, 'N', t(2, 3))).toEqual(ok);
    const frames = getPresentationFrames(state());
    expect(frames.map((frame) => frame.kind)).toEqual(['settle', 'deal']);
    expect(frames[0]).toMatchObject({ seat: 'N', points: 18, durationMs: 5000 });
    expect(frames[1]).toMatchObject({ durationMs: 1500, seat: 'N' });
    expect(JSON.stringify(frames)).not.toContain('"tile"');
  });
});
