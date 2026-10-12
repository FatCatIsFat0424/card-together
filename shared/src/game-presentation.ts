import type {
  AnyGameState, Card, ChinesePokerRow, LiarFace, LiarTableFace, PlayerVisibleGameState, SevensLogEntry,
} from './types/game';
import type { GameSeat, Seat } from './types/player';
import { rpScore } from './rules/redpoints';
import { nnWinners } from './rules/ninetynine';
import { SEVENS_COLLAPSE_MS, SEVENS_COLLAPSE_SETTLE_MS, SEVENS_SLAY_FRAME_MS, sevensSlayEffect } from './sevens-options';

/** Stamped on new presentations; restored ones keep their version so saved deadlines stay valid. */
export const PRESENTATION_TIMING_VERSION = 3;

/** Slay frame length before the dragon and fire effects had their own durations. */
const LEGACY_SLAY_FRAME_MS = 2400;

export interface PresentationFrame {
  readonly key: string;
  readonly kind: 'play' | 'pass' | 'trick' | 'round' | 'capture' | 'eliminated' | 'cover' | 'reveal' | 'shoot'
    | 'homerun' | 'deal' | 'challenge' | 'roulette' | 'shot' | 'hit' | 'stand' | 'double' | 'split'
    | 'dealerReveal' | 'dealerHit' | 'dealerStand' | 'settle' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn' | 'street'
    | 'showdown' | 'award' | 'slay' | 'collapse' | 'finish';
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
  /** Liar's Deck: face-down cards played */
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
}

function isAutoCover(entry: SevensLogEntry | undefined): boolean {
  return entry?.type === 'cover' && entry.auto === true;
}

/** Reconstructs only public events; private hands and stock never enter presentation frames. */
export function getPresentationFrames(
  game: AnyGameState | PlayerVisibleGameState,
): PresentationFrame[] {
  if (!game.presentation) return [];
  const { id, logStart, timingVersion } = game.presentation;
  // New plays include 300 ms arrival plus one full second of readable results.
  const playDuration = timingVersion ? 1300 : 400;
  const passDuration = timingVersion ? 1000 : 350;
  const frames: PresentationFrame[] = [];
  for (let index = logStart; index < game.log.length; index++) {
    const key = `${id}:${index}`;
    if (game.gameType === 'bridge') {
      const entry = game.log[index];
      if (entry.type === 'play') {
        frames.push({ key, kind: 'play', durationMs: playDuration, seat: entry.seat, cards: [entry.card] });
      } else if (entry.type === 'trick_end') {
        const trick = game.playing?.completedTricks[entry.trickIndex - 1];
        const cardSeats = trick ? Object.keys(trick.cards) as Seat[] : [];
        frames.push({ key, kind: 'trick', durationMs: 2000, seat: entry.winnerSeat,
          cards: trick ? cardSeats.map((seat) => trick.cards[seat]) : [], cardSeats });
      }
    } else if (game.gameType === 'bigtwo') {
      const entry = game.log[index];
      if (entry.type === 'play') {
        frames.push({ key, kind: 'play', durationMs: playDuration, seat: entry.seat, cards: entry.cards });
      } else if (entry.type === 'pass') {
        frames.push({ key, kind: 'pass', durationMs: passDuration, seat: entry.seat, cards: [] });
      } else if (entry.type === 'round_end') {
        const preceding = game.log.slice(0, index);
        const lastPlay = [...preceding].reverse().find((event) => event.type === 'play');
        let previousRound = preceding.length - 1;
        while (previousRound >= 0 && preceding[previousRound].type !== 'round_end') previousRound--;
        const passedSeats = preceding.slice(previousRound + 1)
          .filter((event) => event.type === 'pass').map((event) => event.seat);
        frames.push({ key, kind: 'round', durationMs: 2000, seat: entry.leaderSeat,
          cards: lastPlay?.type === 'play' ? lastPlay.cards : [], passedSeats });
      }
    } else if (game.gameType === 'redpoints') {
      const entry = game.log[index];
      const cards = entry.captured ? [entry.card, entry.captured] : [entry.card];
      frames.push({ key, kind: entry.captured ? 'capture' : 'play', durationMs: 1900,
        seat: entry.seat, cards, flipped: entry.type === 'flip', points: entry.captured ? rpScore(cards) : 0 });
    } else if (game.gameType === 'sevens') {
      const entry = game.log[index];
      if (entry.type === 'play') {
        frames.push({ key, kind: 'play', durationMs: playDuration, seat: entry.seat, cards: [entry.card] });
        // Under Dragon Slaying an A or K always reaches its row end, which closes the whole suit.
        if (game.options?.closeOnEnd && (entry.card.rank === 14 || entry.card.rank === 13)) {
          const durationMs = timingVersion === PRESENTATION_TIMING_VERSION
            ? SEVENS_SLAY_FRAME_MS[sevensSlayEffect(game.options)]
            : LEGACY_SLAY_FRAME_MS;
          frames.push({ key: `${key}:slay`, kind: 'slay', durationMs, seat: entry.seat, cards: [entry.card] });
        }
      } else if (!entry.auto) {
        frames.push({ key, kind: 'cover', durationMs: passDuration, seat: entry.seat, cards: [] });
      } else if (!isAutoCover(game.log[index - 1])) {
        // The remaining hands are covered all at once, shown as the table collapsing rather than card by card.
        frames.push({ key, kind: 'collapse', durationMs: SEVENS_COLLAPSE_MS, cards: [] });
      }
    } else if (game.gameType === 'chinesepoker') {
      // Submissions are private and simultaneous, so only the showdown is presented.
      const entry = game.log[index];
      if (entry.type === 'reveal') {
        frames.push({ key, kind: 'reveal', durationMs: 2500, cards: [], row: entry.row });
      } else if (entry.type === 'shoot') {
        frames.push({ key, kind: 'shoot', durationMs: 1500, seat: entry.seat, target: entry.target, cards: [] });
      } else if (entry.type === 'homerun') {
        frames.push({ key, kind: 'homerun', durationMs: 2500, seat: entry.seat, cards: [] });
      }
    } else if (game.gameType === 'liarsdeck') {
      const entry = game.log[index];
      if (entry.type === 'round') {
        frames.push({ key, kind: 'deal', durationMs: 2000, seat: entry.starter, cards: [], tableFace: entry.tableFace });
      } else if (entry.type === 'play') {
        frames.push({ key, kind: 'play', durationMs: playDuration, seat: entry.seat, cards: [], count: entry.count });
      } else if (entry.type === 'challenge') {
        frames.push({ key, kind: 'challenge', durationMs: 2500, seat: entry.seat, target: entry.target, cards: [],
          liarFaces: entry.revealed, lied: entry.lied });
      } else {
        // The suspense frame carries no outcome so the table cannot reveal it early.
        frames.push({ key, kind: 'roulette', durationMs: 2500, seat: entry.seat, cards: [], shot: entry.shot });
        frames.push({ key: `${key}:result`, kind: 'shot', durationMs: 1500, seat: entry.seat, cards: [],
          shot: entry.shot, survived: entry.survived });
      }
    } else if (game.gameType === 'blackjack') {
      const entry = game.log[index];
      // Bets stay hidden until the deal, so they have no frame and never delay other bettors.
      if (entry.type === 'deal') {
        frames.push({ key, kind: 'deal', durationMs: 1800, cards: [] });
      } else if (entry.type === 'hit' || entry.type === 'double') {
        frames.push({ key, kind: entry.type, durationMs: entry.type === 'hit' ? 1000 : 1300, seat: entry.seat,
          cards: [entry.card], handIndex: entry.handIndex });
      } else if (entry.type === 'stand') {
        frames.push({ key, kind: 'stand', durationMs: 700, seat: entry.seat, cards: [], handIndex: entry.handIndex });
      } else if (entry.type === 'split') {
        frames.push({ key, kind: 'split', durationMs: 1300, seat: entry.seat, cards: [...entry.cards],
          handIndex: entry.handIndex });
      } else if (entry.type === 'reveal') {
        frames.push({ key, kind: 'dealerReveal', durationMs: 1300, cards: [entry.card] });
      } else if (entry.type === 'dealerHit') {
        frames.push({ key, kind: 'dealerHit', durationMs: 1000, cards: [entry.card] });
      } else if (entry.type === 'dealerStand') {
        frames.push({ key, kind: 'dealerStand', durationMs: 700, cards: [] });
      } else if (entry.type === 'settle') {
        frames.push({ key, kind: 'settle', durationMs: 2500, cards: [] });
      }
    } else if (game.gameType === 'holdem') {
      const entry = game.log[index];
      if (entry.type === 'hand') {
        frames.push({ key, kind: 'deal', durationMs: 1500, seat: entry.button, cards: [] });
      } else if (entry.type === 'action') {
        frames.push({ key, kind: entry.allIn ? 'allIn' : entry.action, durationMs: 900, seat: entry.seat, cards: [],
          ...(entry.action === 'fold' || entry.action === 'check' ? {} : { amount: entry.to }) });
      } else if (entry.type === 'street') {
        frames.push({ key, kind: 'street', durationMs: 1300, cards: entry.cards });
      } else if (entry.type === 'showdown') {
        frames.push({ key, kind: 'showdown', durationMs: 2500, cards: [] });
      } else {
        frames.push({ key, kind: 'award', durationMs: 2500, cards: [] });
      }
    } else {
      const entry = game.log[index];
      if (entry.type === 'play') {
        const previousPlay = game.log.slice(0, index).reverse()
          .find((event) => event.type === 'play');
        const previousTotal = previousPlay?.type === 'play' ? previousPlay.total : 0;
        frames.push({ key, kind: 'play', durationMs: 1900, seat: entry.seat,
          cards: [entry.card], total: entry.total, previousTotal, direction: game.direction, choice: entry.choice, ...(entry.target ? { target: entry.target } : {}) });
      } else {
        frames.push({ key, kind: 'eliminated', durationMs: 2500, seat: entry.seat, cards: [] });
      }
    }
  }
  if (game.phase === 'scoring') {
    const winners = (game.gameType === 'sevens' || game.gameType === 'chinesepoker' || game.gameType === 'blackjack'
      || game.gameType === 'holdem') && game.result
      ? game.result.winners
      : game.gameType === 'ninetynine' && game.result ? nnWinners(game.result) : [];
    const seat = game.gameType === 'bigtwo' || game.gameType === 'liarsdeck'
      ? game.result?.winnerSeat : winners.length === 1 ? winners[0] : undefined;
    const lastCards = [...frames].reverse().find((frame) => frame.cards.length > 0);
    // After a collapse the broken table holds briefly instead of showing the usual closing frame.
    const collapsed = game.gameType === 'sevens' && game.log.some(isAutoCover);
    frames.push({ key: `${id}:finish`, kind: 'finish', durationMs: collapsed ? SEVENS_COLLAPSE_SETTLE_MS : 3000,
      cards: lastCards?.cards ?? [],
      ...(lastCards?.cardSeats ? { cardSeats: lastCards.cardSeats } : {}),
      ...(seat ? { seat } : {}) });
  }
  return frames;
}

export function getPresentationEndsAt(game: AnyGameState | PlayerVisibleGameState): number {
  if (!game.presentation) return 0;
  return game.presentation.startedAt
    + getPresentationFrames(game).reduce((duration, frame) => duration + frame.durationMs, 0);
}

/** Log index a frame presents, or null for the closing result frame; keys are `${id}:${index}[:part]`. */
export function frameLogIndex(frame: PresentationFrame): number | null {
  const index = Number(frame.key.split(':')[1]);
  return Number.isInteger(index) ? index : null;
}
