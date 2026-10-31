import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useChatMentionStore } from '../stores/chat-mention-store';

interface ViewRect {
  readonly top: number; readonly bottom: number; readonly left: number; readonly right: number;
}

const readingLogs = new Map<HTMLElement, { visible: boolean; bottom: boolean }>();

function publishReading(): void {
  const logs = [...readingLogs.values()];
  useChatMentionStore.getState().setReading(logs.some((log) => log.visible), logs.some((log) => log.visible && log.bottom));
}

/** Require real visible area in both the scroll viewport and the browser viewport. */
export function intersectsChatViewport(row: ViewRect, log: ViewRect, width: number, height: number): boolean {
  return Math.min(row.bottom, log.bottom, height) > Math.max(row.top, log.top, 0)
    && Math.min(row.right, log.right, width) > Math.max(row.left, log.left, 0);
}

function chatLogViewport(log: HTMLElement): ViewRect | null {
  if (document.visibilityState !== 'visible' || !document.hasFocus() || log.clientHeight === 0) return null;
  const rect = log.getBoundingClientRect();
  let viewport: ViewRect = rect;
  for (let node: HTMLElement | null = log; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || style.display === 'none' || style.visibility === 'hidden'
      || style.visibility === 'collapse' || Number(style.opacity) === 0) return null;
    if (node === log) continue;
    const clipX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
    const clipY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
    if (!clipX && !clipY) continue;
    const bounds = node.getBoundingClientRect();
    viewport = {
      left: clipX ? Math.max(viewport.left, bounds.left) : viewport.left,
      right: clipX ? Math.min(viewport.right, bounds.right) : viewport.right,
      top: clipY ? Math.max(viewport.top, bounds.top) : viewport.top,
      bottom: clipY ? Math.min(viewport.bottom, bounds.bottom) : viewport.bottom,
    };
  }
  return intersectsChatViewport(viewport, viewport, window.innerWidth, window.innerHeight) ? viewport : null;
}

export function chatLogShown(log: HTMLElement, covered = false): boolean {
  return !covered && chatLogViewport(log) !== null;
}

/** Observers survive message updates; hidden, retained dock panels never acknowledge reads. */
export function useChatMentionReading(
  logRef: RefObject<HTMLDivElement | null>, following: RefObject<boolean>, roomCode: string | null, covered = false,
): void {
  const target = useChatMentionStore((state) => state.targetMessageId);
  const refresh = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { refresh.current?.(); }, [target, roomCode]);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const rows = new Set<HTMLElement>();
    const intersecting = new Set<HTMLElement>();
    let positioned: string | null = null;
    let frame: number | null = null;

    const update = (): void => {
      const state = useChatMentionStore.getState();
      const viewport = covered ? null : chatLogViewport(log);
      const shown = viewport !== null;
      const targetRow = state.targetMessageId === null ? undefined
        : [...rows].find((row) => row.dataset.chatMessageId === state.targetMessageId);
      if (shown && targetRow && positioned !== state.targetMessageId) {
        following.current = false;
        // An instant scroll makes the final position unambiguous to the visibility observer.
        log.scrollTop += targetRow.getBoundingClientRect().top - log.getBoundingClientRect().top
          - (log.clientHeight - targetRow.getBoundingClientRect().height) / 2;
        positioned = state.targetMessageId;
      }
      const bottom = shown && log.scrollHeight - log.scrollTop - log.clientHeight <= 24;
      readingLogs.set(log, { visible: shown, bottom });
      publishReading();
      if (!viewport) return;
      const visibleIds = [...intersecting].filter((row) => rows.has(row)
        && intersectsChatViewport(row.getBoundingClientRect(), viewport, window.innerWidth, window.innerHeight))
        .map((row) => row.dataset.chatMessageId).filter((id): id is string => Boolean(id));
      const unread = visibleIds.filter((id) => state.unreadIds.includes(id));
      if (unread.length) state.markRead(unread);
      if (positioned !== null && positioned === state.targetMessageId && visibleIds.includes(positioned)) {
        state.finishJump(positioned);
        positioned = null;
      }
    };
    const schedule = (): void => {
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; update(); });
    };
    const intersection = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!(entry.target instanceof HTMLElement)) continue;
        if (entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0) intersecting.add(entry.target);
        else intersecting.delete(entry.target);
      }
      schedule();
    }, { root: log, threshold: 0 });
    const syncRows = (): void => {
      const current = new Set(log.querySelectorAll<HTMLElement>('[data-chat-message-id]'));
      for (const row of rows) if (!current.has(row)) {
        intersection.unobserve(row); rows.delete(row); intersecting.delete(row);
      }
      for (const row of current) if (!rows.has(row)) { rows.add(row); intersection.observe(row); }
      schedule();
    };
    const messages = new MutationObserver(syncRows);
    messages.observe(log, { childList: true, subtree: true });
    const visibility = new MutationObserver(schedule);
    for (let node: HTMLElement | null = log; node; node = node.parentElement) {
      visibility.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
    }
    const resize = new ResizeObserver(schedule);
    resize.observe(log);
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('focus', schedule);
    window.addEventListener('blur', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    log.addEventListener('scroll', schedule);
    // Force the initial state even if this mount starts hidden.
    readingLogs.set(log, { visible: false, bottom: false });
    publishReading();
    refresh.current = schedule;
    syncRows();
    return () => {
      refresh.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
      messages.disconnect(); visibility.disconnect(); resize.disconnect(); intersection.disconnect();
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('blur', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      log.removeEventListener('scroll', schedule);
      readingLogs.delete(log);
      publishReading();
    };
  }, [logRef, following, covered]);
}
