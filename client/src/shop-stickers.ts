import type { ShopStickerId } from '@shared/types';
import tableHello from './assets/shop/stickers/table-hello.svg?no-inline';
import tableNice from './assets/shop/stickers/table-nice.svg?no-inline';
import tableThanks from './assets/shop/stickers/table-thanks.svg?no-inline';
import tableNext from './assets/shop/stickers/table-next.svg?no-inline';
import forestCheer from './assets/shop/stickers/forest-cheer.svg?no-inline';
import forestThink from './assets/shop/stickers/forest-think.svg?no-inline';
import forestWow from './assets/shop/stickers/forest-wow.svg?no-inline';
import forestRest from './assets/shop/stickers/forest-rest.svg?no-inline';

const urls: Record<ShopStickerId, string> = {
  'table-hello': tableHello,
  'table-nice': tableNice,
  'table-thanks': tableThanks,
  'table-next': tableNext,
  'forest-cheer': forestCheer,
  'forest-think': forestThink,
  'forest-wow': forestWow,
  'forest-rest': forestRest,
};

export function shopStickerUrl(id: ShopStickerId): string {
  return urls[id];
}
