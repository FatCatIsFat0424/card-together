import type { GameSeat, Rank } from '@shared/types';
import type { GoFishVisibleState } from '@shared/games/gofish/types';
import { gfRanks, gfTargets } from '@shared/rules/gofish';
import type { BotAction } from './bot-decisions';
import { certainHolder, GF_RANKS, goFishKnowledge, goFishPublicKnowledge, rankIndex, sampleGoFishWorld } from './gofish-knowledge';
import type { GoFishKnowledge } from './gofish-knowledge';

/** Deals of the hidden cards behind the synchronous estimate of who holds what. */
const ESTIMATE_DEALS = 48;
/** Weight of the chance the ask succeeds; a success also keeps the turn. */
const SUCCESS_WEIGHT = 10;
/** Weight of the cards a success is expected to bring, counted together with the cards already held. */
const BOOK_WEIGHT = 2;
/** Each card of the rank already held moves a book closer, whatever the ask brings. */
const OWNED_WEIGHT = 20;
/** A certain ask comes first: it keeps the turn and takes cards before anyone else can. */
const CERTAIN_BONUS = 1000;
/** Small preference for a rank the table already knows this seat holds: asking it reveals nothing new. */
const PUBLIC_BONUS = 0.5;

export interface GoFishAsk {
  readonly target: GameSeat;
  readonly rank: Rank;
}

export interface ScoredAsk extends GoFishAsk {
  /** Larger is better */
  readonly score: number;
  /** The log proves the target holds the rank */
  readonly certain: boolean;
}

export function askAction(target: GameSeat, rank: Rank): BotAction {
  return { type: 'game-action', request: { gameType: 'gofish', action: { type: 'ask', target, rank } } };
}

export function turnChoices(visible: GoFishVisibleState): { ranks: Rank[]; targets: GameSeat[] } | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const ranks = gfRanks(visible.myHand);
  const targets = gfTargets(visible.seats, visible.handCounts, visible.mySeat);
  return ranks.length > 0 && targets.length > 0 ? { ranks, targets } : null;
}

/**
 * A legal ask that takes a known holder when the log shows one and otherwise steps through every seat and rank
 * as the log grows, so repeated fallback turns cannot cycle on one refused ask forever.
 */
export function goFishFirstLegalAction(visible: GoFishVisibleState): BotAction | null {
  const choices = turnChoices(visible);
  if (!choices) return null;
  const knowledge = goFishKnowledge(visible);
  for (const rank of choices.ranks) {
    const target = choices.targets.find((seat) => knowledge.hands[knowledge.seats.indexOf(seat)].known[rankIndex(rank)] > 0);
    if (target) return askAction(target, rank);
  }
  const step = visible.log.length;
  return askAction(choices.targets[step % choices.targets.length],
    choices.ranks[Math.floor(step / choices.targets.length) % choices.ranks.length]);
}

/**
 * Scores every legal ask by the chance the target holds the rank and the cards it would bring, estimated over
 * deals of the hidden cards that fit everything the log shows (the four copies of each rank included).
 */
export function scoreGoFishAsks(
  visible: GoFishVisibleState, knowledge: GoFishKnowledge, random: () => number, deals = ESTIMATE_DEALS,
): ScoredAsk[] {
  const choices = turnChoices(visible);
  if (!choices) return [];
  const { seats } = knowledge;
  const held = new Float64Array(seats.length * GF_RANKS);
  const cards = new Float64Array(seats.length * GF_RANKS);
  let dealt = 0;
  for (let attempt = 0; attempt < deals; attempt++) {
    const world = sampleGoFishWorld(knowledge, random);
    if (!world) continue;
    dealt++;
    for (let index = 0; index < world.counts.length; index++) {
      if (world.counts[index] > 0) held[index]++;
      cards[index] += world.counts[index];
    }
  }
  const publicView = goFishPublicKnowledge(visible);
  const mineInPublic = publicView.hands[publicView.seats.indexOf(visible.mySeat)];
  const asks: ScoredAsk[] = [];
  for (const rank of choices.ranks) {
    const index = rankIndex(rank);
    const owned = knowledge.own[index];
    for (const target of choices.targets) {
      const seat = seats.indexOf(target);
      const certain = certainHolder(knowledge, seat, index);
      const chance = certain ? 1 : dealt > 0 ? held[seat * GF_RANKS + index] / dealt : 0;
      const gain = dealt > 0 ? cards[seat * GF_RANKS + index] / dealt : knowledge.hands[seat].known[index];
      const revealed = mineInPublic && mineInPublic.known[index] > 0 ? PUBLIC_BONUS : 0;
      const score = chance * (SUCCESS_WEIGHT + BOOK_WEIGHT * (owned + gain)) + owned * OWNED_WEIGHT + revealed
        + (certain ? CERTAIN_BONUS : 0);
      asks.push({ target, rank, score, certain });
    }
  }
  return asks;
}

/** The best-scored ask; ties keep the first (highest rank, earliest seat), so the choice is deterministic. */
export function bestAsk(asks: readonly ScoredAsk[]): ScoredAsk | null {
  return asks.reduce<ScoredAsk | null>((best, ask) => (!best || ask.score > best.score ? ask : best), null);
}

/**
 * Asks a seat the log proves holds the rank when there is one; otherwise the ask most likely to succeed and
 * bring the most cards, by deals of the hidden cards that fit the log. Only public information and the
 * seat's own hand are used.
 */
export function getGoFishBotAction(visible: GoFishVisibleState, random: () => number): BotAction | null {
  if (!turnChoices(visible)) return null;
  const chosen = bestAsk(scoreGoFishAsks(visible, goFishKnowledge(visible), random));
  return chosen ? askAction(chosen.target, chosen.rank) : null;
}
