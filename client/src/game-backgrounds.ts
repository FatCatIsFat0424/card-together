import type { GameType } from '@shared/types';
import bridge from './assets/lobby-backgrounds/bridge.webp';
import bigtwo from './assets/lobby-backgrounds/bigtwo.webp';
import redpoints from './assets/lobby-backgrounds/redpoints.webp';
import ninetynine from './assets/lobby-backgrounds/ninetynine.webp';
import sevens from './assets/lobby-backgrounds/sevens.webp';
import chinesepoker from './assets/lobby-backgrounds/chinesepoker.webp';
import liarsdeck from './assets/lobby-backgrounds/liarsdeck.webp';
import blackjack from './assets/lobby-backgrounds/blackjack.webp';
import holdem from './assets/lobby-backgrounds/holdem.webp';

// Napoleon shares the Bridge artwork until it has its own.
export const GAME_BACKGROUNDS: Readonly<Record<GameType, string>> = {
  bridge, bigtwo, redpoints, ninetynine, sevens, chinesepoker, liarsdeck, blackjack, holdem, napoleon: bridge,
};
