import type {
  Card, GameSeat, NapoleonCard, NapoleonContract, NapoleonTrick, NapoleonVisibleState, Suit,
} from '@shared/types';
import {
  createNapoleonDeck, hasNapoleonCard, isNapoleonFinalTrick, isNapoleonFreeCard, isNapoleonJoker,
  isNapoleonPointCard, napoleonDealSize, napoleonPlayedCards, napoleonTrickIndex, napoleonTrickWinner,
  NAPOLEON_FINAL_TRICKS, sameNapoleonCard,
} from '@shared/rules/napoleon';

export type NapoleonRole = 'napoleon' | 'secretary' | 'defender';

/** What one seat can deduce from its own filtered view during play. */
export interface NapoleonTable {
  readonly visible: NapoleonVisibleState;
  readonly seat: GameSeat;
  readonly role: NapoleonRole;
  readonly contract: NapoleonContract;
  readonly secretaryCard: NapoleonCard;
  readonly trump: Suit | null;
  readonly hand: readonly NapoleonCard[];
  readonly trickIndex: number;
  readonly finalTrick: boolean;
  /** Tricks still to finish, including the one in progress */
  readonly tricksLeft: number;
  /** Tricks before the final three still to finish, including the one in progress */
  readonly jokerTricksLeft: number;
  /** Cards this seat cannot locate: other hands plus discards it cannot see */
  readonly unseen: readonly NapoleonCard[];
  /** Point cards expected in other hands, excluding an estimate for hidden discards */
  readonly unseenHandPoints: number;
  /** Suits each seat has shown it lacks by not following */
  readonly voids: ReadonlyMap<GameSeat, ReadonlySet<Suit>>;
  /** Probability that each other seat holds the secretary card */
  readonly secretaryOdds: ReadonlyMap<GameSeat, number>;
  /** Probability that each seat is on this seat's side; this seat is 1 */
  readonly allies: ReadonlyMap<GameSeat, number>;
}

/** Seats that still play after this seat in the trick, in play order. */
export function seatsAfter(table: NapoleonTable, trick: NapoleonTrick): GameSeat[] {
  const seats = table.visible.seats;
  const start = seats.indexOf(trick.leadSeat);
  const order = seats.map((_, offset) => seats[(start + offset) % seats.length]);
  return order.filter((seat) => !trick.plays.some((play) => play.seat === seat) && seat !== table.seat);
}

export function cardPoints(card: NapoleonCard): number {
  return isNapoleonPointCard(card) ? 1 : 0;
}

export function suitOf(card: NapoleonCard): Suit | null {
  return isNapoleonJoker(card) ? null : card.suit;
}

/** Suits a seat failed to follow with an ordinary card. */
function findVoids(visible: NapoleonVisibleState): Map<GameSeat, Set<Suit>> {
  const voids = new Map<GameSeat, Set<Suit>>(visible.seats.map((seat) => [seat, new Set<Suit>()]));
  const tricks: NapoleonTrick[] = [...visible.tricks, ...(visible.trick ? [visible.trick] : [])];
  for (const trick of tricks) {
    if (!trick.leadSuit) continue;
    for (const play of trick.plays.slice(1)) {
      if (isNapoleonFreeCard(visible, play.card) || isNapoleonJoker(play.card)) continue;
      if (play.card.suit !== trick.leadSuit) voids.get(play.seat)?.add(trick.leadSuit);
    }
  }
  return voids;
}

/**
 * Weighs public behavior: feeding points onto the Napoleon's winning card suggests the secretary,
 * while overtaking the Napoleon or feeding another seat suggests a defender.
 */
function secretaryEvidence(visible: NapoleonVisibleState, napoleon: GameSeat): Map<GameSeat, number> {
  const evidence = new Map<GameSeat, number>(visible.seats.map((seat) => [seat, 1]));
  const tricks: NapoleonTrick[] = [...visible.tricks, ...(visible.trick ? [visible.trick] : [])];
  tricks.forEach((trick, index) => {
    if (!trick.leadSuit) return;
    for (let i = 1; i < trick.plays.length; i++) {
      const play = trick.plays[i];
      if (play.seat === napoleon || isNapoleonFreeCard(visible, play.card)) continue;
      const before = napoleonTrickWinner(visible, { ...trick, plays: trick.plays.slice(0, i) }, index);
      const after = napoleonTrickWinner(visible, { ...trick, plays: trick.plays.slice(0, i + 1) }, index);
      const factor = before === napoleon
        ? (after === play.seat ? 0.45 : isNapoleonPointCard(play.card) ? 2.5 : 1)
        : (after === before && isNapoleonPointCard(play.card) ? 0.6 : 1);
      evidence.set(play.seat, (evidence.get(play.seat) ?? 1) * factor);
    }
  });
  return evidence;
}

function secretaryOddsFor(
  visible: NapoleonVisibleState, role: NapoleonRole, contract: NapoleonContract, secretaryCard: NapoleonCard,
): Map<GameSeat, number> {
  const seat = visible.mySeat;
  const others = visible.seats.filter((other) => other !== seat && other !== contract.napoleon);
  const odds = new Map<GameSeat, number>(visible.seats.map((other) => [other, 0]));
  if (role === 'secretary') return odds;
  if (visible.secretarySeat) {
    if (visible.secretarySeat !== seat) odds.set(visible.secretarySeat, 1);
    return odds;
  }
  if (hasNapoleonCard(visible.myHand, secretaryCard) || hasNapoleonCard(visible.discards ?? [], secretaryCard)
    || hasNapoleonCard(napoleonPlayedCards(visible), secretaryCard)) return odds;
  const evidence = secretaryEvidence(visible, contract.napoleon);
  // A defender cannot rule out a Napoleon holding or discarding its own call; the Napoleon can.
  const noSecretary = role === 'napoleon' ? 0 : visible.discards ? 0.1 : 0.25;
  const total = others.reduce((sum, other) => sum + (evidence.get(other) ?? 1), noSecretary);
  for (const other of others) odds.set(other, total > 0 ? (evidence.get(other) ?? 1) / total : 0);
  return odds;
}

export function readTable(visible: NapoleonVisibleState): NapoleonTable | null {
  const contract = visible.contract;
  const secretaryCard = visible.secretaryCard;
  if (!contract || !secretaryCard) return null;
  const seat = visible.mySeat;
  const role: NapoleonRole = contract.napoleon === seat ? 'napoleon'
    : visible.secretarySeat === seat || hasNapoleonCard(visible.myHand, secretaryCard) ? 'secretary' : 'defender';
  const { hand: handSize } = napoleonDealSize(visible.seats.length);
  const trickIndex = napoleonTrickIndex(visible);
  const played = napoleonPlayedCards(visible);
  const known = [...visible.myHand, ...played, ...(visible.discards ?? [])];
  const unseen = createNapoleonDeck().filter((card) => !hasNapoleonCard(known, card));
  const inHands = visible.seats.filter((other) => other !== seat)
    .reduce((sum, other) => sum + (visible.handCounts[other] ?? 0), 0);
  const unseenPoints = unseen.filter(isNapoleonPointCard).length;
  const unseenHandPoints = unseen.length > 0 ? unseenPoints * Math.min(1, inHands / unseen.length) : 0;
  const secretaryOdds = secretaryOddsFor(visible, role, contract, secretaryCard);
  const allies = new Map<GameSeat, number>();
  for (const other of visible.seats) {
    const odds = secretaryOdds.get(other) ?? 0;
    allies.set(other, other === seat ? 1
      : role === 'napoleon' ? odds
        : role === 'secretary' ? Number(other === contract.napoleon)
          : other === contract.napoleon ? 0 : 1 - odds);
  }
  const tricksLeft = handSize - trickIndex;
  return {
    visible, seat, role, contract, secretaryCard,
    trump: contract.suit === 'nt' ? null : contract.suit,
    hand: visible.myHand,
    trickIndex,
    finalTrick: isNapoleonFinalTrick(trickIndex, visible.seats.length),
    tricksLeft,
    jokerTricksLeft: Math.max(0, tricksLeft - NAPOLEON_FINAL_TRICKS),
    unseen,
    unseenHandPoints,
    voids: findVoids(visible),
    secretaryOdds,
    allies,
  };
}

export function allyOf(table: NapoleonTable, seat: GameSeat): number {
  return table.allies.get(seat) ?? 0;
}

/** Probability that `seat` holds a particular unseen card. */
export function holdChance(table: NapoleonTable, seat: GameSeat, card: NapoleonCard): number {
  if (sameNapoleonCard(card, table.secretaryCard)) return table.secretaryOdds.get(seat) ?? 0;
  const suit = suitOf(card);
  if (suit && !isNapoleonFreeCard(table.visible, card) && table.voids.get(seat)?.has(suit)) return 0;
  const count = table.visible.handCounts[seat] ?? 0;
  return table.unseen.length > 0 ? Math.min(1, count / table.unseen.length) : 0;
}

function anyHeld(table: NapoleonTable, seat: GameSeat, cards: readonly NapoleonCard[]): number {
  return 1 - cards.reduce((miss, card) => miss * (1 - holdChance(table, seat, card)), 1);
}

/**
 * Probability that a later seat can beat the current winner of `trick`. A trump only counts when the
 * seat is out of the led suit; the secretary card and jokers may be played at any time.
 */
export function beatChance(table: NapoleonTable, trick: NapoleonTrick, seat: GameSeat): number {
  const leadSuit = trick.leadSuit;
  if (!leadSuit) return 0;
  const beaters = table.unseen.filter((card) => napoleonTrickWinner(
    table.visible, { ...trick, plays: [...trick.plays, { seat, card }] }, table.trickIndex,
  ) === seat);
  if (beaters.length === 0) return 0;
  const free = beaters.filter((card) => isNapoleonFreeCard(table.visible, card));
  const follow = beaters.filter((card) => !isNapoleonFreeCard(table.visible, card) && suitOf(card) === leadSuit);
  const ruff = beaters.filter((card) => !isNapoleonFreeCard(table.visible, card) && suitOf(card) !== leadSuit);
  const leadCards = table.unseen.filter((card) => !isNapoleonFreeCard(table.visible, card) && suitOf(card) === leadSuit);
  const outOfSuit = table.voids.get(seat)?.has(leadSuit) ? 1 : 1 - anyHeld(table, seat, leadCards);
  const pFree = anyHeld(table, seat, free);
  const pFollow = anyHeld(table, seat, follow);
  const pRuff = outOfSuit * anyHeld(table, seat, ruff);
  return 1 - (1 - pFree) * (1 - pFollow) * (1 - pRuff);
}

/** Probability that this seat's side takes `trick` once the remaining seats have played. */
export function sideWinChance(table: NapoleonTable, trick: NapoleonTrick, later: readonly GameSeat[]): number {
  const winner = napoleonTrickWinner(table.visible, trick, table.trickIndex);
  const winnerAlly = allyOf(table, winner);
  // The outnumbered Napoleon's side assumes defenders always beat it when they can; defenders allow
  // that the other side sometimes saves a winner for a richer trick.
  const effort = table.role === 'defender' ? 0.85 : 1;
  let keep = 1;
  let rescue = 1;
  for (const seat of later) {
    const beat = beatChance(table, trick, seat);
    const ally = allyOf(table, seat);
    keep *= 1 - beat * (1 - ally) * effort;
    rescue *= 1 - beat * ally;
  }
  return winnerAlly * keep + (1 - winnerAlly) * (1 - rescue);
}

/** Point cards per unfinished trick that the remaining hands still hold. */
export function pointsPerTrick(table: NapoleonTable): number {
  const inPlay = table.unseenHandPoints + table.hand.filter(isNapoleonPointCard).length;
  return table.tricksLeft > 0 ? inPlay / table.tricksLeft : 0;
}

function unseenHigher(table: NapoleonTable, card: Card): number {
  return table.unseen.filter((other) => !isNapoleonJoker(other) && other.suit === card.suit && other.rank > card.rank
    && !sameNapoleonCard(other, table.secretaryCard)).length;
}

function unseenTrumps(table: NapoleonTable): number {
  return table.trump ? table.unseen.filter((card) => suitOf(card) === table.trump).length : 0;
}

/** Rough chance that holding the card lets it win a later trick. */
export function winPower(table: NapoleonTable, card: NapoleonCard): number {
  if (sameNapoleonCard(card, table.secretaryCard)) return 1;
  const secretaryOut = hasNapoleonCard(table.unseen, table.secretaryCard) ? 1 : 0;
  if (isNapoleonJoker(card)) {
    const jokers = table.hand.filter(isNapoleonJoker).length;
    // Jokers lose their strength in the final tricks; with more jokers than tricks before then, one is lost.
    const usable = Math.min(1, Math.max(0, table.jokerTricksLeft - 1) / Math.max(1, jokers));
    const bigOut = card.joker === 'small' && hasNapoleonCard(table.unseen, { joker: 'big' });
    return usable * (bigOut ? 0.75 : 0.92) * (1 - 0.1 * secretaryOut);
  }
  const jokersOut = table.finalTrick ? 0 : table.unseen.filter(isNapoleonJoker).length;
  const higher = unseenHigher(table, card) + secretaryOut * 0.7 + jokersOut * 0.5;
  if (card.suit === table.trump) return 0.92 * 0.55 ** higher;
  const trumpsOut = unseenTrumps(table);
  const ruff = trumpsOut === 0 ? 0.05 : Math.min(0.8, 0.12 + table.trickIndex * 0.06 + (6 - Math.min(6, trumpsOut)) * 0.02);
  return 0.85 * 0.45 ** higher * (1 - ruff);
}

/** Points a richer later trick may add when the always-winning secretary card waits for it. */
export function secretaryKeepValue(table: NapoleonTable): number {
  return Math.min(1.5, 0.45 * Math.max(0, table.tricksLeft - 1));
}

/** Expected points the card earns for this seat's side if kept for later. */
export function holdValue(table: NapoleonTable, card: NapoleonCard): number {
  const power = winPower(table, card);
  const feed = table.role === 'defender' ? 0.45 : table.role === 'secretary' ? 0.35 : 0.15;
  const ownPoint = cardPoints(card) * (power + (1 - power) * feed);
  if (sameNapoleonCard(card, table.secretaryCard)) return cardPoints(card) + secretaryKeepValue(table);
  return ownPoint + power * pointsPerTrick(table) * 1.1;
}
