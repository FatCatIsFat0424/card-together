// ─── Napoleon Game: auction, exchange, secretary call, and tricks for four to six players ───

import { randomInt, randomUUID } from 'node:crypto';
import type {
  GameSeat,
  NapoleonAction,
  NapoleonBidAction,
  NapoleonCard,
  NapoleonGameState,
  NapoleonOptions,
  NapoleonSummon,
  NapoleonTrick,
  NapoleonVisibleState,
  PlayerInfo,
  RoomCode,
  Suit,
} from '@shared/types';
import { DEFAULT_NAPOLEON_OPTIONS } from '@shared/napoleon-options';
import { occupiedSeats } from '@shared/rules/seats';
import {
  applyNapoleonBid,
  applyNapoleonPlay,
  createNapoleonBidding,
  createNapoleonDeck,
  dealNapoleon,
  hasNapoleonCard,
  isNapoleonJoker,
  napoleonBidError,
  napoleonBiddingEnd,
  napoleonContract,
  napoleonDealSize,
  napoleonDiscardError,
  napoleonDiscardsPublic,
  napoleonOutcome,
  napoleonPlayError,
  napoleonPlayedCards,
  napoleonTrickWinner,
  napoleonValidCards,
  nextNapoleonSeat,
  removeNapoleonCards,
  sameNapoleonCard,
  sortNapoleonHand,
  withNapoleonJokerSummon,
} from '@shared/rules/napoleon';
import { shuffleDeck } from '../../engine/deck';

type Result = { success: true } | { success: false; reason: string };

/** Deals stay unpredictable from previously observed shuffles. */
const RANDOM_RANGE = 2 ** 32;
const secureRandom = (): number => randomInt(RANDOM_RANGE) / RANDOM_RANGE;

/** roomCode → NapoleonGameState */
const games: Map<RoomCode, NapoleonGameState> = new Map();

export function shuffleNapoleonDeck(random: () => number = secureRandom): NapoleonCard[] {
  return shuffleDeck(createNapoleonDeck(), random);
}

function fail(reason: string): Result {
  return { success: false, reason };
}

/** Rebuilds a card so caller-supplied extra keys never reach saved state. */
function copyCard(card: NapoleonCard): NapoleonCard {
  return isNapoleonJoker(card) ? { joker: card.joker } : { suit: card.suit, rank: card.rank };
}

function copyBid(action: NapoleonBidAction): NapoleonBidAction {
  return action.type === 'pass' ? { type: 'pass' } : { type: 'bid', level: action.level, suit: action.suit };
}

function emptyTrick(leadSeat: GameSeat): NapoleonTrick {
  return { leadSeat, plays: [], leadSuit: null, summon: null };
}

function sortHands(game: NapoleonGameState): void {
  const trump = game.contract?.suit ?? null;
  for (const seat of game.seats) game.hands[seat] = sortNapoleonHand(game.hands[seat] ?? [], trump);
}

/** Deals a fresh shuffle and opens the auction with the seat after the unchanged dealer. */
function deal(game: NapoleonGameState, deck: readonly NapoleonCard[], now: number): void {
  const dealt = dealNapoleon(game.seats, deck);
  game.hands = dealt.hands;
  sortHands(game);
  game.kitty = dealt.kitty;
  game.pickedUp = [];
  const opener = nextNapoleonSeat(game.seats, game.dealerSeat);
  game.bidding = createNapoleonBidding(opener);
  game.currentTurnSeat = opener;
  game.log.push({ type: 'deal', dealerSeat: game.dealerSeat, timestamp: now });
}

/** Whether the Napoleon has already returned the table cards, so `kitty` holds the discards. */
export function isExchanged(game: NapoleonGameState): boolean {
  return game.phase !== 'bidding' && game.phase !== 'exchanging';
}

/** Participants who still owe an acknowledgment of the public discards, ordered N, E, S, W, P5, P6. */
export function pendingReviewSeats(game: NapoleonGameState): GameSeat[] {
  if (game.phase !== 'reviewing' || !game.contract) return [];
  const napoleon = game.contract.napoleon;
  return game.seats.filter((seat) => seat !== napoleon && !game.reviewed.includes(seat));
}

function startCalling(game: NapoleonGameState): void {
  game.phase = 'calling';
  game.reviewDeadline = null;
  game.currentTurnSeat = game.contract?.napoleon ?? null;
}

/**
 * Seats missing from `players` stay empty; four to six seats take part. `deck` and `dealerSeat`
 * are test hooks; games normally deal a fresh shuffle from a random dealer.
 */
export function startGame(
  roomCode: RoomCode,
  players: Partial<Record<GameSeat, PlayerInfo>>,
  options: NapoleonOptions = DEFAULT_NAPOLEON_OPTIONS,
  deck: readonly NapoleonCard[] = shuffleNapoleonDeck(),
  dealerSeat?: GameSeat,
  now: number = Date.now(),
): void {
  const seats = occupiedSeats(players);
  napoleonDealSize(seats.length);
  const dealer = dealerSeat ?? seats[randomInt(seats.length)];
  if (!seats.includes(dealer)) throw new RangeError(`The dealer ${dealer} does not take part.`);
  const game: NapoleonGameState = {
    gameType: 'napoleon',
    id: randomUUID(),
    startedAt: now,
    players: structuredClone(players),
    roomCode,
    options: { jokerSummon: options.jokerSummon },
    seats,
    phase: 'bidding',
    dealerSeat: dealer,
    hands: {},
    kitty: [],
    pickedUp: [],
    bidding: null,
    contract: null,
    reviewed: [],
    reviewDeadline: null,
    secretaryCard: null,
    secretarySeat: null,
    trick: null,
    tricks: [],
    currentTurnSeat: null,
    log: [],
    result: null,
  };
  deal(game, deck, now);
  games.set(roomCode, game);
}

function bid(
  game: NapoleonGameState, seat: GameSeat, action: NapoleonBidAction, now: number, shuffle: () => NapoleonCard[],
): Result {
  if (game.phase !== 'bidding' || !game.bidding) return fail('Not in bidding phase');
  const error = napoleonBidError(game.bidding, seat, action);
  if (error) return fail(error);
  const entry = copyBid(action);
  game.bidding = applyNapoleonBid(game.bidding, game.seats, seat, entry);
  game.log.push({ type: 'bid', seat, action: entry, timestamp: now });
  const end = napoleonBiddingEnd(game.bidding, game.seats.length);
  if (end === 'all_pass') {
    deal(game, shuffle(), now);
  } else if (end === 'contract') {
    const contract = napoleonContract(game.bidding);
    if (!contract) throw new Error('Napoleon auction ended without a bid');
    game.contract = contract;
    // The Napoleon privately picks up the table cards; `kitty` keeps them until the exchange.
    game.pickedUp = [...game.kitty];
    game.hands[contract.napoleon] = [...(game.hands[contract.napoleon] ?? []), ...game.kitty];
    sortHands(game);
    game.phase = 'exchanging';
    game.currentTurnSeat = contract.napoleon;
  } else {
    game.currentTurnSeat = game.bidding.currentBidderSeat;
  }
  return { success: true };
}

/**
 * With four players the discards are public and every other human acknowledges them before the
 * call; bots acknowledge at once, and `reviewMs` bounds the wait for the rest.
 */
function discard(
  game: NapoleonGameState, seat: GameSeat, cards: readonly NapoleonCard[], reviewMs: number, now: number,
): Result {
  if (game.phase !== 'exchanging' || !game.contract) return fail('Not in exchange phase');
  if (seat !== game.contract.napoleon) return fail('Only the Napoleon exchanges cards.');
  const hand = game.hands[seat] ?? [];
  const error = napoleonDiscardError(hand, cards, napoleonDealSize(game.seats.length).kitty);
  if (error) return fail(error);
  const discards = cards.map(copyCard);
  game.hands[seat] = removeNapoleonCards(hand, discards);
  game.kitty = sortNapoleonHand(discards, game.contract.suit);
  game.pickedUp = [];
  game.log.push({ type: 'exchange', seat, timestamp: now });
  if (!napoleonDiscardsPublic(game.seats.length)) {
    startCalling(game);
    return { success: true };
  }
  const napoleon = game.contract.napoleon;
  game.phase = 'reviewing';
  game.reviewed = game.seats.filter((other) => other !== napoleon && game.players[other]?.isBot === true);
  game.reviewDeadline = now + reviewMs;
  game.currentTurnSeat = null;
  if (pendingReviewSeats(game).length === 0) startCalling(game);
  return { success: true };
}

function review(game: NapoleonGameState, seat: GameSeat): Result {
  if (game.phase !== 'reviewing') return fail('Not in review phase');
  if (!pendingReviewSeats(game).includes(seat)) return fail('Nothing to acknowledge.');
  game.reviewed = game.seats.filter((other) => other === seat || game.reviewed.includes(other));
  if (pendingReviewSeats(game).length === 0) startCalling(game);
  return { success: true };
}

/** A card the Napoleon holds or discarded leaves the Napoleon without a secretary; nobody is told. */
function call(game: NapoleonGameState, seat: GameSeat, card: NapoleonCard, now: number): Result {
  if (game.phase !== 'calling' || !game.contract) return fail('Not in calling phase');
  const napoleon = game.contract.napoleon;
  if (seat !== napoleon) return fail('Only the Napoleon names the secretary card.');
  const secretaryCard = copyCard(card);
  game.secretaryCard = secretaryCard;
  game.secretarySeat = game.seats.find((other) => other !== napoleon
    && hasNapoleonCard(game.hands[other] ?? [], secretaryCard)) ?? null;
  game.log.push({ type: 'call', seat, card: secretaryCard, timestamp: now });
  game.phase = 'playing';
  game.trick = emptyTrick(napoleon);
  game.currentTurnSeat = napoleon;
  return { success: true };
}

function play(
  game: NapoleonGameState, seat: GameSeat,
  action: { readonly card: NapoleonCard; readonly leadSuit?: Suit; readonly summon?: NapoleonSummon }, now: number,
): Result {
  if (game.phase !== 'playing' || !game.trick || !game.contract) return fail('Not in playing phase');
  if (game.currentTurnSeat !== seat) return fail('Not your turn');
  const hand = game.hands[seat] ?? [];
  // A led trump 2 or 3 summons its joker whether or not the client asked for it.
  const move = withNapoleonJokerSummon(game, hand, {
    card: copyCard(action.card),
    ...(action.leadSuit !== undefined ? { leadSuit: action.leadSuit } : {}),
    ...(action.summon !== undefined ? { summon: action.summon } : {}),
  });
  const error = napoleonPlayError(game, seat, hand, move, game.kitty);
  if (error) return fail(error);
  game.hands[seat] = removeNapoleonCards(hand, [move.card]);
  game.trick = applyNapoleonPlay(game.trick, seat, move);
  game.log.push({ type: 'play', seat, ...move, timestamp: now });
  if (game.trick.plays.length < game.seats.length) {
    game.currentTurnSeat = nextNapoleonSeat(game.seats, seat);
    return { success: true };
  }
  const trick = game.trick;
  if (!trick.leadSuit) throw new Error('Napoleon trick finished without a lead suit');
  const winnerSeat = napoleonTrickWinner(game, trick, game.tricks.length);
  game.tricks.push({ ...trick, leadSuit: trick.leadSuit, winnerSeat });
  game.log.push({ type: 'trick_end', winnerSeat, trickIndex: game.tricks.length, timestamp: now });
  if (game.tricks.length < napoleonDealSize(game.seats.length).hand) {
    game.trick = emptyTrick(winnerSeat);
    game.currentTurnSeat = winnerSeat;
    return { success: true };
  }
  finish(game);
  return { success: true };
}

function finish(game: NapoleonGameState): void {
  const contract = game.contract;
  const secretaryCard = game.secretaryCard;
  if (!contract || !secretaryCard) throw new Error('Napoleon match finished without a contract');
  const outcome = napoleonOutcome(game.seats, contract, game.secretarySeat, game.tricks, game.kitty);
  game.phase = 'scoring';
  game.trick = null;
  game.currentTurnSeat = null;
  game.result = {
    gameType: 'napoleon',
    seats: [...game.seats],
    contract,
    secretaryCard,
    secretarySeat: game.secretarySeat,
    points: outcome.points,
    discards: [...game.kitty],
    discardPoints: outcome.discardPoints,
    napoleonPoints: outcome.napoleonPoints,
    defenderPoints: outcome.defenderPoints,
    napoleonWins: outcome.napoleonWins,
    winners: outcome.winners,
  };
}

/**
 * `reviewMs` sets the shared acknowledgment window opened by a public discard. `shuffle` is a
 * test hook for the redeal after an all-pass auction.
 */
export function act(
  roomCode: RoomCode,
  seat: GameSeat,
  action: NapoleonAction,
  reviewMs: number,
  now: number = Date.now(),
  shuffle: () => NapoleonCard[] = shuffleNapoleonDeck,
): Result {
  const game = games.get(roomCode);
  if (!game) return fail('Game not found');
  if (!game.seats.includes(seat)) return fail('You are not playing in this game.');
  switch (action.type) {
    case 'bid': return bid(game, seat, action.action, now, shuffle);
    case 'discard': return discard(game, seat, action.cards, reviewMs, now);
    case 'review': return review(game, seat);
    case 'call': return call(game, seat, action.card, now);
    case 'play': return play(game, seat, action, now);
  }
}

export function abortGame(roomCode: RoomCode): void {
  games.delete(roomCode);
}

function secretaryPlayed(game: NapoleonGameState): boolean {
  const secretaryCard = game.secretaryCard;
  return secretaryCard !== null && napoleonPlayedCards(game).some((card) => sameNapoleonCard(card, secretaryCard));
}

/**
 * Only the seat's own hand. The table cards reach the Napoleon alone; discards also reach everyone
 * with four players and at settlement. The secretary seat reaches only the secretary until its
 * card is played or the match is settled, so even the Napoleon does not learn it from the state.
 */
export function getPlayerVisibleState(roomCode: RoomCode, seat: GameSeat): NapoleonVisibleState | null {
  const game = games.get(roomCode);
  if (!game) return null;
  const napoleon = game.contract?.napoleon ?? null;
  const settled = game.phase === 'scoring';
  const discardsShown = isExchanged(game) && (seat === napoleon || napoleonDiscardsPublic(game.seats.length) || settled);
  const secretaryShown = game.secretarySeat !== null && (seat === game.secretarySeat || settled || secretaryPlayed(game));
  const hand = game.hands[seat] ?? [];
  return {
    gameType: 'napoleon',
    phase: game.phase,
    options: game.options,
    mySeat: seat,
    seats: [...game.seats],
    dealerSeat: game.dealerSeat,
    myHand: sortNapoleonHand(hand, game.contract?.suit ?? null),
    handCounts: Object.fromEntries(game.seats.map((other) => [other, game.hands[other]?.length ?? 0])),
    pickedUp: game.phase === 'exchanging' && seat === napoleon ? [...game.pickedUp] : null,
    discards: discardsShown ? [...game.kitty] : null,
    bidding: game.bidding,
    contract: game.contract,
    reviewed: [...game.reviewed],
    reviewDeadline: game.reviewDeadline,
    secretaryCard: game.secretaryCard,
    secretarySeat: secretaryShown ? game.secretarySeat : null,
    trick: game.trick,
    tricks: game.tricks,
    currentTurnSeat: game.currentTurnSeat,
    validCards: game.phase === 'playing' && game.currentTurnSeat === seat ? napoleonValidCards(game, seat, hand) : [],
    log: game.log,
    result: game.result,
  };
}

/**
 * God-view additions for spectators, who see every hand: the secretary seat, the table cards while
 * the Napoleon holds them, and the discards. The face-down cards stay hidden during the auction.
 */
export function getObserverView(game: NapoleonGameState): Pick<
  NapoleonVisibleState, 'observedHands' | 'secretarySeat' | 'pickedUp' | 'discards'
> {
  return {
    observedHands: Object.fromEntries(game.seats.map((seat) => [seat, sortNapoleonHand(game.hands[seat] ?? [],
      game.contract?.suit ?? null)])),
    secretarySeat: game.secretarySeat,
    pickedUp: game.phase === 'exchanging' ? [...game.pickedUp] : null,
    discards: isExchanged(game) ? [...game.kitty] : null,
  };
}

export function getGameState(roomCode: RoomCode): NapoleonGameState | null {
  return games.get(roomCode) ?? null;
}

export function exportGames(): NapoleonGameState[] {
  return [...games.values()];
}

export function restoreGames(records: NapoleonGameState[]): void {
  games.clear();
  for (const game of records) games.set(game.roomCode, game);
}
