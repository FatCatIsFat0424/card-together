import type { CardOrJoker, DouDizhuVisibleState, GameSeat } from '@shared/types';
import { cardKey } from '@shared/rules/cards';
import { ddzIsBomb, ddzNextSeat, ddzSmallestMove, sortDdzHand } from '@shared/rules/doudizhu';
import type { DdzCombo, DdzMove } from '@shared/rules/doudizhu';
import type { BotAction } from './bot-decisions';
import { getDouDizhuBotAction, partnerOf, scoreOptions, unseenCards } from './doudizhu-strategy';
import type { SearchContext } from './search/search-types';

// Determinized rollouts: the hidden cards are dealt at random to the two other hands, every candidate play is
// followed by a quick greedy game to the end, and the play whose side wins most often is chosen. All
// candidates share each deal of the hidden cards, so their results compare directly. The heuristic ranks
// the candidates and breaks ties; a spent clock stops after the rounds already finished.

/** Candidates examined per decision. */
const CANDIDATES = 6;
/** Hidden-card deals per decision at most. */
const MAX_ROUNDS = 60;
/** Plies a rollout may take before it is scored as a loss for the mover. */
const MAX_PLIES = 240;

interface Rollout {
  readonly hands: Map<GameSeat, CardOrJoker[]>;
  turn: GameSeat;
  last: { readonly seat: GameSeat; readonly combo: DdzCombo } | null;
  passes: number;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Plays on greedily; returns the seat that went out first, or null when the rollout ran too long. */
function playOut(
  state: Rollout, seats: readonly GameSeat[], landlord: GameSeat, apply: DdzMove | null, first: boolean,
): GameSeat | null {
  let pending: DdzMove | null | undefined = first ? apply : undefined;
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const seat = state.turn;
    const hand = state.hands.get(seat)!;
    let move: DdzMove | null;
    if (pending !== undefined) {
      move = pending;
      pending = undefined;
    } else {
      const friends = seat === landlord ? [] : seats.filter((other) => other !== seat && other !== landlord);
      const partnerLed = state.last !== null && friends.includes(state.last.seat);
      move = partnerLed ? null : ddzSmallestMove(hand, state.last?.combo ?? null);
      // A bomb is not worth it while every opponent still holds a lot of cards.
      if (move && ddzIsBomb(move.combo) && state.last && !ddzIsBomb(state.last.combo)
        && seats.every((other) => other === seat || friends.includes(other) || (state.hands.get(other)?.length ?? 0) > 4)) move = null;
    }
    if (move === null) {
      if (state.last === null) {
        // Leading cannot pass; the smallest play always exists.
        move = ddzSmallestMove(hand, null);
      }
    }
    if (move === null) {
      state.passes += 1;
      if (state.passes >= seats.length - 1 && state.last) {
        state.turn = state.last.seat;
        state.last = null;
        state.passes = 0;
      } else state.turn = ddzNextSeat(seats, seat);
      continue;
    }
    const played = new Set(move.cards.map(cardKey));
    const rest = hand.filter((card) => !played.has(cardKey(card)));
    state.hands.set(seat, rest);
    if (rest.length === 0) return seat;
    state.last = { seat, combo: move.combo };
    state.passes = 0;
    state.turn = ddzNextSeat(seats, seat);
  }
  return null;
}

/** Hard bot search for the worker pool; falls back to the heuristic outside the play phase. */
export function douDizhuSearch(visible: DouDizhuVisibleState, context: SearchContext): BotAction | null {
  const { random, budget } = context;
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat || !visible.landlord) {
    return getDouDizhuBotAction(visible, random);
  }
  const landlord = visible.landlord;
  const me = visible.mySeat;
  const seats = visible.seats;
  const options = scoreOptions({
    hand: visible.myHand, previous: visible.lastPlay?.combo ?? null, lastSeat: visible.lastPlay?.seat ?? null,
    partner: partnerOf(visible), counts: visible.handCounts, me, seats, landlord,
  }).sort((a, b) => b.score - a.score);
  if (options.length <= 1 || options[0].score >= 1000) return getDouDizhuBotAction(visible, random);
  const candidates = options.slice(0, CANDIDATES);
  const others = seats.filter((seat) => seat !== me);
  const unseen = unseenCards(visible);
  const wins = candidates.map(() => 0);
  let rounds = 0;
  while (rounds < MAX_ROUNDS && (rounds === 0 || !budget.expired())) {
    const deck = shuffled(unseen, random);
    const dealt = new Map<GameSeat, CardOrJoker[]>();
    let offset = 0;
    for (const seat of others) {
      dealt.set(seat, deck.slice(offset, offset + visible.handCounts[seat]));
      offset += visible.handCounts[seat];
    }
    candidates.forEach((candidate, index) => {
      const hands = new Map<GameSeat, CardOrJoker[]>([[me, [...visible.myHand]]]);
      for (const [seat, cards] of dealt) hands.set(seat, sortDdzHand(cards));
      const state: Rollout = {
        hands, turn: me, last: visible.lastPlay ? { seat: visible.lastPlay.seat, combo: visible.lastPlay.combo } : null,
        passes: visible.passes,
      };
      const winner = playOut(state, seats, landlord, candidate.move, true);
      if (winner !== null && (winner === landlord) === (me === landlord)) wins[index] += 1;
    });
    rounds += 1;
  }
  let best = 0;
  let bestValue = -Infinity;
  candidates.forEach((candidate, index) => {
    const value = (wins[index] / rounds) * 100 + candidate.score * 0.1;
    if (value > bestValue) {
      bestValue = value;
      best = index;
    }
  });
  const move = candidates[best].move;
  return move
    ? { type: 'game-action', request: { gameType: 'doudizhu', action: { type: 'play', cards: move.cards } } }
    : { type: 'game-action', request: { gameType: 'doudizhu', action: { type: 'pass' } } };
}
