import { beforeEach, describe, expect, it } from 'vitest';
import type { LiarCard, LiarFace, LiarsDeckGameState, LiarTableFace, PlayerInfo, Seat } from '@shared/types';
import { LD_DECK } from '@shared/rules/liarsdeck';
import * as liarsdeck from '../../src/managers/games/liarsdeck-game';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const CODE = 'LIAR01';
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
}])) as Record<Seat, PlayerInfo>;

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function game(): LiarsDeckGameState {
  const state = liarsdeck.getGameState(CODE);
  if (!state) throw new Error("Expected a Liar's Deck game");
  return state;
}

/** Takes unused deck cards of the requested faces, so ids stay unique within a test. */
function cardsOf(faces: readonly LiarFace[], used: Set<number>): LiarCard[] {
  return faces.map((face) => {
    const card = LD_DECK.find((entry) => entry.face === face && !used.has(entry.id));
    if (!card) throw new Error(`No ${face} left`);
    used.add(card.id);
    return { ...card };
  });
}

/** Replaces the current round with chosen hands; the starter opens with an empty table. */
function setRound(hands: Partial<Record<Seat, LiarFace[]>>, starter: Seat, tableFace: LiarTableFace): void {
  const state = game();
  const used = new Set<number>();
  state.hands = Object.fromEntries(SEATS.map((seat) => [seat, cardsOf(hands[seat] ?? [], used)])) as
    Record<Seat, LiarCard[]>;
  state.pile = [];
  state.lastPlay = null;
  state.tableFace = tableFace;
  state.currentTurnSeat = starter;
}

const ids = (seat: Seat, count: number): number[] => game().hands[seat].slice(0, count).map((card) => card.id);

describe("Liar's Deck gameplay", () => {
  beforeEach(() => {
    liarsdeck.restoreGames([]);
    liarsdeck.startGame(CODE, PLAYERS, seeded(1));
  });

  it('should deal five distinct cards to every seat and reveal the first table card', () => {
    const state = game();
    const dealt = SEATS.flatMap((seat) => state.hands[seat]);
    expect(dealt).toHaveLength(20);
    expect(new Set(dealt.map((card) => card.id)).size).toBe(20);
    expect(state.log).toEqual([expect.objectContaining({ type: 'round', round: 1, tableFace: state.tableFace,
      starter: state.currentTurnSeat })]);
    for (const seat of SEATS) {
      expect(state.bullets[seat]).toBeGreaterThanOrEqual(1);
      expect(state.bullets[seat]).toBeLessThanOrEqual(6);
    }
    expect(state.shots).toEqual({ N: 0, E: 0, S: 0, W: 0 });
  });

  it('should reject a call on the first turn and malformed plays without changes', () => {
    setRound({ N: ['K', 'Q', 'A', 'K', 'Q'], W: ['K'] }, 'N', 'K');
    const before = structuredClone(game());
    expect(liarsdeck.challenge(CODE, 'N').success).toBe(false);
    expect(liarsdeck.play(CODE, 'N', []).success).toBe(false);
    expect(liarsdeck.play(CODE, 'N', ids('N', 4)).success).toBe(false);
    expect(liarsdeck.play(CODE, 'N', [ids('N', 1)[0], ids('N', 1)[0]]).success).toBe(false);
    expect(liarsdeck.play(CODE, 'N', ids('W', 1)).success).toBe(false);
    expect(liarsdeck.play(CODE, 'W', ids('W', 1)).success).toBe(false);
    expect(game()).toEqual(before);
  });

  it('should keep played faces and bullets out of every visible state', () => {
    setRound({ N: ['Q', 'A', 'K'], W: ['K', 'K'] }, 'N', 'K');
    const played = ids('N', 2);
    expect(liarsdeck.play(CODE, 'N', played).success).toBe(true);
    expect(game().log.at(-1)).toEqual(expect.objectContaining({ type: 'play', seat: 'N', count: 2 }));
    expect(game().currentTurnSeat).toBe('W');
    for (const seat of SEATS) {
      const visible = liarsdeck.getPlayerVisibleState(CODE, seat)!;
      expect(visible).not.toHaveProperty('pile');
      expect(visible).not.toHaveProperty('bullets');
      expect(visible).not.toHaveProperty('hands');
      expect(visible.pileCount).toBe(2);
      expect(visible.lastPlay).toEqual({ seat: 'N', count: 2 });
      expect(visible.myPlayed.map((card) => card.id)).toEqual(seat === 'N' ? played : []);
    }
  });

  it('should make a caught liar pull and start the next round with that survivor', () => {
    setRound({ N: ['Q', 'K', 'K'], W: ['A', 'A'], S: ['K'], E: ['K'] }, 'N', 'K');
    game().bullets.N = 6;
    expect(liarsdeck.play(CODE, 'N', ids('N', 2)).success).toBe(true);
    expect(liarsdeck.challenge(CODE, 'W', seeded(9)).success).toBe(true);
    const state = game();
    expect(state.log.slice(-3)).toEqual([
      expect.objectContaining({ type: 'challenge', seat: 'W', target: 'N', revealed: ['Q', 'K'], lied: true }),
      expect.objectContaining({ type: 'shot', seat: 'N', shot: 1, survived: true }),
      expect.objectContaining({ type: 'round', round: 2, starter: 'N' }),
    ]);
    expect(state.shots.N).toBe(1);
    expect(state.currentTurnSeat).toBe('N');
    expect(state.pile).toEqual([]);
    expect(SEATS.every((seat) => state.hands[seat].length === 5)).toBe(true);
  });

  it('should make a false accuser pull and skip that seat once its bullet fires', () => {
    setRound({ N: ['K', 'joker'], W: ['A', 'A'], S: ['K'], E: ['K'] }, 'N', 'K');
    game().bullets.W = 1;
    expect(liarsdeck.play(CODE, 'N', ids('N', 2)).success).toBe(true);
    expect(liarsdeck.challenge(CODE, 'W', seeded(9)).success).toBe(true);
    const state = game();
    expect(state.log.at(-2)).toEqual(expect.objectContaining({ type: 'shot', seat: 'W', shot: 1, survived: false }));
    expect(state.eliminated).toEqual(['W']);
    expect(state.currentTurnSeat).toBe('S');
    expect(state.hands.W).toEqual([]);
    expect(SEATS.flatMap((seat) => state.hands[seat])).toHaveLength(15);
  });

  it('should skip empty hands and force the last holder to call', () => {
    setRound({ N: ['K'], W: ['Q', 'Q', 'Q'], S: ['A', 'A'] }, 'N', 'K');
    expect(liarsdeck.play(CODE, 'N', ids('N', 1)).success).toBe(true);
    expect(game().currentTurnSeat).toBe('W');
    expect(liarsdeck.play(CODE, 'W', ids('W', 2)).success).toBe(true);
    expect(game().currentTurnSeat).toBe('S');
    expect(liarsdeck.play(CODE, 'S', ids('S', 1)).success).toBe(true);
    // E and N hold nothing, so play passes from S straight back to W.
    expect(game().currentTurnSeat).toBe('W');
  });

  it('should require the only seat still holding cards to call LIAR', () => {
    setRound({ N: ['K'], W: ['Q', 'Q'] }, 'N', 'K');
    game().bullets.W = 6;
    expect(liarsdeck.play(CODE, 'N', ids('N', 1)).success).toBe(true);
    const play = liarsdeck.play(CODE, 'W', ids('W', 1));
    expect(play.success).toBe(false);
    expect(liarsdeck.challenge(CODE, 'W', seeded(3)).success).toBe(true);
    expect(game().log.at(-2)).toEqual(expect.objectContaining({ type: 'shot', seat: 'W' }));
  });

  it('should end with the last survivor and record the elimination order', () => {
    const state = game();
    state.bullets = { N: 1, E: 1, S: 1, W: 6 };
    const random = seeded(11);
    // Each victim lies to W, the only other seat holding cards, which must call.
    for (const victim of ['N', 'E', 'S'] as const) {
      setRound({ [victim]: ['Q'], W: ['K'] }, victim, 'K');
      expect(liarsdeck.play(CODE, victim, ids(victim, 1)).success).toBe(true);
      expect(liarsdeck.challenge(CODE, 'W', random).success).toBe(true);
    }
    const finished = game();
    expect(finished.phase).toBe('scoring');
    expect(finished.result).toEqual({
      gameType: 'liarsdeck', winnerSeat: 'W', eliminationOrder: ['N', 'E', 'S'],
      shots: { N: 1, E: 1, S: 1, W: 0 }, rounds: 3,
    });
    expect(finished.currentTurnSeat).toBe('W');
    expect(liarsdeck.challenge(CODE, 'W').success).toBe(false);
  });

  it('should restore exported games unchanged', () => {
    const exported = structuredClone(liarsdeck.exportGames());
    liarsdeck.restoreGames([]);
    expect(liarsdeck.getGameState(CODE)).toBeNull();
    liarsdeck.restoreGames(exported);
    expect(liarsdeck.exportGames()).toEqual(exported);
  });
});
