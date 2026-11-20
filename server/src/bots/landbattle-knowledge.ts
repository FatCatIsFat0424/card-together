// ─── Land Battle Chess bot knowledge: what the seat's own view reveals about both sides' pieces ───
//
// Everything here reads one seat's filtered view: its own deployment, the public move list with battle
// outcomes, and any shown flag. Pieces are tracked by the station they were deployed on (their token), which
// every seat sees. Besides the hard constraints on each opponent piece, the replay records how each one
// behaved (for the likelihood in `landbattle-inference.ts`) and what the opponent has seen of our pieces.

import type { LandBattleVisibleState } from '@shared/types';
import {
  LB_COUNTS, LB_NODES, LB_RANKS, lbBattle, lbCell, lbDeploySlots, lbMobile, lbSlotIndex, lbSlotOf, lbSlotProblem, lbSteps,
} from '@shared/rules/landbattle';
import type { LbCell, LbRank, LbSide } from '@shared/rules/landbattle';

/** A piece as the bot tracks it: own pieces carry their rank; every piece carries its deployment station. */
export interface LbBotCell extends LbCell {
  /** Deployment station of the piece */
  readonly token: number;
}

/** One battle an own piece fought, as both seats saw it. */
export interface LbOwnBattle {
  /** The opponent piece's token */
  readonly token: number;
  /** Whether our piece attacked */
  readonly attacked: boolean;
  readonly outcome: 'win' | 'lose' | 'tie';
}

/** What the opponent has seen of one of our pieces: everything except identities its own pieces revealed. */
export interface LbOwnPublic {
  readonly moved: boolean;
  /** Turned along a railway, which only an engineer can */
  readonly turned: boolean;
  readonly battles: readonly LbOwnBattle[];
}

/** How an opponent piece behaved in public, for the generic behaviour likelihood. */
export interface LbBehaviour {
  /** Battles it started */
  readonly attacks: number;
  readonly moved: boolean;
  /** Own ranks of pieces that had already won a battle and that it stepped next to without attacking */
  readonly approached: readonly LbRank[];
  /** Own ranks of pieces that had already won a battle and that it stepped away from */
  readonly fled: readonly LbRank[];
}

export interface LbKnowledge {
  readonly side: LbSide;
  readonly board: readonly (LbBotCell | null)[];
  /** Opponent deployment stations, one token each, alive or not */
  readonly tokens: readonly number[];
  readonly alive: ReadonlySet<number>;
  /** Identities each opponent token can still have, by token */
  readonly allowed: ReadonlyMap<number, ReadonlySet<LbRank>>;
  /** Public behaviour of each opponent token */
  readonly behaviour: ReadonlyMap<number, LbBehaviour>;
  /** What the opponent has seen of each own piece, by token */
  readonly ownPublic: ReadonlyMap<number, LbOwnPublic>;
  /** Own ranks removed so far */
  readonly ownLost: readonly LbRank[];
  /** Moves the opponent has made */
  readonly opponentMoves: number;
}

/** Whether the route turns a corner, which only an engineer can do. */
export function routeTurns(route: readonly number[]): boolean {
  for (let index = 2; index < route.length; index++) {
    const [a, b, c] = [route[index - 2], route[index - 1], route[index]];
    if (b % 5 - a % 5 !== c % 5 - b % 5 || Math.floor(b / 5) - Math.floor(a / 5) !== Math.floor(c / 5) - Math.floor(b / 5)) return true;
  }
  return false;
}

interface MutableBehaviour { attacks: number; moved: boolean; approached: LbRank[]; fled: LbRank[] }
interface MutableOwn { moved: boolean; turned: boolean; battles: LbOwnBattle[]; wins: number }

/** Own pieces next to `at` that have won a battle, which the opponent knows to be strong. */
function provenNeighbours(board: readonly (LbBotCell | null)[], at: number, side: LbSide, own: ReadonlyMap<number, MutableOwn>): LbBotCell[] {
  return lbSteps(at).flatMap((next) => {
    const cell = board[next];
    return cell && cell.side === side && (own.get(cell.token)?.wins ?? 0) > 0 ? [cell] : [];
  });
}

/**
 * Replays the public moves from the seat's own deployment. Each opponent piece starts with the identities
 * its station allows (flag in a headquarters, mines in the last two rows, no bomb on the front row); moving
 * rules out mines and the flag, turning along a railway means an engineer, every battle keeps only the
 * identities that give its published outcome against the known own piece (and never the flag, since play
 * went on), and a shown flag or a fallen marshal pins the piece down.
 */
export function landBattleKnowledge(visible: LandBattleVisibleState): LbKnowledge | null {
  const index = visible.seats.indexOf(visible.mySeat);
  const layout = visible.myLayout;
  if (index < 0 || !layout || visible.phase === 'deploying') return null;
  const side: LbSide = index === 0 ? 0 : 1;
  const opponentSide: LbSide = side === 0 ? 1 : 0;
  const opponentSeat = visible.seats[opponentSide];
  const board: (LbBotCell | null)[] = new Array<LbBotCell | null>(LB_NODES).fill(null);
  const ownPublic = new Map<number, MutableOwn>();
  layout.forEach((rank, slot) => {
    const at = lbSlotIndex(side, slot);
    board[at] = { side, rank, token: at };
    ownPublic.set(at, { moved: false, turned: false, battles: [], wins: 0 });
  });
  const tokens = lbDeploySlots(opponentSide);
  const allowed = new Map<number, Set<LbRank>>();
  const behaviour = new Map<number, MutableBehaviour>();
  for (const token of tokens) {
    const slot = lbSlotOf(opponentSide, token);
    allowed.set(token, new Set(LB_RANKS.filter((rank) => lbSlotProblem(rank, slot) === null)));
    behaviour.set(token, { attacks: 0, moved: false, approached: [], fled: [] });
    board[token] = { side: opponentSide, token };
  }
  const alive = new Set(tokens);
  const ownLost: LbRank[] = [];
  let opponentMoves = 0;
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
    const route = [from, ...(entry.path ?? []).map((node) => lbCell(node) ?? -1), to];
    const defender = board[to];
    if (moverIsOpponent) {
      opponentMoves++;
      keep(mover.token, lbMobile);
      if (routeTurns(route)) keep(mover.token, (rank) => rank === 'engineer');
      const record = behaviour.get(mover.token)!;
      record.moved = true;
      if (defender) record.attacks++;
      else {
        // Stepping next to a proven own piece without attacking, or away from one, hints at its strength.
        const before = provenNeighbours(board, from, side, ownPublic).map((cell) => cell.token);
        board[from] = null;
        const after = provenNeighbours(board, to, side, ownPublic);
        board[from] = mover;
        for (const cell of after) if (!before.includes(cell.token)) record.approached.push(cell.rank!);
        for (const token of before) {
          if (!after.some((cell) => cell.token === token)) record.fled.push(board.find((cell) => cell?.token === token)!.rank!);
        }
      }
    } else {
      const record = ownPublic.get(mover.token)!;
      record.moved = true;
      if (routeTurns(route)) record.turned = true;
    }
    board[from] = null;
    if (!entry.battle || !defender) {
      board[to] = mover;
      continue;
    }
    const opponentPiece = moverIsOpponent ? mover : defender;
    const ownPiece = moverIsOpponent ? defender : mover;
    const ownRank = ownPiece.rank!;
    // A battle against the flag ends the match, so a piece that fought while play goes on is not the flag.
    keep(opponentPiece.token, (rank) => rank !== 'flag'
      && (moverIsOpponent ? lbBattle(rank, ownRank) : lbBattle(ownRank, rank)) === entry.battle);
    const ownRecord = ownPublic.get(ownPiece.token)!;
    ownRecord.battles.push({ token: opponentPiece.token, attacked: !moverIsOpponent, outcome: entry.battle });
    if ((moverIsOpponent ? entry.battle === 'lose' : entry.battle === 'win')) ownRecord.wins++;
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

  pinCounts(tokens, allowed);
  return {
    side, board, tokens, alive, allowed, behaviour, ownLost, opponentMoves,
    ownPublic: new Map([...ownPublic].map(([token, record]) => [token, { moved: record.moved, turned: record.turned, battles: record.battles }])),
  };
}

/** Identities pinned down on as many tokens as there are copies are not available to the other tokens. */
export function pinCounts(tokens: readonly number[], allowed: Map<number, Set<LbRank>>): void {
  for (let pass = 0; pass < 3; pass++) {
    for (const rank of LB_RANKS) {
      const pinned = tokens.filter((token) => {
        const set = allowed.get(token)!;
        return set.size === 1 && set.has(rank);
      });
      if (pinned.length < LB_COUNTS[rank]) continue;
      for (const token of tokens) {
        if (pinned.includes(token)) continue;
        const set = allowed.get(token)!;
        if (set.size > 1 && set.has(rank)) allowed.set(token, new Set([...set].filter((other) => other !== rank)));
      }
    }
  }
}
