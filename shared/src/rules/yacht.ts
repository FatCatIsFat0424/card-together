// ─── Yacht Dice rules: boxes, scoring, the Yacht joker, and totals ───

/** One die shows 1 to 6. */
export type YachtFace = 1 | 2 | 3 | 4 | 5 | 6;

export const YACHT_DICE = 5;
export const YACHT_MAX_ROLLS = 3;
/** Every player fills each of the 13 boxes exactly once. */
export const YACHT_ROUNDS = 13;

export const YACHT_UPPER_BOXES = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const;
export const YACHT_LOWER_BOXES = [
  'threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yacht', 'chance',
] as const;
export const YACHT_BOXES = [...YACHT_UPPER_BOXES, ...YACHT_LOWER_BOXES] as const;
export type YachtBox = typeof YACHT_BOXES[number];

export const YACHT_UPPER_BONUS_TARGET = 63;
export const YACHT_UPPER_BONUS = 35;
/** Awarded for each further Yacht while the Yacht box holds 50. */
export const YACHT_EXTRA_BONUS = 100;
export const YACHT_FULL_HOUSE = 25;
export const YACHT_SMALL_STRAIGHT = 30;
export const YACHT_LARGE_STRAIGHT = 40;
export const YACHT_YACHT = 50;

/** Shortest window of a simultaneous round; longer room timers give longer rounds. */
export const YACHT_MIN_ROUND_SECONDS = 30;

export function yachtRoundSeconds(baseSeconds: number): number {
  return Math.max(YACHT_MIN_ROUND_SECONDS, baseSeconds);
}

/** `turns`: one player at a time; `simultaneous`: everyone rolls their own dice in each round. */
export type YachtMode = 'turns' | 'simultaneous';
export const YACHT_MODES: readonly YachtMode[] = ['turns', 'simultaneous'];

/** Room rules chosen before the match. */
export interface YachtOptions {
  readonly mode: YachtMode;
}

export const DEFAULT_YACHT_OPTIONS: YachtOptions = { mode: 'turns' };

export function isYachtMode(value: unknown): value is YachtMode {
  return value === 'turns' || value === 'simultaneous';
}

export function isYachtOptions(value: unknown): value is YachtOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 1 && isYachtMode(candidate.mode);
}

/** One player's card: the score in every filled box, and the count of extra Yachts. */
export interface YachtScorecard {
  readonly boxes: Readonly<Partial<Record<YachtBox, number>>>;
  readonly extraYachts: number;
}

export const EMPTY_YACHT_SCORECARD: YachtScorecard = { boxes: {}, extraYachts: 0 };

export function isYachtFace(value: unknown): value is YachtFace {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}

export function isYachtBox(value: unknown): value is YachtBox {
  return typeof value === 'string' && (YACHT_BOXES as readonly string[]).includes(value);
}

export function isUpperBox(box: YachtBox): box is typeof YACHT_UPPER_BOXES[number] {
  return (YACHT_UPPER_BOXES as readonly string[]).includes(box);
}

/** The face an upper box counts. */
export function upperFace(box: typeof YACHT_UPPER_BOXES[number]): YachtFace {
  return (YACHT_UPPER_BOXES.indexOf(box) + 1) as YachtFace;
}

export function yachtRollDice(count: number, random: () => number): YachtFace[] {
  return Array.from({ length: count }, () => (Math.floor(random() * 6) + 1) as YachtFace);
}

/** Rerolls the dice that are not held; held dice keep their place. */
export function yachtReroll(dice: readonly YachtFace[], held: readonly boolean[], random: () => number): YachtFace[] {
  return dice.map((die, index) => (held[index] ? die : (Math.floor(random() * 6) + 1) as YachtFace));
}

/** How many dice show each face, indexed 1 to 6 (index 0 is unused). */
export function yachtFaceCounts(dice: readonly YachtFace[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const die of dice) counts[die] += 1;
  return counts;
}

export function yachtSum(dice: readonly YachtFace[]): number {
  return dice.reduce<number>((sum, die) => sum + die, 0);
}

export function isYachtRoll(dice: readonly YachtFace[]): boolean {
  return dice.length === YACHT_DICE && dice.every((die) => die === dice[0]);
}

/** Longest run of consecutive faces among the dice. */
function longestRun(dice: readonly YachtFace[]): number {
  const counts = yachtFaceCounts(dice);
  let best = 0;
  let run = 0;
  for (let face = 1; face <= 6; face += 1) {
    run = counts[face] > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** What `dice` score in `box` when the box rules alone decide, before the Yacht joker. */
export function yachtBoxScore(box: YachtBox, dice: readonly YachtFace[]): number {
  const counts = yachtFaceCounts(dice);
  const most = Math.max(...counts);
  switch (box) {
    case 'threeKind': return most >= 3 ? yachtSum(dice) : 0;
    case 'fourKind': return most >= 4 ? yachtSum(dice) : 0;
    case 'fullHouse': return counts.includes(3) && counts.includes(2) ? YACHT_FULL_HOUSE : 0;
    case 'smallStraight': return longestRun(dice) >= 4 ? YACHT_SMALL_STRAIGHT : 0;
    case 'largeStraight': return longestRun(dice) >= 5 ? YACHT_LARGE_STRAIGHT : 0;
    case 'yacht': return isYachtRoll(dice) ? YACHT_YACHT : 0;
    case 'chance': return yachtSum(dice);
    default: return counts[upperFace(box)] * upperFace(box);
  }
}

/** A Yacht rolled while the Yacht box already holds 50: it earns the bonus and is a joker. */
export function isYachtJoker(card: YachtScorecard, dice: readonly YachtFace[]): boolean {
  return card.boxes.yacht === YACHT_YACHT && isYachtRoll(dice);
}

export function emptyBoxes(card: YachtScorecard): YachtBox[] {
  return YACHT_BOXES.filter((box) => card.boxes[box] === undefined);
}

/**
 * Boxes the dice may be written into. A joker must go to the matching upper box while it is empty, then
 * to any empty lower box, and only when none is left to an empty upper box (which scores 0).
 */
export function yachtLegalBoxes(card: YachtScorecard, dice: readonly YachtFace[]): YachtBox[] {
  const empty = emptyBoxes(card);
  if (!isYachtJoker(card, dice)) return empty;
  const matching = YACHT_UPPER_BOXES[dice[0] - 1];
  if (empty.includes(matching)) return [matching];
  const lower = empty.filter((box) => !isUpperBox(box));
  return lower.length > 0 ? lower : empty;
}

/** What `dice` score when written into `box`: a joker takes the full value of Full House and the straights. */
export function yachtScoreIn(card: YachtScorecard, box: YachtBox, dice: readonly YachtFace[]): number {
  if (isYachtJoker(card, dice)) {
    if (box === 'fullHouse') return YACHT_FULL_HOUSE;
    if (box === 'smallStraight') return YACHT_SMALL_STRAIGHT;
    if (box === 'largeStraight') return YACHT_LARGE_STRAIGHT;
  }
  return yachtBoxScore(box, dice);
}

/** The score of every legal box for the dice, for showing potential scores. */
export function yachtPotentials(card: YachtScorecard, dice: readonly YachtFace[]): Partial<Record<YachtBox, number>> {
  return Object.fromEntries(yachtLegalBoxes(card, dice).map((box) => [box, yachtScoreIn(card, box, dice)]));
}

/** The card after writing the dice into `box`, or null when the box is not a legal choice. */
export function yachtWrite(card: YachtScorecard, box: YachtBox, dice: readonly YachtFace[]): YachtScorecard | null {
  if (dice.length !== YACHT_DICE || !yachtLegalBoxes(card, dice).includes(box)) return null;
  return {
    boxes: { ...card.boxes, [box]: yachtScoreIn(card, box, dice) },
    extraYachts: card.extraYachts + (isYachtJoker(card, dice) ? 1 : 0),
  };
}

export interface YachtTotals {
  readonly upper: number;
  readonly upperBonus: number;
  readonly lower: number;
  readonly extra: number;
  readonly total: number;
}

export function yachtTotals(card: YachtScorecard): YachtTotals {
  const sum = (boxes: readonly YachtBox[]): number => boxes.reduce((total, box) => total + (card.boxes[box] ?? 0), 0);
  const upper = sum(YACHT_UPPER_BOXES);
  const upperBonus = upper >= YACHT_UPPER_BONUS_TARGET ? YACHT_UPPER_BONUS : 0;
  const lower = sum(YACHT_LOWER_BOXES);
  const extra = card.extraYachts * YACHT_EXTRA_BONUS;
  return { upper, upperBonus, lower, extra, total: upper + upperBonus + lower + extra };
}

/** Yachts the card holds: the Yacht box plus every extra one. */
export function yachtCount(card: YachtScorecard): number {
  return (card.boxes.yacht === YACHT_YACHT ? 1 : 0) + card.extraYachts;
}

export function isYachtCardFull(card: YachtScorecard): boolean {
  return emptyBoxes(card).length === 0;
}

/** Seats with the highest total share the win. */
export function yachtWinners<S extends string>(totals: Readonly<Partial<Record<S, number>>>, seats: readonly S[]): S[] {
  const best = Math.max(...seats.map((seat) => totals[seat] ?? 0));
  return seats.filter((seat) => (totals[seat] ?? 0) === best);
}

/** A stored card: filled boxes hold scores a box can produce, and extra Yachts need a Yacht worth 50. */
export function isYachtScorecard(value: unknown): value is YachtScorecard {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const card = value as Record<string, unknown>;
  if (Object.keys(card).length !== 2 || typeof card.extraYachts !== 'number' || !Number.isSafeInteger(card.extraYachts)
    || card.extraYachts < 0) return false;
  const boxes = card.boxes;
  if (typeof boxes !== 'object' || boxes === null || Array.isArray(boxes)) return false;
  const entries = Object.entries(boxes as Record<string, unknown>);
  return entries.every(([box, score]) => isYachtBox(box) && typeof score === 'number' && Number.isSafeInteger(score)
    && score >= 0 && score <= YACHT_YACHT)
    && (card.extraYachts === 0 || (boxes as Record<string, unknown>).yacht === YACHT_YACHT);
}
