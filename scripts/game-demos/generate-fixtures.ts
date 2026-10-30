import { writeFileSync } from 'node:fs';
import type {
  BridgeVisibleState, Card, ChinesePokerArrangement, ChinesePokerMatchResult, ChinesePokerVisibleState,
  DiceFace, GameResult, GameSeat, LiarsDiceMatchResult, LiarsDiceVisibleState, NapoleonAction,
  NapoleonCard, NapoleonMatchResult, NapoleonVisibleState, PlayerInfo, Rank, Seat, Suit,
} from '../../shared/src/types';
import type { BridgeAction } from '../../shared/src/games/bridge/actions';
import type { ChinesePokerAction } from '../../shared/src/games/chinesepoker/actions';
import type { LiarsDiceAction } from '../../shared/src/games/liarsdice/actions';
import { cpBestArrangement } from '../../shared/src/rules/chinesepoker-arrange';
import { createDeck } from '../../server/src/engine/deck';
import * as bridge from '../../server/src/managers/games/bridge-game';
import * as napoleon from '../../server/src/managers/games/napoleon-game';
import * as chinesePoker from '../../server/src/managers/games/chinesepoker-game';
import * as liarsDice from '../../server/src/managers/games/liarsdice-game';

// These synthetic deals exercise real manager validation without a database or live room.
const STARTED_AT = 1_800_000_000_000;
const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const CARD_SUITS: Readonly<Record<string, Suit>> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };
const CARD_RANKS: Readonly<Record<string, Rank>> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14,
};
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: `demo-${seat}`, username: `demo_${seat.toLowerCase()}`, nickname: `Demo ${seat}`,
  color: '#4a9eff', avatar: 'cat', avatarImage: null,
} satisfies PlayerInfo])) as Record<Seat, PlayerInfo>;

type ActionResult = { readonly success: boolean; readonly reason?: string };
type RecordedChinesePokerAction = ChinesePokerAction | { readonly type: 'arrange' };

interface DemoStep<State, Action> {
  readonly index: number;
  readonly actingSeat: GameSeat;
  readonly action: Action;
  readonly chapter: string;
  readonly after: State;
}

interface DemoRecording<State, Action> {
  readonly code: string;
  readonly focusSeat: Seat;
  readonly seats: readonly Seat[];
  readonly initial: State;
  readonly steps: DemoStep<State, Action>[];
}

interface DemoFixture<State, Action, Result> extends DemoRecording<State, Action> {
  readonly result: Result;
}

interface DemoFixtures {
  readonly version: 1;
  readonly synthetic: true;
  readonly games: {
    readonly bridge: DemoFixture<BridgeVisibleState, BridgeAction, GameResult>;
    readonly napoleon: DemoFixture<NapoleonVisibleState, NapoleonAction, NapoleonMatchResult>;
    readonly chinesepoker: DemoFixture<ChinesePokerVisibleState, RecordedChinesePokerAction, ChinesePokerMatchResult>;
    readonly liarsdice: DemoFixture<LiarsDiceVisibleState, LiarsDiceAction, LiarsDiceMatchResult>;
  };
}

function required<Value>(value: Value | null | undefined, context: string): Value {
  if (value === null || value === undefined) throw new Error(`Missing ${context}.`);
  return value;
}

function card(code: string): Card {
  const suit = required(CARD_SUITS[code[0]], `suit in ${code}`);
  const rank = required(CARD_RANKS[code.slice(1)], `rank in ${code}`);
  return { suit, rank };
}

function suitCards(suit: Suit): Card[] {
  return RANKS.map((rank) => ({ suit, rank }));
}

function interleavedDeck(hands: readonly (readonly Card[])[]): Card[] {
  if (hands.length !== 4 || hands.some((hand) => hand.length !== 13)) {
    throw new Error('A four-player deal requires four hands of thirteen cards.');
  }
  const deck = Array.from({ length: 13 }, (_, index) => hands.map((hand) => hand[index])).flat();
  if (new Set(deck.map((entry) => `${entry.suit}:${entry.rank}`)).size !== 52) {
    throw new Error('The scripted deal must contain every card exactly once.');
  }
  return deck;
}

function assertPlayerView(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertPlayerView(entry);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (['observedHands', 'observedDice', 'observer', 'hands', 'replayRecording'].includes(key)) {
        throw new Error(`Unexpected private or observer field: ${key}.`);
      }
      assertPlayerView(entry);
    }
  }
}

function recording<State extends { readonly mySeat: GameSeat }, Action>(
  code: string, focusSeat: Seat, seats: readonly Seat[], read: () => State,
): {
  readonly data: DemoRecording<State, Action>;
  readonly act: (seat: GameSeat, action: Action, chapter: string, apply: () => ActionResult) => void;
} {
  const snapshot = (): State => {
    const visible = structuredClone(read());
    if (visible.mySeat !== focusSeat) throw new Error(`Unexpected perspective in ${code}.`);
    assertPlayerView(visible);
    return visible;
  };
  const data: DemoRecording<State, Action> = { code, focusSeat, seats, initial: snapshot(), steps: [] };
  return {
    data,
    act: (actingSeat, action, chapter, apply): void => {
      const result = apply();
      if (!result.success) throw new Error(`${code}/${actingSeat}: ${result.reason ?? 'Action rejected'}.`);
      data.steps.push({ index: data.steps.length + 1, actingSeat, action: structuredClone(action), chapter, after: snapshot() });
    },
  };
}

function bridgeFixture(): DemoFixture<BridgeVisibleState, BridgeAction, GameResult> {
  const code = 'DEMOBR';
  // Each row is N/E/S/W; the manager determines play order from the previous winner.
  const tricks = [
    'CA C2 C3 C4', 'CK C5 C6 C7', 'CQ C8 C9 C10', 'CJ D2 D3 H2',
    'H3 H4 H5 HA', 'H6 H7 H8 HK', 'H9 H10 HJ HQ', 'D4 D5 D6 DA',
    'D7 D8 D9 DK', 'D10 DJ S2 DQ', 'S3 S4 S5 SA', 'S6 S7 S8 SK', 'S10 SJ SQ S9',
  ].map((row) => row.split(' ').map(card));
  const hands = SEATS.map((_, index) => tricks.map((trick) => trick[index]));
  bridge.startGame(code, PLAYERS, interleavedDeck(hands), 'N');
  const { data, act } = recording<BridgeVisibleState, BridgeAction>(code, 'E', SEATS,
    () => required(bridge.getPlayerVisibleState(code, 'E'), 'Bridge player view'));
  while (bridge.getGameState(code)?.phase === 'redeal_pending') {
    const seat = required(bridge.getGameState(code)?.redealPendingSeat, 'redeal recipient');
    act(seat, { type: 'redeal', accept: false }, 'redeal', () => bridge.handleRedealResponse(code, seat, false));
  }
  const bid = { type: 'bid', level: 3, suit: 'hearts' } as const;
  act('E', { type: 'bid', bid }, 'auction', () => bridge.handleBid(code, 'E', bid));
  for (const seat of ['S', 'W', 'N'] as const) {
    act(seat, { type: 'bid', bid: { type: 'pass' } }, 'auction', () => bridge.handleBid(code, seat, { type: 'pass' }));
  }
  for (const [index, trick] of tricks.entries()) {
    for (let play = 0; play < 4; play++) {
      const seat = required(bridge.getGameState(code)?.playing?.currentTurnSeat, 'Bridge turn');
      const played = trick[SEATS.indexOf(seat)];
      act(seat, { type: 'play', card: played }, `trick-${index + 1}`, () => bridge.handlePlayCard(code, seat, played));
    }
  }
  const result = required(bridge.getGameState(code)?.result, 'Bridge result');
  if (result.declarerTeamTricks !== 9 || result.defenderTeamTricks !== 4 || !result.declarerTeamWins) {
    throw new Error('The Bridge learning deal no longer ends 9:4.');
  }
  return { ...data, result: structuredClone(result) };
}

function napoleonFixture(): DemoFixture<NapoleonVisibleState, NapoleonAction, NapoleonMatchResult> {
  const code = 'DEMONA';
  const deck: NapoleonCard[] = [
    ...suitCards('hearts'), ...suitCards('spades'), ...suitCards('clubs').slice(2),
    { joker: 'big' }, { joker: 'small' }, ...suitCards('diamonds'), card('C2'), card('C3'),
  ];
  napoleon.startGame(code, PLAYERS, { jokerSummon: true }, deck, 'W', STARTED_AT);
  const { data, act } = recording<NapoleonVisibleState, NapoleonAction>(code, 'N', SEATS,
    () => required(napoleon.getPlayerVisibleState(code, 'N'), 'Napoleon player view'));
  const move = (seat: GameSeat, action: NapoleonAction, chapter: string): void => {
    act(seat, action, chapter, () => napoleon.act(code, seat, action, 30_000, STARTED_AT));
  };
  move('N', { type: 'bid', action: { type: 'bid', level: 9, suit: 'hearts' } }, 'auction');
  for (const seat of ['E', 'S', 'W'] as const) move(seat, { type: 'bid', action: { type: 'pass' } }, 'auction');
  move('N', { type: 'discard', cards: [card('C2'), card('C3')] }, 'exchange');
  for (const seat of ['E', 'S', 'W'] as const) move(seat, { type: 'review' }, 'review');
  move('N', { type: 'call', card: card('SA') }, 'secretary');
  move('N', { type: 'play', card: card('H2') }, 'trick-1-auto-summon');
  for (let step = 0; step < 100 && napoleon.getGameState(code)?.phase !== 'scoring'; step++) {
    const game = required(napoleon.getGameState(code), 'Napoleon game');
    const seat = required(game.currentTurnSeat, 'Napoleon turn');
    const view = required(napoleon.getPlayerVisibleState(code, seat), 'acting Napoleon player view');
    const played = required(view.validCards[0], 'legal Napoleon card');
    const special = 'joker' in played || (played.suit === 'spades' && played.rank === 14);
    const action: NapoleonAction = !game.trick?.plays.length && special
      ? { type: 'play', card: played, leadSuit: 'spades' } : { type: 'play', card: played };
    move(seat, action, `trick-${game.tricks.length + 1}`);
  }
  const result = required(napoleon.getGameState(code)?.result, 'Napoleon result');
  if (result.napoleonPoints !== 13 || result.defenderPoints !== 3 || !result.napoleonWins) {
    throw new Error('The Napoleon learning deal no longer ends 13:3.');
  }
  return { ...data, result: structuredClone(result) };
}

function chinesePokerFixture(): DemoFixture<ChinesePokerVisibleState, RecordedChinesePokerAction, ChinesePokerMatchResult> {
  const code = 'DEMOCP';
  const own: ChinesePokerArrangement = {
    front: ['C2', 'D2', 'S9'].map(card), middle: ['C3', 'D4', 'H5', 'S6', 'C7'].map(card),
    back: ['HK', 'HQ', 'H9', 'H7', 'H3'].map(card),
  };
  const ownHand = [...own.front, ...own.middle, ...own.back];
  const remaining = createDeck().filter((entry) => !ownHand.some((other) => other.suit === entry.suit && other.rank === entry.rank));
  const hands = [ownHand, ...[0, 1, 2].map((index) => remaining.slice(index * 13, index * 13 + 13))];
  chinesePoker.startGame(code, PLAYERS, 600_000, interleavedDeck(hands));
  const { data, act } = recording<ChinesePokerVisibleState, RecordedChinesePokerAction>(code, 'N', SEATS,
    () => required(chinesePoker.getPlayerVisibleState(code, 'N'), 'Chinese Poker player view'));
  for (const seat of SEATS) {
    const hand = required(chinesePoker.getGameState(code)?.hands[seat], 'Chinese Poker hand');
    const arrangement = seat === 'N' ? own : cpBestArrangement(hand);
    // Other players' submitted arrangements remain private until the final reveal.
    const action: RecordedChinesePokerAction = seat === 'N' ? { type: 'arrange', arrangement } : { type: 'arrange' };
    act(seat, action, 'arrange-and-submit', () => chinesePoker.arrange(code, seat, arrangement, false, STARTED_AT));
  }
  const result = required(chinesePoker.getGameState(code)?.result, 'Chinese Poker result');
  if (result.fouls.length !== 0 || result.scores.N !== -33 || result.scores.W !== 55 || result.winners.join() !== 'W') {
    throw new Error('The Chinese Poker learning deal no longer has its expected valid arrangements and scores.');
  }
  return { ...data, result: structuredClone(result) };
}

function liarsDiceFixture(): DemoFixture<LiarsDiceVisibleState, LiarsDiceAction, LiarsDiceMatchResult> {
  const code = 'DEMOLD';
  const seats: readonly Seat[] = ['N', 'E'];
  const rounds: readonly (readonly (readonly DiceFace[])[])[] = [
    [[1, 2, 2, 3, 4], [1, 3, 3, 5, 6]], [[1, 2, 2, 3, 4], [1, 3, 5, 6]],
    [[1, 2, 2, 3, 4], [1, 3, 6]], [[1, 2, 3, 4], [1, 3, 6]],
    [[1, 2, 4], [1, 3, 6]], [[2, 4], [1, 3, 6]], [[2], [1, 3, 6]],
  ];
  // The first value selects N as starter; subsequent values roll the exact face sequence.
  const tape = [0, ...rounds.flat(2).map((face) => (face - 0.5) / 6)];
  let cursor = 0;
  const random = (): number => required(tape[cursor++], 'scripted dice roll');
  liarsDice.startGame(code, { N: PLAYERS.N, E: PLAYERS.E }, random, STARTED_AT);
  const { data, act } = recording<LiarsDiceVisibleState, LiarsDiceAction>(code, 'N', seats,
    () => required(liarsDice.getPlayerVisibleState(code, 'N'), "Liar's Dice player view"));
  const bid = (seat: Seat, quantity: number, face: DiceFace, chapter: string): void => {
    act(seat, { type: 'bid', quantity, face }, chapter, () => liarsDice.bid(code, seat, quantity, face, STARTED_AT));
  };
  const open = (seat: Seat, chapter: string): void => {
    act(seat, { type: 'challenge' }, chapter, () => liarsDice.challenge(code, seat, STARTED_AT, random));
  };
  bid('N', 4, 2, 'round-1-wild');
  open('E', 'round-1-wild');
  bid('E', 3, 1, 'round-2-ones');
  open('N', 'round-2-ones');
  bid('E', 3, 2, 'round-3-reset-wild');
  open('N', 'round-3-reset-wild');
  for (let round = 4; round <= 7; round++) {
    bid('N', 1, 2, `round-${round}`);
    bid('E', 1, 3, `round-${round}`);
    open('N', `round-${round}`);
  }
  const result = required(liarsDice.getGameState(code)?.result, "Liar's Dice result");
  if (cursor !== tape.length || result.rounds !== 7 || result.winnerSeat !== 'E' || result.dice.E !== 3) {
    throw new Error("The Liar's Dice learning match no longer ends with E holding three dice after seven rounds.");
  }
  return { ...data, result: structuredClone(result) };
}

function main(): void {
  const now = Date.now;
  try {
    // Bridge log entries and the shared arranging deadline do not expose a clock hook.
    Date.now = (): number => STARTED_AT;
    const fixtures: DemoFixtures = {
      version: 1, synthetic: true,
      games: { bridge: bridgeFixture(), napoleon: napoleonFixture(), chinesepoker: chinesePokerFixture(), liarsdice: liarsDiceFixture() },
    };
    writeFileSync(new URL('./fixtures.json', import.meta.url), `${JSON.stringify(fixtures, null, 2)}\n`);
  } finally {
    Date.now = now;
    bridge.restoreGames([]);
    napoleon.restoreGames([]);
    chinesePoker.restoreGames([]);
    liarsDice.restoreGames([]);
  }
}

main();
