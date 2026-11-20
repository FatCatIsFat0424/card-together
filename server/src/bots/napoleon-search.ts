import type { GameSeat, NapoleonCard, NapoleonSummon, NapoleonVisibleState, Suit } from '@shared/types';
import {
  createNapoleonDeck, hasNapoleonCard, isNapoleonJoker, napoleonDealSize, napoleonJoker, napoleonPlayedCards,
  napoleonSeatPoints, NAPOLEON_FINAL_TRICKS,
} from '@shared/rules/napoleon';
import type { BotAction } from './bot-decisions';
import { callOrder } from './napoleon-hand';
import { readTable } from './napoleon-knowledge';
import type { NapoleonTable } from './napoleon-knowledge';
import { scoredNapoleonPlays } from './napoleon-play';
import type { NapoleonPlayChoice } from './napoleon-play';
import { getNapoleonBotAction } from './napoleon-strategy';
import { dealUnseen } from './search/card-dealer';
import type { DealSeat } from './search/card-dealer';
import { determinizedSearch } from './search/determinized';
import type { Candidate, DeterminizedGame, SampledWorld } from './search/determinized';
import type { SearchContext } from './search/search-types';

// Determinized search over Napoleon card play. The seat sees only its own filtered view: unseen cards are dealt
// to the other hands (and, with five or six players, to the hidden discards) honoring hand sizes, shown voids,
// and summons a seat failed to answer. The secretary card is placed first by the public evidence of who feeds
// the Napoleon, so the sides differ between worlds. Each heuristic candidate is played out to the end of the
// deal with a fast greedy policy that sees the sampled world, and scored by whether the Napoleon's side reaches
// its contract level: a smooth step around the level, so the search plays to reach (or deny) the contract
// rather than to collect as many point cards as possible.

const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const BIG = 52;
const SMALL = 53;
const NONE = -1;

/** Card codes: suit index * 13 + rank - 2 for suit cards; 52 and 53 for the big and small joker. */
export function napoleonCardCode(card: NapoleonCard): number {
  if (isNapoleonJoker(card)) return card.joker === 'big' ? BIG : SMALL;
  return SUITS.indexOf(card.suit) * 13 + card.rank - 2;
}

function decodeCard(code: number): NapoleonCard {
  if (code >= BIG) return napoleonJoker(code === BIG ? 'big' : 'small');
  return { suit: SUITS[Math.floor(code / 13)], rank: (code % 13) + 2 } as NapoleonCard;
}

const suitOfCode = (code: number): number => (code >= BIG ? NONE : Math.floor(code / 13));
const rankOfCode = (code: number): number => (code % 13) + 2;
const isPointCode = (code: number): boolean => code < BIG && code % 13 >= 9;

/** Moves pack the card, the named lead suit plus one, and the summon (0 none, 1 secretary, 2 big, 3 small joker). */
const SUMMON_CODES: readonly (NapoleonSummon | undefined)[] = [undefined, 'secretary', 'bigJoker', 'smallJoker'];
function encodeMove(card: number, leadSuit: number, summon: number): number {
  return card | ((leadSuit + 1) << 6) | (summon << 9);
}
const moveCard = (move: number): number => move & 63;
const moveLeadSuit = (move: number): number => ((move >> 6) & 7) - 1;
const moveSummon = (move: number): number => (move >> 9) & 3;

/** Rules and facts every world of one decision shares. */
interface Rules {
  readonly players: number;
  readonly trump: number;
  readonly secretary: number;
  readonly summons: boolean;
  readonly napoleon: number;
  readonly tricks: number;
  /** The first trick index where jokers lose their strength */
  readonly finalFrom: number;
  readonly level: number;
  readonly me: number;
}

/** One complete deal from the deciding seat's view; `copy` makes it safe to change. */
export interface NapoleonWorld {
  hands: number[][];
  played: Uint8Array;
  points: number[];
  leader: number;
  cards: number[];
  leadSuit: number;
  /** The summoned card of the trick in progress, or NONE */
  summoned: number;
  trick: number;
  turn: number;
  /** The seat holding (or that played) the secretary card; NONE when no other seat has it */
  holder: number;
}

function copyWorld(world: NapoleonWorld): NapoleonWorld {
  return {
    hands: world.hands.map((hand) => hand.slice()),
    played: world.played.slice(),
    points: world.points.slice(),
    leader: world.leader,
    cards: world.cards.slice(),
    leadSuit: world.leadSuit,
    summoned: world.summoned,
    trick: world.trick,
    turn: world.turn,
    holder: world.holder,
  };
}

/** Mirrors the shared rules' play strength: secretary card, jokers (not in the final tricks), trumps, led suit. */
function strength(rules: Rules, card: number, led: boolean, leadSuit: number, final: boolean): number {
  if (card === rules.secretary) return 10_000;
  if (card >= BIG) {
    if (!final) return card === BIG ? 5000 : 4000;
    if (led) return leadSuit === rules.trump ? 1000 + (card === BIG ? 1 : 0) : 100 + (card === BIG ? 1 : 0);
    return card === BIG ? -1 : -2;
  }
  const suit = suitOfCode(card);
  const rank = rankOfCode(card);
  return suit === rules.trump ? 1000 + rank : suit === leadSuit ? 100 + rank : 0;
}

const isFinal = (rules: Rules, trick: number): boolean => trick >= rules.finalFrom;
const isFree = (rules: Rules, card: number): boolean => card >= BIG || card === rules.secretary;

/** The joker a led card summons whoever holds it, regardless of where that joker is. */
function jokerSummonOf(rules: Rules, card: number): number {
  if (!rules.summons || rules.trump === NONE || card >= BIG || suitOfCode(card) !== rules.trump) return 0;
  const rank = rankOfCode(card);
  return rank === 2 ? 2 : rank === 3 ? 3 : 0;
}

/** The automatic joker summon of a lead, as in `napoleonJokerSummon`; 0 when it does not apply. */
function automaticSummon(rules: Rules, world: NapoleonWorld, hand: readonly number[], card: number): number {
  const summon = jokerSummonOf(rules, card);
  if (!summon) return 0;
  const joker = summon === 2 ? BIG : SMALL;
  return joker === rules.secretary || world.played[joker] || hand.includes(joker) ? 0 : summon;
}

function summonedCard(rules: Rules, summon: number): number {
  return summon === 1 ? rules.secretary : summon === 2 ? BIG : summon === 3 ? SMALL : NONE;
}

/** Every legal move for the seat to act, as `napoleonPlayError` allows them (secretary summons included). */
function legalMoves(rules: Rules, world: NapoleonWorld): number[] {
  const hand = world.hands[world.turn];
  const moves: number[] = [];
  if (world.cards.length === 0) {
    const secretaryOut = world.holder !== NONE && world.holder !== world.turn && !world.played[rules.secretary];
    for (const card of hand) {
      const automatic = automaticSummon(rules, world, hand, card);
      const summons = automatic ? [automatic]
        : world.turn === rules.napoleon && secretaryOut && !jokerSummonOf(rules, card) ? [0, 1] : [0];
      const suits = isFree(rules, card) ? [0, 1, 2, 3] : [suitOfCode(card)];
      for (const suit of suits) for (const summon of summons) moves.push(encodeMove(card, isFree(rules, card) ? suit : NONE, summon));
    }
    return moves;
  }
  if (world.summoned !== NONE && hand.includes(world.summoned)) return [world.summoned];
  const follows = hand.some((card) => !isFree(rules, card) && suitOfCode(card) === world.leadSuit);
  for (const card of hand) {
    if (!follows || isFree(rules, card) || suitOfCode(card) === world.leadSuit) moves.push(card);
  }
  return moves;
}

function trickWinner(rules: Rules, world: NapoleonWorld): number {
  const final = isFinal(rules, world.trick);
  let best = 0;
  let bestStrength = strength(rules, world.cards[0], true, world.leadSuit, final);
  for (let index = 1; index < world.cards.length; index++) {
    const value = strength(rules, world.cards[index], false, world.leadSuit, final);
    if (value > bestStrength) {
      best = index;
      bestStrength = value;
    }
  }
  return (world.leader + best) % rules.players;
}

function playMove(rules: Rules, world: NapoleonWorld, move: number): void {
  const card = moveCard(move);
  const hand = world.hands[world.turn];
  const at = hand.indexOf(card);
  if (at < 0) throw new Error('The move plays a card the seat does not hold.');
  hand.splice(at, 1);
  world.played[card] = 1;
  if (world.cards.length === 0) {
    world.leader = world.turn;
    const named = moveLeadSuit(move);
    world.leadSuit = named !== NONE ? named : suitOfCode(card);
    world.summoned = summonedCard(rules, moveSummon(move));
  }
  world.cards.push(card);
  if (world.cards.length < rules.players) {
    world.turn = (world.turn + 1) % rules.players;
    return;
  }
  const winner = trickWinner(rules, world);
  for (const played of world.cards) if (isPointCode(played)) world.points[winner]++;
  world.trick++;
  world.cards = [];
  world.leadSuit = NONE;
  world.summoned = NONE;
  world.leader = winner;
  world.turn = winner;
}

const onSide = (rules: Rules, world: NapoleonWorld, seat: number): boolean => seat === rules.napoleon || seat === world.holder;

/** Point cards the Napoleon's side has won so far in this world. */
function sidePoints(rules: Rules, world: NapoleonWorld): number {
  return world.points[rules.napoleon] + (world.holder !== NONE && world.holder !== rules.napoleon ? world.points[world.holder] : 0);
}

/** Steepness of the step around the contract level; one point card short is about a 12% chance kept. */
const STEP = 2;
/** A small share of the point margin separates moves that all surely win or surely lose. */
const MARGIN_WEIGHT = 0.01;

/** The Napoleon side's result: near 1 at or above the level, near 0 below, with a small margin term. */
export function napoleonContractValue(points: number, level: number): number {
  return 1 / (1 + Math.exp(-STEP * (points - level + 0.5))) + MARGIN_WEIGHT * (points - level);
}

// ─── Rollout policy ───

/** Strongest card each seat could play to a trick led in `leadSuit`, as the follower rules allow. */
function bestReply(rules: Rules, hand: readonly number[], leadSuit: number, final: boolean): number {
  const follows = hand.some((card) => !isFree(rules, card) && suitOfCode(card) === leadSuit);
  let best = -Infinity;
  for (const card of hand) {
    if (follows && !isFree(rules, card) && suitOfCode(card) !== leadSuit) continue;
    const value = strength(rules, card, false, leadSuit, final);
    if (value > best) best = value;
  }
  return best;
}

/** Whether an opponent still to play could beat `value` (the sampled world is fully visible to the policy). */
function threatened(rules: Rules, world: NapoleonWorld, seat: number, value: number, leadSuit: number, remaining: number): boolean {
  const final = isFinal(rules, world.trick);
  for (let step = 1; step <= remaining; step++) {
    const other = (seat + step) % rules.players;
    if (onSide(rules, world, other) === onSide(rules, world, seat)) continue;
    if (bestReply(rules, world.hands[other], leadSuit, final) > value) return true;
  }
  return false;
}

/** How much the seat wants to keep a card: low for cards to dump, high for winners and points. */
function keepValue(rules: Rules, card: number, final: boolean): number {
  if (card === rules.secretary) return 1000;
  if (card >= BIG) return final ? -10 : 500 + (card === BIG ? 1 : 0);
  return (suitOfCode(card) === rules.trump ? 40 : 0) + rankOfCode(card) + (isPointCode(card) ? 15 : 0);
}

function lowest(rules: Rules, cards: readonly number[], final: boolean): number {
  let chosen = cards[0];
  for (const card of cards) if (keepValue(rules, card, final) < keepValue(rules, chosen, final)) chosen = card;
  return chosen;
}

function followMove(rules: Rules, world: NapoleonWorld, random: () => number): number {
  const moves = legalMoves(rules, world);
  if (moves.length === 1) return moves[0];
  const seat = world.turn;
  const final = isFinal(rules, world.trick);
  const remaining = rules.players - world.cards.length - 1;
  let winnerIndex = 0;
  let top = strength(rules, world.cards[0], true, world.leadSuit, final);
  for (let index = 1; index < world.cards.length; index++) {
    const value = strength(rules, world.cards[index], false, world.leadSuit, final);
    if (value > top) {
      top = value;
      winnerIndex = index;
    }
  }
  const winner = (world.leader + winnerIndex) % rules.players;
  let points = 0;
  for (const card of world.cards) if (isPointCode(card)) points++;
  const lastTricks = rules.tricks - world.trick <= 2;

  if (onSide(rules, world, winner) === onSide(rules, world, seat)) {
    if (!threatened(rules, world, seat, top, world.leadSuit, remaining)) {
      // Feed the safest point card: off-trump and low among the points.
      let feed = NONE;
      for (const card of moves) {
        if (!isPointCode(card) || card === rules.secretary) continue;
        if (feed === NONE || keepValue(rules, card, final) < keepValue(rules, feed, final)) feed = card;
      }
      if (feed !== NONE) return feed;
    }
    return lowest(rules, moves, final);
  }
  // An opponent is winning: take it with the cheapest card that holds, when worth it.
  let cheapest = NONE;
  let cheapestSafe = NONE;
  for (const card of moves) {
    const value = strength(rules, card, false, world.leadSuit, final);
    if (value <= top) continue;
    if (card === rules.secretary && points < 2 && !lastTricks) continue;
    if (cheapest === NONE || value < strength(rules, cheapest, false, world.leadSuit, final)) cheapest = card;
    if (!threatened(rules, world, seat, value, world.leadSuit, remaining)
      && (cheapestSafe === NONE || value < strength(rules, cheapestSafe, false, world.leadSuit, final))) cheapestSafe = card;
  }
  const worth = (card: number): boolean => points + (isPointCode(card) ? 1 : 0) > 0
    || (card < BIG && suitOfCode(card) !== rules.trump && card !== rules.secretary);
  if (cheapestSafe !== NONE && worth(cheapestSafe)) return cheapestSafe;
  if (cheapest !== NONE && remaining === 0 && worth(cheapest)) return cheapest;
  if (cheapest !== NONE && random() < 0.25 && worth(cheapest)) return cheapest;
  return lowest(rules, moves, final);
}

function leadMove(rules: Rules, world: NapoleonWorld, random: () => number): number {
  const seat = world.turn;
  const hand = world.hands[seat];
  const final = isFinal(rules, world.trick);
  const mySide = onSide(rules, world, seat);
  const lead = (card: number, suit: number): number => encodeMove(card, isFree(rules, card) ? suit : NONE,
    automaticSummon(rules, world, hand, card));
  const jokers = hand.filter((card) => card >= BIG && card !== rules.secretary);
  // Jokers lose their strength in the final tricks: cash them while they still win.
  if (!final && jokers.length > 0 && world.trick + jokers.length >= rules.finalFrom) {
    const joker = jokers.includes(BIG) ? BIG : jokers[0];
    const suit = mySide && rules.trump !== NONE ? rules.trump : Math.floor(random() * 4);
    return lead(joker, suit);
  }
  // A card no opponent can beat; points first.
  let winner = NONE;
  for (const card of hand) {
    if (isFree(rules, card)) continue;
    const suit = suitOfCode(card);
    if (threatened(rules, world, seat, strength(rules, card, true, suit, final), suit, rules.players - 1)) continue;
    if (winner === NONE || (isPointCode(card) && !isPointCode(winner))
      || (isPointCode(card) === isPointCode(winner) && rankOfCode(card) < rankOfCode(winner))) winner = card;
  }
  if (winner !== NONE) return lead(winner, NONE);
  // Otherwise a low card from a side suit, kept random so rollouts vary.
  const plain = hand.filter((card) => !isFree(rules, card));
  const pool = plain.filter((card) => suitOfCode(card) !== rules.trump && !isPointCode(card));
  const choices = pool.length > 0 ? pool : plain.length > 0 ? plain : hand;
  let card = choices[Math.floor(random() * choices.length)];
  const suit = suitOfCode(card);
  for (const other of choices) if (suitOfCode(other) === suit && keepValue(rules, other, final) < keepValue(rules, card, final)) card = other;
  return lead(card, card === rules.secretary || card >= BIG ? (rules.trump !== NONE ? rules.trump : 0) : NONE);
}

function rolloutMove(rules: Rules, world: NapoleonWorld, random: () => number): number {
  return world.cards.length === 0 ? leadMove(rules, world, random) : followMove(rules, world, random);
}

// ─── Belief: dealing the unseen cards ───

/** Seats that answered a joker summon without the joker cannot hold it. */
function summonMisses(visible: NapoleonVisibleState): Map<GameSeat, Set<number>> {
  const misses = new Map<GameSeat, Set<number>>();
  const tricks = [...visible.tricks, ...(visible.trick ? [visible.trick] : [])];
  for (const trick of tricks) {
    if (trick.summon !== 'bigJoker' && trick.summon !== 'smallJoker') continue;
    const joker = trick.summon === 'bigJoker' ? BIG : SMALL;
    for (const play of trick.plays.slice(1)) {
      if (napoleonCardCode(play.card) === joker) continue;
      if (!misses.has(play.seat)) misses.set(play.seat, new Set());
      misses.get(play.seat)!.add(joker);
    }
  }
  return misses;
}

interface Belief {
  readonly rules: Rules;
  readonly seats: readonly GameSeat[];
  /** Hands to fill: seat indexes, then NONE for the hidden discards */
  readonly owners: readonly number[];
  readonly specSeats: readonly DealSeat<number>[];
  readonly unseen: readonly number[];
  /** Where the secretary card may be and how likely: owner index into `owners`, weight */
  readonly secretaryPlaces: readonly { readonly owner: number; readonly weight: number }[];
  /** Place of the Napoleon's hand in `owners`, or NONE when it is this seat's own */
  readonly napoleonPlace: number;
  /** Unseen cards the Napoleon likely holds: those it would have called before the secretary card */
  readonly callEvidence: readonly number[];
  /** Trumps and jokers the Napoleon has already played */
  readonly napoleonTrumpsPlayed: number;
  readonly base: NapoleonWorld;
}

/** Each card ranked above the call stays with the Napoleon in this share of the worlds. */
const CALL_TRUST = 0.8;
/** Trumps and jokers a Napoleon usually holds after the exchange, by player count. */
const NAPOLEON_TRUMPS: Readonly<Record<number, number>> = { 4: 6, 5: 5, 6: 4 };
const TRUMP_ATTEMPTS = 8;

function buildBelief(visible: NapoleonVisibleState, table: NapoleonTable): Belief {
  const seats = visible.seats;
  const contract = table.contract;
  const players = seats.length;
  const { hand: tricks, kitty } = napoleonDealSize(players);
  const me = seats.indexOf(visible.mySeat);
  const secretary = napoleonCardCode(table.secretaryCard);
  const rules: Rules = {
    players, trump: table.trump ? SUITS.indexOf(table.trump) : NONE, secretary, summons: visible.options.jokerSummon,
    napoleon: seats.indexOf(contract.napoleon), tricks, finalFrom: tricks - NAPOLEON_FINAL_TRICKS, level: contract.level, me,
  };
  const played = new Uint8Array(54);
  for (const card of napoleonPlayedCards(visible)) played[napoleonCardCode(card)] = 1;
  const known = new Set<number>([...visible.myHand, ...(visible.discards ?? [])].map(napoleonCardCode));
  const unseenAll = createNapoleonDeck().map(napoleonCardCode).filter((code) => !played[code] && !known.has(code));

  const owners: number[] = [];
  for (let index = 0; index < players; index++) if (index !== me) owners.push(index);
  if (!visible.discards) owners.push(NONE);
  const misses = summonMisses(visible);
  const sizes = owners.map((owner) => (owner === NONE ? kitty : visible.handCounts[seats[owner]] ?? 0));

  // Who has the secretary card: revealed, held by me, played, discarded, or weighed by the public evidence.
  let holder = NONE;
  const placements: { owner: number; weight: number }[] = [];
  const secretarySeen = played[secretary] === 1 || known.has(secretary);
  if (visible.secretarySeat) holder = seats.indexOf(visible.secretarySeat);
  else if (hasNapoleonCard(visible.myHand, table.secretaryCard) && me !== rules.napoleon) holder = me;
  if (!secretarySeen) {
    let assigned = 0;
    owners.forEach((owner, place) => {
      if (owner === NONE || owner === rules.napoleon || sizes[place] === 0) return;
      const odds = holder !== NONE ? Number(owner === holder) : table.secretaryOdds.get(seats[owner]) ?? 0;
      assigned += odds;
      if (odds > 0) placements.push({ owner: place, weight: odds });
    });
    // The rest of the chance lies with the Napoleon's own hand or the hidden discards.
    const rest = Math.max(0, 1 - assigned);
    const elsewhere = owners.map((owner, place) => ({ owner, place }))
      .filter(({ owner, place }) => (owner === NONE || owner === rules.napoleon) && sizes[place] > 0);
    const room = elsewhere.reduce((sum, { place }) => sum + sizes[place], 0);
    if (rest > 0 && holder === NONE) {
      for (const { place } of elsewhere) placements.push({ owner: place, weight: (rest * sizes[place]) / room });
    }
  }
  const unseen = unseenAll.filter((code) => code !== secretary || placements.length === 0);
  const specSeats: DealSeat<number>[] = owners.map((owner, place) => {
    if (owner === NONE) return { size: sizes[place] };
    const seat = seats[owner];
    const voids = table.voids.get(seat);
    const missing = misses.get(seat);
    return {
      size: sizes[place],
      accepts: (code: number) => !(missing?.has(code))
        && !(voids && code < BIG && code !== secretary && voids.has(SUITS[suitOfCode(code)])),
    };
  });

  const points = new Array<number>(players).fill(0);
  const seatPoints = napoleonSeatPoints(seats, visible.tricks);
  seats.forEach((seat, index) => { points[index] = seatPoints[seat]; });
  const trick = visible.trick;
  const base: NapoleonWorld = {
    hands: seats.map(() => []),
    played,
    points,
    leader: trick ? seats.indexOf(trick.leadSeat) : me,
    cards: (trick?.plays ?? []).map((play) => napoleonCardCode(play.card)),
    leadSuit: trick?.leadSuit ? SUITS.indexOf(trick.leadSuit) : NONE,
    summoned: trick?.summon ? napoleonCardCode(
      trick.summon === 'secretary' ? table.secretaryCard : napoleonJoker(trick.summon === 'bigJoker' ? 'big' : 'small'),
    ) : NONE,
    trick: visible.tricks.length,
    turn: me,
    holder,
  };
  base.hands[me] = visible.myHand.map(napoleonCardCode);

  // A Napoleon usually calls the strongest card it lacks, so the stronger ones are likely in its hand.
  const napoleonPlace = owners.indexOf(rules.napoleon);
  const order = callOrder(contract.suit).map(napoleonCardCode);
  const called = order.indexOf(secretary);
  const unseenSet = new Set(unseen);
  const callEvidence = napoleonPlace === NONE || called < 0 ? []
    : order.slice(0, called).filter((code) => unseenSet.has(code) && (specSeats[napoleonPlace].accepts?.(code) ?? true));
  const napoleonTrumpsPlayed = [...visible.tricks, ...(trick ? [trick] : [])].flatMap((done) => done.plays)
    .filter((play) => play.seat === contract.napoleon).map((play) => napoleonCardCode(play.card))
    .filter((code) => code >= BIG || suitOfCode(code) === rules.trump).length;
  return {
    rules, seats, owners, specSeats, unseen, secretaryPlaces: placements, napoleonPlace, callEvidence, napoleonTrumpsPlayed, base,
  };
}

function sampleWorld(belief: Belief, random: () => number): SampledWorld<NapoleonWorld> | null {
  const { owners, rules } = belief;
  let specSeats = belief.specSeats;
  let holder = belief.base.holder;
  if (belief.secretaryPlaces.length > 0) {
    const total = belief.secretaryPlaces.reduce((sum, place) => sum + place.weight, 0);
    let ticket = random() * total;
    let chosen = belief.secretaryPlaces[belief.secretaryPlaces.length - 1].owner;
    for (const place of belief.secretaryPlaces) {
      ticket -= place.weight;
      if (ticket < 0) {
        chosen = place.owner;
        break;
      }
    }
    specSeats = specSeats.map((seat, index) => (index === chosen ? { ...seat, known: [rules.secretary] } : seat));
    const owner = owners[chosen];
    holder = owner !== NONE && owner !== rules.napoleon ? owner : NONE;
  }
  let unseen = belief.unseen;
  let misfit: ((hands: readonly (readonly number[])[]) => number) | undefined;
  const place = belief.napoleonPlace;
  if (place !== NONE) {
    const seat = specSeats[place];
    const room = seat.size - (seat.known?.length ?? 0);
    const kept = belief.callEvidence.filter(() => random() < CALL_TRUST).slice(0, room);
    if (kept.length > 0) {
      specSeats = specSeats.map((other, index) => (index === place ? { ...other, known: [...(other.known ?? []), ...kept] } : other));
      unseen = unseen.filter((code) => !kept.includes(code));
    }
    if (rules.trump !== NONE && TRUMP_ATTEMPTS > 1) {
      const target = (NAPOLEON_TRUMPS[rules.players] ?? 0) - belief.napoleonTrumpsPlayed;
      misfit = (hands) => {
        let held = 0;
        for (const code of hands[place]) if (code >= BIG || suitOfCode(code) === rules.trump) held++;
        return Math.max(0, target - held);
      };
    }
  }
  const deal = dealUnseen({ unseen, seats: specSeats, ...(misfit ? { misfit, attempts: TRUMP_ATTEMPTS } : {}) }, random);
  if (!deal) return null;
  const world = copyWorld(belief.base);
  world.holder = holder;
  owners.forEach((owner, index) => { if (owner !== NONE) world.hands[owner] = deal.hands[index]; });
  return { state: world };
}

// ─── Search ───

/** Worlds examined per decision at most; late in the deal the rollouts are short and this cap ends the search. */
const MAX_SAMPLES = 2000;
const MIN_SAMPLES = 12;
/** Value differences below this count as equal; the heuristic then decides. */
const TOLERANCE = 0.004;
const RESERVE_MS = 30;
const MAX_CANDIDATES = 10;

function choiceToMove(world: NapoleonWorld, choice: NapoleonPlayChoice): number {
  const card = napoleonCardCode(choice.card);
  if (world.cards.length > 0) return card;
  const summon = choice.summon ? SUMMON_CODES.indexOf(choice.summon) : 0;
  return encodeMove(card, choice.leadSuit ? SUITS.indexOf(choice.leadSuit) : NONE, summon);
}

/**
 * Candidate plays with equal effect merged: adjacent suit cards with no unseen card between them and the same
 * point value, excluding free cards and the trump 2 and 3 (summons).
 */
function distinctChoices(
  visible: NapoleonVisibleState, scored: readonly { value: NapoleonPlayChoice; score: number }[], rules: Rules,
  played: Uint8Array,
): { value: NapoleonPlayChoice; score: number }[] {
  const mine = new Set(visible.myHand.map(napoleonCardCode));
  const special = (code: number): boolean => isFree(rules, code) || jokerSummonOf(rules, code) !== 0;
  const groupOf = (choice: NapoleonPlayChoice): string => {
    const code = napoleonCardCode(choice.card);
    if (special(code)) return `${code}:${choice.leadSuit ?? ''}:${choice.summon ?? ''}`;
    let low = code;
    while (low % 13 > 0) {
      const next = low - 1;
      if (special(next) || isPointCode(next) !== isPointCode(code) || (!mine.has(next) && !played[next])) break;
      low = next;
    }
    return `run:${low}:${choice.summon ?? ''}`;
  };
  const best = new Map<string, { value: NapoleonPlayChoice; score: number }>();
  for (const option of scored) {
    const key = groupOf(option.value);
    const current = best.get(key);
    if (!current || option.score > current.score) best.set(key, option);
  }
  return [...best.values()];
}

function napoleonGame(belief: Belief): DeterminizedGame<NapoleonWorld, number> {
  const { rules } = belief;
  return {
    seat: belief.seats[rules.me],
    sample: (random) => sampleWorld(belief, random),
    copy: copyWorld,
    legalMoves: (world) => legalMoves(rules, world),
    play: (world, move) => playMove(rules, world, move),
    rolloutMove: (world, random) => rolloutMove(rules, world, random),
    isTerminal: (world) => world.trick >= rules.tricks,
    utility: (world) => {
      const value = napoleonContractValue(sidePoints(rules, world), rules.level);
      return onSide(rules, world, rules.me) ? value : -value;
    },
  };
}

/** The searched play, or null when the heuristic should decide. */
export function chooseNapoleonSearchPlay(visible: NapoleonVisibleState, context: SearchContext): NapoleonPlayChoice | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat || !visible.trick) return null;
  const table = readTable(visible);
  if (!table) return null;
  const scored = scoredNapoleonPlays(visible);
  if (scored.length <= 1) return scored[0]?.value ?? null;
  const belief = buildBelief(visible, table);
  const options = distinctChoices(visible, scored, belief.rules, belief.base.played);
  if (options.length === 1) return options[0].value;
  const moves = new Map<number, NapoleonPlayChoice>();
  const candidates: Candidate<number>[] = options.map((option) => {
    const move = choiceToMove(belief.base, option.value);
    moves.set(move, option.value);
    return { move, prior: option.score };
  });
  const choice = determinizedSearch(napoleonGame(belief), candidates, context, {
    maxSamples: MAX_SAMPLES, minSamples: MIN_SAMPLES, maxCandidates: MAX_CANDIDATES, tolerance: TOLERANCE, reserveMs: RESERVE_MS,
  });
  return moves.get(choice.move) ?? null;
}

/**
 * Worker-pool strategy: card play searches sampled deals; bidding, the exchange, the call, and the review use
 * the heuristic strategy, which also decides when the search has too few deals.
 */
export function napoleonSearch(visible: NapoleonVisibleState, context: SearchContext): BotAction | null {
  if (visible.phase === 'playing') {
    const play = chooseNapoleonSearchPlay(visible, context);
    if (play) return { type: 'napoleon-action', action: { type: 'play', ...play } };
  }
  const action = getNapoleonBotAction(visible, context.random);
  return action ? { type: 'napoleon-action', action } : null;
}

/** Test hooks: the fast rules model and the belief, checked against the shared rules. */
export const napoleonSearchInternals = {
  buildBelief, sampleWorld, legalMoves, playMove, rolloutMove, decodeCard, encodeMove, moveCard, copyWorld,
  isPointCode,
};
