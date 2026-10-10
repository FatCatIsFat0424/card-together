import type { LiarCard, LiarsDeckVisibleState, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import {
  LD_CHAMBERS,
  LD_DECK,
  LD_MAX_PLAY,
  LD_TRUTH_COUNT,
  ldCanChallenge,
  ldIsTruth,
  ldMustChallenge,
} from '@shared/rules/liarsdeck';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

// Heuristic summary: every option is scored as the bot's own expected chance of dying on its next trigger pull,
// with small bonuses for shedding cards and for making an opponent shoot.
// - Calling LIAR: the previous play is honest only if that seat could have held that many truths. Unknown cards are
//   everything outside the bot's own hand and plays; earlier claims this round are assumed partly honest and use up
//   truths. A wrong call costs the bot a pull.
// - Playing truths is safe and invites a losing call; leaving only lies in hand forces a lie later.
// - Lying risks a call that grows with the number of cards, and is certain when it empties the hand while only one
//   opponent still holds cards, since that opponent must call.

const HONEST_RATE = 0.9;
const PRIOR_CLAIM_HONESTY = 0.6;
const SHED_VALUE = 0.01;
const HIT_VALUE = 0.15;
const FUTURE_LIE_WEIGHT = 0.3;
const BASE_CALL_CHANCE = 0.35;
const CALL_CHANCE_PER_CARD = 0.12;
const MAX_CALL_CHANCE = 0.9;
const WRONG_CALL_SHARE = 0.5;
const MARGIN = 0.03;

interface PlayOption {
  readonly cards: readonly LiarCard[];
  readonly lies: number;
}

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

/** Chance that `size` cards drawn from `pool` cards, `truths` of them true, include at least `need` truths. */
export function atLeastTruths(pool: number, truths: number, size: number, need: number): number {
  const draw = Math.min(size, pool);
  const total = combinations(pool, draw);
  if (total === 0) return 0;
  let chance = 0;
  for (let hits = need; hits <= Math.min(draw, truths); hits++) {
    chance += (combinations(truths, hits) * combinations(pool - truths, draw - hits)) / total;
  }
  return Math.min(1, chance);
}

/** Plays made this round, oldest first. */
function roundPlays(visible: LiarsDeckVisibleState): { seat: Seat; count: number }[] {
  const plays: { seat: Seat; count: number }[] = [];
  for (const entry of visible.log) {
    if (entry.type === 'round') plays.length = 0;
    else if (entry.type === 'play') plays.push({ seat: entry.seat, count: entry.count });
  }
  return plays;
}

/** Estimated chance that the previous play contains a lie, using only the bot's cards and public claims. */
export function lieChance(visible: LiarsDeckVisibleState): number {
  const lastPlay = visible.lastPlay;
  if (!lastPlay) return 0;
  const isTruth = (card: LiarCard): boolean => ldIsTruth(card.face, visible.tableFace);
  const known = [...visible.myHand, ...visible.myPlayed];
  const truths = LD_TRUTH_COUNT - known.filter(isTruth).length;
  if (lastPlay.count > truths) return 1;
  const otherClaims = roundPlays(visible).slice(0, -1)
    .filter((play) => play.seat !== visible.mySeat).reduce((sum, play) => sum + play.count, 0);
  const pool = Math.max(lastPlay.count, LD_DECK.length - known.length - otherClaims);
  const remainingTruths = Math.max(0, Math.round(truths - PRIOR_CLAIM_HONESTY * otherClaims));
  const handBefore = visible.handCounts[lastPlay.seat] + lastPlay.count;
  return 1 - HONEST_RATE * atLeastTruths(pool, remainingTruths, handBefore, lastPlay.count);
}

/** Every distinct mix of truths and lies up to three cards; non-joker truths are spent first. */
function playOptions(visible: LiarsDeckVisibleState): PlayOption[] {
  const truths = visible.myHand.filter((card) => ldIsTruth(card.face, visible.tableFace))
    .sort((a, b) => Number(a.face === 'joker') - Number(b.face === 'joker'));
  const lies = visible.myHand.filter((card) => !ldIsTruth(card.face, visible.tableFace));
  const options: PlayOption[] = [];
  for (let truthCount = 0; truthCount <= Math.min(LD_MAX_PLAY, truths.length); truthCount++) {
    for (let lieCount = 0; lieCount <= Math.min(LD_MAX_PLAY - truthCount, lies.length); lieCount++) {
      if (truthCount + lieCount === 0) continue;
      options.push({ cards: [...truths.slice(0, truthCount), ...lies.slice(0, lieCount)], lies: lieCount });
    }
  }
  return options;
}

function scorePlay(visible: LiarsDeckVisibleState, option: PlayOption, deathRisk: number): number {
  const remaining = visible.myHand.length - option.cards.length;
  const holders = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== visible.mySeat && visible.handCounts[seat] > 0);
  const forcedCall = remaining === 0 && holders.length === 1;
  const callChance = forcedCall ? 1
    : Math.min(MAX_CALL_CHANCE, BASE_CALL_CHANCE + CALL_CHANCE_PER_CARD * (option.cards.length - 1));
  // A free opponent calls an honest play less often than a lie, while a forced caller always does.
  const wrongCallChance = forcedCall ? 1 : WRONG_CALL_SHARE * callChance;
  const truthsHeld = visible.myHand.filter((card) => ldIsTruth(card.face, visible.tableFace)).length;
  const truthsLeft = truthsHeld - (option.cards.length - option.lies);
  const forcedLieLater = remaining > 0 && truthsLeft === 0 ? FUTURE_LIE_WEIGHT * deathRisk : 0;
  const outcome = option.lies > 0 ? -callChance * deathRisk : wrongCallChance * HIT_VALUE;
  return SHED_VALUE * option.cards.length + outcome - forcedLieLater;
}

export function getLiarsDeckBotAction(visible: LiarsDeckVisibleState, random: () => number): BotAction | null {
  const me = visible.mySeat;
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== me) return null;
  if (ldMustChallenge(me, visible.handCounts, visible.lastPlay)) return { type: 'liarsdeck-challenge' };
  const deathRisk = 1 / (LD_CHAMBERS - visible.shots[me]);
  const options: { value: BotAction; score: number }[] = playOptions(visible).map((option) => ({
    value: { type: 'liarsdeck-play', cardIds: option.cards.map((card) => card.id) },
    score: scorePlay(visible, option, deathRisk),
  }));
  if (ldCanChallenge(me, visible.lastPlay)) {
    const lie = lieChance(visible);
    options.push({ value: { type: 'liarsdeck-challenge' }, score: -(1 - lie) * deathRisk + lie * HIT_VALUE });
  }
  return selectNearBest(options, random, MARGIN);
}
