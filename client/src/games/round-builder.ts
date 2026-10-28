import type {
  BlackjackOutcome, Card, ChinesePokerCategory, DiceFace, HoldemStreet, LiarFace, LiarTableFace, PlayerVisibleGameState,
  GameSeat, GameType, TenHalfHandKind,
} from '@shared/types';
import type { BigTwoComboType } from '@shared/rules/bigtwo';

export interface HistoryAction {
  kind: 'play' | 'pass' | 'round_end' | 'dragon' | 'flip' | 'eliminated' | 'cover' | 'challenge' | 'shot'
    | 'deal' | 'hit' | 'stand' | 'double' | 'split' | 'dealerReveal' | 'dealerHit' | 'dealerStand' | 'settle'
    | 'button' | 'blind' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn' | 'street' | 'showdown' | 'award' | 'bid';
  /** Null for the Blackjack dealer and Hold'em board cards */
  seat: GameSeat | null;
  cards: readonly Card[];
  comboType?: BigTwoComboType;
  captured?: Card | null;
  points?: number;
  previousTotal?: number;
  total?: number;
  target?: GameSeat | null;
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
  /** Blackjack: the settlement row of a player dealer */
  dealer?: boolean;
  /** Hold'em: chips a blind or call added, a bet or raise's street total, or chips won */
  amount?: number;
  /** Ten and a Half: the shown hand's kind, with its total in `handTotal` as half points */
  handKind?: TenHalfHandKind;
  /** Hold'em: the street a board entry dealt */
  street?: Exclude<HoldemStreet, 'preflop'>;
  /** Liar's Dice: the bid made, or the bid a challenge called */
  bid?: { readonly quantity: number; readonly face: DiceFace };
  /** Liar's Dice: dice that matched the called bid, whether it held, and who lost a die */
  found?: number;
  bidTrue?: boolean;
  loser?: GameSeat;
  eliminated?: boolean;
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
  /** Liar's Dice: dice in play when the round began */
  diceInPlay?: number;
}

export type HistoryInput = PlayerVisibleGameState extends infer T
  ? T extends PlayerVisibleGameState
    ? Pick<T, 'gameType' | 'phase' | 'log'> & (T extends { pendingFlip: unknown; currentTurnSeat: GameSeat }
      ? Pick<T, 'pendingFlip' | 'currentTurnSeat'> : object) & (T extends { seats: readonly GameSeat[] }
      ? Pick<T, 'seats'> : object)
    : never
  : never;

export type HistoryInputOf<K extends GameType> = Extract<HistoryInput, { readonly gameType: K }>;

/** Collects actions into rounds while a game walks its public log. */
export interface RoundBuilder {
  readonly rounds: HistoryRound[];
  /** The round still collecting actions, if any */
  current: () => HistoryRound | undefined;
  /** Opens a new round and leaves the previous one as it was */
  start: () => HistoryRound;
  /** The open round, or a new one when none is open */
  open: () => HistoryRound;
  /** Stops adding to the open round */
  release: () => void;
}

export function createRoundBuilder(): RoundBuilder {
  const rounds: HistoryRound[] = [];
  let current: HistoryRound | undefined;
  const start = (): HistoryRound => {
    const round: HistoryRound = { number: rounds.length + 1, complete: false, actions: [] };
    rounds.push(round);
    current = round;
    return round;
  };
  return {
    rounds,
    current: () => current,
    start,
    open: () => current ?? start(),
    release: () => { current = undefined; },
  };
}
