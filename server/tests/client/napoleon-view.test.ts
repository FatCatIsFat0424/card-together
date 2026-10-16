import { describe, expect, it, vi } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import type {
  Card, MatchSummary, NapoleonCard, NapoleonLogEntry, NapoleonTrickRecord, NapoleonVisibleState,
} from '@shared/types';
import {
  NAPOLEON_PICKER_GROUPS, napoleonAckKey, napoleonActiveSummon, napoleonCardText, napoleonExchange,
  napoleonFinalTricks, napoleonForcedPlay, napoleonLeadSummons, napoleonNeedsAck, napoleonNeedsLeadSuit,
  napoleonNotice, napoleonOwnTurn, napoleonPickerCards, napoleonPickerNote, napoleonPlayableCards,
  napoleonPresentedPoints, napoleonReviewState, napoleonSeatLabels, toggleNapoleonDiscard,
} from '../../../client/src/games/napoleon/napoleon-view';
import { napoleonTrickSlot } from '../../../client/src/games/napoleon/NapoleonTrickArea';
import { deriveRoundHistory } from '../../../client/src/games/round-history';
import { matchOutcome } from '../../../client/src/match-history';
import { useGameStore } from '../../../client/src/stores/game-store';

vi.mock('../../../client/src/cosmetics/card-faces/use-card-face', () => ({
  useCardFaceUrl: () => () => '/card.svg', useJokerFaceUrl: () => null,
}));

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const BIG: NapoleonCard = { joker: 'big' };
const SMALL: NapoleonCard = { joker: 'small' };
const secretaryCard = card(14, 'hearts');
const jokerName = (joker: 'big' | 'small'): string => joker === 'big' ? 'Big joker' : 'Small joker';

/** A four-player deal in play: N is the Napoleon in spades, E holds the secretary card ♥A. */
function game(overrides: Partial<NapoleonVisibleState> = {}): NapoleonVisibleState {
  return {
    gameType: 'napoleon', phase: 'playing', options: { jokerSummon: true }, mySeat: 'N',
    seats: ['N', 'E', 'S', 'W'], dealerSeat: 'W',
    myHand: [card(2, 'spades'), card(3, 'spades'), card(13, 'clubs'), BIG],
    handCounts: { N: 4, E: 4, S: 4, W: 4 }, pickedUp: null, discards: [card(12, 'diamonds'), card(4, 'clubs')],
    bidding: null, contract: { level: 12, suit: 'spades', napoleon: 'N' }, reviewed: [], reviewDeadline: null,
    secretaryCard, secretarySeat: null, trick: { leadSeat: 'N', plays: [], leadSuit: null, summon: null },
    tricks: [], currentTurnSeat: 'N', validCards: [card(2, 'spades'), card(3, 'spades'), card(13, 'clubs'), BIG],
    log: [{ type: 'call', seat: 'N', card: secretaryCard, timestamp: 50 }], result: null,
    ...overrides,
  };
}

function framesOf(visible: NapoleonVisibleState, logStart: number): PresentationFrame[] {
  return getPresentationFrames({ ...visible, presentation: { id: 'p', startedAt: 0, logStart, timingVersion: 3 } });
}

const secretaryPlay: NapoleonLogEntry = { type: 'play', seat: 'E', card: secretaryCard, timestamp: 60 };

describe('Napoleon seat labels', () => {
  it('shows the Napoleon to everyone and the secretary only to the secretary and observers before it is played', () => {
    expect(napoleonSeatLabels(game({ secretarySeat: null }), null)).toEqual({ napoleon: 'N', secretary: null });
    expect(napoleonSeatLabels(game({ mySeat: 'E', secretarySeat: 'E' }), null)).toEqual({ napoleon: 'N', secretary: 'E' });
    expect(napoleonSeatLabels(game({ mySeat: 'S', observer: 'spectator', secretarySeat: 'E' }), null))
      .toEqual({ napoleon: 'N', secretary: 'E' });
    // A snapshot that already names the secretary still waits for the secretary card's play frame.
    const revealed = game({ mySeat: 'S', secretarySeat: 'E', log: [...game().log, secretaryPlay] });
    const [playFrame] = framesOf(revealed, 1);
    expect(napoleonSeatLabels(revealed, null).secretary).toBe('E');
    expect(napoleonSeatLabels(revealed, playFrame).secretary).toBe('E');
    const later: NapoleonVisibleState = { ...revealed, log: [game().log[0],
      { type: 'play', seat: 'N', card: card(13, 'clubs'), timestamp: 55 }, secretaryPlay] };
    expect(napoleonSeatLabels(later, framesOf(later, 1)[0]).secretary).toBeNull();
    expect(napoleonSeatLabels(game({ secretarySeat: 'N' }), null).secretary).toBeNull();
    expect(napoleonSeatLabels(game({ contract: null, secretaryCard: null }), null)).toEqual({ napoleon: null, secretary: null });
  });

  it('counts each seat’s point cards only from tricks already presented', () => {
    const trick: NapoleonTrickRecord = { leadSeat: 'N', leadSuit: 'clubs', summon: null, winnerSeat: 'S',
      plays: [{ seat: 'N', card: card(13, 'clubs') }, { seat: 'E', card: card(11, 'clubs') },
        { seat: 'S', card: card(14, 'clubs') }, { seat: 'W', card: card(5, 'clubs') }] };
    const log: NapoleonLogEntry[] = [game().log[0],
      ...trick.plays.map((play, index): NapoleonLogEntry => ({ type: 'play', seat: play.seat, card: play.card, timestamp: 60 + index })),
      { type: 'trick_end', winnerSeat: 'S', trickIndex: 1, timestamp: 70 }];
    const played = game({ tricks: [trick], log });
    expect(napoleonPresentedPoints(played, null)).toEqual({ N: 0, E: 0, S: 3, W: 0 });
    const frames = framesOf(played, 1);
    expect(napoleonPresentedPoints(played, frames[0])).toEqual({ N: 0, E: 0, S: 0, W: 0 });
    expect(napoleonPresentedPoints(played, frames.find((frame) => frame.kind === 'trick') ?? null).S).toBe(3);
  });
});

describe('Napoleon notices', () => {
  it('tells the secretary their role, others the card, and observers the holder', () => {
    const called = game({ mySeat: 'E', secretarySeat: 'E' });
    const [callFrame] = framesOf(called, 0);
    expect(callFrame.kind).toBe('call');
    expect(napoleonNotice(called, callFrame)).toEqual({ kind: 'secretaryCard', card: secretaryCard, self: true });
    expect(napoleonNotice(game({ mySeat: 'S' }), callFrame)).toEqual({ kind: 'secretaryCard', card: secretaryCard, self: false });
    expect(napoleonNotice(game({ mySeat: 'S', observer: 'spectator', secretarySeat: 'E' }), callFrame))
      .toEqual({ kind: 'secretaryCard', card: secretaryCard, self: false, holder: 'E' });
    expect(napoleonNotice(game({ mySeat: 'S', observer: 'spectator', secretarySeat: null }), callFrame))
      .toMatchObject({ holder: null });
  });

  it('alerts everyone but the leader about a summon', () => {
    const summoned = game({ log: [game().log[0],
      { type: 'play', seat: 'N', card: card(2, 'spades'), leadSuit: 'spades', summon: 'bigJoker', timestamp: 60 }] });
    const frames = framesOf(summoned, 1);
    expect(frames.map((frame) => frame.kind)).toEqual(['play', 'summon']);
    expect(napoleonNotice(summoned, frames[1])).toEqual({ kind: 'summon', summon: 'bigJoker', card: BIG, self: true });
    expect(napoleonNotice({ ...summoned, mySeat: 'E' }, frames[1])).toMatchObject({ self: false });
    expect(napoleonNotice(summoned, frames[0])).toBeNull();
  });
});

describe('Napoleon lead controls', () => {
  it('offers the secretary summon to the Napoleon and joker summons for a led trump 2 or 3', () => {
    const summons = napoleonLeadSummons(game());
    expect(summons).toEqual([
      { summon: 'secretary', cards: [card(13, 'clubs'), BIG] },
      { summon: 'smallJoker', cards: [card(3, 'spades')] },
    ]);
    expect(napoleonPlayableCards(game(), 'smallJoker')).toEqual([card(3, 'spades')]);
    expect(napoleonPlayableCards(game(), 'secretary')).toEqual([card(13, 'clubs'), BIG]);
    expect(napoleonPlayableCards(game(), null)).toEqual(game().validCards);
    // The big joker is in the leader's own hand, so trump 2 cannot summon it.
    expect(summons.some((option) => option.summon === 'bigJoker')).toBe(false);
  });

  it('drops summons when the option is off, the card is gone, or it is not the viewer’s lead', () => {
    expect(napoleonLeadSummons(game({ options: { jokerSummon: false } })).map((option) => option.summon))
      .toEqual(['secretary']);
    expect(napoleonLeadSummons(game({ myHand: [...game().myHand, secretaryCard] }))
      .some((option) => option.summon === 'secretary')).toBe(false);
    expect(napoleonLeadSummons(game({ discards: [secretaryCard] }))
      .some((option) => option.summon === 'secretary')).toBe(false);
    expect(napoleonLeadSummons(game({ currentTurnSeat: 'E' }))).toEqual([]);
    expect(napoleonLeadSummons(game({ observer: 'spectator' }))).toEqual([]);
    const following = game({ trick: { leadSeat: 'W', plays: [{ seat: 'W', card: card(5, 'clubs') }], leadSuit: 'clubs', summon: null } });
    expect(napoleonLeadSummons(following)).toEqual([]);
    expect(napoleonActiveSummon(following, 'secretary')).toBeNull();
    expect(napoleonActiveSummon(game(), 'secretary')).toBe('secretary');
  });

  it('asks for a suit only when leading the secretary card or a joker', () => {
    expect(napoleonNeedsLeadSuit(game(), BIG)).toBe(true);
    expect(napoleonNeedsLeadSuit(game({ mySeat: 'E' }), secretaryCard)).toBe(true);
    expect(napoleonNeedsLeadSuit(game(), card(13, 'clubs'))).toBe(false);
    const following = game({ trick: { leadSeat: 'W', plays: [{ seat: 'W', card: card(5, 'clubs') }], leadSuit: 'clubs', summon: null } });
    expect(napoleonNeedsLeadSuit(following, BIG)).toBe(false);
  });

  it('names the summoned card a seat must play and the final three tricks', () => {
    const summoned = game({ mySeat: 'E', currentTurnSeat: 'E', myHand: [SMALL, card(5, 'clubs')],
      trick: { leadSeat: 'N', plays: [{ seat: 'N', card: card(3, 'spades') }], leadSuit: 'spades', summon: 'smallJoker' } });
    expect(napoleonForcedPlay(summoned)).toEqual(SMALL);
    expect(napoleonForcedPlay({ ...summoned, myHand: [card(5, 'clubs')] })).toBeNull();
    expect(napoleonFinalTricks(game())).toBe(false);
    expect(napoleonFinalTricks(game({ tricks: Array.from({ length: 10 }, () => ({
      leadSeat: 'N', leadSuit: 'clubs', summon: null, winnerSeat: 'N', plays: [] })) }))).toBe(true);
  });

  it('falls back to the bidder for the turn and never lets spectators act', () => {
    const bidding = game({ phase: 'bidding', currentTurnSeat: null, contract: null,
      bidding: { bids: [], currentBidderSeat: 'N', highestBid: null, consecutivePassCount: 0 } });
    expect(napoleonOwnTurn(bidding)).toBe(true);
    expect(napoleonOwnTurn({ ...bidding, observer: 'spectator' })).toBe(false);
  });
});

describe('Napoleon secretary picker and acknowledgment', () => {
  it('offers four suits of thirteen and the two jokers, and marks cards that leave no secretary', () => {
    expect(NAPOLEON_PICKER_GROUPS).toEqual(['spades', 'hearts', 'clubs', 'diamonds', 'joker']);
    const all = NAPOLEON_PICKER_GROUPS.flatMap(napoleonPickerCards);
    expect(all).toHaveLength(54);
    expect(new Set(all.map((entry) => napoleonCardText(entry, jokerName))).size).toBe(54);
    expect(napoleonPickerCards('hearts')[0]).toEqual(card(14, 'hearts'));
    expect(napoleonPickerCards('joker')).toEqual([BIG, SMALL]);
    expect(napoleonPickerNote(game(), card(13, 'clubs'))).toBe('hand');
    expect(napoleonPickerNote(game(), card(12, 'diamonds'))).toBe('discard');
    expect(napoleonPickerNote(game(), secretaryCard)).toBeNull();
  });

  it('keeps the secretary notice until it is acknowledged for this deal or the card is played', () => {
    const secretary = game({ mySeat: 'E', secretarySeat: 'E', currentTurnSeat: 'N', myHand: [secretaryCard, card(5, 'clubs')] });
    const key = napoleonAckKey('ROOM1', secretary);
    expect(key).toBe('ROOM1:50');
    expect(napoleonAckKey('ROOM1', game({ log: [] }))).toBeNull();
    expect(napoleonNeedsAck(secretary, key, null)).toBe(true);
    expect(napoleonNeedsAck(secretary, key, 'ROOM1:10')).toBe(true);
    expect(napoleonNeedsAck(secretary, key, key)).toBe(false);
    expect(napoleonNeedsAck({ ...secretary, myHand: [card(5, 'clubs')] }, key, null)).toBe(false);
    expect(napoleonNeedsAck(game({ mySeat: 'S' }), key, null)).toBe(false);
    expect(napoleonNeedsAck({ ...secretary, observer: 'spectator' }, key, null)).toBe(false);
  });
});

describe('Napoleon exchange and review', () => {
  it('merges the picked-up cards into the Napoleon’s hand and limits discards to their number', () => {
    const picked = [card(14, 'spades'), SMALL];
    const exchanging = game({ phase: 'exchanging', secretaryCard: null, trick: null, discards: null,
      myHand: [card(2, 'clubs'), ...picked], pickedUp: picked });
    const exchange = napoleonExchange(exchanging);
    expect(exchange?.discardCount).toBe(2);
    expect(exchange?.cards).toEqual([SMALL, card(14, 'spades'), card(2, 'clubs')]);
    expect(exchange?.pickedUp).toEqual(picked);
    expect(napoleonExchange({ ...exchanging, mySeat: 'E' })).toBeNull();
    expect(napoleonExchange({ ...exchanging, observer: 'spectator' })).toBeNull();
    const first = toggleNapoleonDiscard([], SMALL, 2);
    const full = toggleNapoleonDiscard(first, card(2, 'clubs'), 2);
    expect(toggleNapoleonDiscard(full, card(14, 'spades'), 2)).toEqual(full);
    expect(toggleNapoleonDiscard(full, SMALL, 2)).toEqual([card(2, 'clubs')]);
  });

  it('asks only seats that still owe a review', () => {
    const reviewing = game({ phase: 'reviewing', mySeat: 'E', currentTurnSeat: null, reviewDeadline: 99 });
    expect(napoleonReviewState(reviewing)).toBe('review');
    expect(napoleonReviewState({ ...reviewing, reviewed: ['E'] })).toBe('waiting');
    expect(napoleonReviewState({ ...reviewing, mySeat: 'N' })).toBe('waiting');
    expect(napoleonReviewState({ ...reviewing, observer: 'spectator' })).toBe('waiting');
    expect(napoleonReviewState(game())).toBe('none');
  });
});

describe('Napoleon table helpers', () => {
  it('places trick cards around the table with the viewer at the bottom', () => {
    const compass = ['N', 'E', 'S', 'W'] as const;
    expect(napoleonTrickSlot('S', 'S', compass)).toMatchObject({ left: 50, top: 81 });
    expect(napoleonTrickSlot('W', 'S', compass)).toMatchObject({ left: 14, top: 50 });
    expect(napoleonTrickSlot('N', 'S', compass)).toMatchObject({ left: 50, top: 19 });
    expect(napoleonTrickSlot('E', 'S', compass)).toMatchObject({ left: 86, top: 50 });
    const six = ['N', 'E', 'S', 'W', 'P5', 'P6'] as const;
    const slots = six.map((seat) => napoleonTrickSlot(seat, 'P5', six));
    expect(new Set(slots.map((slot) => `${slot.left}:${slot.top}`)).size).toBe(6);
    expect(slots[4]).toMatchObject({ left: 50, top: 81 });
  });

  it('groups plays into tricks for the round history', () => {
    const log: NapoleonLogEntry[] = [
      { type: 'deal', dealerSeat: 'W', timestamp: 1 },
      { type: 'bid', seat: 'N', action: { type: 'pass' }, timestamp: 2 },
      game().log[0],
      { type: 'play', seat: 'N', card: BIG, leadSuit: 'hearts', summon: 'secretary', timestamp: 3 },
      { type: 'play', seat: 'E', card: secretaryCard, timestamp: 4 },
      { type: 'play', seat: 'S', card: card(5, 'hearts'), timestamp: 5 },
      { type: 'play', seat: 'W', card: card(6, 'hearts'), timestamp: 6 },
      { type: 'trick_end', winnerSeat: 'E', trickIndex: 1, timestamp: 7 },
      { type: 'play', seat: 'E', card: card(13, 'spades'), leadSuit: 'spades', timestamp: 8 },
    ];
    const rounds = deriveRoundHistory({ gameType: 'napoleon', phase: 'playing', seats: ['N', 'E', 'S', 'W'], log });
    expect(rounds.map((round) => round.complete)).toEqual([true, false]);
    expect(rounds[0].actions[0]).toEqual({ kind: 'play', seat: 'N', cards: [], napoleonCards: [BIG],
      leadSuit: 'hearts', summon: 'secretary' });
    expect(rounds[0].actions[4]).toEqual({ kind: 'trickWon', seat: 'E', cards: [] });
    // A suit card leading its own suit names nothing new.
    expect(rounds[1].actions[0]).not.toHaveProperty('leadSuit');
  });

  it('counts both members of the winning side as winners, not a tie', () => {
    const match: MatchSummary = { id: 'm', roomCode: 'R', accountIds: ['a', 'b', 'c', 'd', 'e'], finishedAt: 1,
      result: { gameType: 'napoleon', seats: ['N', 'E', 'S', 'W', 'P5'], contract: { level: 12, suit: 'spades', napoleon: 'N' },
        secretaryCard, secretarySeat: 'E',
        points: { N: 8, E: 5, S: 1, W: 1, P5: 1, P6: 0, P7: 0, P8: 0 }, discards: [], discardPoints: 0,
        napoleonPoints: 13, defenderPoints: 3, napoleonWins: true, winners: ['N', 'E'] } };
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => matchOutcome(match, id)))
      .toEqual(['win', 'win', 'loss', 'loss', 'loss', 'completed']);
  });

  it('keeps Napoleon state in its own store slot and maps every phase onto the shared turn model', () => {
    const store = useGameStore.getState();
    store.restore(game({ phase: 'reviewing', currentTurnSeat: null }));
    expect(useGameStore.getState()).toMatchObject({ gameType: 'napoleon', phase: 'playing', currentTurnSeat: null,
      dealerSeat: 'W', bidding: null, contract: null });
    expect(useGameStore.getState().napoleon?.phase).toBe('reviewing');
    store.restore(game({ phase: 'bidding', currentTurnSeat: null, contract: null,
      bidding: { bids: [], currentBidderSeat: 'E', highestBid: null, consecutivePassCount: 0 } }));
    expect(useGameStore.getState()).toMatchObject({ phase: 'bidding', currentTurnSeat: 'E' });
    store.restore(game({ phase: 'scoring', currentTurnSeat: null }));
    expect(useGameStore.getState().phase).toBe('scoring');
    store.reset();
  });
});
