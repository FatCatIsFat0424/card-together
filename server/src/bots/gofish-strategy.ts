import type { GameSeat, Rank } from '@shared/types';
import type { GoFishVisibleState } from '@shared/games/gofish/types';
import { gfCount, gfRanks, gfTargets } from '@shared/rules/gofish';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

/** Value of asking a seat known to hold the rank: the ask is certain to succeed. */
const KNOWN_HOLDER = 100;
/** Value of a certain miss; fishing can still draw the rank, so it is a poor choice rather than an impossible one. */
const KNOWN_LACK = -50;
/** Value scaled by the chance an unknown seat holds the rank. */
const GUESS_WEIGHT = 40;
/** Each card of the rank already in hand moves a book closer. */
const OWNED_WEIGHT = 6;
const MARGIN = 0.5;

function askAction(target: GameSeat, rank: Rank): BotAction {
  return { type: 'game-action', request: { gameType: 'gofish', action: { type: 'ask', target, rank } } };
}

function turnChoices(visible: GoFishVisibleState): { ranks: Rank[]; targets: GameSeat[] } | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const ranks = gfRanks(visible.myHand);
  const targets = gfTargets(visible.seats, visible.handCounts, visible.mySeat);
  return ranks.length > 0 && targets.length > 0 ? { ranks, targets } : null;
}

/** Ranks and seats the log shows a seat holding, for the fallback to ask first. */
function knownAsk(visible: GoFishVisibleState, choices: { ranks: Rank[]; targets: GameSeat[] }): { target: GameSeat; rank: Rank } | null {
  const { holds } = publicKnowledge(visible);
  for (const rank of choices.ranks) {
    const target = choices.targets.find((seat) => holds.get(seat)?.has(rank));
    if (target) return { target, rank };
  }
  return null;
}

/**
 * A legal ask that takes a known holder when the log shows one and otherwise steps through every seat and rank
 * as the log grows, so repeated fallback turns cannot cycle on one refused ask forever.
 */
export function goFishFirstLegalAction(visible: GoFishVisibleState): BotAction | null {
  const choices = turnChoices(visible);
  if (!choices) return null;
  const known = knownAsk(visible, choices);
  if (known) return askAction(known.target, known.rank);
  const step = visible.log.length;
  return askAction(choices.targets[step % choices.targets.length],
    choices.ranks[Math.floor(step / choices.targets.length) % choices.ranks.length]);
}

/** A random rank from the hand asked of a random opponent that holds cards. */
export function easyGoFishAction(visible: GoFishVisibleState, random: () => number = Math.random): BotAction | null {
  const choices = turnChoices(visible);
  if (!choices) return null;
  const pick = <T>(items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  return askAction(pick(choices.targets), pick(choices.ranks));
}

interface PublicKnowledge {
  /** Ranks a seat is known to hold: it asked for them and nobody has taken or booked them since */
  readonly holds: ReadonlyMap<GameSeat, ReadonlySet<Rank>>;
  /** Ranks a seat was found without when asked, valid until it draws a card */
  readonly lacks: ReadonlyMap<GameSeat, ReadonlySet<Rank>>;
}

/** Replays the public ask log: every ask shows the asker holds the rank, and who received what. */
function publicKnowledge(visible: GoFishVisibleState): PublicKnowledge {
  const holds = new Map<GameSeat, Set<Rank>>();
  const lacks = new Map<GameSeat, Set<Rank>>();
  const of = (map: Map<GameSeat, Set<Rank>>, seat: GameSeat): Set<Rank> => {
    const found = map.get(seat) ?? new Set<Rank>();
    map.set(seat, found);
    return found;
  };
  for (const entry of visible.log) {
    switch (entry.type) {
      case 'hand':
        holds.clear();
        lacks.clear();
        break;
      case 'ask':
        of(holds, entry.seat).add(entry.rank);
        // Whether the target handed cards over or had none, it holds none of the rank afterwards.
        of(holds, entry.target).delete(entry.rank);
        of(lacks, entry.target).add(entry.rank);
        // A fished card is unknown unless it was the asked rank, so earlier "lacks" no longer hold.
        if (entry.fished === 'lucky' || entry.fished === 'miss') of(lacks, entry.seat).clear();
        break;
      case 'book':
        for (const ranks of holds.values()) ranks.delete(entry.rank);
        break;
      case 'refill':
        of(lacks, entry.seat).clear();
        break;
      case 'handEnd':
        break;
    }
  }
  return { holds, lacks };
}

/**
 * Asks known holders first: a seat that asked for a rank holds it until someone takes it, so the ask is certain.
 * Otherwise it prefers ranks it already holds several of and seats with many cards, and avoids seats that were
 * lately found without the rank. Only public information is used.
 */
export function getGoFishBotAction(visible: GoFishVisibleState, random: () => number): BotAction | null {
  const choices = turnChoices(visible);
  if (!choices) return null;
  const { holds, lacks } = publicKnowledge(visible);
  const unseen = choices.targets.reduce((sum, seat) => sum + visible.handCounts[seat], 0) + visible.stockCount;
  const options: { value: { target: GameSeat; rank: Rank }; score: number }[] = [];
  for (const rank of choices.ranks) {
    const owned = gfCount(visible.myHand, rank);
    // Copies of the rank still unaccounted for sit in other hands or the stock.
    const missing = 4 - owned;
    for (const target of choices.targets) {
      let score = owned * OWNED_WEIGHT;
      if (holds.get(target)?.has(rank)) score += KNOWN_HOLDER;
      else if (lacks.get(target)?.has(rank)) score += KNOWN_LACK;
      else {
        const share = unseen > 0 ? visible.handCounts[target] / unseen : 0;
        score += GUESS_WEIGHT * (1 - (1 - share) ** missing);
      }
      options.push({ value: { target, rank }, score });
    }
  }
  const chosen = selectNearBest(options, random, MARGIN);
  return chosen ? askAction(chosen.target, chosen.rank) : null;
}
