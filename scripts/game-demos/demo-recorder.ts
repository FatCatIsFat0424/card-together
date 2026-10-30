import { diffReplaySnapshot } from '../../shared/src/replay-patch';
import type { GameSeat, PlayerVisibleGameState } from '../../shared/src/types';
import type { DemoFixture, DemoStep } from './demo-fixture-types';

export const DEMO_NOW = 1_800_000_000_000;

function assertPrivateView(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertPrivateView(entry);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (['observedHands', 'observedDice', 'observer', 'replayRecording'].includes(key)) {
        throw new Error(`Unexpected observer data in tutorial: ${key}.`);
      }
      assertPrivateView(entry);
    }
  }
}

/** Stores only changes between filtered player views, keeping long board matches compact. */
export function createDemoRecorder(
  code: string,
  focusSeat: GameSeat,
  seats: readonly GameSeat[],
  read: () => PlayerVisibleGameState | null,
): {
  readonly act: (
    seat: GameSeat, action: unknown, chapter: string,
    apply: () => { readonly success: boolean; readonly reason?: string },
  ) => void;
  readonly finish: () => DemoFixture;
} {
  const capture = (): PlayerVisibleGameState => {
    const source = read();
    if (!source || source.mySeat !== focusSeat) throw new Error(`Missing tutorial player view in ${code}.`);
    const visible = structuredClone(source);
    delete visible.clock;
    delete visible.presentation;
    assertPrivateView(visible);
    return visible;
  };
  const initial = capture();
  let previous = initial;
  const steps: DemoStep[] = [];
  return {
    act: (actingSeat, action, chapter, apply): void => {
      const result = apply();
      if (!result.success) throw new Error(`${code}: ${result.reason ?? 'Tutorial action rejected'}.`);
      const next = capture();
      steps.push({ index: steps.length + 1, actingSeat, action: structuredClone(action), chapter,
        patch: diffReplaySnapshot(previous, next) });
      previous = next;
    },
    finish: (): DemoFixture => {
      if (!previous.result) throw new Error(`${code}: tutorial did not reach a result.`);
      return { code, focusSeat, seats, initial, steps, result: previous.result };
    },
  };
}
