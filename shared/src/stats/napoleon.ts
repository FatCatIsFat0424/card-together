import type { GameSeat, NapoleonMatchResult } from '../types';
import { encodeContract } from './definitions';
import type { SeatFacts } from './facts';
import { factsBuilder } from './facts';

/** Every point card in the deck: A, K, Q and J of four suits. */
const ALL_POINT_CARDS = 16;

/**
 * Contracts the seat made as the Napoleon (alone, the highest one, no-trump ones) and the side taking
 * every point card, counted for the Napoleon and the secretary.
 */
export function napoleonFacts(result: NapoleonMatchResult, seat: GameSeat): SeatFacts {
  const facts = factsBuilder();
  const { contract } = result;
  const napoleon = seat === contract.napoleon;
  const declaring = napoleon || seat === result.secretarySeat;
  if (declaring && result.napoleonPoints === ALL_POINT_CARDS) facts.count('allSixteen');
  if (!napoleon || !result.napoleonWins) return facts;
  if (result.secretarySeat === null || result.secretarySeat === seat) facts.count('soloWins');
  if (contract.suit === 'nt') facts.count('ntMade');
  facts.value('topContract', encodeContract(contract.level, contract.suit));
  return facts;
}
