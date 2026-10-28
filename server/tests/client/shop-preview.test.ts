import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getShopItem } from '@shared/constants';
import { observeShopPreview } from '../../../client/src/components/shop-preview-visibility';
import { ShopProductArt, ShopProductPreview } from '../../../client/src/components/ShopProductArt';
import { layeredShopArt } from '../../../client/src/cosmetics/art-layers/shop-art-layers';
import { layeredSeatPreview } from '../../../client/src/cosmetics/art-layers/seat-preview-art-layers';
import { shopArtworkUrl } from '../../../client/src/shop-art';
import { useMotionStore } from '../../../client/src/stores/motion-store';

const motion = vi.hoisted(() => ({ reducedMotion: false }));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string): string => `/api/media/${id}` }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: { account: null }) => unknown) => select({ account: null }),
}));
vi.mock('../../../client/src/stores/motion-store', () => ({
  useMotionStore: Object.assign((select: (state: typeof motion) => unknown) => select(motion), {
    getState: () => ({ setReducedMotion: (value: boolean) => { motion.reducedMotion = value; } }),
  }),
}));

const account = { avatar: 'cat', color: '#4a9eff', nickname: 'Shopper', avatarImage: null } as const;

afterEach(() => {
  vi.unstubAllGlobals();
  useMotionStore.getState().setReducedMotion(false);
});

describe('shop preview visibility', () => {
  it('shares observation, unloads distant previews, and ignores removed targets', () => {
    let notify: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    const observer = { observe, unobserve, disconnect } as unknown as IntersectionObserver;
    const createObserver = vi.fn(function (callback: IntersectionObserverCallback) {
      notify = callback;
      return observer;
    });
    vi.stubGlobal('IntersectionObserver', createObserver);
    const first = {} as Element;
    const second = {} as Element;
    const firstVisible = vi.fn();
    const secondVisible = vi.fn();
    const removeFirst = observeShopPreview(first, firstVisible);
    const removeSecond = observeShopPreview(second, secondVisible);
    const update = (target: Element, isIntersecting: boolean): void => {
      notify?.([{ target, isIntersecting } as IntersectionObserverEntry], observer);
    };
    try {
      expect(createObserver).toHaveBeenCalledTimes(1);
      expect(createObserver).toHaveBeenCalledWith(expect.any(Function), { root: null, rootMargin: '400px 0px' });
      expect(observe).toHaveBeenCalledTimes(2);
      expect(firstVisible).not.toHaveBeenCalled();
      update(first, true);
      update(first, false);
      expect(firstVisible.mock.calls).toEqual([[true], [false]]);
      removeFirst();
      update(first, true);
      update(second, true);
      expect(firstVisible).toHaveBeenCalledTimes(2);
      expect(secondVisible).toHaveBeenCalledWith(true);
      expect(disconnect).not.toHaveBeenCalled();
    } finally {
      removeFirst();
      removeSecond();
    }
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('observes each scroll root separately, so previews inside a dialog still report', () => {
    const created: { root: Element | null; notify: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('IntersectionObserver', vi.fn(function (this: unknown, notify: IntersectionObserverCallback, options: { root: Element | null }) {
      const disconnect = vi.fn();
      created.push({ root: options.root, notify, disconnect });
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect };
    }));
    const page = {} as Element;
    const inPage = {} as Element;
    const inDialog = {} as Element;
    const pageVisible = vi.fn();
    const dialogVisible = vi.fn();
    const removePage = observeShopPreview(inPage, pageVisible, page);
    const removeDialog = observeShopPreview(inDialog, dialogVisible, null);
    expect(created.map((entry) => entry.root)).toEqual([page, null]);
    created[1].notify([{ target: inDialog, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(dialogVisible).toHaveBeenCalledWith(true);
    expect(pageVisible).not.toHaveBeenCalled();
    removeDialog();
    expect(created[1].disconnect).toHaveBeenCalledTimes(1);
    expect(created[0].disconnect).not.toHaveBeenCalled();
    removePage();
    expect(created[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it.each(['card-face-four-color', 'sound-starfleet', 'chat-frame-starfleet', 'nameplate-starfleet'])(
    'keeps descriptive content while deferring the decorative %s tile preview', (id) => {
      vi.stubGlobal('IntersectionObserver', vi.fn());
      const distant = renderToStaticMarkup(createElement(ShopProductPreview, {
        item: getShopItem(id)!, account, className: 'preview', children: 'Product category',
      }));
      expect(distant).toBe('<div class="preview">Product category</div>');
    });

  it('renders the dialog copy of a sound pack with its sample button', () => {
    expect(renderToStaticMarkup(createElement(ShopProductArt, { item: getShopItem('sound-starfleet')!, account })))
      .toContain('<button');
  });

  it('renders artwork when observation is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const update = vi.fn();
    observeShopPreview({} as Element, update)();
    expect(update).toHaveBeenCalledWith(true);
    const html = renderToStaticMarkup(createElement(ShopProductPreview, {
      item: getShopItem('card-back-aurora')!, account, className: 'preview', children: null,
    }));
    expect(html).toContain('<img');
  });
});

describe('shop tile sizing', () => {
  const bordered = { ...account, avatarBorder: 'rabbit' } as const;

  it('puts the tile nameplate under a small avatar and keeps the dialog avatar large', () => {
    const item = getShopItem('nameplate-tide')!;
    expect(renderToStaticMarkup(createElement(ShopProductArt, { item, account: bordered, tile: true })))
      .toContain('data-avatar-size="row"');
    expect(renderToStaticMarkup(createElement(ShopProductArt, { item, account: bordered })))
      .toContain('data-avatar-size="large"');
  });

  it('fits the seat background avatar, decorations included, inside the scene', () => {
    const html = renderToStaticMarkup(createElement(ShopProductArt, { item: getShopItem('seat-tide')!, account: bordered }));
    expect(html).toMatch(/<div[^>]*inert=""[^>]*><div[^>]*><span[^>]*data-avatar-size="large"/);
  });
});

describe('shop animated background previews', () => {
  it.each(['card-back', 'table', 'seat'])('uses composited layers for %s and preserves the reduced-motion still image', (prefix) => {
    const item = getShopItem(`${prefix}-neoncity`)!;
    const layers = layeredShopArt(item.id) ?? layeredSeatPreview(item.id);
    expect(layers).not.toBeNull();
    const animated = renderToStaticMarkup(createElement(ShopProductArt, { item, account }));
    expect(animated).toContain('decoding="async"');
    expect(animated).not.toContain(shopArtworkUrl(item.id));
    useMotionStore.getState().setReducedMotion(true);
    const still = renderToStaticMarkup(createElement(ShopProductArt, { item, account }));
    expect(still).toContain(`${shopArtworkUrl(item.id)}#still`.replaceAll('&', '&amp;').replaceAll("'", '&#x27;').replaceAll('"', '&quot;'));
    expect(still).not.toContain('decoding="async"');
  });
});
