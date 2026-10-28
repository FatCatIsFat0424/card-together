import { GAME_DEFINITIONS } from '@shared/games/registry';
import type {
  NapoleonCard, NapoleonBidLevel, GameSeat, NapoleonContract, NapoleonGameState, NapoleonBiddingState,
  NapoleonTrick, NapoleonTrickRecord,
} from '@shared/types';
import {
  isNapoleonCard, NAPOLEON_BID_LEVELS, napoleonCardKey, napoleonDealSize, NAPOLEON_POINT_CARDS, napoleonSide,
  napoleonPoints, createNapoleonBidding, nextNapoleonSeat, napoleonBidError, applyNapoleonBid,
  napoleonBiddingEnd, napoleonContract, hasNapoleonCard, napoleonPlayError, removeNapoleonCards,
  applyNapoleonPlay, napoleonTrickWinner, napoleonDiscardsPublic, napoleonOutcome,
} from '@shared/rules/napoleon';
import {
  object, oneOf, suits, number, gameSeatList, sameJson, gameSeats, gameSeatCounts, text, distinctPlayers,
} from '../../runtime/validation-helpers';
import type { ObjectValue, PlayerValidator } from '../../runtime/validation-helpers';
import { isNapoleonOptions } from '@shared/napoleon-options';
import type { NapoleonPlayView } from '@shared/rules/napoleon';

const napoleonSeats = GAME_DEFINITIONS.napoleon.seats;

// ─── Napoleon ───

const NAPOLEON_PHASES = ['bidding', 'exchanging', 'reviewing', 'calling', 'playing', 'scoring'];

const NAPOLEON_SUMMONS = ['secretary', 'bigJoker', 'smallJoker'];

function napoleonCards(value: unknown, max: number): value is NapoleonCard[] {
  return Array.isArray(value) && value.length <= max && value.every(isNapoleonCard);
}

function napoleonBid(value: unknown): boolean {
  if (!object(value)) return false;
  return value.type === 'pass' || (value.type === 'bid'
    && NAPOLEON_BID_LEVELS.includes(value.level as NapoleonBidLevel) && oneOf(value.suit, [...suits, 'nt']));
}

function napoleonContractValue(value: unknown, participants: GameSeat[]): value is NapoleonContract {
  return object(value) && napoleonBid({ type: 'bid', level: value.level, suit: value.suit })
    && oneOf(value.napoleon, participants);
}

function napoleonBiddingValue(value: unknown, participants: GameSeat[]): boolean {
  return object(value) && oneOf(value.currentBidderSeat, participants) && number(value.consecutivePassCount)
    && value.consecutivePassCount <= participants.length
    && (value.highestBid === null || (object(value.highestBid)
      && napoleonBid({ type: 'bid', level: value.highestBid.level, suit: value.highestBid.suit })
      && oneOf(value.highestBid.seat, participants)))
    && Array.isArray(value.bids)
    && value.bids.every((entry: unknown) => object(entry) && oneOf(entry.seat, participants) && napoleonBid(entry.action));
}

function napoleonTrickValue(value: unknown, participants: GameSeat[], complete: boolean): boolean {
  return object(value) && oneOf(value.leadSeat, participants) && Array.isArray(value.plays)
    && value.plays.length <= participants.length
    && value.plays.every((play: unknown) => object(play) && oneOf(play.seat, participants) && isNapoleonCard(play.card))
    && (value.leadSuit === null ? !complete : oneOf(value.leadSuit, suits))
    && (value.summon === null || oneOf(value.summon, NAPOLEON_SUMMONS))
    && (!complete || (value.plays.length === participants.length && oneOf(value.winnerSeat, participants)));
}

function napoleonLog(value: unknown, participants: GameSeat[]): boolean {
  if (!object(value) || !number(value.timestamp)) return false;
  switch (value.type) {
    case 'deal': return oneOf(value.dealerSeat, participants);
    case 'bid': return oneOf(value.seat, participants) && napoleonBid(value.action);
    case 'exchange': return oneOf(value.seat, participants);
    case 'call': return oneOf(value.seat, participants) && isNapoleonCard(value.card);
    case 'play':
      return oneOf(value.seat, participants) && isNapoleonCard(value.card)
        && (value.leadSuit === undefined || oneOf(value.leadSuit, suits))
        && (value.summon === undefined || oneOf(value.summon, NAPOLEON_SUMMONS));
    case 'trick_end': return oneOf(value.winnerSeat, participants) && number(value.trickIndex) && value.trickIndex >= 1;
    default: return false;
  }
}

function distinctNapoleonCards(cards: readonly NapoleonCard[]): boolean {
  return new Set(cards.map(napoleonCardKey)).size === cards.length;
}

/**
 * Napoleon result: the discards fill the table, the sides' point cards add up to all sixteen, and
 * the winners follow from the Napoleon side's total against the contract.
 */
export function isNapoleonResult(value: unknown): boolean {
  if (!object(value) || value.gameType !== 'napoleon' || !gameSeatList(value.seats)) return false;
  const participants = value.seats;
  if (participants.length < napoleonSeats.minPlayers || participants.length > napoleonSeats.maxPlayers
    || !sameJson(participants, gameSeats.filter((seat) => participants.includes(seat)))) return false;
  const contract = value.contract;
  const secretarySeat = value.secretarySeat;
  const kittySize = napoleonDealSize(participants.length).kitty;
  if (!napoleonContractValue(contract, participants) || !isNapoleonCard(value.secretaryCard)
    || !(secretarySeat === null || (oneOf(secretarySeat, participants) && secretarySeat !== contract.napoleon))
    || !gameSeatCounts(value.points, NAPOLEON_POINT_CARDS)
    || !napoleonCards(value.discards, kittySize) || value.discards.length !== kittySize
    || !distinctNapoleonCards(value.discards)) return false;
  const points = value.points;
  if (gameSeats.some((seat) => !participants.includes(seat) && points[seat] !== 0)) return false;
  const side = napoleonSide(contract, secretarySeat as GameSeat | null);
  const discardPoints = napoleonPoints(value.discards);
  const napoleonTotal = side.reduce((total, seat) => total + points[seat], 0);
  const defenderTotal = participants.filter((seat) => !side.includes(seat))
    .reduce((total, seat) => total + points[seat], discardPoints);
  const napoleonWins = napoleonTotal >= contract.level;
  return napoleonTotal + defenderTotal === NAPOLEON_POINT_CARDS && sameJson(
    { discardPoints: value.discardPoints, napoleonPoints: value.napoleonPoints, defenderPoints: value.defenderPoints,
      napoleonWins: value.napoleonWins, winners: value.winners },
    { discardPoints, napoleonPoints: napoleonTotal, defenderPoints: defenderTotal, napoleonWins,
      winners: participants.filter((seat) => side.includes(seat) === napoleonWins) },
  );
}

export function napoleonGame(value: ObjectValue, player: PlayerValidator): boolean {
  if (!text(value.id) || !text(value.roomCode) || !number(value.startedAt) || !object(value.players)) return false;
  const players = value.players;
  const keys = Object.keys(players);
  if (!keys.every((key) => oneOf(key, gameSeats) && player(players[key]))) return false;
  const participants = gameSeats.filter((seat) => keys.includes(seat));
  if (participants.length < napoleonSeats.minPlayers || participants.length > napoleonSeats.maxPlayers) return false;
  const { hand, kitty } = napoleonDealSize(participants.length);
  const hands = value.hands;
  return isNapoleonOptions(value.options) && sameJson(value.seats, participants)
    && oneOf(value.phase, NAPOLEON_PHASES) && oneOf(value.dealerSeat, participants)
    && object(hands) && Object.keys(hands).every((seat) => oneOf(seat, participants))
    && participants.every((seat) => napoleonCards(hands[seat], hand + kitty))
    && napoleonCards(value.kitty, kitty) && napoleonCards(value.pickedUp, kitty)
    && (value.bidding === null || napoleonBiddingValue(value.bidding, participants))
    && (value.contract === null || napoleonContractValue(value.contract, participants))
    && gameSeatList(value.reviewed) && value.reviewed.every((seat) => participants.includes(seat))
    && (value.reviewDeadline === null || number(value.reviewDeadline))
    && (value.secretaryCard === null || isNapoleonCard(value.secretaryCard))
    && (value.secretarySeat === null || oneOf(value.secretarySeat, participants))
    && (value.trick === null || napoleonTrickValue(value.trick, participants, false))
    && Array.isArray(value.tricks) && value.tricks.length <= hand
    && value.tricks.every((entry: unknown) => napoleonTrickValue(entry, participants, true))
    && (value.currentTurnSeat === null || oneOf(value.currentTurnSeat, participants))
    && Array.isArray(value.log) && value.log.every((entry: unknown) => napoleonLog(entry, participants))
    && (value.result === null || isNapoleonResult(value.result));
}

/**
 * Replaying the public log reproduces the auction since the latest deal, the exchange and call by
 * the Napoleon, every legal play and trick winner, and the settlement; hands, table cards, and
 * played cards account for all 54 cards.
 */
export function coherentNapoleonGame(state: NapoleonGameState): boolean {
  if (!distinctPlayers(state.players)) return false;
  const participants = state.seats;
  const { hand: handSize, kitty: kittySize } = napoleonDealSize(participants.length);
  const playedBy = (seat: GameSeat): NapoleonCard[] => state.log.flatMap((entry) =>
    entry.type === 'play' && entry.seat === seat ? [entry.card] : []);
  // Hands as they stood when the secretary card was named, before any card was played.
  const held = Object.fromEntries(participants.map((seat) => [seat, [...(state.hands[seat] ?? []), ...playedBy(seat)]])) as
    Partial<Record<GameSeat, NapoleonCard[]>>;
  let stage: 'deal' | 'bidding' | 'exchanging' | 'exchanged' | 'playing' = 'deal';
  let bidding: NapoleonBiddingState | null = null;
  let contract: NapoleonContract | null = null;
  let trick: NapoleonTrick | null = null;
  const tricks: NapoleonTrickRecord[] = [];
  let turn: GameSeat | null = null;
  const view = (): NapoleonPlayView => ({
    seats: participants, options: state.options, contract, secretaryCard: state.secretaryCard, trick, tricks,
  });
  for (const entry of state.log) {
    if (entry.type === 'deal') {
      if (stage !== 'deal' || entry.dealerSeat !== state.dealerSeat) return false;
      bidding = createNapoleonBidding(nextNapoleonSeat(participants, state.dealerSeat));
      stage = 'bidding';
    } else if (entry.type === 'bid') {
      if (stage !== 'bidding' || !bidding || napoleonBidError(bidding, entry.seat, entry.action) !== null) return false;
      bidding = applyNapoleonBid(bidding, participants, entry.seat, entry.action);
      const end = napoleonBiddingEnd(bidding, participants.length);
      if (end === 'all_pass') stage = 'deal';
      else if (end === 'contract') {
        contract = napoleonContract(bidding);
        stage = 'exchanging';
      }
    } else if (entry.type === 'exchange') {
      if (stage !== 'exchanging' || entry.seat !== contract?.napoleon) return false;
      stage = 'exchanged';
    } else if (entry.type === 'call') {
      const secretaryCard = state.secretaryCard;
      if (stage !== 'exchanged' || !contract || entry.seat !== contract.napoleon || !secretaryCard
        || !sameJson(entry.card, secretaryCard)) return false;
      const napoleon = contract.napoleon;
      const secretarySeat = participants.find((seat) => seat !== napoleon
        && hasNapoleonCard(held[seat] ?? [], secretaryCard)) ?? null;
      if (state.secretarySeat !== secretarySeat) return false;
      trick = { leadSeat: napoleon, plays: [], leadSuit: null, summon: null };
      turn = napoleon;
      stage = 'playing';
    } else if (entry.type === 'play') {
      if (stage !== 'playing' || !trick || turn !== entry.seat) return false;
      const move = { card: entry.card,
        ...(entry.leadSuit !== undefined ? { leadSuit: entry.leadSuit } : {}),
        ...(entry.summon !== undefined ? { summon: entry.summon } : {}) };
      const hand = held[entry.seat] ?? [];
      if (napoleonPlayError(view(), entry.seat, hand, move, state.kitty) !== null) return false;
      held[entry.seat] = removeNapoleonCards(hand, [entry.card]);
      trick = applyNapoleonPlay(trick, entry.seat, move);
      turn = trick.plays.length < participants.length ? nextNapoleonSeat(participants, entry.seat) : null;
    } else {
      if (stage !== 'playing' || !trick || trick.plays.length !== participants.length || !trick.leadSuit) return false;
      const winnerSeat = napoleonTrickWinner(view(), trick, tricks.length);
      if (entry.winnerSeat !== winnerSeat || entry.trickIndex !== tricks.length + 1) return false;
      tricks.push({ ...trick, leadSuit: trick.leadSuit, winnerSeat });
      trick = tricks.length < handSize ? { leadSeat: winnerSeat, plays: [], leadSuit: null, summon: null } : null;
      turn = trick ? winnerSeat : null;
    }
  }
  const all = [...participants.flatMap((seat) => state.hands[seat] ?? []),
    ...(state.phase === 'exchanging' ? [] : state.kitty), ...tricks.flatMap((entry) => entry.plays), ...trick?.plays ?? []]
    .map((entry) => 'seat' in entry ? entry.card : entry);
  if (all.length !== 54 || !distinctNapoleonCards(all) || !sameJson(state.bidding, bidding)
    || !sameJson(state.contract, contract) || !sameJson(state.trick, trick) || !sameJson(state.tricks, tricks)
    || state.reviewed.some((seat) => seat === contract?.napoleon)
    || (state.reviewed.length > 0 && !napoleonDiscardsPublic(participants.length))) return false;
  const napoleon = contract?.napoleon;
  const handsDealt = (extra: GameSeat | null): boolean => participants.every((seat) =>
    (state.hands[seat] ?? []).length === handSize + (seat === extra ? kittySize : 0));
  const beforeCall = state.secretaryCard === null && state.secretarySeat === null && state.result === null;
  switch (state.phase) {
    case 'bidding':
      return stage === 'bidding' && handsDealt(null) && state.kitty.length === kittySize && state.pickedUp.length === 0
        && state.reviewed.length === 0 && state.reviewDeadline === null && beforeCall
        && state.currentTurnSeat === bidding?.currentBidderSeat;
    case 'exchanging':
      return stage === 'exchanging' && !!napoleon && handsDealt(napoleon) && state.kitty.length === kittySize
        && sameJson(state.pickedUp, state.kitty)
        && state.kitty.every((card) => hasNapoleonCard(state.hands[napoleon] ?? [], card))
        && state.reviewed.length === 0 && state.reviewDeadline === null && beforeCall && state.currentTurnSeat === napoleon;
    case 'reviewing':
      return stage === 'exchanged' && !!napoleon && napoleonDiscardsPublic(participants.length) && handsDealt(null)
        && state.kitty.length === kittySize && state.pickedUp.length === 0 && state.reviewDeadline !== null
        && participants.some((seat) => seat !== napoleon && !state.reviewed.includes(seat))
        && beforeCall && state.currentTurnSeat === null;
    case 'calling':
      return stage === 'exchanged' && !!napoleon && handsDealt(null) && state.kitty.length === kittySize
        && state.pickedUp.length === 0 && state.reviewDeadline === null
        && (!napoleonDiscardsPublic(participants.length)
          || participants.every((seat) => seat === napoleon || state.reviewed.includes(seat)))
        && beforeCall && state.currentTurnSeat === napoleon;
    case 'playing':
      return stage === 'playing' && trick !== null && state.kitty.length === kittySize && state.pickedUp.length === 0
        && state.reviewDeadline === null && state.result === null && state.currentTurnSeat === turn;
    case 'scoring': {
      if (stage !== 'playing' || trick !== null || !contract || !state.secretaryCard || state.currentTurnSeat !== null
        || state.reviewDeadline !== null) return false;
      const outcome = napoleonOutcome(participants, contract, state.secretarySeat, tricks, state.kitty);
      return sameJson(state.result, { gameType: 'napoleon', seats: participants, contract,
        secretaryCard: state.secretaryCard, secretarySeat: state.secretarySeat, discards: state.kitty, ...outcome });
    }
  }
}
