import { afterEach, describe, expect, it } from 'vitest';
import type { BidAction, BridgeVisibleState, Card, PlayerInfo, Seat, Suit } from '@shared/types';
import { analyzeAuction, humanSeats } from '../../src/bots/bridge-auction';
import { readPartnerSignals, signalBonus } from '../../src/bots/bridge-signals';
import { getBridgeBotAction } from '../../src/bots/bridge-strategy';
import { getNaturalBridgeBid } from '../../src/bots/bridge-bidding';
import { applyBid, createBiddingState } from '../../src/engine/bidding';
import * as bridge from '../../src/managers/games/bridge-game';

const card = (suit: Suit, rank: Card['rank']): Card => ({ suit, rank });
const player = (seat: Seat, isBot = false): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, ...(isBot ? { isBot } : {}),
});

/** A defender's view in the middle of play; W defends 2♠ by N, so E is W's partner. */
function defending(
  myHand: readonly Card[], currentTrick: Partial<Record<Seat, Card>>, leadSeat: Seat,
  overrides: Partial<BridgeVisibleState> = {},
): BridgeVisibleState {
  const order: Seat[] = ['N', 'E', 'S', 'W'];
  const turn = order[(order.indexOf(leadSeat) + Object.keys(currentTrick).length) % 4];
  const led = currentTrick[leadSeat];
  const follows = led ? myHand.filter((other) => other.suit === led.suit) : [];
  return {
    gameType: 'bridge', phase: 'playing', myHand, mySeat: 'W', dealerSeat: 'N', validCards: follows.length > 0 ? follows : myHand,
    bidding: null, contract: { level: 2, suit: 'spades', declarer: 'N' },
    playing: { currentTrick, trickLeadSeat: leadSeat, currentTurnSeat: turn, completedTricks: [], trickCountNS: 0, trickCountEW: 0 },
    result: null, log: [], redealPendingSeat: null, botSeats: ['N', 'E', 'S', 'W'], ...overrides,
  };
}

function playedCard(visible: BridgeVisibleState): Card {
  const action = getBridgeBotAction(visible, () => 0);
  if (action?.type !== 'bridge-play') throw new Error('Expected a card');
  return action.card;
}

describe('bridge partnership with people and signals', () => {
  afterEach(() => bridge.restoreGames([]));

  it('lists bot seats in every view and treats the other seats as people', () => {
    bridge.startGame('BRPART', { N: player('N'), E: player('E', true), S: player('S'), W: player('W', true) });
    const visible = bridge.getPlayerVisibleState('BRPART', 'W')!;
    expect(visible.botSeats).toEqual(['E', 'W']);
    expect([...humanSeats(visible)].sort()).toEqual(['N', 'S']);
    expect(humanSeats({ ...visible, botSeats: undefined }).size).toBe(0);
  });

  it("reads a person's call with wider margins and never as forcing", () => {
    const bids = [{ seat: 'N' as Seat, action: { type: 'bid', level: 1, suit: 'nt' } as BidAction }];
    const bot = analyzeAuction(bids).profiles.N;
    const person = analyzeAuction(bids, new Set<Seat>(['N'])).profiles.N;
    expect(person.minPoints).toBe(bot.minPoints - 2);
    expect(person.maxPoints).toBe(bot.maxPoints + 3);
    expect(bot.balanced).toBe(true);
    expect(person.balanced).toBe(false);
    const response = [...bids, { seat: 'E' as Seat, action: { type: 'pass' } as BidAction },
      { seat: 'S' as Seat, action: { type: 'bid', level: 2, suit: 'clubs' } as BidAction }];
    expect(analyzeAuction(response, new Set<Seat>(['S'])).meanings.at(-1)?.forcing).toBeUndefined();
  });

  it('bids reproducibly from the same hand and auction', () => {
    let bidding = applyBid(createBiddingState('N'), 'N', { type: 'bid', level: 1, suit: 'hearts' });
    bidding = applyBid(bidding, 'E', { type: 'bid', level: 1, suit: 'spades' });
    bidding = applyBid(bidding, 'S', { type: 'bid', level: 2, suit: 'hearts' });
    const myHand = [card('spades', 13), card('spades', 11), card('spades', 9), card('spades', 6), card('spades', 3),
      card('hearts', 4), card('diamonds', 14), card('diamonds', 8), card('diamonds', 2), card('clubs', 12),
      card('clubs', 7), card('clubs', 5), card('clubs', 2)];
    const visible: BridgeVisibleState = {
      gameType: 'bridge', phase: 'bidding', myHand, mySeat: 'W', dealerSeat: 'N', validCards: [], bidding,
      contract: null, playing: null, result: null, log: [], redealPendingSeat: null,
    };
    expect(getNaturalBridgeBid(visible)).toEqual(getNaturalBridgeBid(structuredClone(visible)));
  });

  it("encourages partner's lead with a high spot card only while holding a top honor", () => {
    // E led a heart and declarer's partner S won with the ace, so W cannot win the trick.
    const trick = { E: card('hearts', 4), S: card('hearts', 14) };
    expect(playedCard(defending([card('hearts', 13), card('hearts', 8), card('hearts', 3), card('clubs', 5)], trick, 'E')))
      .toEqual(card('hearts', 8));
    expect(playedCard(defending([card('hearts', 9), card('hearts', 8), card('hearts', 3), card('clubs', 5)], trick, 'E')))
      .toEqual(card('hearts', 3));
    // Declarer's side does not signal.
    const declaring = defending([card('hearts', 13), card('hearts', 8), card('hearts', 3)], trick, 'E', {
      contract: { level: 2, suit: 'spades', declarer: 'E' },
    });
    expect(signalBonus(declaring, card('hearts', 8))).toBe(0);
  });

  it('asks for a suit with a high first discard', () => {
    const hand = [card('diamonds', 14), card('diamonds', 7), card('diamonds', 2), card('hearts', 9), card('hearts', 5), card('hearts', 4)];
    const trick = { N: card('clubs', 10), E: card('clubs', 3), S: card('clubs', 12) };
    expect(playedCard(defending(hand, trick, 'N'))).toEqual(card('diamonds', 7));
    // Without a top honor anywhere, the discard is low.
    expect(playedCard(defending([card('diamonds', 9), card('diamonds', 2), card('hearts', 8), card('hearts', 5)], trick, 'N')).rank)
      .toBe(2);
  });

  it("reads partner's signals with full weight from a bot and little from a person", () => {
    const completed = (partnerCard: Card) => [{
      leadSeat: 'W' as Seat, winnerSeat: 'N' as Seat,
      cards: { W: card('diamonds', 3), N: card('diamonds', 14), E: partnerCard, S: card('diamonds', 4) },
    }];
    const view = (partnerCard: Card, botSeats: Seat[]): BridgeVisibleState => {
      const base = defending([card('clubs', 5)], {}, 'N', { botSeats });
      return { ...base, playing: { ...base.playing!, completedTricks: completed(partnerCard), trickCountNS: 1 } };
    };
    expect(readPartnerSignals(view(card('diamonds', 9), ['N', 'E', 'S', 'W']))).toMatchObject({
      wanted: ['diamonds'], unwanted: [], hints: [{ seat: 'E', suit: 'diamonds', holds: true, weight: 3 }],
    });
    expect(readPartnerSignals(view(card('diamonds', 2), ['N', 'S', 'W']))).toMatchObject({
      wanted: [], unwanted: ['diamonds'], hints: [{ seat: 'E', suit: 'diamonds', holds: false, weight: 1 }],
    });
  });
});
