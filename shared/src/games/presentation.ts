import type {
  Card, ChinesePokerRow, DiceFace, GamePresentation, LiarFace, LiarTableFace, NapoleonCard, NapoleonSummon, Suit,
} from '../types/game';
import type { CrazyEightsEffect } from './crazyeights/types';
import type { GameSeat } from '../types/player';

/** Stamped on new presentations; restored ones keep their version so saved deadlines stay valid. */
export const PRESENTATION_TIMING_VERSION = 3;

/** Closing result frame shown before the score overlay, unless a game overrides it. */
export const FINAL_RESULT_MS = 3000;

export interface PresentationFrame {
  readonly key: string;
  readonly kind: 'play' | 'pass' | 'trick' | 'round' | 'capture' | 'eliminated' | 'cover' | 'reveal' | 'shoot'
    | 'homerun' | 'deal' | 'challenge' | 'roulette' | 'shot' | 'hit' | 'stand' | 'double' | 'split'
    | 'dealerReveal' | 'dealerHit' | 'dealerStand' | 'settle' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn' | 'street'
    | 'showdown' | 'award' | 'slay' | 'collapse' | 'summon' | 'bid' | 'diceReveal' | 'finish';
  readonly durationMs: number;
  readonly seat?: GameSeat;
  readonly cards: readonly Card[];
  readonly cardSeats?: readonly GameSeat[];
  readonly total?: number;
  readonly previousTotal?: number;
  readonly points?: number;
  readonly target?: GameSeat;
  readonly passedSeats?: readonly GameSeat[];
  readonly direction?: 'ccw' | 'cw';
  readonly choice?: 'plus' | 'minus' | null;
  readonly flipped?: boolean;
  /** Chinese Poker row revealed by this frame */
  readonly row?: ChinesePokerRow;
  /** Liar's Deck: face-down cards played; Crazy Eights: cards drawn */
  readonly count?: number;
  /** Liar's Deck: the round's table face */
  readonly tableFace?: LiarTableFace;
  /** Liar's Deck: the challenged play, revealed */
  readonly liarFaces?: readonly LiarFace[];
  readonly lied?: boolean;
  /** Liar's Deck: the shooter's trigger pull count including this one */
  readonly shot?: number;
  /** Liar's Deck: present only on the frame that resolves the pull */
  readonly survived?: boolean;
  /** Blackjack: the seat's hand the action applies to */
  readonly handIndex?: number;
  /** Hold'em: the seat's street stake after a call, bet, or raise */
  readonly amount?: number;
  /** Crazy Eights: the suit an 8 declared */
  readonly suit?: Suit;
  /** Crazy Eights: what an action card did */
  readonly effect?: CrazyEightsEffect;
  /** Napoleon: cards shown, which may include jokers; `cards` stays empty */
  readonly napoleonCards?: readonly NapoleonCard[];
  /** Napoleon: what the lead summoned */
  readonly summon?: NapoleonSummon;
  /** Liar's Dice: the bid and, on the reveal frame, the lifted cups */
  readonly liarsDice?: LiarsDiceFrameData;
}

/** Liar's Dice: the bid a frame announces, and what a challenge found once the cups are lifted. */
export interface LiarsDiceFrameData {
  readonly quantity: number;
  readonly face: DiceFace;
  /** Ones counted as the bid face */
  readonly wild?: boolean;
  /** Every seat's revealed dice; present only on the reveal frame */
  readonly dice?: Readonly<Partial<Record<GameSeat, readonly DiceFace[]>>>;
  /** Dice that matched the bid */
  readonly count?: number;
  readonly bidTrue?: boolean;
  readonly loser?: GameSeat;
  /** The loser's last die went */
  readonly eliminated?: boolean;
}

/** Shared frame lengths for one presentation, which depend on its timing version. */
export interface FrameTiming {
  readonly timingVersion: GamePresentation['timingVersion'];
  /** Ordinary play: 300 ms arrival plus one second of reading; shorter on legacy presentations */
  readonly playMs: number;
  /** Ordinary pass or cover */
  readonly passMs: number;
}

export function frameTiming(timingVersion: GamePresentation['timingVersion']): FrameTiming {
  return { timingVersion, playMs: timingVersion ? 1300 : 400, passMs: timingVersion ? 1000 : 350 };
}
