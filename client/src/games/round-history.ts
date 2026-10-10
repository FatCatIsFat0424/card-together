import type { Card, LiarFace, LiarTableFace, PlayerVisibleGameState, Seat } from '@shared/types';
import type { BigTwoComboType } from '@shared/rules/bigtwo';
import { rpScore } from '@shared/rules/redpoints';

export interface HistoryAction {
  kind: 'play' | 'pass' | 'round_end' | 'dragon' | 'flip' | 'eliminated' | 'cover' | 'challenge' | 'shot';
  seat: Seat;
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
}

export interface HistoryRound {
  number: number;
  complete: boolean;
  actions: HistoryAction[];
  /** Liar's Deck: the round's table card */
  tableFace?: LiarTableFace;
}

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
