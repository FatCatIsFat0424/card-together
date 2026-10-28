import type { GameSeat, StudAction, StudVisibleState } from '@shared/types';
import { heInHand, heLegalActions } from '@shared/rules/holdem';
import type { HeLegalActions } from '@shared/rules/holdem';
import { STUD_FINAL_STREET } from '@shared/rules/stud';
import type { BotAction } from './bot-decisions';
import { studEquity } from './stud-equity';

// Heuristic summary: the bot simulates its equity from its own hole card and every up card on the table (folded
// seats' included) against the unfolded opponents, each holding an unknown hole card, and compares it with the pot
// odds. Opponents who keep betting usually hold more than a random hand, so the equity needed to continue rises
// with the number of bets faced and with the share of the stack at risk. Strong hands bet for value in sizes that
// do not depend on exact strength; a rare bluff is limited to heads-up spots where the bot shows the better cards.

/** Pot-odds margin added for every extra raise already made on the street. */
const RAISE_MARGIN = 0.04;
const BLUFF_RATE = 0.06;

function action(request: StudAction): BotAction {
  return { type: 'game-action', request: { gameType: 'stud', action: request } };
}

function potSize(visible: StudVisibleState): number {
  return Object.values(visible.totalBets).reduce((sum, bet) => sum + bet, 0);
}

type RaiseBounds = NonNullable<HeLegalActions['raise']>;

function raiseTo(bounds: RaiseBounds, target: number): BotAction {
  return action({ type: 'raise', to: Math.min(bounds.max, Math.max(bounds.min, Math.round(target))) });
}

export function getStudBotAction(visible: StudVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const legal = heLegalActions(visible, visible.mySeat);
  if (!legal) return null;
  const me = visible.mySeat;
  const rivals: readonly GameSeat[] = heInHand(visible).filter((seat) => seat !== me);
  const equity = studEquity({
    own: [...visible.myHand, ...visible.up[me]],
    opponents: rivals.map((seat) => ({ up: visible.up[seat] })),
    visible: visible.dealt.flatMap((seat) => visible.up[seat]),
    random,
  });
  const pot = potSize(visible);
  const stack = visible.chips[me] + visible.streetBets[me];
  // An even share of the pot is the baseline; being far above it is a hand worth betting.
  const share = 1 / (rivals.length + 1);
  const strong = equity > Math.min(0.85, share + 0.3);
  const decent = equity > Math.min(0.7, share + 0.15);
  const lastStreet = visible.street === STUD_FINAL_STREET;

  const bounds = legal.raise;
  if (legal.check) {
    if (bounds && strong) return raiseTo(bounds, visible.currentBet + pot * (0.5 + 0.25 * random()));
    if (bounds && decent && random() < 0.6) return raiseTo(bounds, visible.currentBet + pot * 0.4);
    // A rare probe with a better showing hand against a single rival
    if (bounds && rivals.length === 1 && !lastStreet && equity > share && random() < BLUFF_RATE) {
      return raiseTo(bounds, bounds.min);
    }
    return action({ type: 'check' });
  }

  // Bets already made on this street, in minimum bets, beyond the first
  const raises = Math.max(0, Math.floor(visible.currentBet / Math.max(visible.minBet, 1)) - 1);
  const odds = legal.call / (pot + legal.call);
  const atRisk = legal.call / Math.max(stack, 1);
  // Opponents who bet or raise hold more than a random hand, so ask for a margin that grows with the price.
  const needed = odds + 0.03 + RAISE_MARGIN * Math.min(raises, 3) + 0.12 * atRisk;
  if (equity < needed) return action({ type: 'fold' });
  if (bounds && strong && equity > needed + 0.15 && random() < 0.7) {
    return raiseTo(bounds, visible.currentBet + pot * (0.6 + 0.4 * random()));
  }
  return action({ type: 'call' });
}
