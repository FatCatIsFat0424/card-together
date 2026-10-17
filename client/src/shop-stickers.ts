import type { ShopStickerId } from '@shared/types';
import tableHello from './assets/shop/stickers/table-hello.svg?no-inline';
import tableNice from './assets/shop/stickers/table-nice.svg?no-inline';
import tableThanks from './assets/shop/stickers/table-thanks.svg?no-inline';
import tableNext from './assets/shop/stickers/table-next.svg?no-inline';
import forestCheer from './assets/shop/stickers/forest-cheer.svg?no-inline';
import forestThink from './assets/shop/stickers/forest-think.svg?no-inline';
import forestWow from './assets/shop/stickers/forest-wow.svg?no-inline';
import forestRest from './assets/shop/stickers/forest-rest.svg?no-inline';
import spaceLaunch from './assets/shop/stickers/space-launch.svg?no-inline';
import spaceThink from './assets/shop/stickers/space-think.svg?no-inline';
import spaceStar from './assets/shop/stickers/space-star.svg?no-inline';
import spaceSleep from './assets/shop/stickers/space-sleep.svg?no-inline';
import catsHello from './assets/shop/stickers/cats-hello.svg?no-inline';
import catsFocus from './assets/shop/stickers/cats-focus.svg?no-inline';
import catsLove from './assets/shop/stickers/cats-love.svg?no-inline';
import catsNap from './assets/shop/stickers/cats-nap.svg?no-inline';
import oceanWave from './assets/shop/stickers/ocean-wave.svg?no-inline';
import oceanThink from './assets/shop/stickers/ocean-think.svg?no-inline';
import oceanCheer from './assets/shop/stickers/ocean-cheer.svg?no-inline';
import oceanRest from './assets/shop/stickers/ocean-rest.svg?no-inline';
import snacksHello from './assets/shop/stickers/snacks-hello.svg?no-inline';
import snacksWait from './assets/shop/stickers/snacks-wait.svg?no-inline';
import snacksYay from './assets/shop/stickers/snacks-yay.svg?no-inline';
import snacksFull from './assets/shop/stickers/snacks-full.svg?no-inline';
import weatherSunny from './assets/shop/stickers/weather-sunny.svg?no-inline';
import weatherCloudy from './assets/shop/stickers/weather-cloudy.svg?no-inline';
import weatherRainbow from './assets/shop/stickers/weather-rainbow.svg?no-inline';
import weatherNight from './assets/shop/stickers/weather-night.svg?no-inline';
import gardenHello from './assets/shop/stickers/garden-hello.svg?no-inline';
import gardenGrow from './assets/shop/stickers/garden-grow.svg?no-inline';
import gardenBloom from './assets/shop/stickers/garden-bloom.svg?no-inline';
import gardenRest from './assets/shop/stickers/garden-rest.svg?no-inline';
import arcadeReady from './assets/shop/stickers/arcade-ready.svg?no-inline';
import arcadeThink from './assets/shop/stickers/arcade-think.svg?no-inline';
import arcadeWin from './assets/shop/stickers/arcade-win.svg?no-inline';
import arcadePause from './assets/shop/stickers/arcade-pause.svg?no-inline';
import dragonsHello from './assets/shop/stickers/dragons-hello.svg?no-inline';
import dragonsPonder from './assets/shop/stickers/dragons-ponder.svg?no-inline';
import dragonsFire from './assets/shop/stickers/dragons-fire.svg?no-inline';
import dragonsSleep from './assets/shop/stickers/dragons-sleep.svg?no-inline';

import starfleetReady from './assets/shop/stickers/starfleet-ready.svg?no-inline';
import starfleetThink from './assets/shop/stickers/starfleet-think.svg?no-inline';
import starfleetCheer from './assets/shop/stickers/starfleet-cheer.svg?no-inline';
import starfleetRest from './assets/shop/stickers/starfleet-rest.svg?no-inline';
import shrineReady from './assets/shop/stickers/shrine-ready.svg?no-inline';
import shrineThink from './assets/shop/stickers/shrine-think.svg?no-inline';
import shrineCheer from './assets/shop/stickers/shrine-cheer.svg?no-inline';
import shrineRest from './assets/shop/stickers/shrine-rest.svg?no-inline';
import ironfrontReady from './assets/shop/stickers/ironfront-ready.svg?no-inline';
import ironfrontThink from './assets/shop/stickers/ironfront-think.svg?no-inline';
import ironfrontCheer from './assets/shop/stickers/ironfront-cheer.svg?no-inline';
import ironfrontRest from './assets/shop/stickers/ironfront-rest.svg?no-inline';
import neoncityReady from './assets/shop/stickers/neoncity-ready.svg?no-inline';
import neoncityThink from './assets/shop/stickers/neoncity-think.svg?no-inline';
import neoncityCheer from './assets/shop/stickers/neoncity-cheer.svg?no-inline';
import neoncityRest from './assets/shop/stickers/neoncity-rest.svg?no-inline';
import crownrealmReady from './assets/shop/stickers/crownrealm-ready.svg?no-inline';
import crownrealmThink from './assets/shop/stickers/crownrealm-think.svg?no-inline';
import crownrealmCheer from './assets/shop/stickers/crownrealm-cheer.svg?no-inline';
import crownrealmRest from './assets/shop/stickers/crownrealm-rest.svg?no-inline';

const seriesUrls = {
  'starfleet-ready': starfleetReady,
  'starfleet-think': starfleetThink,
  'starfleet-cheer': starfleetCheer,
  'starfleet-rest': starfleetRest,
  'shrine-ready': shrineReady,
  'shrine-think': shrineThink,
  'shrine-cheer': shrineCheer,
  'shrine-rest': shrineRest,
  'ironfront-ready': ironfrontReady,
  'ironfront-think': ironfrontThink,
  'ironfront-cheer': ironfrontCheer,
  'ironfront-rest': ironfrontRest,
  'neoncity-ready': neoncityReady,
  'neoncity-think': neoncityThink,
  'neoncity-cheer': neoncityCheer,
  'neoncity-rest': neoncityRest,
  'crownrealm-ready': crownrealmReady,
  'crownrealm-think': crownrealmThink,
  'crownrealm-cheer': crownrealmCheer,
  'crownrealm-rest': crownrealmRest,
};

const urls: Record<ShopStickerId, string> = {
  ...seriesUrls,
  'table-hello': tableHello,
  'table-nice': tableNice,
  'table-thanks': tableThanks,
  'table-next': tableNext,
  'forest-cheer': forestCheer,
  'forest-think': forestThink,
  'forest-wow': forestWow,
  'forest-rest': forestRest,
  'space-launch': spaceLaunch,
  'space-think': spaceThink,
  'space-star': spaceStar,
  'space-sleep': spaceSleep,
  'cats-hello': catsHello,
  'cats-focus': catsFocus,
  'cats-love': catsLove,
  'cats-nap': catsNap,
  'ocean-wave': oceanWave,
  'ocean-think': oceanThink,
  'ocean-cheer': oceanCheer,
  'ocean-rest': oceanRest,
  'snacks-hello': snacksHello,
  'snacks-wait': snacksWait,
  'snacks-yay': snacksYay,
  'snacks-full': snacksFull,
  'weather-sunny': weatherSunny,
  'weather-cloudy': weatherCloudy,
  'weather-rainbow': weatherRainbow,
  'weather-night': weatherNight,
  'garden-hello': gardenHello,
  'garden-grow': gardenGrow,
  'garden-bloom': gardenBloom,
  'garden-rest': gardenRest,
  'arcade-ready': arcadeReady,
  'arcade-think': arcadeThink,
  'arcade-win': arcadeWin,
  'arcade-pause': arcadePause,
  'dragons-hello': dragonsHello,
  'dragons-ponder': dragonsPonder,
  'dragons-fire': dragonsFire,
  'dragons-sleep': dragonsSleep,
};

export function shopStickerUrl(id: ShopStickerId, reducedMotion = false): string {
  return `${urls[id]}${reducedMotion ? '#still' : ''}`;
}
