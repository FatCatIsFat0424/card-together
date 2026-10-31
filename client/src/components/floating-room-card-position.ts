export interface FloatingCardPoint { x: number; y: number }
export interface FloatingCardSize { width: number; height: number }
export interface FloatingCardViewport extends FloatingCardSize { left: number; top: number }
export interface FloatingCardInsets { left: number; top: number; right: number; bottom: number }
export interface FloatingCardBounds { left: number; top: number; right: number; bottom: number }

/** Shell bars are anchored to the layout viewport; safe areas follow the visible viewport. */
export function floatingCardArea(
  viewport: Readonly<FloatingCardViewport>,
  shell: Readonly<Pick<FloatingCardInsets, 'left' | 'top'>>,
  safe: Readonly<FloatingCardInsets>,
): FloatingCardBounds {
  const right = viewport.left + viewport.width - Math.max(8, safe.right);
  const bottom = viewport.top + viewport.height - Math.max(8, safe.bottom);
  const left = Math.min(right, Math.max(shell.left + 8, viewport.left + Math.max(8, safe.left)));
  const top = Math.min(bottom, Math.max(shell.top + 8, viewport.top + Math.max(8, safe.top)));
  return { left, top, right: Math.max(left, right), bottom: Math.max(top, bottom) };
}

export function floatingCardBounds(area: Readonly<FloatingCardBounds>, size: Readonly<FloatingCardSize>): FloatingCardBounds {
  return { ...area, right: Math.max(area.left, area.right - size.width), bottom: Math.max(area.top, area.bottom - size.height) };
}

export function clampFloatingCard(point: Readonly<FloatingCardPoint>, bounds: Readonly<FloatingCardBounds>): FloatingCardPoint {
  return { x: Math.max(bounds.left, Math.min(bounds.right, point.x)), y: Math.max(bounds.top, Math.min(bounds.bottom, point.y)) };
}

export function normalizeFloatingCard(point: Readonly<FloatingCardPoint>, bounds: Readonly<FloatingCardBounds>): FloatingCardPoint {
  const clamped = clampFloatingCard(point, bounds);
  return {
    x: bounds.right === bounds.left ? 0 : (clamped.x - bounds.left) / (bounds.right - bounds.left),
    y: bounds.bottom === bounds.top ? 0 : (clamped.y - bounds.top) / (bounds.bottom - bounds.top),
  };
}

export function restoreFloatingCard(point: Readonly<FloatingCardPoint>, bounds: Readonly<FloatingCardBounds>): FloatingCardPoint {
  return clampFloatingCard({ x: bounds.left + point.x * (bounds.right - bounds.left), y: bounds.top + point.y * (bounds.bottom - bounds.top) }, bounds);
}

export function defaultFloatingCardPosition(messages: boolean, compact: boolean, landscape: boolean): FloatingCardPoint {
  return { x: messages || !compact || landscape ? 1 : 0, y: messages ? 0 : 1 };
}

export function floatingCardDragStarted(start: Readonly<FloatingCardPoint>, point: Readonly<FloatingCardPoint>): boolean {
  return Math.hypot(point.x - start.x, point.y - start.y) >= 6;
}

export function floatingCardKeyMove(key: string, shift: boolean): FloatingCardPoint | null {
  const step = shift ? 40 : 10;
  switch (key) {
    case 'ArrowLeft': return { x: -step, y: 0 };
    case 'ArrowRight': return { x: step, y: 0 };
    case 'ArrowUp': return { x: 0, y: -step };
    case 'ArrowDown': return { x: 0, y: step };
    default: return null;
  }
}
