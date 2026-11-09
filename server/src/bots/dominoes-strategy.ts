import type { DominoesVisibleState, DominoPip, DominoTile } from '@shared/games/dominoes/types';
import {
  dmCompareHeavy, dmHandPips, dmHasPip, dmIsDouble, dmKnownVoids, dmPlacement, dmSameTile, dmTilePips, dmTurnOptions,
  DM_PIPS,
} from '@shared/rules/dominoes';
import type { DominoPlay, DominoTurnOptions } from '@shared/rules/dominoes';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

function turnOptions(visible: DominoesVisibleState): DominoTurnOptions | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  return dmTurnOptions(visible.myHand, visible.line, visible.boneyardCount, visible.openingTile);
}

function playAction(play: DominoPlay): BotAction {
  return {
    type: 'game-action',
    request: { gameType: 'dominoes', action: { type: 'play', tile: play.tile, ...(play.side ? { side: play.side } : {}) } },
  };
}

/** No playable tile: draw while the boneyard has one, otherwise pass. */
function drawOrPass(options: DominoTurnOptions): BotAction | null {
  if (options.canDraw) return { type: 'game-action', request: { gameType: 'dominoes', action: { type: 'draw' } } };
  return options.canPass ? { type: 'game-action', request: { gameType: 'dominoes', action: { type: 'pass' } } } : null;
}

/** The heaviest legal tile, as a timeout plays it. */
export function dominoesFirstLegalAction(visible: DominoesVisibleState): BotAction | null {
  const options = turnOptions(visible);
  if (!options) return null;
  const heaviest = [...options.plays].sort((a, b) => dmCompareHeavy(a.tile, b.tile))[0];
  return heaviest ? playAction(heaviest) : drawOrPass(options);
}

/** A random legal tile and end. */
export function easyDominoesAction(visible: DominoesVisibleState, random: () => number): BotAction | null {
  const options = turnOptions(visible);
  if (!options) return null;
  if (options.plays.length === 0) return drawOrPass(options);
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('Bot random source must return a number in [0, 1).');
  }
  return playAction(options.plays[Math.floor(sample * options.plays.length)]);
}

/** Tiles holding `pip` that this seat can neither see in its hand nor on the line. */
function unseenWith(visible: DominoesVisibleState, pip: DominoPip): number {
  const seen = new Set<string>([...visible.myHand, ...visible.line.map((placed) => placed.tile)]
    .map((tile) => `${tile[0]}-${tile[1]}`));
  let unseen = 0;
  for (const other of DM_PIPS) {
    const tile: DominoTile = other < pip ? [other, pip] : [pip, other];
    if (!seen.has(`${tile[0]}-${tile[1]}`)) unseen++;
  }
  return unseen;
}

/**
 * Sheds heavy tiles and doubles early, keeps a spread of numbers, and leaves ends the seat can continue on
 * and opponents are known (from their draws and passes) or likely (from the tiles still unseen) to lack.
 */
export function getDominoesBotAction(visible: DominoesVisibleState, random: () => number): BotAction | null {
  const options = turnOptions(visible);
  if (!options) return null;
  if (options.plays.length === 0) return drawOrPass(options);

  const voids = dmKnownVoids(visible.log);
  const opponents = visible.seats.filter((seat) => seat !== visible.mySeat);
  const smallest = Math.min(...opponents.map((seat) => visible.handCounts[seat]));
  // An opponent close to going out makes every pip kept in hand a larger liability.
  const urgency = smallest <= 2 ? 1.6 : 1;
  const unseen = new Map<DominoPip, number>(DM_PIPS.map((pip) => [pip, unseenWith(visible, pip)]));

  const scored = options.plays.map((play) => {
    const rest = visible.myHand.filter((tile) => !dmSameTile(tile, play.tile));
    if (rest.length === 0) return { value: play, score: 1000 };
    const placement = dmPlacement(play.tile, play.side, visible.line);
    const ends = placement
      ? visible.line.length === 0 ? [placement.left, placement.right]
        : play.side === 'left' ? [placement.left, visible.line[visible.line.length - 1].right]
          : [visible.line[0].left, placement.right]
      : [];
    let score = dmTilePips(play.tile) * 1.1 * urgency + (dmIsDouble(play.tile) ? 4 : 0);
    score += new Set(rest.flatMap((tile) => [tile[0], tile[1]])).size * 1.5;
    for (const end of ends) {
      score += rest.filter((tile) => dmHasPip(tile, end)).length * 1.4;
      score -= (unseen.get(end) ?? 0) * 0.45;
      score += opponents.filter((seat) => voids.get(seat)?.has(end)).length * 4;
    }
    // Keep the leftover hand light as well.
    score -= dmHandPips(rest) * 0.05;
    return { value: play, score };
  });
  const chosen = selectNearBest(scored, random, 0.25);
  return chosen ? playAction(chosen) : null;
}
