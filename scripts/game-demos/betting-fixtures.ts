import type {
  BlackjackAction, BlackjackDealerAction, Card, GameSeat, HoldemAction, PlayerInfo, StudAction, TenHalfAction,
} from '../../shared/src/types';
import { createDeck } from '../../server/src/engine/deck';
import * as blackjack from '../../server/src/managers/games/blackjack-game';
import * as holdem from '../../server/src/managers/games/holdem-game';
import * as stud from '../../server/src/managers/games/stud-game';
import * as tenhalf from '../../server/src/managers/games/tenhalf-game';
import type { DemoFixture } from './demo-fixture-types';
import { createDemoRecorder, DEMO_NOW } from './demo-recorder';

export type BettingDemoGame = 'blackjack' | 'holdem' | 'stud' | 'tenhalf';
const TWO_SEATS = ['N', 'E'] as const;
const THREE_SEATS = ['N', 'E', 'S'] as const;

function players(seats: readonly GameSeat[]): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(seats.map((seat) => [seat, {
    id: `demo-${seat}`, username: `demo_${seat.toLowerCase()}`, nickname: `Demo ${seat}`,
    color: '#4a9eff', avatar: 'cat', avatarImage: null,
  } satisfies PlayerInfo]));
}

/** Encodes a complete, unique deck as inputs to the manager's Fisher-Yates hook. */
function shuffleTape(prefix: string): number[] {
  const deck = createDeck();
  const suits = { S: 'spades', H: 'hearts', C: 'clubs', D: 'diamonds' } as const;
  const cards = prefix.split(' ').map((code): Card => {
    const suit = suits[code[0] as keyof typeof suits];
    const rank = ({ A: 14, K: 13, Q: 12, J: 11 } as Record<string, number>)[code.slice(1)] ?? Number(code.slice(1));
    const found = deck.find((card) => card.suit === suit && card.rank === rank);
    if (!found) throw new Error(`Invalid tutorial card: ${code}.`);
    return found;
  });
  const key = (card: Card): string => `${card.suit}:${card.rank}`;
  if (new Set(cards.map(key)).size !== cards.length) throw new Error('Duplicate tutorial card.');
  const desired = [...cards, ...deck.filter((card) => !cards.some((other) => key(card) === key(other)))];
  const tape: number[] = [];
  for (let index = deck.length - 1; index > 0; index--) {
    const target = deck.findIndex((card) => key(card) === key(desired[index]));
    if (target < 0 || target > index) throw new Error('Invalid tutorial shuffle.');
    tape.push((target + 0.5) / (index + 1));
    [deck[index], deck[target]] = [deck[target], deck[index]];
  }
  return tape;
}

function randomTape(values: readonly number[]): () => number {
  let cursor = 0;
  return (): number => {
    const value = values[cursor++];
    if (value === undefined) throw new Error('Tutorial random tape exhausted.');
    return value;
  };
}

function blackjackFixture(): DemoFixture {
  const code = 'DEMOBJ';
  blackjack.startGame(code, players(TWO_SEATS), 30_000, DEMO_NOW, { playerDealer: true }, () => 0.75);
  try {
    const recorder = createDemoRecorder(code, 'N', TWO_SEATS, () => blackjack.getPlayerVisibleState(code, 'N'));
    const bet = (seat: GameSeat, deck: string, chapter: string): void => {
      blackjack.openBetting(code, DEMO_NOW);
      // Only the focus player's pending amount is public before the deal.
      const action = seat === 'N' ? { type: 'bet', amount: 100 } : { type: 'bet' };
      recorder.act(seat, action, chapter,
        () => blackjack.bet(code, seat, 100, false, DEMO_NOW, randomTape(shuffleTape(deck))));
    };
    const act = (seat: GameSeat, action: BlackjackAction, chapter: string): void => {
      recorder.act(seat, { type: 'act', action }, chapter, () => blackjack.act(code, seat, action, DEMO_NOW));
    };
    const dealer = (seat: GameSeat, action: BlackjackDealerAction, chapter: string): void => {
      recorder.act(seat, { type: 'dealerAct', action }, chapter, () => blackjack.dealerAct(code, seat, action, DEMO_NOW));
    };
    bet('N', 'S8 H6 H8 C10 S3 S2 H10 S9 S5', 'blackjack-bet');
    act('N', 'split', 'blackjack-split');
    act('N', 'double', 'blackjack-double');
    act('N', 'hit', 'blackjack-hit');
    act('N', 'stand', 'blackjack-stand');
    dealer('E', 'hit', 'blackjack-reveal');
    bet('E', 'S9 H5 S7 H9 S3', 'blackjack-rotate');
    act('E', 'stand', 'blackjack-rotate');
    dealer('N', 'hit', 'blackjack-dealer');
    dealer('N', 'stand', 'blackjack-dealer-stand');
    bet('N', 'SA H9 SK H8', 'blackjack-natural');
    bet('E', 'S10 H6 S6 H9 S8', 'blackjack-fast');
    act('E', 'hit', 'blackjack-fast');
    return { ...recorder.finish(), roomOptions: { blackjack: { playerDealer: true } } };
  } finally {
    blackjack.abortGame(code);
  }
}

function holdemFixture(): DemoFixture {
  const code = 'DEMOHE';
  // First deal: E, S, N twice, then the five community cards. Second: S, N, E.
  const random = randomTape([0,
    ...shuffleTape('S7 SK SA H2 HQ HA CA D9 S5 HJ C2'),
    ...shuffleTape('SQ SA SK HQ HA HK CA D9 S5 HJ C2'),
  ]);
  holdem.startGame(code, players(THREE_SEATS), random, DEMO_NOW);
  try {
    const recorder = createDemoRecorder(code, 'N', THREE_SEATS, () => holdem.getPlayerVisibleState(code, 'N'));
    const act = (seat: GameSeat, action: HoldemAction, chapter: string): void => {
      recorder.act(seat, action, chapter, () => holdem.act(code, seat, action, DEMO_NOW, random));
    };
    act('N', { type: 'call' }, 'holdem-preflop');
    act('E', { type: 'call' }, 'holdem-preflop');
    act('S', { type: 'check' }, 'holdem-preflop');
    act('E', { type: 'check' }, 'holdem-flop');
    act('S', { type: 'check' }, 'holdem-flop');
    act('N', { type: 'raise', to: 100 }, 'holdem-bet');
    act('E', { type: 'fold' }, 'holdem-fold');
    act('S', { type: 'call' }, 'holdem-fold');
    act('S', { type: 'check' }, 'holdem-turn');
    act('N', { type: 'check' }, 'holdem-turn');
    act('S', { type: 'check' }, 'holdem-river');
    act('N', { type: 'check' }, 'holdem-showdown');
    act('E', { type: 'call' }, 'holdem-next-hand');
    act('S', { type: 'raise', to: 880 }, 'holdem-short-stack');
    act('N', { type: 'call' }, 'holdem-call');
    act('E', { type: 'raise', to: 980 }, 'holdem-short-raise');
    act('N', { type: 'call' }, 'holdem-sidepot');
    return recorder.finish();
  } finally {
    holdem.abortGame(code);
  }
}

function studFixture(): DemoFixture {
  const code = 'DEMOST';
  const random = randomTape([0, ...shuffleTape('SK SA HK HA S2 CA S3 D9 S4 C8')]);
  stud.startGame(code, players(TWO_SEATS), random, DEMO_NOW);
  try {
    const recorder = createDemoRecorder(code, 'N', TWO_SEATS, () => stud.getPlayerVisibleState(code, 'N'));
    const act = (seat: GameSeat, action: StudAction, chapter: string): void => {
      recorder.act(seat, action, chapter, () => stud.act(code, seat, action, DEMO_NOW, random));
    };
    act('N', { type: 'raise', to: 40 }, 'stud-bet');
    act('E', { type: 'call' }, 'stud-call');
    act('N', { type: 'check' }, 'stud-third');
    act('E', { type: 'check' }, 'stud-third');
    act('N', { type: 'raise', to: 100 }, 'stud-fourth');
    act('E', { type: 'call' }, 'stud-fourth');
    act('N', { type: 'raise', to: 850 }, 'stud-allin');
    act('E', { type: 'call' }, 'stud-showdown');
    return recorder.finish();
  } finally {
    stud.abortGame(code);
  }
}

function tenhalfFixture(): DemoFixture {
  const code = 'DEMOTH';
  tenhalf.startGame(code, players(TWO_SEATS), 30_000, DEMO_NOW, () => 0.75);
  try {
    const recorder = createDemoRecorder(code, 'N', TWO_SEATS, () => tenhalf.getPlayerVisibleState(code, 'N'));
    const bet = (seat: GameSeat, deck: string, chapter: string): void => {
      tenhalf.openBetting(code, DEMO_NOW);
      const action = seat === 'N' ? { type: 'bet', amount: 100 } : { type: 'bet' };
      recorder.act(seat, action, chapter,
        () => tenhalf.bet(code, seat, 100, false, DEMO_NOW, randomTape(shuffleTape(deck))));
    };
    const act = (seat: GameSeat, action: TenHalfAction, chapter: string): void => {
      recorder.act(seat, { type: 'act', action }, chapter, () => tenhalf.act(code, seat, action, DEMO_NOW));
    };
    bet('N', 'S10 H8 SJ', 'tenhalf-bet');
    act('N', 'hit', 'tenhalf-hit');
    act('E', 'stand', 'tenhalf-banker');
    bet('E', 'S2 H9 S4 S3', 'tenhalf-rotate');
    act('E', 'hit', 'tenhalf-bust');
    act('N', 'hit', 'tenhalf-own-banker');
    act('N', 'stand', 'tenhalf-settle');
    bet('N', 'S2 H10 S3 SA SJ SQ HK', 'tenhalf-five-start');
    for (let draw = 0; draw < 4; draw++) act('N', 'hit', 'tenhalf-five');
    act('E', 'hit', 'tenhalf-special-settle');
    bet('E', 'S8 H9 S5', 'tenhalf-fast');
    act('E', 'stand', 'tenhalf-fast');
    act('N', 'hit', 'tenhalf-fast');
    return recorder.finish();
  } finally {
    tenhalf.abortGame(code);
  }
}

/** Generates complete matches without file writes or import-time manager changes. */
export function generateBettingFixtures(): Record<BettingDemoGame, DemoFixture> {
  return { blackjack: blackjackFixture(), holdem: holdemFixture(), stud: studFixture(), tenhalf: tenhalfFixture() };
}
