import type { Card, NinetyNineDirection, NinetyNineLogEntry, NinetyNineVisibleState, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { NN_HAND_SIZE, NN_MAX, nnApply, nnRequiresChoice } from '@shared/rules/ninetynine';
import type { NnChoice } from '@shared/rules/ninetynine';
import { createDeck } from '../engine/deck';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

/** Ten, Q, J, K, 4, 5 and the spade ace stay playable at any total. */
function isRescue(card: Card): boolean {
  return (card.rank === 14 && card.suit === 'spades') || nnRequiresChoice(card)
    || card.rank === 4 || card.rank === 5 || card.rank === 11 || card.rank === 13;
}

const pips = (card: Card): number => (card.rank === 14 ? 1 : card.rank);

/** Value of keeping a card for later turns: rescue cards decide survival near 99, small numbers fit late totals. */
function keepValue(card: Card): number {
  if (card.rank === 14 && card.suit === 'spades') return 12;
  if (card.rank === 12) return 9;
  if (card.rank === 10) return 8;
  if (card.rank === 4) return 6;
  if (isRescue(card)) return 7;
  return Math.max(0, 10 - pips(card)) * 0.25;
}

const fits = (card: Card, headroom: number): boolean => isRescue(card) || pips(card) <= headroom;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function step(seat: Seat, direction: NinetyNineDirection): Seat {
  const offset = direction === 'cw' ? 1 : SEAT_ORDER_CLOCKWISE.length - 1;
  return SEAT_ORDER_CLOCKWISE[(SEAT_ORDER_CLOCKWISE.indexOf(seat) + offset) % SEAT_ORDER_CLOCKWISE.length];
}

function nextAlive(visible: NinetyNineVisibleState, from: Seat, direction: NinetyNineDirection): Seat {
  let seat = step(from, direction);
  while (visible.eliminated.includes(seat) && seat !== from) seat = step(seat, direction);
  return seat;
}

/** Opponent turns before the bot acts again, assuming no further reverse or designation. */
function turnsUntilMine(visible: NinetyNineVisibleState, first: Seat, direction: NinetyNineDirection): number {
  let turns = 0;
  for (let seat = first; seat !== visible.mySeat && turns < SEAT_ORDER_CLOCKWISE.length; turns++) {
    seat = nextAlive(visible, seat, direction);
  }
  return turns;
}

type PlayEntry = Extract<NinetyNineLogEntry, { type: 'play' }>;

/**
 * A rescue card spent while every number card was still safe suggests a hand without number cards,
 * so pressure on that seat is unlikely to force an elimination.
 */
function showedRescueRichHand(visible: NinetyNineVisibleState, seat: Seat): boolean {
  const plays = visible.log.filter((entry): entry is PlayEntry => entry.type === 'play');
  const recent = Math.max(0, plays.length - SEAT_ORDER_CLOCKWISE.length * 2);
  for (let index = plays.length - 1; index >= recent; index--) {
    const entry = plays[index];
    if (entry.seat !== seat) continue;
    const totalBefore = index > 0 ? plays[index - 1].total : 0;
    return isRescue(entry.card) && totalBefore <= NN_MAX - 9;
  }
  return false;
}

/**
 * Cards whose location is unknown to the bot. Plays since the last reshuffle are still in the
 * public discard pile, so recently used rescue cards cannot be drawn or held by opponents.
 */
function unseenCards(visible: NinetyNineVisibleState): Card[] {
  const deck = createDeck();
  const held = Object.values(visible.handCounts).reduce((sum, count) => sum + count, 0);
  const discardSize = deck.length - visible.stockCount - held;
  const known = [...visible.myHand];
  let counted = 0;
  for (let index = visible.log.length - 1; index >= 0 && counted < discardSize; index--) {
    const entry = visible.log[index];
    // Eliminated hands are discarded face down; they occupy discard space without being known.
    const size = entry.type === 'play' ? 1 : NN_HAND_SIZE;
    if (counted + size > discardSize) break;
    counted += size;
    if (entry.type === 'play') known.push(entry.card);
  }
  return deck.filter((card) => !known.some((own) => own.suit === card.suit && own.rank === card.rank));
}

/** Probability that every one of `draws` cards comes from a subset of `size` within `pool`. */
function allFrom(size: number, pool: number, draws: number): number {
  let probability = 1;
  for (let index = 0; index < draws; index++) probability *= Math.max(0, size - index) / Math.max(1, pool - index);
  return probability;
}

interface Outcome {
  readonly total: number;
  readonly next: Seat;
  readonly turnsUntilMine: number;
}

function outcomeOf(visible: NinetyNineVisibleState, total: number, reverse: boolean, target?: Seat): Outcome {
  const direction: NinetyNineDirection = reverse ? (visible.direction === 'cw' ? 'ccw' : 'cw') : visible.direction;
  const next = target ?? nextAlive(visible, visible.mySeat, direction);
  return { total, next, turnsUntilMine: turnsUntilMine(visible, next, direction) };
}

function scorePlay(visible: NinetyNineVisibleState, unseen: readonly Card[], index: number, outcome: Outcome): number {
  const { total } = outcome;
  const remaining = visible.myHand.filter((_, cardIndex) => cardIndex !== index);
  const aliveCount = SEAT_ORDER_CLOCKWISE.filter((seat) => !visible.eliminated.includes(seat)).length;
  let score = remaining.reduce((sum, card) => sum + keepValue(card), 0);

  // Each intervening turn tends to raise the total; with no safe card left, survival rests on the next draw.
  const returnHeadroom = NN_MAX - Math.min(NN_MAX, total + 5 * outcome.turnsUntilMine);
  if (!remaining.some((card) => fits(card, returnHeadroom))) {
    const unsafeDraw = unseen.filter((card) => !fits(card, returnHeadroom)).length / Math.max(1, unseen.length);
    score -= unsafeDraw * (aliveCount === 2 ? 50 : 40);
  }

  // Only near 99 can number cards stop fitting, so the next player's risk is modeled only there.
  const headroom = NN_MAX - total;
  if (headroom <= 9) {
    const draws = visible.handCounts[outcome.next];
    const unsafe = unseen.filter((card) => !fits(card, headroom)).length;
    const noNumber = unseen.filter((card) => isRescue(card) || pips(card) > headroom).length;
    const seatFactor = showedRescueRichHand(visible, outcome.next) ? 0.25 : 1;
    score += seatFactor * (allFrom(unsafe, unseen.length, draws) * 45 + allFrom(noNumber, unseen.length, draws) * 1.5);
    // Every turn near 99 costs a rescue card, so acting again sooner than the normal rotation is costly.
    score -= clamp01((total - 80) / (NN_MAX - 80)) * 3 * (aliveCount - 1 - outcome.turnsUntilMine);
  }
  return score;
}

/** Keeps rescue cards for high totals and pressures the next player near 99, using only public cards. */
export function getNinetyNineBotAction(visible: NinetyNineVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat
    || visible.eliminated.includes(visible.mySeat)) return null;
  const opponents: Seat[] = SEAT_ORDER_CLOCKWISE
    .filter((seat) => seat !== visible.mySeat && !visible.eliminated.includes(seat));
  const unseen = unseenCards(visible);
  const options: { value: BotAction; score: number }[] = [];
  visible.myHand.forEach((card, index) => {
    const choices: readonly (NnChoice | undefined)[] = nnRequiresChoice(card) ? ['plus', 'minus'] : [undefined];
    for (const choice of choices) {
      const effect = nnApply(visible.total, card, choice);
      if (effect.total > NN_MAX) continue;
      const targets: readonly (Seat | undefined)[] = effect.designate ? opponents : [undefined];
      for (const target of targets) {
        options.push({
          value: {
            type: 'ninetynine-play', card,
            ...(choice ? { choice } : {}), ...(target ? { target } : {}),
          },
          score: scorePlay(visible, unseen, index, outcomeOf(visible, effect.total, effect.reverse, target)),
        });
      }
    }
  });
  return selectNearBest(options, random, 2.5);
}
