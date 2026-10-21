const previews = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | null = null;

/** Prepare artwork before it scrolls into view; release animation and image DOM after it leaves. */
export function observeShopPreview(element: Element, update: (visible: boolean) => void, root: Element | null = null): () => void {
  if (typeof IntersectionObserver !== 'function') {
    update(true);
    return () => undefined;
  }
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) previews.get(entry.target)?.(entry.isIntersecting);
  }, { root, rootMargin: '400px 0px' });
  previews.set(element, update);
  observer.observe(element);
  return () => {
    previews.delete(element);
    observer?.unobserve(element);
    if (previews.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}
