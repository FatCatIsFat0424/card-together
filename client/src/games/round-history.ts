import type {
  BlackjackOutcome, Card, ChinesePokerCategory, HoldemStreet, LiarFace, LiarTableFace, PlayerVisibleGameState, Seat,
} from '@shared/types';
import type { BigTwoComboType } from '@shared/rules/bigtwo';
import { bjApplyEntry, bjEmptyTable, bjTotal } from '@shared/rules/blackjack';
import { heApplyEntry, heAward, heBestHand, heEmptyTable } from '@shared/rules/holdem';
import { chipsAdded } from './holdem/holdem-view';
import { rpScore } from '@shared/rules/redpoints';

export interface HistoryAction {
  kind: 'play' | 'pass' | 'round_end' | 'dragon' | 'flip' | 'eliminated' | 'cover' | 'challenge' | 'shot'
    | 'deal' | 'hit' | 'stand' | 'double' | 'split' | 'dealerReveal' | 'dealerHit' | 'settle'
    | 'button' | 'blind' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn' | 'street' | 'showdown' | 'award';
  /** Null for the Blackjack dealer and Hold'em board cards */
  seat: Seat | null;
  cards: readonly Card[];
  comboType?: BigTwoComboType;
  captured?: Card | null;
  points?: number;
  previousTotal?: number;
  total?: number;
  target?: Seat | null;
  choice?: 'plus' | 'minus' | null;
  pending?: boolean;
  /** Liar's Deck: face-down cards played */
  count?: number;
  /** Liar's Deck: the revealed play and whether it held a lie */
  faces?: readonly LiarFace[];
  lied?: boolean;
  shot?: number;
  survived?: boolean;
  /** Blackjack: stake dealt to the seat, and whether the bet was placed automatically */
  bet?: number;
  auto?: boolean;
  /** Blackjack: which of a split seat's hands acted */
  handIndex?: number;
  /** Blackjack: the hand's total after this action */
  handTotal?: number;
  outcomes?: readonly BlackjackOutcome[];
  net?: number;
  /** Hold'em: chips a blind or call added, a bet or raise's street total, or chips won */
  amount?: number;
  /** Hold'em: the street a board entry dealt */
  street?: Exclude<HoldemStreet, 'preflop'>;
  /** Hold'em: the shown hand's best category */
  category?: ChinesePokerCategory;
  /** Hold'em: the hand's blinds, on the button entry */
  blinds?: { readonly small: number; readonly big: number };
}

export interface HistoryRound {
  number: number;
  complete: boolean;
  actions: HistoryAction[];
  /** Liar's Deck: the round's table card */
  tableFace?: LiarTableFace;
}

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

type HistoryInput = PlayerVisibleGameState extends infer T
  ? T extends PlayerVisibleGameState
    ? Pick<T, 'gameType' | 'phase' | 'log'> & (T extends { pendingFlip: unknown; currentTurnSeat: Seat }
      ? Pick<T, 'pendingFlip' | 'currentTurnSeat'> : object)
    : never
  : never;

/** Rebuild history from the full public log, including after reconnects. */
export function deriveRoundHistory(game: HistoryInput): HistoryRound[] {
  const rounds: HistoryRound[] = [];
  // Chinese Poker has no turns; its showdown is shown in the result instead.
  if (game.gameType === 'bridge' || game.gameType === 'chinesepoker') return rounds;
  let current: HistoryRound | undefined;
  const start = (): HistoryRound => {
    const round = { number: rounds.length + 1, complete: false, actions: [] as HistoryAction[] };
    rounds.push(round);
    current = round;
    return round;
  };
  if (game.gameType === 'bigtwo') {
    for (const entry of game.log) {
      const round = current ?? start();
      round.actions.push({ kind: entry.type,
        seat: entry.type === 'round_end' ? entry.leaderSeat : entry.seat,
        cards: entry.type === 'play' ? entry.cards : [],
        ...(entry.type === 'play' ? { comboType: entry.comboType } : {}),
      });
      if (entry.type === 'round_end' || entry.type === 'dragon') {
        round.complete = true;
        current = undefined;
      }
    }
  } else if (game.gameType === 'redpoints') {
    for (const entry of game.log) {
      if (entry.type === 'play' && current) current.complete = true;
      const round = entry.type === 'play' ? start() : current ?? start();
      round.actions.push({ kind: entry.type, seat: entry.seat, cards: [entry.card],
        captured: entry.captured,
        points: entry.captured ? rpScore([entry.card, entry.captured]) : 0,
      });
      if (entry.type === 'flip') {
        round.complete = true;
        current = undefined;
      }
    }
    if (game.pendingFlip) {
      (current ?? start()).actions.push({ kind: 'flip', seat: game.currentTurnSeat,
        cards: [game.pendingFlip], pending: true });
    } else if (current && current.actions[0]?.seat !== game.currentTurnSeat) {
      current.complete = true;
    }
  } else if (game.gameType === 'sevens') {
    // Every seat acts once per rotation, so each four actions form one round.
    game.log.forEach((entry, index) => {
      const round = index % 4 === 0 ? start() : current ?? start();
      round.actions.push({ kind: entry.type, seat: entry.seat, cards: entry.type === 'play' ? [entry.card] : [] });
      if (round.actions.length === 4) {
        round.complete = true;
        current = undefined;
      }
    });
  } else if (game.gameType === 'liarsdeck') {
    for (const entry of game.log) {
      if (entry.type === 'round') {
        if (current) current.complete = true;
        start().tableFace = entry.tableFace;
        continue;
      }
      const round = current ?? start();
      if (entry.type === 'play') {
        round.actions.push({ kind: 'play', seat: entry.seat, cards: [], count: entry.count });
      } else if (entry.type === 'challenge') {
        round.actions.push({ kind: 'challenge', seat: entry.seat, cards: [], target: entry.target,
          faces: entry.revealed, lied: entry.lied });
      } else {
        round.actions.push({ kind: 'shot', seat: entry.seat, cards: [], shot: entry.shot, survived: entry.survived });
        round.complete = true;
      }
    }
  } else if (game.gameType === 'blackjack') {
    // Each hand is one round; totals come from replaying the public log alongside.
    const table = bjEmptyTable();
    let autoBets: Seat[] = [];
    for (const entry of game.log) {
      if (entry.type === 'bet') {
        if (entry.auto) autoBets.push(entry.seat);
        continue;
      }
      bjApplyEntry(table, entry);
      if (entry.type === 'deal') {
        if (current) current.complete = true;
        const round = start();
        for (const seat of SEATS) {
          if (entry.bets[seat] === 0) continue;
          round.actions.push({ kind: 'deal', seat, cards: entry.cards[seat], bet: entry.bets[seat],
            handTotal: bjTotal(entry.cards[seat]).total, ...(autoBets.includes(seat) ? { auto: true } : {}) });
        }
        round.actions.push({ kind: 'deal', seat: null, cards: [entry.upCard] });
        autoBets = [];
        continue;
      }
      const round = current ?? start();
      if (entry.type === 'hit' || entry.type === 'double' || entry.type === 'stand' || entry.type === 'split') {
        const hands = table.hands[entry.seat];
        round.actions.push({ kind: entry.type, seat: entry.seat,
          cards: entry.type === 'stand' ? [] : entry.type === 'split' ? entry.cards : [entry.card],
          ...(hands.length > 1 && entry.type !== 'split' ? { handIndex: entry.handIndex } : {}),
          ...(entry.type === 'split' ? {} : { handTotal: bjTotal(hands[entry.handIndex].cards).total }) });
      } else if (entry.type === 'reveal' || entry.type === 'dealerHit') {
        round.actions.push({ kind: entry.type === 'reveal' ? 'dealerReveal' : 'dealerHit', seat: null,
          cards: [entry.card], handTotal: bjTotal(table.dealer).total });
      } else if (entry.type === 'settle') {
        for (const seat of SEATS) {
          if (entry.outcomes[seat].length === 0) continue;
          round.actions.push({ kind: 'settle', seat, cards: [], outcomes: entry.outcomes[seat], net: entry.net[seat] });
        }
        round.complete = true;
      }
    }
  } else if (game.gameType === 'holdem') {
    // Each hand is one round; payouts and categories come from replaying the public log alongside.
    const table = heEmptyTable();
    game.log.forEach((entry, index) => {
      if (entry.type === 'hand') {
        if (current) current.complete = true;
        const round = start();
        round.actions.push({ kind: 'button', seat: entry.button, cards: [],
          blinds: { small: entry.smallBlind, big: entry.bigBlind } });
        for (const seat of SEATS) {
          if (entry.blinds[seat] > 0) round.actions.push({ kind: 'blind', seat, cards: [], amount: entry.blinds[seat] });
        }
      } else if (entry.type === 'action') {
        const kind = entry.allIn ? 'allIn' : entry.action;
        (current ?? start()).actions.push({ kind, seat: entry.seat, cards: [],
          ...(kind === 'fold' || kind === 'check' ? {}
            : { amount: kind === 'call' ? chipsAdded(game.log, index) : entry.to }) });
      } else if (entry.type === 'street') {
        (current ?? start()).actions.push({ kind: 'street', seat: null, cards: entry.cards, street: entry.street });
      } else if (entry.type === 'showdown') {
        const round = current ?? start();
        for (const seat of SEATS) {
          const cards = entry.cards[seat];
          if (cards.length === 0) continue;
          round.actions.push({ kind: 'showdown', seat, cards,
            ...(cards.length + table.board.length >= 5 ? { category: heBestHand([...cards, ...table.board]).category } : {}) });
        }
      } else {
        const round = current ?? start();
        const { payouts } = heAward(table);
        for (const seat of SEATS) {
          if (payouts[seat] > 0) round.actions.push({ kind: 'award', seat, cards: [], amount: payouts[seat] });
        }
        for (const seat of entry.eliminated) round.actions.push({ kind: 'eliminated', seat, cards: [] });
        round.complete = true;
      }
      heApplyEntry(table, entry);
    });
  } else {
    let previousTotal = 0;
    for (const entry of game.log) {
      const round = entry.type === 'play' ? start() : current ?? start();
      round.complete = true;
      if (entry.type === 'play') {
        round.actions.push({ kind: 'play', seat: entry.seat, cards: [entry.card],
          previousTotal, total: entry.total, choice: entry.choice, target: entry.target });
        previousTotal = entry.total;
      } else round.actions.push({ kind: 'eliminated', seat: entry.seat, cards: [] });
    }
  }
  if (game.phase === 'scoring' && current) current.complete = true;
  return rounds;
}
