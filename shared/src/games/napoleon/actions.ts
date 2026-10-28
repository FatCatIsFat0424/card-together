import type { BidSuit, NapoleonAction, NapoleonBidLevel, NapoleonCard, NapoleonSummon, Suit } from '../../types/game';
import { napoleonDefinition } from './definition';
import { BID_SUIT_ORDER } from '../../constants';
import { NAPOLEON_BID_LEVELS, isNapoleonCard, isNapoleonJoker, napoleonCardKey, napoleonDealSize } from '../../rules/napoleon';

export type { NapoleonAction } from '../../types/game';

const NAPOLEON_SUITS: readonly unknown[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const NAPOLEON_SUMMONS: readonly unknown[] = ['secretary', 'bigJoker', 'smallJoker'];
/** The most cards any Napoleon exchange returns: the six-player table. */
const NAPOLEON_MAX_DISCARDS = napoleonDealSize(napoleonDefinition.seats.maxPlayers).kitty;

function parseNapoleonCard(value: unknown): NapoleonCard | null {
  if (!isNapoleonCard(value)) return null;
  return isNapoleonJoker(value) ? { joker: value.joker } : { suit: value.suit, rank: value.rank };
}

/** Rebuilds a Napoleon action so client-supplied extra keys never reach saved state. */
function parseNapoleonAction(value: unknown): NapoleonAction | null {
  if (typeof value !== 'object' || value === null) return null;
  const { type, action, cards, card, leadSuit, summon } = value as Record<string, unknown>;
  if (type === 'review') return { type };
  if (type === 'bid') {
    if (typeof action !== 'object' || action === null) return null;
    const bid = action as Record<string, unknown>;
    if (bid.type === 'pass') return { type, action: { type: 'pass' } };
    return bid.type === 'bid' && NAPOLEON_BID_LEVELS.includes(bid.level as NapoleonBidLevel)
      && (BID_SUIT_ORDER as readonly unknown[]).includes(bid.suit)
      ? { type, action: { type: 'bid', level: bid.level as NapoleonBidLevel, suit: bid.suit as BidSuit } }
      : null;
  }
  if (type === 'discard') {
    if (!Array.isArray(cards) || cards.length < 1 || cards.length > NAPOLEON_MAX_DISCARDS) return null;
    const parsed = Array.from(cards, parseNapoleonCard);
    if (!parsed.every((entry): entry is NapoleonCard => entry !== null)
      || new Set(parsed.map(napoleonCardKey)).size !== parsed.length) return null;
    return { type, cards: parsed };
  }
  const parsed = parseNapoleonCard(card);
  if (!parsed) return null;
  if (type === 'call') return { type, card: parsed };
  if (type !== 'play' || (leadSuit !== undefined && !NAPOLEON_SUITS.includes(leadSuit))
    || (summon !== undefined && !NAPOLEON_SUMMONS.includes(summon))) return null;
  return { type, card: parsed,
    ...(leadSuit !== undefined ? { leadSuit: leadSuit as Suit } : {}),
    ...(summon !== undefined ? { summon: summon as NapoleonSummon } : {}) };
}

export function parseAction(value: unknown): NapoleonAction | string {
  return parseNapoleonAction(value) ?? 'Invalid action.';
}
