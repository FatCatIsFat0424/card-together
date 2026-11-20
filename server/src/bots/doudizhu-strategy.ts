import type { CardOrJoker, DouDizhuVisibleState, GameSeat } from '@shared/types';
import type { DouDizhuAction } from '@shared/games/doudizhu/actions';
import { cardKey } from '@shared/rules/cards';
import { createDdzDeck, ddzPower, ddzResolve, ddzSmallestMove } from '@shared/rules/doudizhu';
import type { DdzMove } from '@shared/rules/doudizhu';
import { ddzReplay } from '@shared/rules/doudizhu-table';
import type { BotAction } from './bot-decisions';
import { cardsFor, cardTotal, rankMoves, rankOf, toCounts } from './doudizhu-hand';
import type { RankMove } from './doudizhu-hand';
import { scoreChoices } from './doudizhu-world';
import type { World } from './doudizhu-world';
import { selectNearBest } from './selection';

// The synchronous Dou Dizhu bot, also the fallback of the search: it bids from a count of jokers, 2s, aces
// and bombs, and plays with the rollout policy of doudizhu-world.ts on a table where each opponent might
// hold any unseen card (so "nobody can beat this" is judged cautiously). The policy plans the hand into the
// fewest plays, leads its weakest group, keeps controls until they are needed, leaves a partner's play
// alone unless the landlord could go out over it, feeds a partner about to go out, and bombs when the hand
// can then finish or an opponent is close.

const asAction = (action: DouDizhuAction): BotAction => ({ type: 'game-action', request: { gameType: 'doudizhu', action } });

// ─── Hand evaluation ───

/** How strong a 17-card hand is for the landlord: high cards, bombs, and the rocket. */
export function handStrength(hand: readonly CardOrJoker[]): number {
  const counts = new Map<number, number>();
  for (const card of hand) counts.set(ddzPower(card), (counts.get(ddzPower(card)) ?? 0) + 1);
  let strength = 0;
  if (counts.has(16) && counts.has(17)) strength += 4;
  else if (counts.has(17)) strength += 2;
  else if (counts.has(16)) strength += 1.2;
  strength += (counts.get(15) ?? 0) * 1.4 + (counts.get(14) ?? 0) * 0.5;
  for (const [power, count] of counts) if (count === 4 && power < 16) strength += 2.5;
  return strength;
}

// ─── What the seat can know ───

/** Cards played since the current deal began. */
export function dealPlays(visible: DouDizhuVisibleState): CardOrJoker[] {
  let start = visible.log.length - 1;
  while (start >= 0 && visible.log[start].type !== 'deal') start -= 1;
  return visible.log.slice(Math.max(0, start)).flatMap((entry) => (entry.type === 'play' ? entry.cards : []));
}

/** Cards that are neither in this hand nor already played: split between the two other hands (and the bottom). */
export function unseenCards(visible: DouDizhuVisibleState): CardOrJoker[] {
  const known = new Set([...visible.myHand, ...dealPlays(visible)].map(cardKey));
  // The bottom cards are open once the landlord holds them; before that they are unseen like any other card.
  return createDdzDeck().filter((card) => !known.has(cardKey(card)));
}

export function partnerOf(visible: DouDizhuVisibleState): GameSeat | null {
  if (!visible.landlord || visible.landlord === visible.mySeat) return null;
  return visible.seats.find((seat) => seat !== visible.mySeat && seat !== visible.landlord) ?? null;
}

/** Plays per seat (play order) in the current deal. */
export function dealPlayCounts(visible: DouDizhuVisibleState): number[] {
  let start = visible.log.length - 1;
  while (start >= 0 && visible.log[start].type !== 'deal') start -= 1;
  const plays = visible.seats.map(() => 0);
  for (const entry of visible.log.slice(Math.max(0, start))) {
    if (entry.type === 'play') plays[visible.seats.indexOf(entry.seat)] += 1;
  }
  return plays;
}

/**
 * The table as the seat to act sees it, on rank counts: its own hand, and for each other seat every unseen
 * card it might hold (sizes stay the real ones). Null outside the seat's turn in the play phase.
 */
export function viewWorld(visible: DouDizhuVisibleState): World | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat || !visible.landlord) return null;
  const seats = visible.seats;
  const me = seats.indexOf(visible.mySeat);
  const pool = toCounts(unseenCards(visible));
  const last = visible.lastPlay;
  return {
    hands: seats.map((_, seat) => (seat === me ? toCounts(visible.myHand) : new Uint8Array(pool))),
    sizes: seats.map((seat) => visible.handCounts[seat]),
    landlord: seats.indexOf(visible.landlord),
    turn: me,
    last: last ? { combo: last.combo, ranks: last.cards.map(rankOf) } : null,
    lastSeat: last ? seats.indexOf(last.seat) : me,
    passes: visible.passes,
    bombs: visible.bombs,
    plays: dealPlayCounts(visible),
    winner: -1,
  };
}

/**
 * Real cards for a rank move from `hand`, read the way the server will read them after `visible`'s last
 * play; null when they cannot be played.
 */
export function playable(visible: DouDizhuVisibleState, move: RankMove): { cards: CardOrJoker[]; move: RankMove } | null {
  const cards = cardsFor(visible.myHand, move);
  if (!cards) return null;
  const combo = ddzResolve(cards, visible.lastPlay?.combo ?? null);
  return combo ? { cards, move: { combo, ranks: move.ranks } } : null;
}

// ─── Auction ───

function auctionAction(visible: DouDizhuVisibleState, strong: number): BotAction | null {
  if (visible.phase !== 'calling' || visible.currentTurnSeat !== visible.mySeat) return null;
  const strength = handStrength(visible.myHand);
  const auction = ddzReplay(visible.options.variant, visible.seats, visible.log).auction;
  if (visible.options.variant === 'grab') {
    const grabbing = auction && !auction.done && auction.mode === 'grab';
    return asAction({ type: 'claim', take: strength >= (grabbing ? strong + 1.5 : strong) });
  }
  const wanted = strength >= strong + 3 ? 3 : strength >= strong + 1.5 ? 2 : strength >= strong ? 1 : 0;
  const minimum = auction && !auction.done ? auction.minScore : 1;
  return asAction({ type: 'bid', score: wanted >= minimum ? (wanted as 1 | 2 | 3) : 0 });
}

// ─── Play ───

function toAction(cards: CardOrJoker[] | null): BotAction {
  return cards ? asAction({ type: 'play', cards }) : asAction({ type: 'pass' });
}

/** Decision from the policy alone; cheap enough to run on the event loop. */
export function getDouDizhuBotAction(visible: DouDizhuVisibleState, random: () => number): BotAction | null {
  if (visible.phase === 'calling') return auctionAction(visible, 3.5);
  const world = viewWorld(visible);
  if (!world) return null;
  const hand = world.hands[world.turn];
  const previous = visible.lastPlay?.combo ?? null;
  const options: (RankMove | null)[] = [];
  for (const move of rankMoves(hand, previous, 'cheap')) {
    if (move.ranks.length === cardTotal(hand)) {
      const finish = playable(visible, move);
      if (finish) return toAction(finish.cards);
    }
    options.push(move);
  }
  if (previous) options.push(null);
  if (options.length === 0) return null;
  const scores = scoreChoices(world, options);
  // Vary among plays the policy rates about one rank step apart, never across a planned play.
  const urgent = world.sizes.some((size, seat) => seat !== world.turn && size <= 2);
  const chosen = selectNearBest(options.map((move, index) => ({ value: move, score: scores[index] })), random, urgent ? 0.4 : 1.05);
  if (!chosen) return toAction(null);
  const play = playable(visible, chosen);
  return play ? toAction(play.cards) : douDizhuFirstLegalAction(visible);
}

/** Pass when allowed, otherwise the smallest legal play: the timeout action and the last-resort move. */
export function douDizhuFirstLegalAction(visible: DouDizhuVisibleState): BotAction | null {
  if (visible.currentTurnSeat !== visible.mySeat) return null;
  if (visible.phase === 'calling') {
    return asAction(visible.options.variant === 'grab' ? { type: 'claim', take: false } : { type: 'bid', score: 0 });
  }
  if (visible.phase !== 'playing') return null;
  if (visible.lastPlay) return asAction({ type: 'pass' });
  const move: DdzMove | null = ddzSmallestMove(visible.myHand, null);
  return move ? toAction(move.cards) : null;
}
