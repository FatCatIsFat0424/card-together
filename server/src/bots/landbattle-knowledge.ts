// ─── Land Battle Chess bot knowledge: what the seat's own view reveals about the opponent's pieces ───
//
// Everything here reads one seat's filtered view: its own deployment, the public move list with battle
// outcomes, and any shown flag. Opponent pieces are tracked by the station they were deployed on.

import type { LandBattleVisibleState } from '@shared/types';
import {
  LB_COUNTS, LB_NODES, LB_PIECES_PER_SIDE, LB_RANKS, lbBattle, lbCell, lbDeploySlots, lbIsHq, lbMobile, lbSlotIndex, lbSlotOf, lbSlotProblem, lbSteps,
} from '@shared/rules/landbattle';
import type { LbCell, LbRank, LbSide } from '@shared/rules/landbattle';

/** A piece as the bot tracks it: own pieces carry their rank, opponent pieces their deployment station. */
export interface LbBotCell extends LbCell {
  /** Deployment station of an opponent piece; -1 for own pieces */
  readonly token: number;
}

export interface LbKnowledge {
  readonly side: LbSide;
  readonly board: readonly (LbBotCell | null)[];
  /** Opponent deployment stations, one token each, alive or not */
  readonly tokens: readonly number[];
  readonly alive: ReadonlySet<number>;
  /** Identities each opponent token can still have, by token */
  readonly allowed: ReadonlyMap<number, ReadonlySet<LbRank>>;
  /** Estimated identity probabilities of each opponent token, by token */
  readonly odds: ReadonlyMap<number, Readonly<Record<LbRank, number>>>;
  /** Own ranks removed so far */
  readonly ownLost: readonly LbRank[];
}

/** Whether the route turns a corner, which only an engineer can do. */
function turns(route: readonly number[]): boolean {
  for (let index = 2; index < route.length; index++) {
    const [a, b, c] = [route[index - 2], route[index - 1], route[index]];
    const d1 = [b % 5 - a % 5, Math.floor(b / 5) - Math.floor(a / 5)];
    const d2 = [c % 5 - b % 5, Math.floor(c / 5) - Math.floor(b / 5)];
    if (d1[0] !== d2[0] || d1[1] !== d2[1]) return true;
  }
  return false;
}

/** How much likelier a mine is on a station next to a headquarters: formations usually ring the flag with mines. */
const MINE_NEAR_HQ = 4;

/** Deployment habits: mines next to a headquarters. Only weights the odds; it never rules an identity out. */
export function deploymentPrior(token: number, rank: LbRank): number {
  return rank === 'mine' && lbSteps(token).some(lbIsHq) ? MINE_NEAR_HQ : 1;
}

/**
 * Spreads probability so each token sums to one and each identity to its count among all tokens, starting
 * from the identity counts times `prior`.
 */
export function estimateOdds(
  tokens: readonly number[], allowed: ReadonlyMap<number, ReadonlySet<LbRank>>,
  prior: (token: number, rank: LbRank) => number = () => 1,
): Map<number, Record<LbRank, number>> {
  const weights = new Map<number, Record<LbRank, number>>();
  for (const token of tokens) {
    const set = allowed.get(token)!;
    weights.set(token, Object.fromEntries(LB_RANKS.map((rank) => [rank, set.has(rank) ? LB_COUNTS[rank] * prior(token, rank) : 0])) as Record<LbRank, number>);
  }
  for (let round = 0; round < 24; round++) {
    for (const row of weights.values()) {
      const total = LB_RANKS.reduce((sum, rank) => sum + row[rank], 0);
      if (total > 0) for (const rank of LB_RANKS) row[rank] /= total;
    }
    for (const rank of LB_RANKS) {
      let total = 0;
      for (const row of weights.values()) total += row[rank];
      if (total > 0) for (const row of weights.values()) row[rank] *= LB_COUNTS[rank] / total;
    }
  }
  for (const row of weights.values()) {
    const total = LB_RANKS.reduce((sum, rank) => sum + row[rank], 0);
    if (total > 0) for (const rank of LB_RANKS) row[rank] /= total;
  }
  return weights;
}

/**
 * Replays the public moves from the seat's own deployment. Each opponent piece starts with the identities
 * its station allows (flag in a headquarters, mines in the last two rows, no bomb on the front row); moving
 * rules out mines and the flag, turning along a railway means an engineer, every battle keeps only the
 * identities that give its published outcome against the known own piece (and never the flag, since play
 * went on), and a shown flag or a fallen marshal pins the piece down. `inferBattles` false keeps only what movement shows (the easy bot).
 */
export function landBattleKnowledge(visible: LandBattleVisibleState, inferBattles = true): LbKnowledge | null {
  const index = visible.seats.indexOf(visible.mySeat);
  const layout = visible.myLayout;
  if (index < 0 || !layout || visible.phase === 'deploying') return null;
  const side: LbSide = index === 0 ? 0 : 1;
  const opponentSide: LbSide = side === 0 ? 1 : 0;
  const opponentSeat = visible.seats[opponentSide];
  const board: (LbBotCell | null)[] = new Array<LbBotCell | null>(LB_NODES).fill(null);
  layout.forEach((rank, slot) => { board[lbSlotIndex(side, slot)] = { side, rank, token: -1 }; });
  const tokens = lbDeploySlots(opponentSide);
  const allowed = new Map<number, Set<LbRank>>();
  for (const token of tokens) {
    const slot = lbSlotOf(opponentSide, token);
    allowed.set(token, new Set(LB_RANKS.filter((rank) => lbSlotProblem(rank, slot) === null)));
    board[token] = { side: opponentSide, token };
  }
  const alive = new Set(tokens);
  const ownLost: LbRank[] = [];
  const keep = (token: number, test: (rank: LbRank) => boolean): void => {
    const set = allowed.get(token)!;
    const next = new Set([...set].filter(test));
    // A contradiction (impossible with a correct log) keeps the earlier knowledge rather than none.
    if (next.size > 0) allowed.set(token, next);
  };

  for (const entry of visible.log) {
    const from = lbCell(entry.from);
    const to = lbCell(entry.to);
    const mover = from === null ? null : board[from];
    if (from === null || to === null || !mover) return null;
    const moverIsOpponent = mover.side === opponentSide;
    if (moverIsOpponent) {
      keep(mover.token, lbMobile);
      const route = [from, ...(entry.path ?? []).map((node) => lbCell(node) ?? -1), to];
      if (turns(route)) keep(mover.token, (rank) => rank === 'engineer');
    }
    const defender = board[to];
    board[from] = null;
    if (!entry.battle || !defender) {
      board[to] = mover;
      continue;
    }
    const opponentPiece = moverIsOpponent ? mover : defender;
    const ownPiece = moverIsOpponent ? defender : mover;
    const ownRank = ownPiece.rank!;
    if (inferBattles) {
      // A battle against the flag ends the match, so a piece that fought while play goes on is not the flag.
      keep(opponentPiece.token, (rank) => rank !== 'flag'
        && (moverIsOpponent ? lbBattle(rank, ownRank) : lbBattle(ownRank, rank)) === entry.battle);
    }
    const attackerWins = entry.battle === 'win';
    const removed = entry.battle === 'tie' ? [mover, defender] : attackerWins ? [defender] : [mover];
    board[to] = attackerWins ? mover : entry.battle === 'lose' ? defender : null;
    for (const piece of removed) {
      if (piece.side === side) ownLost.push(piece.rank!);
      else {
        alive.delete(piece.token);
        if (entry.flagShown?.includes(opponentSeat)) keep(piece.token, (rank) => rank === 'marshal');
      }
    }
  }

  // The view is the authority on where pieces stand; a mismatch means the log could not be followed.
  for (const piece of visible.pieces) {
    const at = lbCell(piece.node);
    const cell = at === null ? null : board[at];
    if (!cell || cell.side !== piece.side) return null;
    if (piece.side === opponentSide && piece.rank) keep(cell.token, (rank) => rank === piece.rank);
  }
  if (board.filter((cell) => cell !== null).length !== visible.pieces.length) return null;

  // Identities pinned down elsewhere are not available to the other tokens.
  for (let pass = 0; pass < 3; pass++) {
    for (const rank of LB_RANKS) {
      const pinned = tokens.filter((token) => {
        const set = allowed.get(token)!;
        return set.size === 1 && set.has(rank);
      });
      if (pinned.length < LB_COUNTS[rank]) continue;
      for (const token of tokens) if (!pinned.includes(token)) keep(token, (other) => other !== rank);
    }
  }
  return { side, board, tokens, alive, allowed, odds: estimateOdds(tokens, allowed, inferBattles ? deploymentPrior : undefined), ownLost };
}

/** Plain prior knowledge, which ignores battle outcomes: the easy bot and the immediate fallback use it. */
export function movementKnowledge(visible: LandBattleVisibleState): LbKnowledge | null {
  return landBattleKnowledge(visible, false);
}

/** The most likely identities of a token, most probable first. */
export function likelyRanks(knowledge: LbKnowledge, token: number): LbRank[] {
  const odds = knowledge.odds.get(token);
  return odds ? LB_RANKS.filter((rank) => odds[rank] > 0).sort((a, b) => odds[b] - odds[a]) : [];
}

/**
 * One full assignment of identities to the opponent's pieces (dead ones too, so living ones see the right
 * remaining counts), drawn in proportion to the estimated odds while respecting the counts. An identity
 * with exactly as many candidate pieces left as copies goes to those pieces at once; otherwise the piece
 * with the fewest choices is drawn next.
 */
export function sampleIdentities(knowledge: LbKnowledge, random: () => number): Map<number, LbRank> | null {
  // Counts can only force identities when every copy goes to some piece, as in a real match.
  const exact = knowledge.tokens.length === LB_PIECES_PER_SIDE;
  for (let attempt = 0; attempt < 8; attempt++) {
    const left: Record<LbRank, number> = { ...LB_COUNTS };
    const open = new Set(knowledge.tokens);
    const drawn = new Map<number, LbRank>();
    const assign = (token: number, rank: LbRank): void => {
      left[rank]--;
      open.delete(token);
      drawn.set(token, rank);
    };
    let failed = false;
    while (open.size > 0 && !failed) {
      let forced = false;
      for (const rank of exact ? LB_RANKS : []) {
        if (left[rank] === 0) continue;
        const candidates = [...open].filter((token) => knowledge.allowed.get(token)!.has(rank));
        if (candidates.length < left[rank]) failed = true;
        else if (candidates.length === left[rank]) {
          for (const token of candidates) assign(token, rank);
          forced = true;
        }
        if (failed || forced) break;
      }
      if (failed || forced) continue;
      let token = -1;
      let choices: LbRank[] = [];
      for (const candidate of open) {
        const options = [...knowledge.allowed.get(candidate)!].filter((rank) => left[rank] > 0);
        if (token < 0 || options.length < choices.length) [token, choices] = [candidate, options];
      }
      if (choices.length === 0) {
        failed = true;
        continue;
      }
      const odds = knowledge.odds.get(token)!;
      const weights = choices.map((rank) => odds[rank] * left[rank] + 1e-6);
      let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
      let choice = choices[choices.length - 1];
      for (let pick = 0; pick < choices.length; pick++) {
        roll -= weights[pick];
        if (roll <= 0) {
          choice = choices[pick];
          break;
        }
      }
      assign(token, choice);
    }
    if (!failed) return drawn;
  }
  return null;
}
