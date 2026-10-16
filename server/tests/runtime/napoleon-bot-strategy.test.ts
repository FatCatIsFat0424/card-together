import { describe, expect, it } from 'vitest';
import type {
  BidSuit, BotDifficulty, Card, GameSeat, NapoleonAction, NapoleonBiddingState, NapoleonCard, NapoleonContract,
  NapoleonOptions, NapoleonTrick, NapoleonTrickRecord, NapoleonVisibleState, Suit,
} from '@shared/types';
import {
  applyNapoleonBid, applyNapoleonPlay, createNapoleonBidding, createNapoleonDeck, dealNapoleon, hasNapoleonCard,
  isNapoleonFinalTrick, isNapoleonJoker, napoleonBidError, napoleonBiddingEnd, napoleonContract, napoleonDealSize,
  napoleonDiscardError, napoleonDiscardsPublic, napoleonOutcome, napoleonPlayedCards, napoleonPlayError,
  napoleonTrickWinner, napoleonValidCards, removeNapoleonCards,
} from '@shared/rules/napoleon';
import { getNapoleonBotAction } from '../../src/bots/napoleon-strategy';
import { runSeededGame } from './seeded-game-runner';

const ALL_SEATS: readonly GameSeat[] = ['N', 'E', 'S', 'W', 'P5', 'P6'];
const BIG: NapoleonCard = { joker: 'big' };
const SMALL: NapoleonCard = { joker: 'small' };
const card = (suit: Suit, rank: Card['rank']): NapoleonCard => ({ suit, rank });

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffled(rng: () => number): NapoleonCard[] {
  const deck = createNapoleonDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const SUIT_CODES: Record<string, Suit> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANKS: Record<string, Card['rank']> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
/** Parses `BJ SJ SAKQ H32 D- C5` style hands: jokers, then suit letter and ranks. */
function hand(text: string): NapoleonCard[] {
  return text.split(' ').filter(Boolean).flatMap((part) => {
    if (part === 'BJ') return [BIG];
    if (part === 'SJ') return [SMALL];
    const suit = SUIT_CODES[part[0]];
    return [...part.slice(1)].filter((rank) => rank !== '-').map((rank) => card(suit, RANKS[rank] ?? Number(rank) as Card['rank']));
  });
}

/** Server-side state of the simulated deal; only `visibleFor` reaches the bots. */
interface Sim {
  readonly seats: GameSeat[];
  readonly options: NapoleonOptions;
  readonly dealerSeat: GameSeat;
  phase: NapoleonVisibleState['phase'];
  hands: Partial<Record<GameSeat, NapoleonCard[]>>;
  kitty: NapoleonCard[];
  pickedUp: NapoleonCard[];
  discards: NapoleonCard[];
  bidding: NapoleonBiddingState | null;
  contract: NapoleonContract | null;
  reviewed: GameSeat[];
  secretaryCard: NapoleonCard | null;
  secretarySeat: GameSeat | null;
  trick: NapoleonTrick | null;
  tricks: NapoleonTrickRecord[];
  currentTurnSeat: GameSeat | null;
}

function deal(seats: GameSeat[], rng: () => number, options: NapoleonOptions, dealerSeat: GameSeat): Sim {
  const dealt = dealNapoleon(seats, shuffled(rng));
  const start = seats[(seats.indexOf(dealerSeat) + 1) % seats.length];
  return {
    seats, options, dealerSeat, phase: 'bidding', hands: dealt.hands, kitty: dealt.kitty, pickedUp: [], discards: [],
    bidding: createNapoleonBidding(start), contract: null, reviewed: [], secretaryCard: null, secretarySeat: null,
    trick: null, tricks: [], currentTurnSeat: start,
  };
}

function visibleFor(sim: Sim, seat: GameSeat, mergedExchange = false): NapoleonVisibleState {
  const napoleon = sim.contract?.napoleon === seat;
  const settled = sim.phase === 'scoring';
  const revealed = sim.secretaryCard !== null && hasNapoleonCard(napoleonPlayedCards(sim), sim.secretaryCard);
  const exchanging = sim.phase === 'exchanging' && napoleon;
  const myHand = exchanging && mergedExchange ? [...sim.hands[seat]!, ...sim.pickedUp] : sim.hands[seat]!;
  const afterExchange = !['bidding', 'exchanging'].includes(sim.phase);
  const view: NapoleonVisibleState = {
    gameType: 'napoleon',
    phase: sim.phase,
    options: sim.options,
    mySeat: seat,
    seats: sim.seats,
    dealerSeat: sim.dealerSeat,
    myHand,
    handCounts: Object.fromEntries(sim.seats.map((other) => [other, sim.hands[other]!.length])),
    pickedUp: exchanging ? sim.pickedUp : null,
    discards: afterExchange && (napoleon || napoleonDiscardsPublic(sim.seats.length) || settled) ? sim.discards : null,
    bidding: sim.bidding,
    contract: sim.contract,
    reviewed: sim.reviewed,
    reviewDeadline: null,
    secretaryCard: sim.secretaryCard,
    secretarySeat: sim.secretarySeat && (sim.secretarySeat === seat || revealed || settled) ? sim.secretarySeat : null,
    trick: sim.trick,
    tricks: sim.tricks,
    currentTurnSeat: sim.currentTurnSeat,
    validCards: [],
    log: [],
    result: null,
  };
  return { ...view, validCards: sim.phase === 'playing' && sim.currentTurnSeat === seat ? napoleonValidCards(view, seat, myHand) : [] };
}

/** Applies a bot action after checking it with the shared validators; throws on anything illegal. */
function apply(sim: Sim, seat: GameSeat, action: NapoleonAction): void {
  const contract = sim.contract;
  switch (action.type) {
    case 'bid': {
      const error = napoleonBidError(sim.bidding!, seat, action.action);
      if (error) throw new Error(`${seat} bid illegally: ${error}`);
      sim.bidding = applyNapoleonBid(sim.bidding!, sim.seats, seat, action.action);
      const end = napoleonBiddingEnd(sim.bidding, sim.seats.length);
      if (end === 'contract') {
        sim.contract = napoleonContract(sim.bidding);
        sim.phase = 'exchanging';
        sim.pickedUp = sim.kitty;
        sim.kitty = [];
        sim.currentTurnSeat = sim.contract!.napoleon;
      } else if (end === 'all_pass') {
        sim.phase = 'scoring';
        sim.currentTurnSeat = null;
      } else {
        sim.currentTurnSeat = sim.bidding.currentBidderSeat;
      }
      return;
    }
    case 'discard': {
      if (sim.phase !== 'exchanging' || contract?.napoleon !== seat) throw new Error(`${seat} cannot discard now.`);
      const pool = [...sim.hands[seat]!, ...sim.pickedUp];
      const error = napoleonDiscardError(pool, action.cards, napoleonDealSize(sim.seats.length).kitty);
      if (error) throw new Error(`${seat} discarded illegally: ${error}`);
      sim.hands[seat] = removeNapoleonCards(pool, action.cards);
      sim.discards = [...action.cards];
      sim.pickedUp = [];
      sim.phase = napoleonDiscardsPublic(sim.seats.length) ? 'reviewing' : 'calling';
      sim.currentTurnSeat = sim.phase === 'calling' ? seat : null;
      return;
    }
    case 'review': {
      if (sim.phase !== 'reviewing' || contract?.napoleon === seat || sim.reviewed.includes(seat)) {
        throw new Error(`${seat} cannot review now.`);
      }
      sim.reviewed.push(seat);
      if (sim.reviewed.length === sim.seats.length - 1) {
        sim.phase = 'calling';
        sim.currentTurnSeat = contract!.napoleon;
      }
      return;
    }
    case 'call': {
      if (sim.phase !== 'calling' || contract?.napoleon !== seat) throw new Error(`${seat} cannot call now.`);
      sim.secretaryCard = action.card;
      sim.secretarySeat = sim.seats.find((other) => other !== seat && hasNapoleonCard(sim.hands[other]!, action.card)) ?? null;
      sim.phase = 'playing';
      sim.trick = { leadSeat: seat, plays: [], leadSuit: null, summon: null };
      sim.currentTurnSeat = seat;
      return;
    }
    case 'play': {
      if (sim.phase !== 'playing' || sim.currentTurnSeat !== seat) throw new Error(`${seat} cannot play now.`);
      const discards = contract!.napoleon === seat ? sim.discards : null;
      const error = napoleonPlayError(visibleFor(sim, seat), seat, sim.hands[seat]!, action, discards);
      if (error) throw new Error(`${seat} played illegally: ${error}`);
      sim.hands[seat] = removeNapoleonCards(sim.hands[seat]!, [action.card]);
      const trick = applyNapoleonPlay(sim.trick!, seat, action);
      if (trick.plays.length < sim.seats.length) {
        sim.trick = trick;
        sim.currentTurnSeat = sim.seats[(sim.seats.indexOf(seat) + 1) % sim.seats.length];
        return;
      }
      const winnerSeat = napoleonTrickWinner(sim, trick, sim.tricks.length);
      sim.tricks = [...sim.tricks, { ...trick, leadSuit: trick.leadSuit!, winnerSeat }];
      if (sim.tricks.length === napoleonDealSize(sim.seats.length).hand) {
        sim.trick = null;
        sim.phase = 'scoring';
        sim.currentTurnSeat = null;
      } else {
        sim.trick = { leadSeat: winnerSeat, plays: [], leadSuit: null, summon: null };
        sim.currentTurnSeat = winnerSeat;
      }
      return;
    }
  }
}

function actingSeats(sim: Sim): GameSeat[] {
  if (sim.phase === 'reviewing') return sim.seats.filter((seat) => seat !== sim.contract!.napoleon && !sim.reviewed.includes(seat));
  return sim.currentTurnSeat ? [sim.currentTurnSeat] : [];
}

interface DealResult {
  readonly sim: Sim;
  readonly redeals: number;
  readonly outcome: ReturnType<typeof napoleonOutcome> | null;
}

/** Plays complete deals with bots until a contract is reached (or too many redeals) and settles it. */
function playDeal(
  playerCount: number, seed: number, difficulty: (seat: GameSeat) => BotDifficulty,
  options: NapoleonOptions = { jokerSummon: true }, mergedExchange = false,
): DealResult {
  const seats = ALL_SEATS.slice(0, playerCount);
  const rng = random(seed);
  const botRandom = random(seed * 7919 + 17);
  for (let redeals = 0; redeals < 20; redeals++) {
    const sim = deal(seats, rng, options, seats[seed % seats.length]);
    runSeededGame(`napoleon ${playerCount}p seed ${seed}`, 400, () => sim.phase === 'scoring', () => {
      const seat = actingSeats(sim)[0];
      for (const other of seats) {
        if (other !== seat && actingSeats(sim).includes(other) === false) {
          expect(getNapoleonBotAction(visibleFor(sim, other, mergedExchange), botRandom, difficulty(other))).toBeNull();
        }
      }
      const action = getNapoleonBotAction(visibleFor(sim, seat, mergedExchange), botRandom, difficulty(seat));
      if (!action) throw new Error(`${seat} returned no action in ${sim.phase}.`);
      apply(sim, seat, action);
    });
    if (!sim.contract) continue;
    expect(sim.seats.every((seat) => sim.hands[seat]!.length === 0)).toBe(true);
    return { sim, redeals, outcome: napoleonOutcome(seats, sim.contract, sim.secretarySeat, sim.tricks, sim.discards) };
  }
  return { sim: deal(seats, rng, options, seats[0]), redeals: 20, outcome: null };
}

function biddingView(seats: GameSeat[], seat: GameSeat, myHand: NapoleonCard[], bidding: NapoleonBiddingState): NapoleonVisibleState {
  const sim = deal(seats, random(1), { jokerSummon: true }, seats[seats.length - 1]);
  sim.hands[seat] = myHand;
  sim.bidding = bidding;
  return visibleFor(sim, seat);
}

/** A playing position with chosen hands, an optional trick history, and the trick in progress. */
function playingSim(options: {
  readonly seats?: GameSeat[];
  readonly hands: Partial<Record<GameSeat, NapoleonCard[]>>;
  readonly trump?: BidSuit;
  readonly napoleon?: GameSeat;
  readonly secretaryCard: NapoleonCard;
  readonly secretarySeat?: GameSeat | null;
  readonly tricks?: NapoleonTrickRecord[];
  readonly trick: NapoleonTrick;
  readonly discards?: NapoleonCard[];
}): Sim {
  const seats = options.seats ?? ['N', 'E', 'S', 'W'];
  const trick = options.trick;
  const next = seats[(seats.indexOf(trick.leadSeat) + trick.plays.length) % seats.length];
  return {
    seats, options: { jokerSummon: true }, dealerSeat: 'W', phase: 'playing', hands: options.hands, kitty: [], pickedUp: [],
    discards: options.discards ?? [card('clubs', 2), card('clubs', 3)], bidding: null,
    contract: { level: 12, suit: options.trump ?? 'spades', napoleon: options.napoleon ?? 'N' }, reviewed: [],
    secretaryCard: options.secretaryCard, secretarySeat: options.secretarySeat ?? null,
    trick, tricks: options.tricks ?? [], currentTurnSeat: next,
  };
}

/** Completed tricks of discarded low cards that only advance the trick index. */
function filler(count: number, seats: GameSeat[] = ['N', 'E', 'S', 'W']): NapoleonTrickRecord[] {
  const lows = [card('diamonds', 2), card('diamonds', 3), card('diamonds', 4), card('diamonds', 5), card('diamonds', 6),
    card('diamonds', 7), card('diamonds', 8), card('diamonds', 9), card('diamonds', 10), card('clubs', 4), card('clubs', 5),
    card('clubs', 6), card('clubs', 7), card('clubs', 8), card('clubs', 9), card('clubs', 10)];
  const records: NapoleonTrickRecord[] = [];
  for (let index = 0; index < count; index++) {
    const plays = seats.map((seat, offset) => ({ seat, card: lows[(index * seats.length + offset) % lows.length] }));
    records.push({ leadSeat: seats[0], plays, leadSuit: 'diamonds', summon: null, winnerSeat: seats[0] });
  }
  return records;
}

function playFor(sim: Sim, seed = 1, difficulty: BotDifficulty = 'hard'): Extract<NapoleonAction, { type: 'play' }> {
  const action = getNapoleonBotAction(visibleFor(sim, sim.currentTurnSeat!), random(seed), difficulty);
  if (action?.type !== 'play') throw new Error('Expected a play');
  return action;
}

describe('Napoleon bot legality', () => {
  it.each([4, 5, 6])('Hard bots finish %i-player deals with only legal actions', (players) => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(playDeal(players, seed * 101 + players, () => 'hard').outcome).not.toBeNull();
    }
  });

  it.each([4, 5, 6])('Easy and mixed tables finish %i-player deals with only legal actions', (players) => {
    for (let seed = 1; seed <= 20; seed++) {
      const mixed = (seat: GameSeat): BotDifficulty => (ALL_SEATS.indexOf(seat) + seed) % 2 === 0 ? 'easy' : 'hard';
      expect(playDeal(players, seed * 37 + players, seed % 3 === 0 ? () => 'easy' : mixed).outcome).not.toBeNull();
    }
  });

  it('plays legally without joker summons and with a merged exchange hand', () => {
    for (let seed = 1; seed <= 6; seed++) {
      expect(playDeal(4 + (seed % 3), seed * 13, () => 'hard', { jokerSummon: false }, true).outcome).not.toBeNull();
    }
  });

  it('returns null when the seat has nothing to do', () => {
    const sim = deal(['N', 'E', 'S', 'W'], random(3), { jokerSummon: true }, 'W');
    expect(getNapoleonBotAction(visibleFor(sim, 'E'), random(1), 'hard')).toBeNull();
    sim.phase = 'scoring';
    expect(getNapoleonBotAction(visibleFor(sim, 'N'), random(1), 'hard')).toBeNull();
  });
});

describe('Napoleon bidding', () => {
  const seats: GameSeat[] = ['N', 'E', 'S', 'W'];
  const strong = hand('BJ SJ SAKQJ93 HA DA C7 C5');

  it('Hard bids a strong trump hand at the lowest winning level', () => {
    expect(getNapoleonBotAction(biddingView(seats, 'N', strong, createNapoleonBidding('N')), random(1), 'hard'))
      .toEqual({ type: 'bid', action: { type: 'bid', level: 9, suit: 'spades' } });
    const bidding = applyNapoleonBid(createNapoleonBidding('W'), seats, 'W', { type: 'bid', level: 10, suit: 'hearts' });
    expect(getNapoleonBotAction(biddingView(seats, 'N', strong, bidding), random(1), 'hard'))
      .toEqual({ type: 'bid', action: { type: 'bid', level: 10, suit: 'spades' } });
  });

  it('Hard passes a weak hand and stops competing beyond its estimate', () => {
    const weak = hand('S9 S4 S2 H8 H6 H2 D9 D7 D3 C8 C6 C4 C3');
    expect(getNapoleonBotAction(biddingView(seats, 'N', weak, createNapoleonBidding('N')), random(1), 'hard'))
      .toEqual({ type: 'bid', action: { type: 'pass' } });
    const fair = hand('SJ SA S9 S6 S3 HA H7 D8 D4 C9 C6 C3 C2');
    const bidding = applyNapoleonBid(createNapoleonBidding('W'), seats, 'W', { type: 'bid', level: 14, suit: 'spades' });
    expect(getNapoleonBotAction(biddingView(seats, 'N', fair, bidding), random(1), 'hard'))
      .toEqual({ type: 'bid', action: { type: 'pass' } });
  });

  it('Easy opens only an obviously strong hand and never competes', () => {
    expect(getNapoleonBotAction(biddingView(seats, 'N', strong, createNapoleonBidding('N')), random(1), 'easy'))
      .toEqual({ type: 'bid', action: { type: 'bid', level: 9, suit: 'spades' } });
    const average = hand('SA S9 S6 S3 HK H7 D8 D4 C9 C6 C3 C2 H2');
    expect(getNapoleonBotAction(biddingView(seats, 'N', average, createNapoleonBidding('N')), random(1), 'easy'))
      .toEqual({ type: 'bid', action: { type: 'pass' } });
    const bidding = applyNapoleonBid(createNapoleonBidding('W'), seats, 'W', { type: 'bid', level: 9, suit: 'clubs' });
    expect(getNapoleonBotAction(biddingView(seats, 'N', strong, bidding), random(1), 'easy'))
      .toEqual({ type: 'bid', action: { type: 'pass' } });
  });
});

describe('Napoleon exchange and call', () => {
  function exchangeSim(myHand: NapoleonCard[], pickedUp: NapoleonCard[], suit: BidSuit, seats: GameSeat[] = ['N', 'E', 'S', 'W']): Sim {
    const sim = deal(seats, random(5), { jokerSummon: true }, 'W');
    sim.hands.N = myHand;
    sim.pickedUp = pickedUp;
    sim.contract = { level: 11, suit, napoleon: 'N' };
    sim.phase = 'exchanging';
    sim.currentTurnSeat = 'N';
    return sim;
  }
  const discardsOf = (action: NapoleonAction | null): readonly NapoleonCard[] => {
    if (action?.type !== 'discard') throw new Error('Expected a discard');
    return action.cards;
  };

  it('Hard keeps jokers, trumps, and points while emptying a short side suit', () => {
    const sim = exchangeSim(hand('BJ SAKQ86 HA HK D9 D4 C7 C5 C3'), hand('SJ D2'), 'spades');
    const discards = discardsOf(getNapoleonBotAction(visibleFor(sim, 'N'), random(1), 'hard'));
    expect(discards).toHaveLength(2);
    expect(discards.every((discarded) => !isNapoleonJoker(discarded) && discarded.suit === 'diamonds')).toBe(true);
  });

  it('Hard discards low side cards from a merged five-player hand', () => {
    const sim = exchangeSim(hand('BJ HAKQ86 SA C9 C4 D7'), hand('SJ D2 D5 HJ'), 'hearts', ['N', 'E', 'S', 'W', 'P5']);
    const discards = discardsOf(getNapoleonBotAction(visibleFor(sim, 'N', true), random(1), 'hard'));
    expect(discards).toHaveLength(4);
    expect(discards.every((discarded) => !isNapoleonJoker(discarded) && ['clubs', 'diamonds'].includes(discarded.suit))).toBe(true);
    expect(discards.filter((discarded) => !isNapoleonJoker(discarded) && discarded.suit === 'diamonds')).toHaveLength(3);
  });

  it('Easy discards legally and keeps its jokers', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = exchangeSim(hand('BJ HAKQ86 SA C9 C4 D7'), hand('SJ D2 D5 HJ'), 'hearts', ['N', 'E', 'S', 'W', 'P5']);
      const discards = discardsOf(getNapoleonBotAction(visibleFor(sim, 'N'), random(seed), 'easy'));
      expect(napoleonDiscardError([...sim.hands.N!, ...sim.pickedUp], discards, 4)).toBeNull();
      expect(discards.some(isNapoleonJoker)).toBe(false);
    }
  });

  it('Hard calls the strongest card it lacks and skips its discards; Easy only skips its hand', () => {
    const sim = exchangeSim([], [], 'hearts');
    sim.phase = 'calling';
    sim.hands.N = hand('BJ HAK97 SA');
    sim.discards = hand('SJ');
    expect(getNapoleonBotAction(visibleFor(sim, 'N'), random(1), 'hard')).toEqual({ type: 'call', card: card('hearts', 12) });
    expect(getNapoleonBotAction(visibleFor(sim, 'N'), random(1), 'easy')).toEqual({ type: 'call', card: SMALL });
    sim.hands.N = hand('HA');
    sim.discards = [];
    expect(getNapoleonBotAction(visibleFor(sim, 'N'), random(1), 'hard')).toEqual({ type: 'call', card: BIG });
  });

  it('acknowledges public discards once and only as a non-Napoleon', () => {
    const sim = exchangeSim([], [], 'hearts');
    sim.phase = 'reviewing';
    sim.currentTurnSeat = null;
    expect(getNapoleonBotAction(visibleFor(sim, 'E'), random(1), 'easy')).toEqual({ type: 'review' });
    expect(getNapoleonBotAction(visibleFor(sim, 'N'), random(1), 'hard')).toBeNull();
    sim.reviewed = ['E'];
    expect(getNapoleonBotAction(visibleFor(sim, 'E'), random(1), 'hard')).toBeNull();
  });
});

describe('Napoleon Hard play', () => {
  const heartsTrick = (plays: [GameSeat, NapoleonCard][]): NapoleonTrick => ({
    leadSeat: plays[0][0], leadSuit: 'hearts', summon: null, plays: plays.map(([seat, played]) => ({ seat, card: played })),
  });

  it('the secretary feeds a point card onto the Napoleon\'s winning trick', () => {
    const sim = playingSim({
      hands: { N: hand('S5 S4'), E: hand('HK HQ H3'), S: hand('C9 C8'), W: hand('D8 D9') },
      trump: 'spades', secretaryCard: card('hearts', 13), secretarySeat: 'E', tricks: filler(10),
      trick: heartsTrick([['S', card('hearts', 5)], ['W', card('hearts', 4)], ['N', card('hearts', 14)]]),
    });
    expect(playFor(sim).card).toEqual(card('hearts', 12));
  });

  it('a defender sheds a low card instead of feeding the Napoleon', () => {
    const sim = playingSim({
      hands: { N: hand('S5 S4'), E: hand('HQ H3 D7'), S: hand('C9 C8'), W: hand('D8 D9') },
      trump: 'spades', secretaryCard: BIG, tricks: filler(10),
      trick: heartsTrick([['S', card('hearts', 5)], ['W', card('hearts', 4)], ['N', card('hearts', 14)]]),
    });
    expect(playFor(sim).card).toEqual(card('hearts', 3));
  });

  it('a defender wins a point trick cheaply as the last to play', () => {
    const sim = playingSim({
      hands: { N: hand('S5'), E: hand('S6'), S: hand('S7'), W: hand('HA H9 S2 S8') },
      trump: 'spades', secretaryCard: BIG, tricks: filler(9),
      trick: heartsTrick([['N', card('hearts', 13)], ['E', card('hearts', 2)], ['S', card('hearts', 4)]]),
    });
    expect(playFor(sim).card).toEqual(card('hearts', 14));
  });

  it('dumps a joker on the last trick before jokers lose their strength', () => {
    const sim = playingSim({
      hands: { N: hand('SJ H9 C2 C3'), E: hand('D7 D8 D9 DT'), S: hand('C9 C8 C7 C6'), W: hand('H3 H4 H5 H6') },
      trump: 'spades', secretaryCard: card('spades', 14), tricks: filler(9),
      trick: { leadSeat: 'N', plays: [], leadSuit: null, summon: null },
    });
    expect(isNapoleonFinalTrick(9, 4)).toBe(false);
    expect(isNapoleonFinalTrick(10, 4)).toBe(true);
    const action = playFor(sim);
    expect(action.card).toEqual(SMALL);
    expect(action.leadSuit).toBeDefined();
  });

  it('the Napoleon draws trumps with a joker that names the trump suit', () => {
    const sim = playingSim({
      hands: { N: hand('BJ SAKQ987 HA HK DA C5 C3 C2'), E: Array(13).fill(card('clubs', 4)), S: Array(13).fill(card('clubs', 4)), W: Array(13).fill(card('clubs', 4)) },
      trump: 'spades', secretaryCard: SMALL, discards: hand('D2 D3'),
      trick: { leadSeat: 'N', plays: [], leadSuit: null, summon: null },
    });
    const action = playFor(sim);
    expect(action.leadSuit ?? (isNapoleonJoker(action.card) ? null : action.card.suit)).toBe('spades');
  });

  it('the Napoleon summons the secretary to save an unprotected point card near the end', () => {
    const sim = playingSim({
      hands: { N: hand('HK C2'), E: hand('BJ D4'), S: hand('C9 C8'), W: hand('D8 D9') },
      trump: 'spades', secretaryCard: BIG, tricks: filler(11),
      trick: { leadSeat: 'N', plays: [], leadSuit: null, summon: null },
    });
    expect(playFor(sim)).toEqual({ type: 'play', card: card('hearts', 13), summon: 'secretary' });
  });

  it('ignores observer hands and the secretary seat it cannot see', () => {
    const sim = playingSim({
      hands: { N: hand('SJ H9 C2 C3'), E: hand('D7 D8 D9 DT'), S: hand('C9 C8 C7 C6'), W: hand('H3 H4 H5 H6') },
      trump: 'spades', secretaryCard: card('spades', 14), tricks: filler(8),
      trick: { leadSeat: 'W', plays: [{ seat: 'W', card: card('hearts', 3) }], leadSuit: 'hearts', summon: null },
    });
    const plain = visibleFor(sim, 'N');
    const leaked: NapoleonVisibleState = { ...plain, observedHands: { E: hand('SA'), S: [], W: [] } };
    for (let seed = 1; seed <= 5; seed++) {
      expect(getNapoleonBotAction(leaked, random(seed), 'hard')).toEqual(getNapoleonBotAction(plain, random(seed), 'hard'));
    }
  });
});

describe('Napoleon bot strength', () => {
  /** Napoleon N plays its longest suit at level 9; returns the side's point cards. */
  function forcedDeal(players: number, seed: number, side: BotDifficulty, defense: BotDifficulty): number {
    const seats = ALL_SEATS.slice(0, players);
    const sim = deal(seats, random(seed), { jokerSummon: true }, seats[seats.length - 1]);
    const suits: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
    const length = (suit: Suit): number => sim.hands.N!.filter((held) => !isNapoleonJoker(held) && held.suit === suit).length;
    sim.contract = { level: 9, suit: suits.reduce((best, suit) => length(suit) > length(best) ? suit : best), napoleon: 'N' };
    sim.phase = 'exchanging';
    sim.pickedUp = sim.kitty;
    sim.kitty = [];
    sim.currentTurnSeat = 'N';
    const botRandom = random(seed + 1);
    runSeededGame(`forced ${seed}`, 400, () => sim.phase === 'scoring', () => {
      const seat = actingSeats(sim)[0];
      const level = seat === 'N' || seat === sim.secretarySeat ? side : defense;
      apply(sim, seat, getNapoleonBotAction(visibleFor(sim, seat), botRandom, level)!);
    });
    return napoleonOutcome(seats, sim.contract, sim.secretarySeat, sim.tricks, sim.discards).napoleonPoints;
  }

  it.each([4, 6])('Hard outplays Easy on both sides with %i players', (players) => {
    let hardSide = 0;
    let easySide = 0;
    for (let seed = 1; seed <= 30; seed++) {
      hardSide += forcedDeal(players, seed * 17 + players, 'hard', 'easy');
      easySide += forcedDeal(players, seed * 17 + players, 'easy', 'hard');
    }
    expect((hardSide - easySide) / 30).toBeGreaterThan(3);
  });
});
