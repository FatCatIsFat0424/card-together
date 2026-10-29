import { RANK_DISPLAY } from '@shared/constants';
import type { Rank } from '@shared/types';
import type { GoFishFish } from '@shared/games/gofish/types';
import type { Translate } from '../client-game';

/** What an ask achieved: the cards handed over, or the fishing result. */
export function askOutcome(t: Translate, ask: { given: number; fished: GoFishFish | null; rank: Rank }): string {
  if (ask.given > 0) return t('gofish.logGot', { n: String(ask.given) });
  if (ask.fished === 'lucky') return t('gofish.logLucky', { rank: RANK_DISPLAY[ask.rank] });
  return t(ask.fished === 'empty' ? 'gofish.logEmpty' : 'gofish.logFish');
}
