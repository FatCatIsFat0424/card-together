interface Watch {
  readonly update: (visible: boolean) => void;
  readonly root: Element | null;
}

const previews = new Map<Element, Watch>();
/** One observer per scroll root: an observer only reports targets inside its own root, so portals need their own. */
const observers = new Map<Element | null, IntersectionObserver>();

function observerFor(root: Element | null): IntersectionObserver {
  let observer = observers.get(root);
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) previews.get(entry.target)?.update(entry.isIntersecting);
    }, { root, rootMargin: '400px 0px' });
    observers.set(root, observer);
  }
  return observer;
}

/** Prepare artwork before it scrolls into view; release animation and image DOM after it leaves. */
export function observeShopPreview(element: Element, update: (visible: boolean) => void, root: Element | null = null): () => void {
  if (typeof IntersectionObserver !== 'function') {
    update(true);
    return () => undefined;
  }
  previews.set(element, { update, root });
  observerFor(root).observe(element);
  return () => {
    previews.delete(element);
    observers.get(root)?.unobserve(element);
    if (![...previews.values()].some((watch) => watch.root === root)) {
      observers.get(root)?.disconnect();
      observers.delete(root);
    }
  };
}
