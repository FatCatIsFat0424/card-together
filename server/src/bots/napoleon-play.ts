import type { GameSeat, NapoleonCard, NapoleonSummon, NapoleonTrick, NapoleonVisibleState, Suit } from '@shared/types';
import {
  applyNapoleonPlay, isNapoleonFreeCard, isNapoleonPointCard, napoleonPlayError, napoleonPoints,
  napoleonSummonOptions, napoleonSummonedCard, sameNapoleonCard,
} from '@shared/rules/napoleon';
import {
  allyOf, cardPoints, holdChance, holdValue, pointsPerTrick, readTable, secretaryKeepValue, seatsAfter, sideWinChance,
  suitOf,
} from './napoleon-knowledge';
import type { NapoleonTable } from './napoleon-knowledge';
import { selectNearBest } from './selection';

const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

export interface NapoleonPlayChoice {
  readonly card: NapoleonCard;
  readonly leadSuit?: Suit;
  readonly summon?: NapoleonSummon;
}

/** Only the Napoleon's own discards matter for its secretary summon. */
function summonDiscards(visible: NapoleonVisibleState): readonly NapoleonCard[] | null {
  return visible.contract?.napoleon === visible.mySeat ? visible.discards : null;
}

/** Every legal play with each named suit and summon choice, validated by the shared rules. */
export function legalNapoleonPlays(visible: NapoleonVisibleState): NapoleonPlayChoice[] {
  const trick = visible.trick;
  if (!trick || visible.currentTurnSeat !== visible.mySeat) return [];
  const seat = visible.mySeat;
  const hand = visible.myHand;
  const discards = summonDiscards(visible);
  const leading = trick.plays.length === 0;
  const choices: NapoleonPlayChoice[] = [];
  for (const card of hand) {
    if (!leading) {
      choices.push({ card });
      continue;
    }
    const suits: readonly (Suit | undefined)[] = isNapoleonFreeCard(visible, card) ? SUITS : [undefined];
    const summons = napoleonSummonOptions(visible, seat, hand, card, discards);
    for (const leadSuit of suits) {
      for (const summon of [undefined, ...summons]) {
        choices.push({ card, ...(leadSuit ? { leadSuit } : {}), ...(summon ? { summon } : {}) });
      }
    }
  }
  return choices.filter((choice) => napoleonPlayError(visible, seat, hand, choice, discards) === null);
}

/** Share of unseen cards of a suit that are point cards, which followers may be forced to drop. */
function pointShare(table: NapoleonTable, suit: Suit): number {
  const cards = table.unseen.filter((card) => suitOf(card) === suit);
  return cards.length > 0 ? cards.filter(isNapoleonPointCard).length / cards.length : 0;
}

/** Points the later seats add when this seat's side wins: allies feed, opponents only when forced. */
function addedPoints(table: NapoleonTable, later: readonly GameSeat[], leadSuit: Suit | null): number {
  const density = table.unseen.length > 0 ? table.unseenHandPoints / table.unseen.length : 0;
  const feed = Math.min(0.7, density * 2.2);
  return later.reduce((sum, seat) => {
    const voidInSuit = leadSuit !== null && table.voids.get(seat)?.has(leadSuit);
    const forced = leadSuit === null || voidInSuit ? 0.05 : 0.35 * pointShare(table, leadSuit);
    const ally = allyOf(table, seat);
    return sum + ally * feed + (1 - ally) * forced;
  }, 0);
}

function trumpCount(table: NapoleonTable, cards: readonly NapoleonCard[]): number {
  return table.trump ? cards.filter((card) => suitOf(card) === table.trump).length : 0;
}

/** The Napoleon draws trumps while holding at least half of those still out. */
function drawingTrumps(table: NapoleonTable): boolean {
  if (table.role !== 'napoleon' || !table.trump) return false;
  const mine = trumpCount(table, table.hand);
  const out = trumpCount(table, table.unseen);
  return out > 0 && mine >= 3 && mine * 2 >= out;
}

/** Value that a joker summon takes from (or costs) the seat holding that joker. */
function flushValue(table: NapoleonTable, joker: NapoleonCard, later: readonly GameSeat[]): number {
  const future = table.finalTrick ? 0.2 : Math.max(0, table.jokerTricksLeft - 1) > 0 ? 1.3 * pointsPerTrick(table) : 0.3;
  return later.reduce((sum, seat) => {
    const held = holdChance(table, seat, joker);
    return sum + held * (1 - 2 * allyOf(table, seat)) * future;
  }, 0);
}

function scoreLead(table: NapoleonTable, choice: NapoleonPlayChoice): number {
  const visible = table.visible;
  const trick = applyNapoleonPlay(visible.trick!, table.seat, choice);
  const leadSuit = trick.leadSuit;
  const later = seatsAfter(table, trick);
  const cost = holdValue(table, choice.card);
  if (choice.summon === 'secretary') {
    // The summoned secretary card always wins (its own point either way); the cost is the richer
    // trick it might have taken later.
    const forced = Math.max(0, later.length - 1) * 0.35 * pointShare(table, leadSuit!);
    return cardPoints(choice.card) + forced - cost - secretaryKeepValue(table);
  }
  let win = sideWinChance(table, trick, later);
  let bonus = 0;
  if (choice.summon) {
    const joker = napoleonSummonedCard(visible, choice.summon)!;
    if (!table.finalTrick) {
      // The summoned joker takes the trick for whoever holds it.
      const held = later.map((seat) => holdChance(table, seat, joker));
      const anywhere = Math.min(1, held.reduce((sum, chance) => sum + chance, 0));
      const allied = later.reduce((sum, seat, index) => sum + held[index] * allyOf(table, seat), 0);
      win = allied + (1 - anywhere) * win;
    }
    bonus += flushValue(table, joker, later);
  }
  const points = cardPoints(choice.card) + addedPoints(table, later, leadSuit);
  if (drawingTrumps(table) && leadSuit === table.trump) bonus += 0.6 + 0.6 * win;
  return win * points - cost + bonus;
}

function scoreFollow(table: NapoleonTable, choice: NapoleonPlayChoice): number {
  const current = table.visible.trick!;
  const trick: NapoleonTrick = applyNapoleonPlay(current, table.seat, choice);
  const later = seatsAfter(table, current);
  const win = sideWinChance(table, trick, later);
  const points = napoleonPoints(trick.plays.map((play) => play.card)) + addedPoints(table, later, current.leadSuit);
  return win * points - holdValue(table, choice.card);
}

/** Heuristic play from the seat's own view; slight randomness among near-equal choices. */
export function chooseHardPlay(visible: NapoleonVisibleState, random: () => number): NapoleonPlayChoice | null {
  const choices = legalNapoleonPlays(visible);
  if (choices.length <= 1) return choices[0] ?? null;
  const table = readTable(visible);
  if (!table) return choices[0];
  const leading = visible.trick!.plays.length === 0;
  const scored = choices.map((choice) => ({
    value: choice,
    score: leading ? scoreLead(table, choice) : scoreFollow(table, choice),
  }));
  return selectNearBest(scored, random, 0.05);
}

function pick<T>(options: readonly T[], random: () => number): T | null {
  return options.length === 0 ? null : options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

/** A random legal card; a led free card names a random suit, and summons are used half the time. */
export function chooseEasyPlay(visible: NapoleonVisibleState, random: () => number): NapoleonPlayChoice | null {
  const choices = legalNapoleonPlays(visible);
  const cards = choices.filter((choice, index) => choices.findIndex((other) => sameNapoleonCard(other.card, choice.card)) === index)
    .map((choice) => choice.card);
  const card = pick(cards, random);
  if (!card) return null;
  const forCard = choices.filter((choice) => sameNapoleonCard(choice.card, card));
  const summoned = forCard.filter((choice) => choice.summon);
  const plain = forCard.filter((choice) => !choice.summon);
  const pool = summoned.length > 0 && (plain.length === 0 || random() < 0.5) ? summoned : plain;
  return pick(pool, random);
}
