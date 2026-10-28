import type { Card, GameSeat, Suit } from '@shared/types';
import type { CrazyEightsVisibleState } from '@shared/games/crazyeights/types';
import {
  CE_SUITS, CE_WILD_RANK, ceCardPoints, ceEffect, ceNeedsSuit, ceNextSeat, ceTurnOptions,
} from '@shared/rules/crazyeights';
import type { CeTurnOptions } from '@shared/rules/crazyeights';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

function turnOptions(visible: CrazyEightsVisibleState): CeTurnOptions | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat || !visible.lastPlayed) return null;
  return ceTurnOptions(visible.myHand, visible.lastPlayed, visible.activeSuit, visible.drawn,
    visible.stockCount + visible.reserveCount);
}

function playAction(visible: CrazyEightsVisibleState, card: Card, suit: Suit): BotAction {
  return {
    type: 'game-action',
    request: {
      gameType: 'crazyeights',
      action: { type: 'play', card, ...(ceNeedsSuit(card, visible.myHand.length) ? { suit } : {}) },
    },
  };
}

/** No playable card: draw when the stock allows it, otherwise pass. */
function drawOrPass(options: CeTurnOptions): BotAction | null {
  if (options.canDraw) return { type: 'game-action', request: { gameType: 'crazyeights', action: { type: 'draw' } } };
  return options.canPass ? { type: 'game-action', request: { gameType: 'crazyeights', action: { type: 'pass' } } } : null;
}

/** Plays the first legal card in hand order, declaring the 8's own suit. */
export function crazyEightsFirstLegalAction(visible: CrazyEightsVisibleState): BotAction | null {
  const options = turnOptions(visible);
  if (!options) return null;
  const card = options.playable[0];
  return card ? playAction(visible, card, card.suit) : drawOrPass(options);
}

export function easyCrazyEightsAction(visible: CrazyEightsVisibleState): BotAction | null {
  return crazyEightsFirstLegalAction(visible);
}

function suitCounts(cards: readonly Card[]): Record<Suit, number> {
  const counts: Record<Suit, number> = { spades: 0, hearts: 0, clubs: 0, diamonds: 0 };
  for (const card of cards) counts[card.suit]++;
  return counts;
}

/**
 * Suits an opponent was last seen unable to follow: a draw at a suit means no matching card then.
 * The record is dropped when that seat draws penalty cards, since those may repair the hand.
 */
function voidSuits(visible: CrazyEightsVisibleState): Map<GameSeat, Suit> {
  const voids = new Map<GameSeat, Suit>();
  let active: Suit = visible.activeSuit;
  for (const entry of visible.log) {
    if (entry.type === 'hand') {
      voids.clear();
      active = entry.starter.suit;
    } else if (entry.type === 'play') {
      active = entry.card.rank === CE_WILD_RANK ? entry.suit ?? entry.card.suit : entry.card.suit;
      if (entry.drawn > 0 && entry.target) voids.delete(entry.target);
    } else if (entry.type === 'draw') voids.set(entry.seat, active);
  }
  return voids;
}

/** Opponents in turn order from the seat after the bot's, with the direction currently in force. */
function opponents(visible: CrazyEightsVisibleState): GameSeat[] {
  const seats = visible.seats ?? [];
  const order: GameSeat[] = [];
  for (let seat = ceNextSeat(seats, visible.mySeat, visible.direction); seat !== visible.mySeat;
    seat = ceNextSeat(seats, seat, visible.direction)) order.push(seat);
  return order;
}

/** The hand without one copy of `card`. */
function without(hand: readonly Card[], card: Card): Card[] {
  const index = hand.findIndex((own) => own.suit === card.suit && own.rank === card.rank);
  return hand.filter((_, other) => other !== index);
}

/**
 * Keeps 8s for last, dumps heavy cards first, steers the suit toward its longest suit and away from the
 * next seat's known void, and spends action cards on the seat closest to going out.
 */
export function getCrazyEightsBotAction(visible: CrazyEightsVisibleState, random: () => number): BotAction | null {
  const options = turnOptions(visible);
  if (!options) return null;
  if (options.playable.length === 0) return drawOrPass(options);

  const order = opponents(visible);
  const next = order[0];
  const voids = voidSuits(visible);
  const leader = order.reduce<GameSeat | null>((best, seat) =>
    best === null || visible.handCounts[seat] < visible.handCounts[best] ? seat : best, null);
  const nearOut = leader !== null && visible.handCounts[leader] <= 3;
  // Heads-up, the only opponent is the leader, and a reverse skips it as well.
  const headsUp = order.length === 1;
  const onlyWilds = options.playable.every((card) => card.rank === CE_WILD_RANK);
  const scored: { value: { card: Card; suit: Suit }; score: number }[] = [];
  for (const card of options.playable) {
    const rest = without(visible.myHand, card);
    const wild = card.rank === CE_WILD_RANK;
    // An 8 can name any suit; other cards leave their own suit in force.
    for (const resulting of wild ? CE_SUITS : [card.suit]) {
      let score = rest.length === 0 ? 1000 : 0;
      // A wild is a 50-point liability but the only guaranteed escape, so it waits until nothing else plays.
      if (wild) score -= onlyWilds ? 0 : 45;
      else score += ceCardPoints(card) * 0.6;
      // Leave the table on a suit the hand can keep following, and one the next seat could not.
      score += suitCounts(rest)[resulting] * 2.5;
      if (next && voids.get(next) === resulting) score += 7;
      const effect = rest.length > 0 ? ceEffect(card, visible.options.actionCards) : null;
      if (effect === 'reverse') {
        const behind = order[order.length - 1];
        score += headsUp ? 6 : behind === leader && next !== leader ? 14 : 1;
      } else if (effect) {
        score += next === leader && nearOut ? 22 : headsUp ? 6 : 2;
        if (effect === 'draw') score += 3;
      }
      scored.push({ value: { card, suit: resulting }, score });
    }
  }
  const chosen = selectNearBest(scored, random, 0.5);
  return chosen ? playAction(visible, chosen.card, chosen.suit) : null;
}
