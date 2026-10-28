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
import napoleon from './assets/lobby-backgrounds/napoleon.webp';
import bridgeCard from './assets/lobby-backgrounds/cards/bridge.webp';
import bigtwoCard from './assets/lobby-backgrounds/cards/bigtwo.webp';
import redpointsCard from './assets/lobby-backgrounds/cards/redpoints.webp';
import ninetynineCard from './assets/lobby-backgrounds/cards/ninetynine.webp';
import sevensCard from './assets/lobby-backgrounds/cards/sevens.webp';
import chinesepokerCard from './assets/lobby-backgrounds/cards/chinesepoker.webp';
import liarsdeckCard from './assets/lobby-backgrounds/cards/liarsdeck.webp';
import blackjackCard from './assets/lobby-backgrounds/cards/blackjack.webp';
import holdemCard from './assets/lobby-backgrounds/cards/holdem.webp';
import napoleonCard from './assets/lobby-backgrounds/cards/napoleon.webp';

/** A game without generated artwork is simply absent; consumers fall back to a plain panel. */
export const GAME_BACKGROUNDS: Readonly<Partial<Record<GameType, string>>> = {
  bridge, bigtwo, redpoints, ninetynine, sevens, chinesepoker, liarsdeck, blackjack, holdem, napoleon,
};

/** Small renditions of the lobby artwork for game cards. */
export const GAME_CARD_ART: Readonly<Partial<Record<GameType, string>>> = {
  bridge: bridgeCard, bigtwo: bigtwoCard, redpoints: redpointsCard, ninetynine: ninetynineCard,
  sevens: sevensCard, chinesepoker: chinesepokerCard, liarsdeck: liarsdeckCard, blackjack: blackjackCard,
  holdem: holdemCard, napoleon: napoleonCard,
};
