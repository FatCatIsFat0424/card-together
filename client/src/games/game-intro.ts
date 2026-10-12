import type { RoomInfo } from '@shared/types';

export type IntroStage = 'title' | 'players' | 'exit';
export const INTRO_REVEAL_MS = 950;
export const INTRO_EXIT_MS = 2450;
export const INTRO_END_MS = 2900;

/** Only a live waiting-room transition earns an intro, never a restored match. */
export function shouldStartGameIntro(previous: RoomInfo | null, next: RoomInfo | null,
  connected: boolean, visible: boolean, pathname: string): boolean {
  return Boolean(connected && visible && previous && next && previous.code === next.code
    && previous.status === 'waiting' && next.status === 'playing'
    && (pathname === `/room/${next.code}` || pathname === `/game/${next.code}`));
}

/** Absolute deadlines skip stale stages after a background-tab timer delay. */
export function scheduleGameIntro(startedAt: number, reduced: boolean, callbacks: {
  readonly stage: (stage: IntroStage) => void;
  readonly impact: () => void;
  readonly finish: () => void;
}): () => void {
  const reveal = reduced ? 0 : INTRO_REVEAL_MS;
  const exit = reduced ? 800 : INTRO_EXIT_MS;
  const end = reduced ? 1000 : INTRO_END_MS;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const schedule = (at: number, action: () => void): void => {
    timers.push(setTimeout(action, Math.max(0, startedAt + at - Date.now())));
  };
  schedule(reveal, () => {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= end) { callbacks.finish(); return; }
    if (elapsed >= exit) return;
    callbacks.stage('players');
    if (elapsed < reveal + 250) callbacks.impact();
  });
  schedule(exit, () => {
    if (Date.now() - startedAt >= end) callbacks.finish();
    else callbacks.stage('exit');
  });
  schedule(end, callbacks.finish);
  return () => timers.forEach(clearTimeout);
}
