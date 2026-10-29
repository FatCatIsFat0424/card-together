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
import tenhalf from './assets/lobby-backgrounds/tenhalf.webp';
import liarsdice from './assets/lobby-backgrounds/liarsdice.webp';
import crazyeights from './assets/lobby-backgrounds/crazyeights.webp';
import stud from './assets/lobby-backgrounds/stud.webp';
import reversi from './assets/lobby-backgrounds/reversi.webp';
import oldmaid from './assets/lobby-backgrounds/oldmaid.webp';
import gofish from './assets/lobby-backgrounds/gofish.webp';
import doudizhu from './assets/lobby-backgrounds/doudizhu.webp';
import jungle from './assets/lobby-backgrounds/jungle.webp';
import gomoku from './assets/lobby-backgrounds/gomoku.webp';
import xiangqi from './assets/lobby-backgrounds/xiangqi.webp';
import banqi from './assets/lobby-backgrounds/banqi.webp';
import chinesecheckers from './assets/lobby-backgrounds/chinesecheckers.webp';
import landbattle from './assets/lobby-backgrounds/landbattle.webp';
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
import tenhalfCard from './assets/lobby-backgrounds/cards/tenhalf.webp';
import liarsdiceCard from './assets/lobby-backgrounds/cards/liarsdice.webp';
import crazyeightsCard from './assets/lobby-backgrounds/cards/crazyeights.webp';
import studCard from './assets/lobby-backgrounds/cards/stud.webp';
import reversiCard from './assets/lobby-backgrounds/cards/reversi.webp';
import oldmaidCard from './assets/lobby-backgrounds/cards/oldmaid.webp';
import gofishCard from './assets/lobby-backgrounds/cards/gofish.webp';
import doudizhuCard from './assets/lobby-backgrounds/cards/doudizhu.webp';
import jungleCard from './assets/lobby-backgrounds/cards/jungle.webp';
import gomokuCard from './assets/lobby-backgrounds/cards/gomoku.webp';
import xiangqiCard from './assets/lobby-backgrounds/cards/xiangqi.webp';
import banqiCard from './assets/lobby-backgrounds/cards/banqi.webp';
import chinesecheckersCard from './assets/lobby-backgrounds/cards/chinesecheckers.webp';
import landbattleCard from './assets/lobby-backgrounds/cards/landbattle.webp';

/** A game without generated artwork is simply absent; consumers fall back to a plain panel. */
export const GAME_BACKGROUNDS: Readonly<Partial<Record<GameType, string>>> = {
  bridge, bigtwo, redpoints, ninetynine, sevens, chinesepoker, liarsdeck, blackjack, holdem, napoleon,
  tenhalf, liarsdice, crazyeights, stud, reversi, oldmaid, gofish, doudizhu, jungle, gomoku, xiangqi, banqi,
  chinesecheckers, landbattle,
};

/** Small renditions of the lobby artwork for game cards. */
export const GAME_CARD_ART: Readonly<Partial<Record<GameType, string>>> = {
  bridge: bridgeCard, bigtwo: bigtwoCard, redpoints: redpointsCard, ninetynine: ninetynineCard,
  sevens: sevensCard, chinesepoker: chinesepokerCard, liarsdeck: liarsdeckCard, blackjack: blackjackCard,
  holdem: holdemCard, napoleon: napoleonCard,
  tenhalf: tenhalfCard, liarsdice: liarsdiceCard, crazyeights: crazyeightsCard, stud: studCard, reversi: reversiCard,
  oldmaid: oldmaidCard, gofish: gofishCard, doudizhu: doudizhuCard, jungle: jungleCard, gomoku: gomokuCard, xiangqi: xiangqiCard,
  banqi: banqiCard, chinesecheckers: chinesecheckersCard, landbattle: landbattleCard,
};
