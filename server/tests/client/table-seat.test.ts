import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, GameClock, PlayerInfo, RoomInfo, Seat } from '@shared/types';
import { rpScore } from '@shared/rules/redpoints';

const state = vi.hoisted(() => ({
  room: null as unknown,
  mySeat: 'S' as string | null,
  game: {} as Record<string, unknown>,
  godView: { role: null, covered: null } as Record<string, unknown>,
}));

vi.mock('../../../client/src/cosmetics/chip-styles/use-chip-style', () => ({ useChipStyle: () => null }));
vi.mock('../../../client/src/cosmetics/card-faces/use-card-face', () => ({
  useCardFaceUrl: () => () => '/card.svg', useJokerFaceUrl: () => null, useNapoleonJokerFaceUrls: () => null,
}));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { roomInfo: unknown; mySeat: string | null }) => unknown) =>
    select({ roomInfo: state.room, mySeat: state.mySeat }),
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: Record<string, unknown>) => unknown) => select(state.game),
}));
vi.mock('../../../client/src/stores/god-view-store', () => ({
  useGodViewStore: (select: (value: Record<string, unknown>) => unknown) => select(state.godView),
}));

import { TableSeat } from '../../../client/src/components/TableSeat';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const human: PlayerInfo = {
  id: 'alice', username: 'alice', nickname: 'Alice', color: '#4a9eff', avatar: 'cat', avatarImage: null,
};
const bot = (nickname: string): PlayerInfo => ({ ...human, id: `bot:${nickname}`, username: '', nickname, isBot: true });

function room(): RoomInfo {
  return {
    code: 'ABC123', gameType: 'redpoints', status: 'playing', createdAt: 1, hostId: human.id,
    abortVote: null, abortVoteCooldownUntil: null,
    seats: {
      N: { player: bot('Bot North'), isReady: true }, E: { player: bot('Bot East'), isReady: true },
      S: { player: human, isReady: true }, W: { player: bot('Bot West'), isReady: true },
    },
  };
}

const counts = (value: number): Record<Seat, number> => ({ N: value, E: value, S: value, W: value });
const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

function clock(turnSeat: Seat | null, overrides: Partial<GameClock> = {}): GameClock {
  return {
    settings: { baseSeconds: 15, bankSeconds: 60 },
    bankRemainingMs: counts(60_000),
    turn: turnSeat ? { id: 'turn-1', seat: turnSeat, startsAt: 0, baseRemainingMs: 15_000, deadline: 75_000 } : null,
    serverNow: 0,
    ...overrides,
  };
}

function baseGame(): Record<string, unknown> {
  return {
    visible: null, presentationReceivedAt: 0, bigTwo: null, redPoints: null, ninetyNine: null, sevens: null,
    chinesePoker: null,
    phase: 'playing', currentTurnSeat: null, contract: null, dealerSeat: null, playing: null,
  };
}

function render(props: Parameters<typeof TableSeat>[0]): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TableSeat, props)));
}

const statusLabels = (html: string): string[] =>
  ['Bust', 'PASS', 'Thinking…', 'Auto-played', 'Arranged'].filter((label) => html.includes(label));

describe('table seat plate', () => {
  beforeEach(() => {
    state.room = room();
    state.mySeat = 'S';
    state.game = baseGame();
    state.godView = { role: null, covered: null };
    useI18nStore.getState().setLocale('en');
    // Clock snapshots below are taken at server time 0.
    vi.useFakeTimers({ now: 0 });
  });

  afterEach(() => vi.useRealTimers());

  it('makes the whole spectator plate selectable without a profile navigation link', () => {
    const html = render({ seat: 'S', position: 'bottom', onObserve: () => undefined });
    expect(html).toContain('role="button" tabindex="0"');
    expect(html).toContain('aria-label="View Alice at the bottom"');
    expect(html).not.toContain('/players/alice');
    expect(render({ seat: 'S', position: 'bottom' })).toContain('/players/alice');
    expect(render({ seat: 'N', position: 'top', onPick: () => undefined }))
      .toContain('aria-label="Choose Bot North to play next"');
    useI18nStore.getState().setLocale('zh-TW');
    expect(render({ seat: 'S', position: 'bottom', onObserve: () => undefined }))
      .toContain('將 Alice 移到底部觀看');
  });

  it('offers covered-card details at all four Sevens seats only to spectators', () => {
    state.mySeat = null;
    state.game = { ...baseGame(), sevens: { handCounts: counts(2), coveredCounts: counts(1) } };
    const covered = { N: [card(2, 'clubs')], E: [card(4, 'diamonds')],
      S: [card(6, 'hearts')], W: [card(9, 'spades')] };
    state.godView = { role: 'spectator', covered };
    for (const [seat, position] of [['N', 'top'], ['E', 'right'], ['S', 'bottom'], ['W', 'left']] as const) {
      const html = render({ seat, position });
      expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*aria-label="Show .+’s covered cards"/);
      expect(html).toContain('>Covered 1</button>');
    }
    state.godView = { role: null, covered: null };
    expect(render({ seat: 'N', position: 'top' })).not.toContain('aria-haspopup="dialog"');
    expect(render({ seat: 'N', position: 'top' })).toContain('Covered 1</span>');
    state.godView = { role: 'spectator', covered: { ...covered, N: [] } };
    state.game = { ...state.game, sevens: { handCounts: counts(2), coveredCounts: { ...counts(1), N: 0 } } };
    expect(render({ seat: 'N', position: 'top' })).not.toContain('aria-haspopup="dialog"');
  });

  it('keeps the Red Points score as the captured-cards button and shows only red cards in the tray', () => {
    const captured = [card(9, 'hearts'), card(5, 'clubs'), card(13, 'diamonds'), card(14, 'hearts')];
    state.game = {
      ...baseGame(),
      redPoints: { handCounts: counts(5), captured: { N: [], E: [], S: [], W: captured } },
      visible: { clock: clock(null), log: [] },
    };
    const html = render({ seat: 'W', position: 'left' });
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-haspopup="dialog"[^>]*title="Show captured cards"/);
    expect(html).toContain(`>${rpScore(captured)} pts</button>`);
    expect(html).toContain('5 cards');
    expect(html.match(/<img[^>]*src="\/card\.svg"/g)).toHaveLength(3);
    expect(html).not.toContain('role="dialog"');
  });

  it('shows the Big Two card count and the locked status in the single status slot', () => {
    state.game = {
      ...baseGame(),
      bigTwo: { phase: 'playing', handCounts: { N: 7, E: 3, S: 9, W: 11 }, lockedSeats: ['E'] },
      visible: { clock: clock('N', { lastTimeout: { seat: 'E', at: 5 } }), log: [] },
    };
    const html = render({ seat: 'E', position: 'right' });
    expect(html).toContain('3 cards');
    expect(statusLabels(html)).toEqual(['PASS']);
    expect(html).toContain('East');
    expect(html).toMatch(/aria-hidden="true">E<\/span>/);
  });

  it('shows how many cards a Sevens seat has covered without naming them', () => {
    state.game = {
      ...baseGame(),
      sevens: { handCounts: counts(8), coveredCounts: { N: 0, E: 2, S: 0, W: 0 } },
      visible: { clock: clock(null), log: [] },
    };
    const html = render({ seat: 'E', position: 'right' });
    expect(html).toContain('8 cards');
    expect(html).toContain('Covered 2');
    expect(render({ seat: 'N', position: 'top' })).not.toContain('Covered');
  });

  it('shows Blackjack chips, betting progress, the bet deadline, and dims seats that sit out', () => {
    state.game = {
      ...baseGame(),
      blackjack: {
        gameType: 'blackjack', phase: 'betting', mySeat: 'S', hand: 1, chips: { N: 1050, E: 5, S: 1010, W: 1000 },
        myBet: null, betPlaced: { N: true, E: false, S: false, W: false }, betDeadline: 30_000,
        hands: { N: [{ cards: [card(10, 'spades'), card(9, 'hearts')], bet: 50, doubled: false, split: false, done: true }],
          E: [], S: [], W: [] },
        dealer: [], holeHidden: false, currentTurnSeat: 'N', activeHand: 0, log: [], result: null,
      },
      visible: { clock: clock(null), log: [] },
    };
    const north = render({ seat: 'N', position: 'top' });
    expect(north).toContain('1050');
    expect(north).toContain('Bet placed');
    expect(north).not.toContain('cards');
    expect(statusLabels(render({ seat: 'W', position: 'left' }))).toEqual(['Thinking…']);
    const east = render({ seat: 'E', position: 'right' });
    expect(east).toContain('Sitting out');
    expect(statusLabels(east)).toEqual([]);
    expect(render({ seat: 'S', position: 'bottom' })).toMatch(/role="timer"[^>]*aria-label="Turn 30s"/);
    expect(render({ seat: 'N', position: 'top' })).not.toContain('role="timer"');
  });

  it('shows Hold\'em chips, button and blind markers, and folded, all-in, and out states', () => {
    state.game = {
      ...baseGame(),
      currentTurnSeat: 'S',
      holdem: {
        gameType: 'holdem', phase: 'playing', mySeat: 'S', myHand: [card(14, 'spades'), card(13, 'spades')], hand: 6,
        button: 'W', smallBlind: 15, bigBlind: 30, chips: { N: 0, E: 0, S: 940, W: 1200 },
        streetBets: { N: 0, E: 0, S: 30, W: 30 }, totalBets: { N: 0, E: 500, S: 30, W: 30 },
        dealt: ['E', 'S', 'W'], folded: ['W'], street: 'preflop', board: [], currentBet: 30, minRaise: 30,
        acted: [], revealed: { N: [], E: [], S: [], W: [] }, eliminated: ['N'], currentTurnSeat: 'S', log: [], result: null,
      },
      visible: { clock: clock('S', { lastTimeout: { seat: 'W', at: 5 } }), log: [] },
    };
    const east = render({ seat: 'E', position: 'right' });
    expect(east).toContain('All-in');
    expect(east).toContain('>SB</span>');
    expect(east).not.toContain('cards');
    const west = render({ seat: 'W', position: 'left' });
    expect(west).toContain('1200');
    expect(west).toContain('Folded');
    expect(west).toContain('>D</span>');
    expect(west).toContain('title="Timeout: bot moved"');
    expect(statusLabels(west)).toEqual([]);
    const north = render({ seat: 'N', position: 'top' });
    expect(north).toContain('>Out</span>');
    expect(north).not.toContain('>D</span>');
    expect(render({ seat: 'S', position: 'bottom' })).toContain('>BB</span>');
  });

  it('shows Chinese Poker arrangement progress and the shared deadline only for the own pending seat', () => {
    const chinesePoker = {
      phase: 'arranging', arrangeDeadline: 45_000, autoArranged: [],
      submitted: { N: true, E: false, S: false, W: false },
    };
    state.game = { ...baseGame(), chinesePoker, visible: { clock: clock(null), log: [] } };
    const north = render({ seat: 'N', position: 'top' });
    expect(statusLabels(north)).toEqual(['Arranged']);
    expect(north).toContain('13 cards');
    expect(statusLabels(render({ seat: 'W', position: 'left' }))).toEqual(['Thinking…']);
    const own = render({ seat: 'S', position: 'bottom' });
    expect(own).toMatch(/role="timer"[^>]*aria-label="Turn 45s"/);
    expect(render({ seat: 'E', position: 'right' })).not.toContain('role="timer"');
    state.game = { ...baseGame(), visible: { clock: clock(null), log: [] },
      chinesePoker: { ...chinesePoker, autoArranged: ['S'], submitted: { N: true, E: true, S: true, W: false } } };
    const auto = render({ seat: 'S', position: 'bottom' });
    expect(statusLabels(auto)).toEqual(['Auto-played']);
    expect(auto).not.toContain('role="timer"');
  });

  it('shows Bridge role chips and the remaining cards', () => {
    state.game = {
      ...baseGame(),
      phase: 'bidding', dealerSeat: 'N', contract: { level: 3, suit: 'nt', declarer: 'N' },
      visible: { clock: clock(null), log: [] },
    };
    const html = render({ seat: 'N', position: 'top' });
    expect(html).toContain('13 cards');
    expect(html).toContain('>Decl</span>');
    expect(html).toContain('>Dealer</span>');
  });

  it("shows each Bridge seat's latest call beside its name during the auction only", () => {
    const bidding = {
      bids: [
        { seat: 'N', action: { type: 'bid', level: 1, suit: 'clubs' } },
        { seat: 'E', action: { type: 'pass' } },
        { seat: 'S', action: { type: 'bid', level: 1, suit: 'hearts' } },
        { seat: 'W', action: { type: 'pass' } },
        { seat: 'N', action: { type: 'bid', level: 2, suit: 'nt' } },
      ],
      currentBidderSeat: 'E', highestBid: { level: 2, suit: 'nt', seat: 'N' }, consecutivePassCount: 0,
      isFirstRound: false,
    };
    state.game = { ...baseGame(), phase: 'bidding', bidding, visible: { clock: clock(null), log: [] } };
    const call = (seat: Seat): string => /title="Latest call">(.*?)<\/span>/.exec(render({ seat, position: 'top' }))?.[1] ?? '';
    // North's earlier 1♣ is replaced by its latest call.
    expect(call('N')).toBe('2NT');
    expect(call('E')).toBe('Pass');
    expect(call('S')).toContain('♥');
    expect(call('S')).toContain('suitRed');
    state.game = { ...baseGame(), phase: 'bidding', bidding: { ...bidding, bids: bidding.bids.slice(0, 1) },
      visible: { clock: clock(null), log: [] } };
    expect(render({ seat: 'E', position: 'top' })).not.toContain('Latest call');
    state.game = { ...baseGame(), phase: 'playing', bidding, visible: { clock: clock(null), log: [] } };
    expect(render({ seat: 'N', position: 'top' })).not.toContain('Latest call');
  });

  it("puts the opposite hand beside its plate at the top only in games whose centre fills the table", () => {
    const game = (gameType: string): Record<string, unknown> => ({
      ...baseGame(), phase: 'playing', visible: { gameType, clock: clock(null), log: [] },
    });
    for (const gameType of ['bridge', 'sevens', 'liarsdeck', 'ninetynine']) {
      state.game = game(gameType);
      expect(render({ seat: 'N', position: 'top' })).toContain('handBeside');
      expect(render({ seat: 'W', position: 'left' })).not.toContain('handBeside');
    }
    state.game = game('bigtwo');
    expect(render({ seat: 'N', position: 'top' })).not.toContain('handBeside');
  });

  it('prefers a bust over a thinking bot and keeps the pickable seat label', () => {
    state.game = {
      ...baseGame(),
      currentTurnSeat: 'N',
      ninetyNine: { handCounts: counts(4), eliminated: ['N'] },
      visible: { clock: clock('N'), log: [] },
    };
    const html = render({ seat: 'N', position: 'top', onPick: () => undefined });
    expect(statusLabels(html)).toEqual(['Bust']);
    expect(html).toContain('4 cards');
    expect(html).toMatch(/role="button" tabindex="0" aria-label="Choose Bot North to play next"/);
  });

  it('announces the turn and shows the active clock as a chip', () => {
    state.game = {
      ...baseGame(),
      currentTurnSeat: 'W',
      ninetyNine: { handCounts: counts(4), eliminated: [] },
      visible: { clock: clock('W'), log: [] },
    };
    const html = render({ seat: 'W', position: 'left' });
    expect(statusLabels(html)).toEqual(['Thinking…']);
    expect(html).toMatch(/>Turn<\/span>/);
    // Other players' reserves stay private to them.
    expect(html).toMatch(/role="timer"[^>]*aria-label="Turn 15s"/);
    expect(html).toContain('>15s</span>');
    expect(html).not.toContain('Reserve');

    const idle = render({ seat: 'E', position: 'right' });
    expect(idle).not.toContain('role="timer"');
    expect(idle).not.toMatch(/>Turn<\/span>/);
  });

  it('hides the turn during a presentation lock', () => {
    state.game = {
      ...baseGame(),
      currentTurnSeat: 'W',
      ninetyNine: { handCounts: counts(4), eliminated: [] },
      visible: { clock: clock(null), log: [] },
    };
    const html = render({ seat: 'W', position: 'left', suppressTurn: true });
    expect(html).not.toMatch(/>Turn<\/span>/);
    expect(statusLabels(html)).toEqual([]);
  });

  it('gives the own seat its reserve clock, me tag and your-turn text without a card fan', () => {
    state.game = {
      ...baseGame(),
      currentTurnSeat: 'S',
      bigTwo: { phase: 'playing', handCounts: counts(13), lockedSeats: [] },
      visible: { clock: clock('S'), log: [] },
    };
    const html = render({ seat: 'S', position: 'bottom' });
    expect(html).toContain('>You</span>');
    expect(html).toContain('Your turn!');
    expect(html).toMatch(/role="timer"[^>]*aria-label="Turn 15s, Reserve 60s"/);
    expect(html).toContain('>15 + 60</span>');
    expect(html).not.toContain('13 cards');

    state.game = { ...state.game, currentTurnSeat: 'N', visible: { clock: clock('N'), log: [] } };
    const waiting = render({ seat: 'S', position: 'bottom' });
    expect(waiting).toMatch(/role="timer"[^>]*aria-label="Turn 15s, Reserve 60s"/);
    expect(waiting).not.toContain('Your turn!');
  });

  it('shows Napoleon roles, won point cards, and auction calls only when the viewer may know them', () => {
    const napoleon = {
      gameType: 'napoleon', phase: 'playing', options: { jokerSummon: true }, mySeat: 'S', seats: ['N', 'E', 'S', 'W'],
      dealerSeat: 'W', myHand: [], handCounts: { N: 12, E: 12, S: 12, W: 12 }, pickedUp: null, discards: null,
      bidding: null, contract: { level: 12, suit: 'spades', napoleon: 'N' }, reviewed: [], reviewDeadline: null,
      secretaryCard: card(14, 'hearts'), secretarySeat: null, trick: { leadSeat: 'W', plays: [], leadSuit: null, summon: null },
      tricks: [{ leadSeat: 'N', leadSuit: 'clubs', summon: null, winnerSeat: 'W', plays: [
        { seat: 'N', card: card(13, 'clubs') }, { seat: 'E', card: card(2, 'clubs') },
        { seat: 'S', card: card(3, 'clubs') }, { seat: 'W', card: card(14, 'clubs') }] }],
      currentTurnSeat: 'W', validCards: [], result: null,
      log: [{ type: 'trick_end', winnerSeat: 'W', trickIndex: 1, timestamp: 1 }],
    };
    state.game = { ...baseGame(), currentTurnSeat: 'W', napoleon, visible: { clock: clock(null), log: [] } };
    const north = render({ seat: 'N', position: 'top' });
    expect(north).toContain('napoleonRole');
    expect(north).toContain('>Napoleon');
    expect(north).toContain('12 cards');
    expect(north).toContain('0 pts');
    expect(render({ seat: 'W', position: 'left' })).toContain('2 pts');
    expect(render({ seat: 'E', position: 'right' })).not.toContain('secretaryRole');

    state.mySeat = 'E';
    state.game = { ...state.game, napoleon: { ...napoleon, mySeat: 'E', secretarySeat: 'E' } };
    expect(render({ seat: 'E', position: 'bottom' })).toContain('secretaryRole');

    state.mySeat = 'S';
    state.game = { ...baseGame(), phase: 'bidding', currentTurnSeat: 'E', visible: { clock: clock(null), log: [] },
      napoleon: { ...napoleon, phase: 'bidding', contract: null, secretaryCard: null, tricks: [], log: [],
        bidding: { bids: [{ seat: 'N', action: { type: 'bid', level: 12, suit: 'hearts' } }],
          currentBidderSeat: 'E', highestBid: { level: 12, suit: 'hearts', seat: 'N' }, consecutivePassCount: 0 } } };
    const bidding = render({ seat: 'N', position: 'top' });
    expect(bidding).toMatch(/title="Latest call">12<span[^>]*>♥/);
    expect(bidding).not.toContain('pts');
    expect(bidding).not.toContain('napoleonRole');

    state.game = { ...baseGame(), phase: 'playing', currentTurnSeat: null, visible: { clock: clock(null), log: [] },
      napoleon: { ...napoleon, phase: 'reviewing', currentTurnSeat: null, reviewDeadline: 30_000, reviewed: ['E'] } };
    expect(render({ seat: 'S', position: 'bottom' })).toMatch(/role="timer"[^>]*aria-label="Turn 30s"/);
    expect(render({ seat: 'N', position: 'top' })).not.toContain('role="timer"');
  });
});
