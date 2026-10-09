import { useEffect } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Move focus into an overlay sheet when it opens and back to its trigger when it closes.
 * `isOverlay` is checked on open so the desktop column layout keeps focus where it is;
 * pass a stable (module-level) function.
 */
export function useSheetFocus(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  isOverlay: () => boolean,
  initialFocus: 'first' | 'panel' = 'first',
): void {
  useEffect(() => {
    if (!open || !isOverlay()) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel) return;
    const target = initialFocus === 'first' ? panel.querySelector<HTMLElement>(FOCUSABLE) : null;
    (target ?? panel).focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      // Restore only when focus would otherwise be lost inside the closed sheet.
      if (!active || active === document.body || panel.contains(active)) trigger?.focus({ preventScroll: true });
    };
  }, [open, panelRef, triggerRef, isOverlay, initialFocus]);
}
